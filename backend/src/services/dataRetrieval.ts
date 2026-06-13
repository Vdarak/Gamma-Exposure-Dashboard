import { pool } from '../db/connection';
import { OptionSnapshot, TimestampInfo } from '../types';

/**
 * Get historical data for a ticker within a time range
 */
export async function getHistoricalData(
  ticker: string,
  hoursBack?: number,
  startDate?: Date,
  endDate?: Date
): Promise<OptionSnapshot[]> {
  try {
    let query = `
      SELECT 
        s.id, s.ticker, s.timestamp, s.spot_price, s.market,
        json_agg(json_build_object(
          'strike', o.strike,
          'type', o.option_type,
          'expiration', o.expiration,
          'lastPrice', o.last_price,
          'bid', o.bid,
          'ask', o.ask,
          'volume', o.volume,
          'openInterest', o.open_interest,
          'impliedVolatility', o.implied_volatility,
          'delta', o.delta,
          'gamma', o.gamma,
          'theta', o.theta,
          'vega', o.vega,
          'rho', o.rho
        ) ORDER BY o.strike, o.option_type) as options
      FROM option_snapshots s
      JOIN option_data o ON s.id = o.snapshot_id
      WHERE s.ticker = $1
    `;

    const params: any[] = [ticker];

    if (hoursBack) {
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - hoursBack);
      query += ` AND s.timestamp >= $2`;
      params.push(cutoff);
    } else if (startDate && endDate) {
      query += ` AND s.timestamp BETWEEN $2 AND $3`;
      params.push(startDate, endDate);
    }

    query += ` GROUP BY s.id ORDER BY s.timestamp DESC`;

    const result = await pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      ticker: row.ticker,
      timestamp: new Date(row.timestamp),
      spotPrice: parseFloat(row.spot_price),
      dataCount: row.options.length,
      market: row.market,
      options: row.options.map((opt: any) => ({
        ...opt,
        expiration: new Date(opt.expiration),
      })),
    }));
  } catch (error) {
    console.error('❌ Error fetching historical data:', error);
    throw error;
  }
}

/**
 * Get the most recent snapshot for a ticker
 */
export async function getCurrentData(ticker: string): Promise<OptionSnapshot | null> {
  try {
    const result = await pool.query(
      `SELECT 
        s.id, s.ticker, s.timestamp, s.spot_price, s.market,
        json_agg(json_build_object(
          'strike', o.strike,
          'type', o.option_type,
          'expiration', o.expiration,
          'lastPrice', o.last_price,
          'bid', o.bid,
          'ask', o.ask,
          'volume', o.volume,
          'openInterest', o.open_interest,
          'impliedVolatility', o.implied_volatility,
          'delta', o.delta,
          'gamma', o.gamma,
          'theta', o.theta,
          'vega', o.vega,
          'rho', o.rho
        ) ORDER BY o.strike, o.option_type) as options
      FROM option_snapshots s
      JOIN option_data o ON s.id = o.snapshot_id
      WHERE s.ticker = $1
      GROUP BY s.id
      ORDER BY s.timestamp DESC
      LIMIT 1`,
      [ticker]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      ticker: row.ticker,
      timestamp: new Date(row.timestamp),
      spotPrice: parseFloat(row.spot_price),
      dataCount: row.options.length,
      market: row.market,
      options: row.options.map((opt: any) => ({
        ...opt,
        expiration: new Date(opt.expiration),
      })),
    };
  } catch (error) {
    console.error('❌ Error fetching current data:', error);
    throw error;
  }
}

/**
 * Get data at a specific timestamp (finds closest match)
 */
export async function getDataAtTimestamp(
  ticker: string,
  timestamp: Date
): Promise<OptionSnapshot | null> {
  try {
    const result = await pool.query(
      `SELECT 
        s.id, s.ticker, s.timestamp, s.spot_price, s.market,
        json_agg(json_build_object(
          'strike', o.strike,
          'type', o.option_type,
          'expiration', o.expiration,
          'lastPrice', o.last_price,
          'bid', o.bid,
          'ask', o.ask,
          'volume', o.volume,
          'openInterest', o.open_interest,
          'impliedVolatility', o.implied_volatility,
          'delta', o.delta,
          'gamma', o.gamma,
          'theta', o.theta,
          'vega', o.vega,
          'rho', o.rho
        ) ORDER BY o.strike, o.option_type) as options
      FROM option_snapshots s
      JOIN option_data o ON s.id = o.snapshot_id
      WHERE s.ticker = $1
      GROUP BY s.id
      ORDER BY ABS(EXTRACT(EPOCH FROM (s.timestamp - $2)))
      LIMIT 1`,
      [ticker, timestamp]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      ticker: row.ticker,
      timestamp: new Date(row.timestamp),
      spotPrice: parseFloat(row.spot_price),
      dataCount: row.options.length,
      market: row.market,
      options: row.options.map((opt: any) => ({
        ...opt,
        expiration: new Date(opt.expiration),
      })),
    };
  } catch (error) {
    console.error('❌ Error fetching data at timestamp:', error);
    throw error;
  }
}

/**
 * Get all available timestamps for a ticker (for time machine slider)
 */
export async function getAvailableTimestamps(
  ticker: string,
  daysBack: number = 3
): Promise<TimestampInfo[]> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const result = await pool.query(
      `SELECT timestamp, spot_price
       FROM option_snapshots
       WHERE ticker = $1 AND timestamp >= $2
       ORDER BY timestamp ASC`,
      [ticker, cutoff]
    );

    return result.rows.map(row => ({
      timestamp: new Date(row.timestamp),
      spotPrice: parseFloat(row.spot_price),
    }));
  } catch (error) {
    console.error('❌ Error fetching available timestamps:', error);
    throw error;
  }
}

/**
 * Get statistics about stored data
 */
export async function getDataStatistics(ticker?: string) {
  try {
    let query = `
      SELECT 
        ticker,
        COUNT(*) as snapshot_count,
        MIN(timestamp) as oldest_snapshot,
        MAX(timestamp) as newest_snapshot,
        AVG(data_count) as avg_options_per_snapshot
      FROM option_snapshots
    `;

    const params: any[] = [];
    if (ticker) {
      query += ` WHERE ticker = $1`;
      params.push(ticker);
    }

    query += ` GROUP BY ticker ORDER BY ticker`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('❌ Error fetching data statistics:', error);
    throw error;
  }
}

/**
 * Get available expiries for a ticker at a specific timestamp
 */
export async function getAvailableExpiries(
  ticker: string,
  timestamp?: Date
): Promise<Array<{ expiration: Date; optionCount: number }>> {
  try {
    let query: string;
    const params: any[] = [ticker];

    if (timestamp) {
      // Get expiries from the closest snapshot to the given timestamp
      query = `
        WITH closest_snapshot AS (
          SELECT id
          FROM option_snapshots
          WHERE ticker = $1
          ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $2)))
          LIMIT 1
        )
        SELECT 
          o.expiration,
          COUNT(*) as option_count
        FROM option_data o
        JOIN closest_snapshot cs ON o.snapshot_id = cs.id
        GROUP BY o.expiration
        ORDER BY o.expiration
      `;
      params.push(timestamp);
    } else {
      // Get expiries from the most recent snapshot
      query = `
        WITH latest_snapshot AS (
          SELECT id
          FROM option_snapshots
          WHERE ticker = $1
          ORDER BY timestamp DESC
          LIMIT 1
        )
        SELECT 
          o.expiration,
          COUNT(*) as option_count
        FROM option_data o
        JOIN latest_snapshot ls ON o.snapshot_id = ls.id
        GROUP BY o.expiration
        ORDER BY o.expiration
      `;
    }

    const result = await pool.query(query, params);
    
    return result.rows.map((row: any) => ({
      expiration: new Date(row.expiration),
      optionCount: parseInt(row.option_count),
    }));
  } catch (error) {
    console.error('❌ Error fetching available expiries:', error);
    throw error;
  }
}

/**
 * Get intraday GEX flow by strike for a given day (0DTE options)
 */
export async function getIntradayGexFlow(
  ticker: string,
  date: Date
): Promise<any[]> {
  try {
    const dateStr = date.toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT 
        s.id as snapshot_id,
        s.timestamp,
        s.spot_price,
        o.strike,
        o.option_type,
        o.open_interest,
        o.volume,
        o.gamma
      FROM option_snapshots s
      JOIN option_data o ON s.id = o.snapshot_id
      WHERE s.ticker = $1 
        AND s.timestamp::DATE = $2::DATE
        AND o.expiration = s.timestamp::DATE
      ORDER BY s.timestamp ASC, o.strike ASC`,
      [ticker, dateStr]
    );

    const snapshotsMap = new Map<string, { timestamp: Date, spotPrice: number, strikes: { [strike: string]: { gex: number, volume: number, openInterest: number } } }>();

    for (const row of result.rows) {
      const tsString = row.timestamp.toISOString();
      const spot = parseFloat(row.spot_price);
      const strike = parseFloat(row.strike).toString();
      const optionType = row.option_type;
      const oi = parseInt(row.open_interest || '0', 10);
      const vol = parseInt(row.volume || '0', 10);
      const gamma = parseFloat(row.gamma || '0');

      // GEX: (C = 1, P = -1) * spot * spot * gamma * open_interest
      const gex = (optionType === 'C' ? 1 : -1) * spot * spot * gamma * oi;

      if (!snapshotsMap.has(tsString)) {
        snapshotsMap.set(tsString, {
          timestamp: row.timestamp,
          spotPrice: spot,
          strikes: {}
        });
      }

      const snap = snapshotsMap.get(tsString)!;
      if (!snap.strikes[strike]) {
        snap.strikes[strike] = { gex: 0, volume: 0, openInterest: 0 };
      }
      snap.strikes[strike].gex += gex;
      snap.strikes[strike].volume += vol;
      snap.strikes[strike].openInterest += oi;
    }

    return Array.from(snapshotsMap.values());
  } catch (error) {
    console.error('❌ Error fetching intraday GEX flow:', error);
    throw error;
  }
}

/**
 * Get daily closing 0DTE GEX trend over the last 30 trading days
 */
export async function getHistoricalGexTrend(
  ticker: string
): Promise<any[]> {
  try {
    const result = await pool.query(
      `WITH daily_closing_snapshots AS (
        SELECT DISTINCT ON (timestamp::DATE)
          id, timestamp, spot_price
        FROM option_snapshots
        WHERE ticker = $1
        ORDER BY timestamp::DATE DESC, timestamp DESC
        LIMIT 30
      )
      SELECT 
        dcs.id,
        dcs.timestamp,
        dcs.spot_price as "spotPrice",
        COALESCE(SUM((CASE WHEN o.option_type = 'C' THEN 1 ELSE -1 END) * dcs.spot_price * dcs.spot_price * o.gamma * o.open_interest), 0) as "totalGex"
      FROM daily_closing_snapshots dcs
      LEFT JOIN option_data o ON dcs.id = o.snapshot_id AND o.expiration = dcs.timestamp::DATE
      GROUP BY dcs.id, dcs.timestamp, dcs.spot_price
      ORDER BY dcs.timestamp ASC`,
      [ticker]
    );

    return result.rows.map(row => ({
      timestamp: new Date(row.timestamp),
      spotPrice: parseFloat(row.spotPrice),
      totalGex: parseFloat(row.totalGex)
    }));
  } catch (error) {
    console.error('❌ Error fetching historical GEX trend:', error);
    throw error;
  }
}
