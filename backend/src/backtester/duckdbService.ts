import * as fs from 'fs';
import * as path from 'path';
import duckdb from 'duckdb';

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const RAW_DIR = path.join(DATA_DIR, 'alpha_vantage/raw');
const PARQUET_DIR = path.join(DATA_DIR, 'alpha_vantage/parquet');

export interface PriceBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// In-process DuckDB database instance
const db = new duckdb.Database(':memory:');

export function query(sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, res) => {
      if (err) {
        console.error(`DuckDB Query Error: ${sql}\nError:`, err);
        reject(err);
      } else {
        resolve(res);
      }
    });
  });
}

/**
 * Checks if a directory contains any parquet files
 */
function hasParquetFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    const files = fs.readdirSync(dir);
    return files.some(file => file.endsWith('.parquet'));
  } catch {
    return false;
  }
}

/**
 * Get available tickers in raw or parquet data folders
 */
export async function getAvailableTickers(): Promise<string[]> {
  const tickers = new Set<string>();
  
  // Scan raw daily adjusted folder
  const rawDailyDir = path.join(RAW_DIR, 'equities/daily_adjusted');
  if (fs.existsSync(rawDailyDir)) {
    fs.readdirSync(rawDailyDir).forEach(file => {
      if (file.endsWith('.csv')) {
        tickers.add(file.replace('.csv', ''));
      }
    });
  }

  // Scan parquet daily adjusted folder
  const parquetDailyDir = path.join(PARQUET_DIR, 'equities/daily_adjusted');
  if (fs.existsSync(parquetDailyDir)) {
    fs.readdirSync(parquetDailyDir).forEach(file => {
      if (file.endsWith('.parquet')) {
        tickers.add(file.replace('.parquet', ''));
      }
    });
  }

  // Scan raw intraday folder
  const rawIntradayDir = path.join(RAW_DIR, 'equities/intraday');
  if (fs.existsSync(rawIntradayDir)) {
    fs.readdirSync(rawIntradayDir).forEach(file => {
      tickers.add(file);
    });
  }

  // Scan parquet intraday folder
  const parquetIntradayDir = path.join(PARQUET_DIR, 'equities/intraday');
  if (fs.existsSync(parquetIntradayDir)) {
    fs.readdirSync(parquetIntradayDir).forEach(file => {
      tickers.add(file);
    });
  }

  return Array.from(tickers).sort();
}

/**
 * Load price bars for backtesting
 */
export async function loadHistoricalData(
  ticker: string,
  timeframe: string,
  startDate: string,
  endDate: string
): Promise<PriceBar[]> {
  const tickerUpper = ticker.toUpperCase();
  
  if (timeframe === '1d') {
    // ─── DAILY TIMEFRAME ───
    const parquetPath = path.join(PARQUET_DIR, `equities/daily_adjusted/${tickerUpper}.parquet`);
    const csvPath = path.join(RAW_DIR, `equities/daily_adjusted/${tickerUpper}.csv`);
    
    let sourcePath = '';
    let readFunc = '';
    
    if (fs.existsSync(parquetPath)) {
      sourcePath = parquetPath;
      readFunc = 'read_parquet';
    } else if (fs.existsSync(csvPath)) {
      sourcePath = csvPath;
      readFunc = 'read_csv_auto';
    } else {
      throw new Error(`No daily historical data found for ticker ${tickerUpper}. Checked Parquet and CSV paths.`);
    }

    // Load daily bars, sorting by date ascending
    const sql = `
      SELECT 
        timestamp::VARCHAR as timestamp,
        open::DOUBLE as open,
        high::DOUBLE as high,
        low::DOUBLE as low,
        adjusted_close::DOUBLE as close,
        volume::DOUBLE as volume
      FROM ${readFunc}('${sourcePath}')
      WHERE timestamp >= '${startDate}' AND timestamp <= '${endDate}'
      ORDER BY timestamp ASC
    `;
    
    const results = await query(sql);
    return results.map(row => ({
      timestamp: row.timestamp.split(' ')[0], // Format as "YYYY-MM-DD"
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume
    }));
  } else {
    // ─── INTRADAY TIMEFRAME (1m, 5m, 15m, 30m, 1h) ───
    // Load from intraday 1min files
    const parquetDir = path.join(PARQUET_DIR, `equities/intraday/${tickerUpper}/1min`);
    const csvDir = path.join(RAW_DIR, `equities/intraday/${tickerUpper}/1min`);
    
    let sourceGlob = '';
    let readFunc = '';
    
    if (hasParquetFiles(parquetDir)) {
      sourceGlob = path.join(parquetDir, '*.parquet');
      readFunc = 'read_parquet';
    } else if (fs.existsSync(csvDir)) {
      sourceGlob = path.join(csvDir, '*.csv');
      readFunc = 'read_csv_auto';
    } else {
      throw new Error(`No 1-minute intraday data found for ticker ${tickerUpper}. Checked Parquet and CSV paths.`);
    }

    // Determine the aggregation interval in minutes
    let aggMinutes = 1;
    if (timeframe === '5m') aggMinutes = 5;
    else if (timeframe === '15m') aggMinutes = 15;
    else if (timeframe === '30m') aggMinutes = 30;
    else if (timeframe === '1h') aggMinutes = 60;

    let sql = '';
    if (aggMinutes === 1) {
      // Direct load
      sql = `
        SELECT 
          timestamp::VARCHAR as timestamp,
          open::DOUBLE as open,
          high::DOUBLE as high,
          low::DOUBLE as low,
          close::DOUBLE as close,
          volume::DOUBLE as volume
        FROM ${readFunc}('${sourceGlob}')
        WHERE timestamp >= '${startDate} 00:00:00' AND timestamp <= '${endDate} 23:59:59'
        ORDER BY timestamp ASC
      `;
    } else {
      // Aggregate 1-minute bars using DuckDB window/grouping functions
      // We truncate the timestamp to the lower boundaries of the bar interval
      sql = `
        WITH grouped_bars AS (
          SELECT 
            time_bucket(INTERVAL '${aggMinutes} minutes', timestamp) AS bucket_time,
            timestamp,
            open,
            high,
            low,
            close,
            volume
          FROM ${readFunc}('${sourceGlob}')
          WHERE timestamp >= '${startDate} 00:00:00' AND timestamp <= '${endDate} 23:59:59'
        ),
        ranked_bars AS (
          SELECT
            bucket_time,
            open,
            close,
            volume,
            row_number() OVER (PARTITION BY bucket_time ORDER BY timestamp ASC) as rn_first,
            row_number() OVER (PARTITION BY bucket_time ORDER BY timestamp DESC) as rn_last
          FROM grouped_bars
        )
        SELECT 
          g.bucket_time::VARCHAR as timestamp,
          MIN(r_first.open)::DOUBLE as open,
          MAX(g.high)::DOUBLE as high,
          MIN(g.low)::DOUBLE as low,
          MIN(r_last.close)::DOUBLE as close,
          SUM(g.volume)::DOUBLE as volume
        FROM grouped_bars g
        LEFT JOIN ranked_bars r_first ON g.bucket_time = r_first.bucket_time AND r_first.rn_first = 1
        LEFT JOIN ranked_bars r_last ON g.bucket_time = r_last.bucket_time AND r_last.rn_last = 1
        GROUP BY g.bucket_time
        ORDER BY g.bucket_time ASC
      `;
    }

    const results = await query(sql);
    return results.map(row => ({
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume
    }));
  }
}
