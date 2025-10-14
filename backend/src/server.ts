import express, { Request, Response } from 'express';
import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { initializeDatabase, cleanOldData } from './db/init';
import { fetchAndStoreMultipleTickers } from './services/dataCollector';
import {
  getCurrentData,
  getHistoricalData,
  getDataAtTimestamp,
  getAvailableTimestamps,
  getDataStatistics,
  getAvailableExpiries,
} from './services/dataRetrieval';

dotenv.config();

const app = express();
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
      console.warn(`⚠️  CORS blocked origin: ${origin}`);
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
 * Get current (most recent) data for a ticker
 */
app.get('/api/current-data', async (req: Request, res: Response) => {
  try {
    const { ticker } = req.query;

    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker parameter is required' });
    }

    const data = await getCurrentData(ticker.toUpperCase());

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

// ============= HELPER FUNCTIONS =============

/**
 * Check if US market is open
 */
function isUSMarketOpen(): boolean {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday

  // Not on weekends
  if (day === 0 || day === 6) return false;

  const currentMinutes = hours * 60 + minutes;
  const startMinutes = US_MARKET_START_HOUR * 60 + US_MARKET_START_MINUTE;
  const endMinutes = US_MARKET_END_HOUR * 60 + US_MARKET_END_MINUTE;

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
const cronSchedule = `*/${COLLECT_INTERVAL} * * * *`; // Every N minutes, all day

cron.schedule(cronSchedule, async () => {
  console.log(`\n⏰ [${new Date().toISOString()}] Scheduled data collection triggered`);
  try {
    await collectMarketData();
    await cleanOldData(DATA_RETENTION_DAYS);
  } catch (error) {
    console.error('❌ Scheduled data collection failed:', error);
  }
});

console.log(`⏰ Cron job scheduled: ${cronSchedule} (Every ${COLLECT_INTERVAL} mins, checks market hours)`);

/**
 * Clean old data daily at 2 AM UTC
 */
cron.schedule('0 2 * * *', async () => {
  console.log(`\n🧹 [${new Date().toISOString()}] Running daily cleanup`);
  try {
    await cleanOldData(DATA_RETENTION_DAYS);
  } catch (error) {
    console.error('❌ Daily cleanup failed:', error);
  }
});

// ============= SERVER STARTUP =============

async function startServer() {
  try {
    console.log('🚀 Starting Gamma Exposure Backend Server...\n');

    // Initialize database
    await initializeDatabase();

    // Initial data collection
    console.log('📊 Running initial data collection...');
    await collectMarketData();

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
