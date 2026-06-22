import * as fs from 'fs';
import * as path from 'path';
import duckdb from 'duckdb';

function getDirs() {
  const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
  return {
    RAW_DIR: path.join(dataDir, 'alpha_vantage/raw'),
    PARQUET_DIR: path.join(dataDir, 'alpha_vantage/parquet')
  };
}

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
    return files.some(file => file.endsWith('.parquet') && !file.startsWith('._'));
  } catch {
    return false;
  }
}

/**
 * Checks if a directory contains any csv files
 */
function hasCsvFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  try {
    const files = fs.readdirSync(dir);
    return files.some(file => file.endsWith('.csv') && !file.startsWith('._'));
  } catch {
    return false;
  }
}

/**
 * Helper to get all valid data files in a directory, excluding hidden metadata files starting with '.' (like AppleDouble '._*' files)
 */
function getValidDataFiles(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter(file => file.endsWith(ext) && !file.startsWith('.'))
      .map(file => path.join(dir, file));
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
    return [];
  }
}

/**
 * Get available tickers in raw or parquet data folders
 */
export async function getAvailableTickers(): Promise<string[]> {
  const { RAW_DIR, PARQUET_DIR } = getDirs();
  const tickers = new Set<string>();
  
  // Scan raw daily adjusted folder
  const rawDailyDir = path.join(RAW_DIR, 'equities/daily_adjusted');
  if (fs.existsSync(rawDailyDir)) {
    fs.readdirSync(rawDailyDir).forEach(file => {
      if (file.endsWith('.csv') && !file.startsWith('.')) {
        tickers.add(file.replace('.csv', ''));
      }
    });
  }

  // Scan parquet daily adjusted folder
  const parquetDailyDir = path.join(PARQUET_DIR, 'equities/daily_adjusted');
  if (fs.existsSync(parquetDailyDir)) {
    fs.readdirSync(parquetDailyDir).forEach(file => {
      if (file.endsWith('.parquet') && !file.startsWith('.')) {
        tickers.add(file.replace('.parquet', ''));
      }
    });
  }

  // Scan raw intraday folder
  const rawIntradayDir = path.join(RAW_DIR, 'equities/intraday');
  if (fs.existsSync(rawIntradayDir)) {
    fs.readdirSync(rawIntradayDir).forEach(file => {
      if (!file.startsWith('.')) {
        tickers.add(file);
      }
    });
  }

  // Scan parquet intraday folder
  const parquetIntradayDir = path.join(PARQUET_DIR, 'equities/intraday');
  if (fs.existsSync(parquetIntradayDir)) {
    fs.readdirSync(parquetIntradayDir).forEach(file => {
      if (!file.startsWith('.')) {
        tickers.add(file);
      }
    });
  }

  return Array.from(tickers).sort();
}

/**
 * Get the date range of available data for a specific ticker
 */
export async function getTickerDateRange(ticker: string): Promise<{ minDate: string; maxDate: string }> {
  const { RAW_DIR, PARQUET_DIR } = getDirs();
  const tickerUpper = ticker.toUpperCase();
  if (tickerUpper.startsWith('._')) {
    throw new Error(`Invalid ticker: ${ticker}`);
  }

  // Check daily first as it is the standard representation
  const parquetPath = path.join(PARQUET_DIR, `equities/daily_adjusted/${tickerUpper}.parquet`);
  const csvPath = path.join(RAW_DIR, `equities/daily_adjusted/${tickerUpper}.csv`);
  
  let sourceArg = '';
  let readFunc = '';
  
  if (fs.existsSync(parquetPath) && !path.basename(parquetPath).startsWith('._')) {
    sourceArg = `'${parquetPath.replace(/'/g, "''")}'`;
    readFunc = 'read_parquet';
  } else if (fs.existsSync(csvPath) && !path.basename(csvPath).startsWith('._')) {
    sourceArg = `'${csvPath.replace(/'/g, "''")}'`;
    readFunc = 'read_csv_auto';
  } else {
    // If daily doesn't exist, check intraday 1min files
    const parquetDir = path.join(PARQUET_DIR, `equities/intraday/${tickerUpper}/1min`);
    const csvDir = path.join(RAW_DIR, `equities/intraday/${tickerUpper}/1min`);
    
    const parquetFiles = getValidDataFiles(parquetDir, '.parquet');
    const csvFiles = getValidDataFiles(csvDir, '.csv');
    
    if (parquetFiles.length > 0) {
      sourceArg = "[" + parquetFiles.map(f => `'${f.replace(/'/g, "''")}'`).join(', ') + "]";
      readFunc = 'read_parquet';
    } else if (csvFiles.length > 0) {
      sourceArg = "[" + csvFiles.map(f => `'${f.replace(/'/g, "''")}'`).join(', ') + "]";
      readFunc = 'read_csv_auto';
    }
  }

  if (!sourceArg) {
    throw new Error(`No historical data found for ticker ${tickerUpper}. Checked daily adjusted and intraday paths.`);
  }

  const sql = `
    SELECT 
      MIN(timestamp)::VARCHAR as min_date,
      MAX(timestamp)::VARCHAR as max_date
    FROM ${readFunc}(${sourceArg})
  `;
  
  try {
    const results = await query(sql);
    if (results && results.length > 0) {
      const rawMin = results[0].min_date || '';
      const rawMax = results[0].max_date || '';
      
      const minDate = rawMin.split(' ')[0].split('T')[0];
      const maxDate = rawMax.split(' ')[0].split('T')[0];
      
      if (minDate && maxDate) {
        return { minDate, maxDate };
      }
    }
  } catch (error: any) {
    console.error(`Error querying date range for ${tickerUpper}:`, error);
  }
  
  // Return fallback defaults if query fails or returns empty
  return { minDate: '2020-01-01', maxDate: '2023-12-31' };
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
  const { RAW_DIR, PARQUET_DIR } = getDirs();
  const tickerUpper = ticker.toUpperCase();
  
  if (tickerUpper.startsWith('._')) {
    throw new Error(`Invalid ticker: ${ticker}`);
  }
  
  if (timeframe === '1d') {
    // ─── DAILY TIMEFRAME ───
    const parquetPath = path.join(PARQUET_DIR, `equities/daily_adjusted/${tickerUpper}.parquet`);
    const csvPath = path.join(RAW_DIR, `equities/daily_adjusted/${tickerUpper}.csv`);
    
    let sourceArg = '';
    let readFunc = '';
    
    if (fs.existsSync(parquetPath) && !path.basename(parquetPath).startsWith('._')) {
      sourceArg = `'${parquetPath.replace(/'/g, "''")}'`;
      readFunc = 'read_parquet';
    } else if (fs.existsSync(csvPath) && !path.basename(csvPath).startsWith('._')) {
      sourceArg = `'${csvPath.replace(/'/g, "''")}'`;
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
      FROM ${readFunc}(${sourceArg})
      WHERE timestamp >= '${startDate}' AND timestamp <= '${endDate}'
      ORDER BY timestamp ASC
    `;
    
    try {
      const results = await query(sql);
      return results.map(row => ({
        timestamp: row.timestamp.split(' ')[0], // Format as "YYYY-MM-DD"
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume
      }));
    } catch (err: any) {
      throw new Error(`Failed to load daily historical data for ${tickerUpper}: ${err.message}`);
    }
  } else {
    // ─── INTRADAY TIMEFRAME (1m, 5m, 15m, 30m, 1h) ───
    // Load from intraday 1min files
    const parquetDir = path.join(PARQUET_DIR, `equities/intraday/${tickerUpper}/1min`);
    const csvDir = path.join(RAW_DIR, `equities/intraday/${tickerUpper}/1min`);
    
    const parquetFiles = getValidDataFiles(parquetDir, '.parquet');
    const csvFiles = getValidDataFiles(csvDir, '.csv');
    
    let sourceArg = '';
    let readFunc = '';
    
    if (parquetFiles.length > 0) {
      sourceArg = "[" + parquetFiles.map(f => `'${f.replace(/'/g, "''")}'`).join(', ') + "]";
      readFunc = 'read_parquet';
    } else if (csvFiles.length > 0) {
      sourceArg = "[" + csvFiles.map(f => `'${f.replace(/'/g, "''")}'`).join(', ') + "]";
      readFunc = 'read_csv_auto';
    } else {
      throw new Error(`No 1-minute intraday data found for ticker ${tickerUpper}. Checked Parquet and CSV paths. Intraday testing is not supported for this ticker, please use Daily (1d).`);
    }

    // Determine the aggregation interval in minutes
    let aggMinutes = 1;
    if (timeframe === '5m') aggMinutes = 5;
    else if (timeframe === '15m') aggMinutes = 15;
    else if (timeframe === '30m') aggMinutes = 30;
    else if (timeframe === '1h') aggMinutes = 60;

    // Check if Indian market to set correct session times
    const isIndia = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'SBIN', 'ITC', 'LT'].includes(tickerUpper) || tickerUpper.endsWith('.NS');
    const marketStart = isIndia ? '09:15:00' : '09:30:00';
    const marketEnd = isIndia ? '15:30:00' : '16:00:00';

    let sql = '';
    if (aggMinutes === 1) {
      // Direct load with outlier/wick cleaning and session hours filtering
      sql = `
        SELECT 
          timestamp::VARCHAR as timestamp,
          open::DOUBLE as open,
          CASE 
            WHEN CAST(timestamp AS TIME) = TIME '${marketEnd}' THEN greatest(open::DOUBLE, close::DOUBLE)
            WHEN (high::DOUBLE - greatest(open::DOUBLE, close::DOUBLE)) / close::DOUBLE > 0.015 
              THEN greatest(open::DOUBLE, close::DOUBLE) + 0.001 * close::DOUBLE
            ELSE high::DOUBLE
          END as high,
          CASE 
            WHEN CAST(timestamp AS TIME) = TIME '${marketEnd}' THEN least(open::DOUBLE, close::DOUBLE)
            WHEN (least(open::DOUBLE, close::DOUBLE) - low::DOUBLE) / close::DOUBLE > 0.015 
              THEN least(open::DOUBLE, close::DOUBLE) - 0.001 * close::DOUBLE
            ELSE low::DOUBLE
          END as low,
          close::DOUBLE as close,
          volume::DOUBLE as volume
        FROM ${readFunc}(${sourceArg})
        WHERE timestamp >= '${startDate} 00:00:00' AND timestamp <= '${endDate} 23:59:59'
          AND CAST(timestamp AS TIME) >= TIME '${marketStart}'
          AND CAST(timestamp AS TIME) <= TIME '${marketEnd}'
        ORDER BY timestamp ASC
      `;
    } else {
      // Aggregate 1-minute bars using DuckDB time_bucket and arg_min/arg_max window functions.
      // Performs outlier cleaning on the 1-minute bars first before aggregating.
      sql = `
        WITH cleaned_raw AS (
          SELECT 
            timestamp,
            open::DOUBLE as open,
            close::DOUBLE as close,
            volume::DOUBLE as volume,
            CASE 
              WHEN CAST(timestamp AS TIME) = TIME '${marketEnd}' THEN greatest(open::DOUBLE, close::DOUBLE)
              WHEN (high::DOUBLE - greatest(open::DOUBLE, close::DOUBLE)) / close::DOUBLE > 0.015 
                THEN greatest(open::DOUBLE, close::DOUBLE) + 0.001 * close::DOUBLE
              ELSE high::DOUBLE
            END as high,
            CASE 
              WHEN CAST(timestamp AS TIME) = TIME '${marketEnd}' THEN least(open::DOUBLE, close::DOUBLE)
              WHEN (least(open::DOUBLE, close::DOUBLE) - low::DOUBLE) / close::DOUBLE > 0.015 
                THEN least(open::DOUBLE, close::DOUBLE) - 0.001 * close::DOUBLE
              ELSE low::DOUBLE
            END as low
          FROM ${readFunc}(${sourceArg})
          WHERE timestamp >= '${startDate} 00:00:00' AND timestamp <= '${endDate} 23:59:59'
            AND CAST(timestamp AS TIME) >= TIME '${marketStart}'
            AND CAST(timestamp AS TIME) <= TIME '${marketEnd}'
        ),
        grouped_bars AS (
          SELECT 
            time_bucket(INTERVAL '${aggMinutes} minutes', timestamp) AS bucket_time,
            timestamp,
            open,
            high,
            low,
            close,
            volume
          FROM cleaned_raw
        )
        SELECT 
          bucket_time::VARCHAR as timestamp,
          arg_min(open, timestamp)::DOUBLE as open,
          MAX(high)::DOUBLE as high,
          MIN(low)::DOUBLE as low,
          arg_max(close, timestamp)::DOUBLE as close,
          SUM(volume)::DOUBLE as volume
        FROM grouped_bars
        GROUP BY bucket_time
        ORDER BY bucket_time ASC
      `;
    }

    try {
      const results = await query(sql);
      return results.map(row => ({
        timestamp: row.timestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume
      }));
    } catch (err: any) {
      throw new Error(`Failed to load/aggregate intraday data for ${tickerUpper}: ${err.message}. Ensure historical intraday data folder contains valid entries.`);
    }
  }
}
