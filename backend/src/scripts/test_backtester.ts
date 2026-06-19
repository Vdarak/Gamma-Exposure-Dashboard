import * as path from 'path';
import * as dotenv from 'dotenv';
import dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

import { getAvailableTickers, getTickerDateRange } from '../backtester/duckdbService';
import { AIAnalystService } from '../services/aiAnalystService';

// Load environment variables
const backendEnvPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: backendEnvPath });

async function main() {
  console.log("=== Backtester Services Local Verification ===");
  console.log("DATA_DIR:", process.env.DATA_DIR);
  console.log("GEMINI_API_KEY Configured:", !!process.env.GEMINI_API_KEY);

  try {
    console.log("\nScanning available tickers...");
    const tickers = await getAvailableTickers();
    console.log("Available Tickers:", tickers);

    if (tickers.length > 0) {
      const testTicker = tickers[0];
      console.log(`\nFetching date range for: ${testTicker}`);
      const range = await getTickerDateRange(testTicker);
      console.log(`Date Range for ${testTicker}:`, range);
    } else {
      console.log("No tickers available. Check if DATA_DIR contains the daily_adjusted or intraday equities data.");
    }

    if (process.env.GEMINI_API_KEY) {
      console.log("\nTesting Gemini AI Strategy Parser...");
      const aiAnalyst = new AIAnalystService();
      const testStrategyDesc = "Buy when RSI 14 crosses below 30 and close is above EMA 50. Exit when price crosses below SMA 20. Stop loss at 2% and take profit at 5%.";
      console.log(`Prompt: "${testStrategyDesc}"`);
      const parsed = await aiAnalyst.parseStrategy(testStrategyDesc);
      console.log("Parsed Strategy Output:\n", JSON.stringify(parsed, null, 2));
    }
  } catch (err: any) {
    console.error("Verification error:", err);
  }
}

main();
