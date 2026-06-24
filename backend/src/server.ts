import express, { Request, Response } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

import { initializeDatabase, cleanOldData } from './db/init';
import { fetchAndStoreMultipleTickers, fetchAndStoreOptionData } from './services/dataCollector';
import {
  getCurrentData,
  getHistoricalData,
  getDataAtTimestamp,
  getAvailableTimestamps,
  getDataStatistics,
  getAvailableExpiries,
  getIntradayGexFlow,
  getHistoricalGexTrend,
} from './services/dataRetrieval';
import {
  getTrades,
  createTrade,
  updateTrade,
  deleteTrade,
  getSetting,
  updateSetting,
} from './services/journalService';
import { getOptionsFlowData } from './services/optionsFlowService';
import { getAvailableTickers, getTickerDateRange } from './backtester/duckdbService';
import { runBacktest } from './backtester/engine';
import { runOptionsBacktest } from './backtester/optionsEngine';
import { getStoredRates, updateRates } from './services/ratesService';
import { AIAnalystService } from './services/aiAnalystService';
import { getGarchForecast, getProbabilityMap, getQuantumTunneling } from './services/quantEngineService';
import { ingestCotData, getHistoricalCot } from './services/cotIngestionService';
import { pool } from './db/connection';

dotenv.config();

const app = express();
const aiAnalystService = new AIAnalystService();

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Ticker configuration
const US_TICKERS = (process.env.US_TICKERS || 'SPX,GLD,TSLA').split(',').map(t => t.trim());
const INDIA_TICKERS = (process.env.INDIA_TICKERS || 'NIFTY,BANKNIFTY,RELIANCE').split(',').map(t => t.trim());
const ALL_TICKERS = [...US_TICKERS, ...INDIA_TICKERS];

const COLLECT_INTERVAL = parseInt(process.env.COLLECT_INTERVAL_MINUTES || '15');
const DATA_RETENTION_DAYS = parseInt(process.env.DATA_RETENTION_DAYS || '3');

// US Market Hours (UTC)
const US_MARKET_START_HOUR = parseInt(process.env.US_MARKET_START_HOUR || '14');
const US_MARKET_START_MINUTE = parseInt(process.env.US_MARKET_START_MINUTE || '30');
const US_MARKET_END_HOUR = parseInt(process.env.US_MARKET_END_HOUR || '21');
const US_MARKET_END_MINUTE = parseInt(process.env.US_MARKET_END_MINUTE || '0');

// Indian Market Hours (UTC)
const INDIA_MARKET_START_HOUR = parseInt(process.env.INDIA_MARKET_START_HOUR || '3');
const INDIA_MARKET_START_MINUTE = parseInt(process.env.INDIA_MARKET_START_MINUTE || '45');
const INDIA_MARKET_END_HOUR = parseInt(process.env.INDIA_MARKET_END_HOUR || '10');
const INDIA_MARKET_END_MINUTE = parseInt(process.env.INDIA_MARKET_END_MINUTE || '0');

// Middleware
// Allow multiple origins for CORS (Vercel + localhost)
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:5173',
  'https://gamma-exposure-dashboard.vercel.app',
  /\.vercel\.app$/, // Allow all Vercel preview deployments
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') return allowed === origin;
      if (allowed instanceof RegExp) return allowed.test(origin);
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(null, true); // Allow anyway for now, remove in production
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Add request logging (only for non-health/non-polling endpoints to reduce log spam)
app.use((req, res, next) => {
  // Skip logging for health checks and frequent polling endpoints
  if (!req.path.includes('/health') && !req.path.includes('/current-data') && !req.path.includes('/timestamps')) {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// ============= API ROUTES =============

/**
 * Root landing endpoint
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Gamma Exposure Terminal API is active',
    health: '/health',
    status: 'online'
  });
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Also support /api/health for frontend
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Get stored interest / risk-free rates (US & India)
 */
app.get('/api/rates', async (req: Request, res: Response) => {
  try {
    const rates = await getStoredRates();
    res.json({
      success: true,
      ...rates,
    });
  } catch (error) {
    console.error('Error in /api/rates:', error);
    res.status(500).json({ error: 'Failed to fetch stored rates' });
  }
});


/**
 * Get current (most recent) data for a ticker
 */
app.get('/api/current-data', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    const tickerUpper = ticker.toUpperCase();
    let data = await getCurrentData(tickerUpper);

    if (!data) {
      console.log(`[Server] No database snapshots found for ${tickerUpper}. Triggering on-demand scrape...`);
      // Trigger synchronous fetch and store from CBOE/NSE
      const success = await fetchAndStoreOptionData(tickerUpper);
      if (success) {
        data = await getCurrentData(tickerUpper);
      }
    }

    if (!data) {
      return res.status(404).json({ error: `No data found for ticker ${ticker}` });
    }

    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/current-data:', error);
    res.status(500).json({ error: 'Failed to fetch current data' });
  }
});

/**
 * Get options flow data for a ticker
 */
app.get('/api/options/flow', async (req: Request, res: Response) => {
  try {
    const { ticker, timeframe, startDate } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    let tf: 'Intraday' | 'Daily' | '5-Day' | 'Custom' = 'Intraday';
    if (timeframe === 'Daily' || timeframe === '5-Day' || timeframe === 'Custom') {
      tf = timeframe;
    }

    const start = startDate ? String(startDate) : undefined;
    const response = await getOptionsFlowData(ticker.toUpperCase(), tf, start);

    res.json(response);
  } catch (error) {
    console.error('Error in /api/options/flow:', error);
    res.status(500).json({ error: 'Failed to fetch options flow data' });
  }
});

/**
 * AI Analyst - Generate GEX and options flow market briefing
 */
app.get('/api/analyze', async (req: Request, res: Response) => {
  try {
    const { ticker, timeframe } = req.query;
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    let tf: 'Intraday' | 'Daily' | '5-Day' = 'Intraday';
    if (timeframe === 'Daily' || timeframe === '5-Day') {
      tf = timeframe;
    }

    const briefing = await aiAnalystService.generateBriefing(ticker.toUpperCase(), tf);
    res.json({
      success: true,
      analysis: briefing,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/analyze:', error);
    res.status(500).json({ error: 'Failed to generate market briefing' });
  }
});

/**
 * AI Analyst - Chat with trade logging tool agent
 */
app.post('/api/analyst/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, ticker, livePrice, uiContext, is0DteMode, optionData } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const activeTicker = (typeof ticker === 'string' && ticker.trim()) ? ticker.trim().toUpperCase() : 'SPX';
    const result = await aiAnalystService.processChat(
      message,
      history || [],
      activeTicker,
      typeof livePrice === 'number' ? livePrice : undefined,
      uiContext,
      !!is0DteMode,
      optionData
    );
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in /api/analyst/chat:', error);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});



/**
 * Get intraday 0DTE GEX flow by strike for a given day
 */
app.get('/api/gex-flow', async (req: Request, res: Response) => {
  try {
    const { ticker, date } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    let flowDate = new Date();
    if (date && typeof date === 'string') {
      const parsed = Date.parse(date);
      if (!isNaN(parsed)) {
        flowDate = new Date(parsed);
      } else {
        return res.status(400).json({ error: 'Invalid date parameter' });
      }
    } else {
      const nyString = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      flowDate = new Date(nyString);
    }

    const data = await getIntradayGexFlow(ticker.toUpperCase(), flowDate);

    res.json({
      success: true,
      data,
      date: flowDate.toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/gex-flow:', error);
    res.status(500).json({ error: 'Failed to fetch GEX flow data' });
  }
});

/**
 * Get historical 30-day closing 0DTE GEX trend
 */
app.get('/api/historical-gex', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    const data = await getHistoricalGexTrend(ticker.toUpperCase());

    res.json({
      success: true,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/historical-gex:', error);
    res.status(500).json({ error: 'Failed to fetch historical GEX trend data' });
  }
});

/**
 * Get historical data for a ticker
 */
app.get('/api/historical-data', async (req: Request, res: Response) => {
  try {
    const { ticker, timestamp, startDate, endDate, hoursBack } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    let data;

    if (timestamp) {
      // Get data at specific timestamp
      data = await getDataAtTimestamp(
        ticker.toUpperCase(),
        new Date(timestamp as string)
      );
      data = data ? [data] : [];
    } else if (startDate && endDate) {
      // Get data in date range
      data = await getHistoricalData(
        ticker.toUpperCase(),
        undefined,
        new Date(startDate as string),
        new Date(endDate as string)
      );
    } else if (hoursBack) {
      // Get data for last N hours
      data = await getHistoricalData(
        ticker.toUpperCase(),
        parseInt(hoursBack as string)
      );
    } else {
      // Default: last 24 hours
      data = await getHistoricalData(ticker.toUpperCase(), 24);
    }

    res.json({
      success: true,
      data,
      count: Array.isArray(data) ? data.length : 1,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/historical-data:', error);
    res.status(500).json({ error: 'Failed to fetch historical data' });
  }
});

/**
 * Get all available timestamps for a ticker (for time machine slider)
 */
app.get('/api/timestamps', async (req: Request, res: Response) => {
  try {
    const { ticker, days } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    const daysBack = days ? parseInt(days as string) : DATA_RETENTION_DAYS;
    const timestamps = await getAvailableTimestamps(ticker.toUpperCase(), daysBack);

    res.json({
      success: true,
      data: timestamps,
      count: timestamps.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/timestamps:', error);
    res.status(500).json({ error: 'Failed to fetch timestamps' });
  }
});

/**
 * Get statistics about stored data
 */
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;
    const stats = await getDataStatistics(ticker as string | undefined);

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = value instanceof Date
    ? value.toISOString()
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Download collected option chain data for analysis.
 * Supports CSV (default) and JSON.
 */
app.get('/api/export/options', async (req: Request, res: Response) => {
  try {
    const { ticker, market, format, startDate, endDate, hoursBack } = req.query;

    const selectedFormat = typeof format === 'string' && format.toLowerCase() === 'json' ? 'json' : 'csv';
    const selectedTicker = typeof ticker === 'string' && ticker.trim() ? ticker.trim().toUpperCase() : undefined;
    const selectedMarket = typeof market === 'string' && market.trim()
      ? market.trim().toUpperCase()
      : undefined;

    let query = `
      SELECT
        s.id as snapshot_id,
        s.ticker,
        s.timestamp,
        s.spot_price,
        s.data_count,
        s.market,
        o.id as option_id,
        o.strike,
        o.option_type,
        o.expiration,
        o.last_price,
        o.bid,
        o.ask,
        o.volume,
        o.open_interest,
        o.implied_volatility,
        o.delta,
        o.gamma,
        o.theta,
        o.vega,
        o.rho,
        o.change_in_oi,
        o.total_buy_qty,
        o.total_sell_qty
      FROM option_snapshots s
      JOIN option_data o ON s.id = o.snapshot_id
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (selectedTicker) {
      query += ` AND s.ticker = $${paramIndex++}`;
      params.push(selectedTicker);
    }

    if (selectedMarket) {
      query += ` AND s.market = $${paramIndex++}`;
      params.push(selectedMarket);
    }

    if (typeof startDate === 'string' && typeof endDate === 'string') {
      query += ` AND s.timestamp BETWEEN $${paramIndex++} AND $${paramIndex++}`;
      params.push(new Date(startDate), new Date(endDate));
    } else if (typeof hoursBack === 'string' && hoursBack.trim()) {
      const hours = Number(hoursBack);
      if (Number.isFinite(hours) && hours > 0) {
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - hours);
        query += ` AND s.timestamp >= $${paramIndex++}`;
        params.push(cutoff);
      }
    }

    query += ` ORDER BY s.ticker, s.timestamp ASC, o.expiration ASC, o.strike ASC, o.option_type ASC`;

    const result = await pool.query(query, params);

    const rows = result.rows.map((row: any) => ({
      snapshot_id: row.snapshot_id,
      ticker: row.ticker,
      timestamp: new Date(row.timestamp).toISOString(),
      spot_price: row.spot_price,
      data_count: row.data_count,
      market: row.market,
      option_id: row.option_id,
      strike: row.strike,
      option_type: row.option_type,
      expiration: new Date(row.expiration).toISOString().split('T')[0],
      last_price: row.last_price,
      bid: row.bid,
      ask: row.ask,
      volume: row.volume,
      open_interest: row.open_interest,
      implied_volatility: row.implied_volatility,
      delta: row.delta,
      gamma: row.gamma,
      theta: row.theta,
      vega: row.vega,
      rho: row.rho,
      change_in_oi: row.change_in_oi,
      total_buy_qty: row.total_buy_qty,
      total_sell_qty: row.total_sell_qty,
    }));

    if (selectedFormat === 'json') {
      return res.json({
        success: true,
        count: rows.length,
        data: rows,
        filters: {
          ticker: selectedTicker ?? null,
          market: selectedMarket ?? null,
          startDate: typeof startDate === 'string' ? startDate : null,
          endDate: typeof endDate === 'string' ? endDate : null,
          hoursBack: typeof hoursBack === 'string' ? hoursBack : null,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const headers = [
      'snapshot_id', 'ticker', 'timestamp', 'spot_price', 'data_count', 'market', 'option_id',
      'strike', 'option_type', 'expiration', 'last_price', 'bid', 'ask', 'volume', 'open_interest',
      'implied_volatility', 'delta', 'gamma', 'theta', 'vega', 'rho', 'change_in_oi', 'total_buy_qty', 'total_sell_qty'
    ];

    const csv = [
      headers.join(','),
      ...rows.map(row => headers.map(header => escapeCsvValue((row as any)[header])).join(',')),
    ].join('\n');

    const safeTicker = selectedTicker || 'all';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="option-data-${safeTicker}-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error('Error in /api/export/options:', error);
    res.status(500).json({ error: 'Failed to export option chain data' });
  }
});

/**
 * Get available expiries for a ticker
 */
app.get('/api/expiries', async (req: Request, res: Response) => {
  try {
    const { ticker, timestamp } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    const timestampDate = timestamp ? new Date(timestamp as string) : undefined;
    const expiries = await getAvailableExpiries(ticker.toUpperCase(), timestampDate);

    res.json({
      success: true,
      data: expiries,
      count: expiries.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/expiries:', error);
    res.status(500).json({ error: 'Failed to fetch expiries' });
  }
});

// ============= BACKTEST API ROUTES =============

/**
 * Get tickers with available backtesting data
 */
app.get('/api/backtest/tickers', async (req: Request, res: Response) => {
  try {
    const tickers = await getAvailableTickers();
    res.json({
      success: true,
      data: tickers,
    });
  } catch (error) {
    console.error('Error in /api/backtest/tickers:', error);
    res.status(500).json({ error: 'Failed to fetch backtest tickers' });
  }
});

/**
 * Get ticker date range metadata
 */
app.get('/api/backtest/ticker-info', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker query parameter is required' });
    }
    const range = await getTickerDateRange(ticker);
    res.json({
      success: true,
      data: range,
    });
  } catch (error: any) {
    console.error(`Error in /api/backtest/ticker-info for ${req.query.ticker}:`, error);
    res.status(500).json({ error: error.message || 'Failed to fetch ticker date info' });
  }
});

/**
 * Parse plain English strategy description into structured parameters using Gemini
 */
app.post('/api/backtest/parse-strategy', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'Strategy description is required' });
    }
    const parsed = await aiAnalystService.parseStrategy(description);
    res.json({
      success: true,
      data: parsed,
    });
  } catch (error: any) {
    console.error('Error in /api/backtest/parse-strategy:', error);
    res.status(500).json({ error: error.message || 'Failed to parse strategy description' });
  }
});

/**
 * Run a backtest strategy simulation
 */
app.post('/api/backtest/run', async (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (!config || !config.ticker || !config.startDate || !config.endDate || !config.initialCapital) {
      return res.status(400).json({ error: 'Missing required backtest parameters' });
    }
    const result = await runBacktest(config);
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error in /api/backtest/run:', error);
    res.status(500).json({ error: error.message || 'Failed to run backtest simulation' });
  }
});

/**
 * Run a multi-leg options backtest strategy simulation
 */
app.post('/api/backtest/options/multileg', async (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (!config || !config.ticker || !config.startDate || !config.endDate || !config.initialCapital) {
      return res.status(400).json({ error: 'Missing required backtest parameters' });
    }
    const result = await runOptionsBacktest({
      ticker: config.ticker,
      startDate: config.startDate,
      endDate: config.endDate,
      strategyClass: 'multileg',
      takeProfitPercent: Number(config.takeProfitPercent) || 50,
      stopLossPercent: Number(config.stopLossPercent) || 50,
      initialCapital: Number(config.initialCapital) || 10000
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error in /api/backtest/options/multileg:', error);
    res.status(500).json({ error: error.message || 'Failed to run options multileg backtest' });
  }
});

/**
 * Run a single-leg options backtest strategy simulation
 */
app.post('/api/backtest/options/single-leg', async (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (!config || !config.ticker || !config.startDate || !config.endDate || !config.initialCapital || !config.strategyClass) {
      return res.status(400).json({ error: 'Missing required backtest parameters including strategyClass (e.g. atm_call)' });
    }
    const result = await runOptionsBacktest({
      ticker: config.ticker,
      startDate: config.startDate,
      endDate: config.endDate,
      strategyClass: config.strategyClass,
      takeProfitPercent: Number(config.takeProfitPercent) || 100,
      stopLossPercent: Number(config.stopLossPercent) || 50,
      initialCapital: Number(config.initialCapital) || 10000
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error in /api/backtest/options/single-leg:', error);
    res.status(500).json({ error: error.message || 'Failed to run options single-leg backtest' });
  }
});

// ============= JOURNAL API ROUTES =============

/**
 * Get all trades
 */
app.get('/api/journal/trades', async (req: Request, res: Response) => {
  try {
    const trades = await getTrades();
    res.json({
      success: true,
      data: trades,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching journal trades:', error);
    res.status(500).json({ error: 'Failed to fetch journal trades' });
  }
});

/**
 * Create a new trade
 */
app.post('/api/journal/trades', async (req: Request, res: Response) => {
  try {
    const tradeData = req.body;
    if (!tradeData.id || !tradeData.ticker || !tradeData.tradeDate || !tradeData.tradeType || !tradeData.direction || !tradeData.quality || tradeData.pnl === undefined) {
      return res.status(400).json({ error: 'Missing required trade parameters' });
    }
    const created = await createTrade(tradeData);
    res.status(201).json({
      success: true,
      data: created,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating journal trade:', error);
    res.status(500).json({ error: 'Failed to create journal trade' });
  }
});

/**
 * Update an existing trade
 */
app.put('/api/journal/trades/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const tradeData = req.body;
    const updated = await updateTrade(id, tradeData);
    if (!updated) {
      return res.status(404).json({ error: `Trade with ID ${id} not found` });
    }
    res.json({
      success: true,
      data: updated,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error updating journal trade ${id}:`, error);
    res.status(500).json({ error: 'Failed to update journal trade' });
  }
});

/**
 * Delete a trade
 */
app.delete('/api/journal/trades/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const deleted = await deleteTrade(id);
    if (!deleted) {
      return res.status(404).json({ error: `Trade with ID ${id} not found` });
    }
    res.json({
      success: true,
      message: 'Trade deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error deleting journal trade ${id}:`, error);
    res.status(500).json({ error: 'Failed to delete journal trade' });
  }
});

/**
 * Get a configuration setting
 */
app.get('/api/journal/settings/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  try {
    const value = await getSetting(key);
    res.json({
      success: true,
      key,
      value,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error fetching journal setting ${key}:`, error);
    res.status(500).json({ error: 'Failed to fetch journal setting' });
  }
});

// ============= QUANT SUITE API ENDPOINTS =============

/**
 * Get Breeden-Litzenberger Implied Probability Density Map
 */
app.get('/api/quant/probability-map', async (req: Request, res: Response) => {
  try {
    const { ticker, expiration } = req.query;
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }
    const expStr = typeof expiration === 'string' ? expiration : undefined;
    const data = await getProbabilityMap(ticker, expStr);
    res.json(data);
  } catch (error: any) {
    console.error('Error in /api/quant/probability-map:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate probability map' });
  }
});

/**
 * Get GARCH(1,1) Volatility forecast vs option IV term structure
 */
app.get('/api/quant/garch-forecast', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }
    const data = await getGarchForecast(ticker);
    res.json(data);
  } catch (error: any) {
    console.error('Error in /api/quant/garch-forecast:', error);
    res.status(500).json({ error: error.message || 'Failed to compute GARCH forecast' });
  }
});

/**
 * Get Quantum Tunneling wall breakthrough probabilities
 */
app.get('/api/quant/quantum-tunneling', async (req: Request, res: Response) => {
  try {
    const { ticker, expiries } = req.query;
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }
    const expiriesArray = typeof expiries === 'string' && expiries ? expiries.split(',') : undefined;
    const data = await getQuantumTunneling(ticker, expiriesArray);
    res.json(data);
  } catch (error: any) {
    console.error('Error in /api/quant/quantum-tunneling:', error);
    res.status(500).json({ error: error.message || 'Failed to compute quantum tunneling probabilities' });
  }
});

/**
 * Get CFTC COT Position Flow macro data
 */
app.get('/api/quant/cot-flow', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;
    const activeTicker = typeof ticker === 'string' ? ticker : 'SPX';
    const data = await getHistoricalCot(activeTicker);
    res.json({
      success: true,
      ticker: activeTicker.toUpperCase(),
      data
    });
  } catch (error: any) {
    console.error('Error in /api/quant/cot-flow:', error);
    res.status(500).json({ error: error.message || 'Failed to retrieve COT position flow' });
  }
});

/**
 * Update a configuration setting
 */
app.put('/api/journal/settings/:key', async (req: Request, res: Response) => {
  const { key } = req.params;
  try {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'Missing required value parameter' });
    }
    await updateSetting(key, String(value));
    res.json({
      success: true,
      message: `Setting ${key} updated successfully`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error updating journal setting ${key}:`, error);
    res.status(500).json({ error: 'Failed to update journal setting' });
  }
});

// ============= SAAS WAITLIST & BILLING ENDPOINTS =============

/**
 * POST /api/waitlist/signup
 * Add email to waitlist
 */
app.post('/api/waitlist/signup', async (req: Request, res: Response) => {
  try {
    const { email, tier } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email parameter is required' });
    }
    const selectedTier = typeof tier === 'string' ? tier : 'Free';
    const status = selectedTier === 'Free' ? 'paid' : 'pending';

    // Insert or update on conflict
    const query = `
      INSERT INTO waitlist_signups (email, tier, status)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) 
      DO UPDATE SET tier = EXCLUDED.tier, status = CASE WHEN waitlist_signups.status = 'paid' THEN 'paid' ELSE EXCLUDED.status END
      RETURNING *
    `;
    const result = await pool.query(query, [email.toLowerCase().trim(), selectedTier, status]);
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error in /api/waitlist/signup:', error);
    res.status(500).json({ error: error.message || 'Failed to submit waitlist signup' });
  }
});

/**
 * POST /api/billing/create-checkout-session
 * Create checkout session for paid waitlist pre-orders
 */
app.post('/api/billing/create-checkout-session', async (req: Request, res: Response) => {
  try {
    const { email, tier } = req.body;
    if (!email || !tier) {
      return res.status(400).json({ error: 'Email and tier are required' });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const sessionId = `cs_${Math.random().toString(36).substring(2, 15)}`;
    
    // Calculate price based on tier
    // Pro: $199/yr, Lifetime: $499
    let priceName = 'Pro Access';
    let amount = 19900; // in cents
    if (tier === 'Lifetime') {
      priceName = 'Lifetime Access';
      amount = 49900;
    }

    // Save initial pending state with session ID
    await pool.query(
      `INSERT INTO waitlist_signups (email, tier, status, stripe_session_id)
       VALUES ($1, $2, 'pending', $3)
       ON CONFLICT (email)
       DO UPDATE SET stripe_session_id = EXCLUDED.stripe_session_id, tier = EXCLUDED.tier
       WHERE waitlist_signups.status != 'paid'`,
      [email.toLowerCase().trim(), tier, sessionId]
    );

    if (stripeSecretKey) {
      // Real Stripe session creation if credentials exist
      try {
        const stripe = require('stripe')(stripeSecretKey);
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Gamma Exposure Terminal - ${priceName}`,
                description: 'Pre-order priority waitlist access and terminal premium tools.',
              },
              unit_amount: amount,
            },
            quantity: 1,
          }],
          mode: 'payment',
          customer_email: email,
          success_url: `${FRONTEND_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}&checkout=success`,
          cancel_url: `${FRONTEND_URL}/?checkout=cancel`,
        });

        // Update with the real Stripe session ID
        await pool.query(
          'UPDATE waitlist_signups SET stripe_session_id = $1 WHERE email = $2',
          [session.id, email.toLowerCase().trim()]
        );

        return res.json({
          success: true,
          sessionId: session.id,
          checkoutUrl: session.url
        });
      } catch (stripeError: any) {
        console.warn('Stripe checkout creation failed, falling back to simulation:', stripeError.message);
      }
    }

    // Fallback: Return simulated checkout url
    const simulatedCheckoutUrl = `${FRONTEND_URL}/checkout-session?session_id=${sessionId}&email=${encodeURIComponent(email)}&tier=${encodeURIComponent(tier)}`;
    res.json({
      success: true,
      sessionId,
      checkoutUrl: simulatedCheckoutUrl
    });
  } catch (error: any) {
    console.error('Error in /api/billing/create-checkout-session:', error);
    res.status(500).json({ error: error.message || 'Failed to create billing checkout session' });
  }
});

/**
 * POST /api/billing/webhook
 * Standard Stripe webhook listener (can be triggered by Stripe CLI or simulated)
 */
app.post('/api/billing/webhook', async (req: Request, res: Response) => {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    let event: any = req.body;
    let sessionId: string | undefined;

    if (stripeSecretKey && stripeWebhookSecret) {
      const stripe = require('stripe')(stripeSecretKey);
      const signature = req.headers['stripe-signature'];
      try {
        if (signature) {
          event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            stripeWebhookSecret
          );
        }
      } catch (err: any) {
        console.error(`⚠️ Webhook signature verification failed:`, err.message);
      }
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      sessionId = session.id;
      const email = session.customer_email || session.customer_details?.email;
      
      console.log(`💳 Stripe payment received for session ${sessionId} (${email})`);
      
      if (sessionId) {
        await pool.query(
          "UPDATE waitlist_signups SET status = 'paid' WHERE stripe_session_id = $1 OR (email = $2 AND status = 'pending')",
          [sessionId, email ? email.toLowerCase().trim() : '']
        );
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Error in /api/billing/webhook:', error);
    res.status(500).json({ error: error.message || 'Webhook handler failed' });
  }
});

/**
 * POST /api/billing/sim-payment-success
 * Developer simulation route to trigger webhook database updates for the simulated checkout flow
 */
app.post('/api/billing/sim-payment-success', async (req: Request, res: Response) => {
  try {
    const { sessionId, email } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    console.log(`💳 Simulated payment success callback triggered for session ${sessionId} (${email})`);
    
    const query = `
      UPDATE waitlist_signups 
      SET status = 'paid' 
      WHERE stripe_session_id = $1 OR (email = $2 AND status = 'pending')
      RETURNING *
    `;
    const result = await pool.query(query, [sessionId, email ? email.toLowerCase().trim() : '']);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No pending waitlist entry found for this session/email' });
    }

    res.json({
      success: true,
      message: 'Simulated payment processed successfully',
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error in /api/billing/sim-payment-success:', error);
    res.status(500).json({ error: error.message || 'Simulation payment handler failed' });
  }
});

// ============= HELPER FUNCTIONS =============

/**
 * Check if US market is open
 */
function isUSMarketOpen(): boolean {
  const now = new Date();
  const nyString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const nyDate = new Date(nyString);
  const day = nyDate.getDay(); // 0 = Sunday, 6 = Saturday

  // Not on weekends
  if (day === 0 || day === 6) return false;

  const hours = nyDate.getHours();
  const minutes = nyDate.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  // US market hours are 9:30 AM to 4:00 PM EST/EDT
  const startMinutes = 9 * 60 + 30; // 9:30 AM
  const endMinutes = 16 * 60; // 4:00 PM

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Check if Indian market is open
 */
function isIndiaMarketOpen(): boolean {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const day = now.getUTCDay();

  // Not on weekends
  if (day === 0 || day === 6) return false;

  const currentMinutes = hours * 60 + minutes;
  const startMinutes = INDIA_MARKET_START_HOUR * 60 + INDIA_MARKET_START_MINUTE;
  const endMinutes = INDIA_MARKET_END_HOUR * 60 + INDIA_MARKET_END_MINUTE;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Collect data for active markets
 */
async function collectMarketData() {
  const tickersToCollect: string[] = [];

  if (isUSMarketOpen()) {
    console.log('🇺🇸 US Market is OPEN');
    tickersToCollect.push(...US_TICKERS);
  } else {
    console.log('🇺🇸 US Market is CLOSED');
  }

  if (isIndiaMarketOpen()) {
    console.log('🇮🇳 Indian Market is OPEN');
    tickersToCollect.push(...INDIA_TICKERS);
  } else {
    console.log('🇮🇳 Indian Market is CLOSED');
  }

  if (tickersToCollect.length > 0) {
    await fetchAndStoreMultipleTickers(tickersToCollect);
  } else {
    console.log('⏸️  No markets open, skipping data collection');
  }
}

// ============= API ROUTES =============

/**
 * Manual trigger for data collection (useful for testing)
 */
app.post('/api/collect-now', async (req: Request, res: Response) => {
  try {
    console.log('📊 Manual data collection triggered');
    await fetchAndStoreMultipleTickers(ALL_TICKERS);

    res.json({
      success: true,
      message: `Data collection completed for ${ALL_TICKERS.join(', ')}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in /api/collect-now:', error);
    res.status(500).json({ error: 'Failed to collect data' });
  }
});

/**
 * Retrieve recorded historical suggestions
 */
app.get('/api/suggestions/history', async (req: Request, res: Response) => {
  try {
    const ticker = (req.query.ticker as string || 'SPX').toUpperCase();
    const result = await pool.query(
      `SELECT id, ticker, timestamp, spot_price as "spotPrice", suggestion_type as "suggestionType", title, description, strikes, entry_trigger as "entryTrigger", risk_reward as "riskReward", confidence_score as "confidenceScore", ppi, recorded_legs as "recordedLegs"
       FROM option_suggestions_history
       WHERE ticker = $1
       ORDER BY timestamp DESC
       LIMIT 100`,
      [ticker]
    );
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error: any) {
    console.error('Error in /api/suggestions/history:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch suggestions history' });
  }
});

/**
 * Manual trigger to log a suggestion
 */
app.post('/api/suggestions/collect', async (req: Request, res: Response) => {
  try {
    const ticker = (req.body?.ticker as string || 'SPX').toUpperCase();
    console.log(`📊 Manual option suggestion logging triggered for ${ticker}`);
    await recordOptionSuggestion(ticker);
    res.json({
      success: true,
      message: `Option suggestion logged for ${ticker}`
    });
  } catch (error: any) {
    console.error('Error in /api/suggestions/collect:', error);
    res.status(500).json({ error: error.message || 'Failed to log suggestion' });
  }
});

// ============= OPTION SUGGESTIONS RECORDER WORKER =============

async function recordOptionSuggestion(ticker: string) {
  try {
    const snapshot = await getCurrentData(ticker);
    if (!snapshot || !snapshot.options || snapshot.options.length === 0) {
      console.log(`[Suggestions Recorder] No current options data for ${ticker}, skipping.`);
      return;
    }

    const spot = snapshot.spotPrice;
    const options = snapshot.options;
    const referenceDate = new Date(snapshot.timestamp);
    
    let totalGEX = 0;
    const gexByStrike: Record<number, number> = {};
    const strikeOpenInterest: Record<number, { callOi: number; putOi: number }> = {};

    const now = new Date(snapshot.timestamp);
    now.setHours(0, 0, 0, 0);
    const expiries = Array.from(new Set(options.map(o => o.expiration.getTime())))
      .map(t => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime());
    const selectedExpiry = expiries.find(d => d >= now) || expiries[0] || new Date();

    options.forEach(opt => {
      const vol = opt.impliedVolatility > 1.0 ? opt.impliedVolatility / 100 : (opt.impliedVolatility > 0.01 ? opt.impliedVolatility : 0.3);
      const daysDiff = Math.max(1, Math.ceil((opt.expiration.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)));
      const T = daysDiff / 262;
      const r = 0.0525;
      const q = 0.0;

      let gamma = 0;
      if (T > 0 && vol > 0) {
        const d1 = (Math.log(spot / opt.strike) + (r - q + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
        const normPdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
        gamma = (Math.exp(-q * T) * normPdf) / (spot * vol * Math.sqrt(T));
      }

      let gexVal = opt.openInterest * 100 * spot * spot * 0.01 * gamma;
      if (opt.type === 'P') gexVal = -gexVal;

      totalGEX += gexVal;
      gexByStrike[opt.strike] = (gexByStrike[opt.strike] || 0) + gexVal;

      if (opt.expiration.toDateString() === selectedExpiry.toDateString()) {
        if (!strikeOpenInterest[opt.strike]) {
          strikeOpenInterest[opt.strike] = { callOi: 0, putOi: 0 };
        }
        if (opt.type === 'C') {
          strikeOpenInterest[opt.strike].callOi += opt.openInterest;
        } else {
          strikeOpenInterest[opt.strike].putOi += opt.openInterest;
        }
      }
    });

    // Find the nearest significant GEX cluster (GEX Magnet / Gravity Well)
    // We scan within a 1.5% localized window of the current spot price, falling back to global max if empty.
    const localizedRange = spot * 0.015;
    let maxGexStrike = 0;
    let maxGexVal = 0;
    let hasLocalizedMagnet = false;

    Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
      const strikeNum = parseFloat(strikeStr);
      if (Math.abs(strikeNum - spot) <= localizedRange) {
        if (Math.abs(val) > Math.abs(maxGexVal)) {
          maxGexVal = val;
          maxGexStrike = strikeNum;
          hasLocalizedMagnet = true;
        }
      }
    });

    if (!hasLocalizedMagnet) {
      Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
        const strikeNum = parseFloat(strikeStr);
        if (Math.abs(val) > Math.abs(maxGexVal)) {
          maxGexVal = val;
          maxGexStrike = strikeNum;
        }
      });
    }

    let callWall = spot * 1.01;
    let putWall = spot * 0.99;
    let maxCallOi = -1;
    let maxPutOi = -1;

    Object.entries(strikeOpenInterest).forEach(([strikeStr, oi]) => {
      const strikeNum = parseFloat(strikeStr);
      if (oi.callOi > maxCallOi) {
        maxCallOi = oi.callOi;
        callWall = strikeNum;
      }
      if (oi.putOi > maxPutOi) {
        maxPutOi = oi.putOi;
        putWall = strikeNum;
      }
    });

    // Find localized nearest GEX clusters above and below spot (for breakouts/squeezes)
    let strikeAbove = spot * 1.01;
    let strikeBelow = spot * 0.99;
    let maxGexAboveVal = 0;
    let maxGexBelowVal = 0;
    let hasLocalizedAbove = false;
    let hasLocalizedBelow = false;

    Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
      const strikeNum = parseFloat(strikeStr);
      if (strikeNum > spot && strikeNum <= spot + localizedRange) {
        if (val > maxGexAboveVal) {
          maxGexAboveVal = val;
          strikeAbove = strikeNum;
          hasLocalizedAbove = true;
        }
      } else if (strikeNum < spot && strikeNum >= spot - localizedRange) {
        if (Math.abs(val) > maxGexBelowVal) {
          maxGexBelowVal = Math.abs(val);
          strikeBelow = strikeNum;
          hasLocalizedBelow = true;
        }
      }
    });

    // Fallbacks to global if no localized clusters are found
    if (!hasLocalizedAbove) {
      Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
        const strikeNum = parseFloat(strikeStr);
        if (strikeNum > spot) {
          if (val > maxGexAboveVal) {
            maxGexAboveVal = val;
            strikeAbove = strikeNum;
          }
        }
      });
    }
    if (!hasLocalizedBelow) {
      Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
        const strikeNum = parseFloat(strikeStr);
        if (strikeNum < spot) {
          if (Math.abs(val) > maxGexBelowVal) {
            maxGexBelowVal = Math.abs(val);
            strikeBelow = strikeNum;
          }
        }
      });
    }

    const roundStrikeAbove = Math.round(strikeAbove / 5) * 5;
    const roundStrikeBelow = Math.round(strikeBelow / 5) * 5;

    const dateCT = new Date(snapshot.timestamp.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const hour = dateCT.getHours();
    const minutes = dateCT.getMinutes();
    const minutesTillClose = Math.max(5, Math.min(390, (16 - hour) * 60 - minutes));

    const isPosGex = totalGEX > 0;
    const proximity = Math.abs(spot - maxGexStrike) / spot;
    let ppi = 40;
    
    if (isPosGex) ppi += 20;
    else ppi -= 35;

    if (proximity < 0.001) ppi += 30;
    else if (proximity < 0.005) ppi += 15;
    else if (proximity > 0.015) ppi -= 20;

    if (minutesTillClose <= 60) ppi += 15;

    const finalPpi = Math.max(5, Math.min(95, ppi));
    const isPinRegime = finalPpi >= 55 || (totalGEX < 0 && proximity < 0.008);

    const distToCall = Math.abs(spot - callWall) / spot;
    const distToPut = Math.abs(spot - putWall) / spot;
    const callProb = Math.max(2, Math.min(98, Math.round((1 - distToCall) * 50 + (totalGEX < 0 ? 30 : -10))));
    const putProb = Math.max(2, Math.min(98, Math.round((1 - distToPut) * 50 + (totalGEX < 0 ? 30 : -10))));

    let type = "neutral_pin";
    let title = "";
    let description = "";
    let strikes = "";
    let confidenceScore = finalPpi;
    let entryTrigger = "";
    let riskReward = "";

    const formatCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

    if (isPinRegime) {
      if (totalGEX < 0) {
        type = "bearish_breakout";
        title = `${ticker} 0DTE Negative Pin Settlebomb`;
        description = `A massive negative GEX cluster at ${maxGexStrike} is acting as a gravity well. Despite negative gamma volatility, dealer hedging flows are trapping the index near this key strike.`;
        strikes = `BUY 1x SPX ${maxGexStrike - 10} Put / SELL 2x SPX ${maxGexStrike} Put / BUY 1x SPX ${maxGexStrike + 10} Put (0DTE Put Butterfly Spread)`;
        entryTrigger = `Enter when price oscillates within 0.5% of ${maxGexStrike} after 2:30 PM EST.`;
        riskReward = "Max Risk: $220 | Max Reward: $780 (per lot)";
        confidenceScore = Math.max(50, 90 - Math.round(proximity * 10000));
      } else {
        type = "neutral_pin";
        title = `${ticker} 0DTE Pin Settlebomb`;
        description = `Positive GEX cluster is acting as a major price magnet. Dealer hedging will compress volatility and pin the close near ${maxGexStrike}.`;
        strikes = `BUY 1x SPX ${maxGexStrike - 10} Call / SELL 2x SPX ${maxGexStrike} Call / BUY 1x SPX ${maxGexStrike + 10} Call (0DTE Butterfly Spread)`;
        entryTrigger = `Enter between 3:15 PM and 3:30 PM EST if price remains within 0.25% of ${maxGexStrike}.`;
        riskReward = "Max Risk: $180 | Max Reward: $820 (per lot)";
      }
    } else {
      const isCallWallProximity = Math.abs(spot - callWall) / spot < 0.003;
      const isPutWallProximity = Math.abs(spot - putWall) / spot < 0.003;

      if (spot >= callWall || isCallWallProximity) {
        type = "bullish_squeeze";
        title = `${ticker} 0DTE Squeeze Settlebomb (Target: ${roundStrikeAbove})`;
        description = `Spot is breaching Call Wall at ${callWall} in a Negative GEX regime. Dealer short-gamma covering will accelerate a sharp short-squeeze upward, pulling price toward the highest positive GEX cluster at ${roundStrikeAbove}.`;
        strikes = `BUY 1x SPX ${Math.round(callWall / 5) * 5} Call / SELL 1x SPX ${roundStrikeAbove} Call (0DTE Bull Call Spread)`;
        entryTrigger = `Enter on a solid 5-minute candle close above ${callWall} with rising options volume.`;
        riskReward = "Max Risk: $250 | Max Reward: Unlimited (Uncapped squeeze)";
        confidenceScore = Math.round(callProb * 0.9);
      } else if (spot <= putWall || isPutWallProximity) {
        type = "bearish_breakout";
        title = `${ticker} 0DTE Put Crash Settlebomb (Target: ${roundStrikeBelow})`;
        description = `Spot is cracking below Put Wall at ${putWall} in a Negative GEX regime. Dealer delta-hedging will dump futures, creating a cascading selloff toward the highest negative GEX cluster at ${roundStrikeBelow}.`;
        strikes = `BUY 1x SPX ${Math.round(putWall / 5) * 5} Put / SELL 1x SPX ${roundStrikeBelow} Put (0DTE Bear Put Spread)`;
        entryTrigger = `Enter on a solid 5-minute candle close below ${putWall} with high put buying flow.`;
        riskReward = "Max Risk: $300 | Max Reward: Unlimited";
        confidenceScore = Math.round(putProb * 0.9);
      } else {
        type = "credit_spread";
        title = `${ticker} 0DTE Range-Bound Credit Settlebomb`;
        description = `Volatility is elevated but spot sits in no-man's-land between ${putWall} and ${callWall}. Positive GEX walls are holding.`;
        strikes = `SELL 1x SPX ${Math.ceil(callWall / 5) * 5} Call / SELL 1x SPX ${Math.floor(putWall / 5) * 5} Put (0DTE Iron Condor)`;
        entryTrigger = `Enter if index stays in range during lunchtime (11:30 AM - 1:30 PM EST) and decay ramps.`;
        riskReward = "Max Risk: $400 | Max Reward: $100 (92% probability of full profit)";
        confidenceScore = 88;
      }
    }

    // ─── INSTITUTIONAL-GRADE DATA CAPTURE ───
    // Helper to format detailed contract statistics
    const getOptionDetails = (strikeNum: number, optionType: 'C' | 'P') => {
      const opt = options.find(o => 
        o.strike === strikeNum && 
        o.type === optionType && 
        o.expiration.toDateString() === selectedExpiry.toDateString()
      );
      if (!opt) return null;
      return {
        strike: opt.strike,
        type: opt.type,
        expiration: opt.expiration.toISOString(),
        last_price: Number(opt.lastPrice) || 0,
        bid: Number(opt.bid) || 0,
        ask: Number(opt.ask) || 0,
        mid_price: opt.bid && opt.ask ? (Number(opt.bid) + Number(opt.ask)) / 2 : Number(opt.lastPrice) || 0,
        volume: Number(opt.volume) || 0,
        open_interest: Number(opt.openInterest) || 0,
        implied_volatility: Number(opt.impliedVolatility) || 0,
        delta: Number(opt.delta) || 0,
        gamma: Number(opt.gamma) || 0,
        theta: Number(opt.theta) || 0,
        vega: Number(opt.vega) || 0,
        gex_bs: opt.openInterest * 100 * spot * spot * 0.01 * (opt.gamma || 0) * (opt.type === 'P' ? -1 : 1)
      };
    };

    // Find the closest option by delta for long single leg selections
    const findOptionByDelta = (optionType: 'C' | 'P', targetDelta: number) => {
      const expiryOptions = options.filter(o => 
        o.type === optionType && 
        o.expiration.toDateString() === selectedExpiry.toDateString()
      );
      if (expiryOptions.length === 0) return null;
      const closestOpt = expiryOptions.reduce((closest, current) => {
        const currentDiff = Math.abs(Math.abs(current.delta || 0) - targetDelta);
        const closestDiff = Math.abs(Math.abs(closest.delta || 0) - targetDelta);
        return currentDiff < closestDiff ? current : closest;
      });
      return getOptionDetails(closestOpt.strike, optionType);
    };

    // Identify closest ATM strikes
    const sortedStrikes = Array.from(new Set(options.map(o => o.strike))).sort((a, b) => a - b);
    const closestStrikeAboveSpot = sortedStrikes.find(s => s >= spot) || spot * 1.001;
    const closestStrikeBelowSpot = [...sortedStrikes].reverse().find(s => s <= spot) || spot * 0.999;

    // Gather long single leg contracts (ATM, OTM 25-delta, OTM 15-delta)
    const singleLegs = {
      atm_call: getOptionDetails(closestStrikeAboveSpot, 'C'),
      atm_put: getOptionDetails(closestStrikeBelowSpot, 'P'),
      otm_25d_call: findOptionByDelta('C', 0.25),
      otm_25d_put: findOptionByDelta('P', 0.25),
      otm_15d_call: findOptionByDelta('C', 0.15),
      otm_15d_put: findOptionByDelta('P', 0.15),
    };

    // Gather specific recommended strategy legs
    const strategyLegs: any[] = [];
    if (isPinRegime) {
      const strategyOptionType = totalGEX < 0 ? 'P' : 'C';
      // Butterfly Spread
      const leg1 = getOptionDetails(maxGexStrike - 10, strategyOptionType);
      const leg2 = getOptionDetails(maxGexStrike, strategyOptionType);
      const leg3 = getOptionDetails(maxGexStrike + 10, strategyOptionType);
      if (leg1) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1 });
      if (leg2) strategyLegs.push({ action: 'SELL', ratio: 2, contract: leg2 });
      if (leg3) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg3 });
    } else {
      const isCallWallProximity = Math.abs(spot - callWall) / spot < 0.003;
      const isPutWallProximity = Math.abs(spot - putWall) / spot < 0.003;

      if (spot >= callWall || isCallWallProximity) {
        // Bull Call Spread
        const buyStrike = Math.round(callWall / 5) * 5;
        const sellStrike = roundStrikeAbove;
        const leg1 = getOptionDetails(buyStrike, 'C');
        const leg2 = getOptionDetails(sellStrike, 'C');
        if (leg1) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1 });
        if (leg2) strategyLegs.push({ action: 'SELL', ratio: 1, contract: leg2 });
      } else if (spot <= putWall || isPutWallProximity) {
        // Bear Put Spread
        const buyStrike = Math.round(putWall / 5) * 5;
        const sellStrike = roundStrikeBelow;
        const leg1 = getOptionDetails(buyStrike, 'P');
        const leg2 = getOptionDetails(sellStrike, 'P');
        if (leg1) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1 });
        if (leg2) strategyLegs.push({ action: 'SELL', ratio: 1, contract: leg2 });
      } else {
        // Iron Condor (Short Call/Put with protective wings)
        const shortCall = Math.ceil(callWall / 5) * 5;
        const longCall = shortCall + 10;
        const shortPut = Math.floor(putWall / 5) * 5;
        const longPut = shortPut - 10;

        const leg1ShortCall = getOptionDetails(shortCall, 'C');
        const leg1LongCall = getOptionDetails(longCall, 'C');
        const leg2ShortPut = getOptionDetails(shortPut, 'P');
        const leg2LongPut = getOptionDetails(longPut, 'P');

        if (leg1ShortCall) strategyLegs.push({ action: 'SELL', ratio: 1, contract: leg1ShortCall });
        if (leg1LongCall) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1LongCall });
        if (leg2ShortPut) strategyLegs.push({ action: 'SELL', ratio: 1, contract: leg2ShortPut });
        if (leg2LongPut) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg2LongPut });
      }
    }

    const recordedLegs = {
      single_legs: singleLegs,
      strategy_legs: strategyLegs
    };

    await pool.query(
      `INSERT INTO option_suggestions_history (
        ticker, timestamp, spot_price, suggestion_type, title, description, strikes, entry_trigger, risk_reward, confidence_score, ppi, recorded_legs
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        ticker,
        snapshot.timestamp,
        spot,
        type,
        title,
        description,
        strikes,
        entryTrigger,
        riskReward,
        confidenceScore,
        finalPpi,
        JSON.stringify(recordedLegs)
      ]
    );

    console.log(`[Suggestions Recorder] Successfully logged suggestion: ${title} for ${ticker} at ${snapshot.timestamp} with detailed contract prints.`);
  } catch (error) {
    console.error(`[Suggestions Recorder] Failed to log option suggestion for ${ticker}:`, error);
  }
}

// ============= SCHEDULED TASKS =============

/**
 * Schedule option suggestions logging every 15 minutes during market hours
 */
cron.schedule('*/15 * * * 1-5', async () => {
  const now = new Date();
  const dateET = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = dateET.getHours();
  const minutes = dateET.getMinutes();
  
  // Market hours: 9:30 AM to 4:00 PM EST. 9:45 AM ET to 4:00 PM ET is the target logging window
  const isMarketSession = (hour === 9 && minutes >= 45) || (hour > 9 && hour < 16) || (hour === 16 && minutes === 0);
  
  if (isMarketSession) {
    console.log(`\n⏰ [${new Date().toISOString()}] Recording option suggestion snapshot for SPX`);
    await recordOptionSuggestion('SPX');
  }
});

console.log('⏰ Option suggestion logging scheduled: every 15 mins during market hours (9:45 AM to 4:00 PM ET)');


/**
 * Schedule data collection every N minutes
 * Checks if markets are open before collecting
 */
const cronSchedule = `*/5 * * * *`; // Every 5 minutes, all day

cron.schedule(cronSchedule, async () => {
  console.log(`\n⏰ [${new Date().toISOString()}] Scheduled data collection triggered`);
  try {
    await collectMarketData();
  } catch (error) {
    console.error('❌ Scheduled data collection failed:', error);
  }
});

console.log(`⏰ Cron job scheduled: ${cronSchedule} (Every 5 mins, checks market hours)`);

/**
 * Clean old data daily at 2 AM UTC - INACTIVE (data is persisted permanently)
 */
cron.schedule('0 2 * * *', async () => {
  console.log(`\n🧹 [${new Date().toISOString()}] Daily cleanup is INACTIVE (all snapshots are persisted permanently)`);
});

/**
 * Schedule interest rates update at Start of Day and End of Day (UTC)
 * 03:00 UTC (~8:30 AM IST / India SOD), 10:30 UTC (~4:00 PM IST / India EOD),
 * 13:00 UTC (~9:00 AM EST / US SOD), 20:30 UTC (~4:30 PM EST / US EOD)
 */
cron.schedule('0 3,10,13,20 * * *', async () => {
  console.log(`\n⏰ [${new Date().toISOString()}] Scheduled interest rates update triggered`);
  try {
    await updateRates();
  } catch (error) {
    console.error('❌ Scheduled interest rates update failed:', error);
  }
});

console.log('⏰ Interest rate cron job scheduled: at SOD & EOD for US/India (3 AM, 10 AM, 1 PM, 8 PM UTC)');

/**
 * Schedule weekly Commitment of Traders (COT) report update
 * Every Saturday at 4:00 AM UTC
 */
cron.schedule('0 4 * * 6', async () => {
  console.log(`\n⏰ [${new Date().toISOString()}] Scheduled COT data ingestion triggered`);
  try {
    await ingestCotData();
  } catch (error) {
    console.error('❌ Scheduled COT data ingestion failed:', error);
  }
});

console.log('⏰ COT weekly cron job scheduled: Saturdays at 4:00 AM UTC');

// ============= SERVER STARTUP =============

async function startServer() {
  try {
    console.log('🚀 Starting Gamma Exposure Backend Server...\n');

    // Initialize database
    try {
      await initializeDatabase();
    } catch (e) {
      console.error('⚠️ Failed to initialize database (Postgres might be offline):', e);
    }

    // Initial rates fetch / seed
    console.log('📊 Fetching and seeding initial interest rates...');
    try {
      await getStoredRates();
    } catch (e) {
      console.error('⚠️ Failed to fetch initial rates:', e);
    }

    // Ingest/seed COT data
    console.log('📊 Fetching and seeding Commitment of Traders (COT) macro data...');
    try {
      await ingestCotData();
    } catch (e) {
      console.error('⚠️ Failed to ingest/seed COT data:', e);
    }

    // Initial data collection
    console.log('📊 Running initial data collection...');
    try {
      await collectMarketData();
    } catch (e) {
      console.error('⚠️ Failed to run initial data collection (Postgres might be offline):', e);
    }


    // Start Express server
    app.listen(PORT, () => {
      console.log(`\n✅ Server is running on port ${PORT}`);
      console.log(`📊 US Market Tickers: ${US_TICKERS.join(', ')}`);
      console.log(`📊 Indian Market Tickers: ${INDIA_TICKERS.join(', ')}`);
      console.log(`⏰ Collection interval: ${COLLECT_INTERVAL} minutes`);
      console.log(`🗄️  Data retention: ${DATA_RETENTION_DAYS} days`);
      console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
      console.log(`\n🕐 Market Hours (UTC):`);
      console.log(`   🇺🇸 US: ${US_MARKET_START_HOUR}:${String(US_MARKET_START_MINUTE).padStart(2, '0')} - ${US_MARKET_END_HOUR}:${String(US_MARKET_END_MINUTE).padStart(2, '0')}`);
      console.log(`   🇮🇳 India: ${INDIA_MARKET_START_HOUR}:${String(INDIA_MARKET_START_MINUTE).padStart(2, '0')} - ${INDIA_MARKET_END_HOUR}:${String(INDIA_MARKET_END_MINUTE).padStart(2, '0')}`);
      console.log(`\n🎯 API Endpoints:`);
      console.log(`   GET  /health - Health check`);
      console.log(`   GET  /api/current-data?ticker=SPX - Latest snapshot`);
      console.log(`   GET  /api/historical-data?ticker=SPX&hoursBack=24 - Historical data`);
      console.log(`   GET  /api/timestamps?ticker=SPX - Available timestamps`);
      console.log(`   GET  /api/stats - Database statistics`);
      console.log(`   GET  /api/backtest/tickers - Backtest available tickers`);
      console.log(`   POST /api/backtest/run - Execute backtest simulation`);
      console.log(`   POST /api/collect-now - Manual data collection\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
