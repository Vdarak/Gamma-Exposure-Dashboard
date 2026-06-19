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
import { getStoredRates, updateRates } from './services/ratesService';
import { AIAnalystService } from './services/aiAnalystService';

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
app.use(express.json());

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
    const { message, history, ticker, livePrice } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const activeTicker = (typeof ticker === 'string' && ticker.trim()) ? ticker.trim().toUpperCase() : 'SPX';
    const result = await aiAnalystService.processChat(message, history || [], activeTicker, typeof livePrice === 'number' ? livePrice : undefined);
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

// ============= SCHEDULED TASKS =============

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
