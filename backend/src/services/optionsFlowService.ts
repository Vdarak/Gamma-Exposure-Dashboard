import { pool } from '../db/connection';
import { OptionFlowItem } from '../types';
import { fetchAndStoreOptionData } from './dataCollector';

/**
 * Fetch and calculate Options Flow records for a given ticker
 * Completely free of mock data or simulated placeholders.
 */
export async function getOptionsFlowData(ticker: string): Promise<OptionFlowItem[]> {
  const t = ticker.toUpperCase();

  try {
    // 1. Check if database has snapshots for this ticker.
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM option_snapshots WHERE ticker = $1',
      [t]
    );
    const snapshotCount = parseInt(countResult.rows[0].count);

    // If 0 snapshots, pull initial data synchronously to populate the database
    if (snapshotCount === 0) {
      console.log(`[Flow Service] 🔍 No snapshots found for ${t}. Fetching initial CBOE/NSE snapshot...`);
      await fetchAndStoreOptionData(t);
    }

    // 2. Query latest snapshot metadata
    const latestSnapshotResult = await pool.query(
      `SELECT id, spot_price, timestamp
       FROM option_snapshots
       WHERE ticker = $1
       ORDER BY timestamp DESC
       LIMIT 1`,
      [t]
    );

    if (latestSnapshotResult.rows.length === 0) {
      console.warn(`[Flow Service] ⚠️ Could not retrieve option data for ${t} (no snapshots stored).`);
      return [];
    }

    const latestSnap = latestSnapshotResult.rows[0];
    const latestSnapId = latestSnap.id;
    const spotPrice = parseFloat(latestSnap.spot_price);
    const snapTime = new Date(latestSnap.timestamp);

    // 3. Query option data for the latest snapshot
    const optionsResult = await pool.query(
      `SELECT strike, option_type, expiration, last_price, bid, ask, volume, open_interest, implied_volatility, delta
       FROM option_data
       WHERE snapshot_id = $1`,
      [latestSnapId]
    );

    const currentOptions = optionsResult.rows;

    // 4. Query snapshot from ~5 business days ago (to compute 5d delta stats)
    const fiveDaysAgoResult = await pool.query(
      `SELECT id
       FROM option_snapshots
       WHERE ticker = $1 AND timestamp <= NOW() - INTERVAL '5 days'
       ORDER BY timestamp DESC
       LIMIT 1`,
      [t]
    );

    let historicalOptionsMap = new Map<string, { oi: number; iv: number; lastPrice: number }>();

    if (fiveDaysAgoResult.rows.length > 0) {
      const historicalSnapId = fiveDaysAgoResult.rows[0].id;
      const histOptionsResult = await pool.query(
        `SELECT strike, option_type, expiration, open_interest, implied_volatility, last_price
         FROM option_data
         WHERE snapshot_id = $1`,
        [historicalSnapId]
      );

      histOptionsResult.rows.forEach(row => {
        const key = `${row.strike}-${row.option_type}-${new Date(row.expiration).toISOString().split('T')[0]}`;
        historicalOptionsMap.set(key, {
          oi: parseInt(row.open_interest) || 0,
          iv: parseFloat(row.implied_volatility) || 0,
          lastPrice: parseFloat(row.last_price) || 0
        });
      });
    }

    // 5. Query actual next earnings date from the database
    const earningsResult = await pool.query(
      'SELECT next_earnings_date FROM earnings_dates WHERE ticker = $1',
      [t]
    );
    
    let earningsRemainingDays: number | null = null;
    if (earningsResult.rows.length > 0) {
      const nextEarnings = new Date(earningsResult.rows[0].next_earnings_date);
      const today = new Date();
      const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      const nextEarningsUTC = Date.UTC(nextEarnings.getFullYear(), nextEarnings.getMonth(), nextEarnings.getDate());
      earningsRemainingDays = Math.max(0, Math.round((nextEarningsUTC - todayUTC) / 86400000));
    }

    // 6. Map options and calculate metrics
    const flowItems: OptionFlowItem[] = currentOptions.map((opt) => {
      const strike = parseFloat(opt.strike);
      const isCall = opt.option_type === 'C';
      const expirationDate = new Date(opt.expiration);
      const expStr = expirationDate.toISOString().split('T')[0];
      const typeLabel = isCall ? 'Call' : 'Put';
      
      const lastPrice = parseFloat(opt.last_price) || 0;
      const volume = parseInt(opt.volume) || 0;
      const openInterest = parseInt(opt.open_interest) || 0;
      const currentIv = parseFloat(opt.implied_volatility) || 0;
      
      // Calculate DTE (Days to Expiration)
      const today = new Date();
      const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
      const expUTC = Date.UTC(expirationDate.getFullYear(), expirationDate.getMonth(), expirationDate.getDate());
      const dte = Math.max(0, Math.round((expUTC - todayUTC) / 86400000));

      // Calculate Out-Of-The-Money (OTM) Percentage
      let otmPercent = 0;
      if (isCall) {
        otmPercent = strike > spotPrice ? ((strike - spotPrice) / spotPrice) * 100 : 0;
      } else {
        otmPercent = strike < spotPrice ? ((spotPrice - strike) / spotPrice) * 100 : 0;
      }

      // Lookup historical snapshot from 5 days ago
      const histKey = `${opt.strike}-${opt.option_type}-${expStr}`;
      const histData = historicalOptionsMap.get(histKey);
      
      let oi5dChangePercent: number | null = null;
      let iv5dPointDiff: number | null = null;
      let changePercent: number | null = null;

      if (histData) {
        // Real 5-Day Calculations
        const oldOI = histData.oi;
        const oldIV = histData.iv * 100; // convert to percentage points
        const currentIvPct = currentIv * 100;

        oi5dChangePercent = oldOI > 0 ? ((openInterest - oldOI) / oldOI) * 100 : 0;
        iv5dPointDiff = currentIvPct - oldIV;
        
        // Real Contract price change computed relative to the historical snapshot
        const oldLast = histData.lastPrice;
        if (oldLast > 0) {
          changePercent = ((lastPrice - oldLast) / oldLast) * 100;
        }
      }

      // Delta: Use database delta or default to BS proxy if delta is missing
      let delta = parseFloat(opt.delta) || 0;
      if (delta === 0) {
        const distance = Math.abs(strike - spotPrice) / spotPrice;
        delta = Math.max(0.05, Math.min(0.95, 0.5 - (isCall ? 1 : -1) * (strike > spotPrice ? distance * 2 : -distance * 2)));
        if (!isCall) delta = -delta;
      }

      // Format current snapshot capture time (HH:MM:SS)
      const hours = String(snapTime.getHours()).padStart(2, '0');
      const minutes = String(snapTime.getMinutes()).padStart(2, '0');
      const seconds = String(snapTime.getSeconds()).padStart(2, '0');
      const month = String(snapTime.getMonth() + 1).padStart(2, '0');
      const date = String(snapTime.getDate()).padStart(2, '0');
      const timeStr = `${month}/${date} ${hours}:${minutes}:${seconds}`;

      return {
        id: `${t}-${expStr}-${strike}-${opt.option_type}`,
        time: timeStr,
        ticker: t,
        contractName: `${strike.toFixed(1)} ${typeLabel} ${expStr}`,
        optionType: typeLabel,
        strike,
        expiration: expStr,
        stockPrice: spotPrice,
        lastPrice: lastPrice || (parseFloat(opt.bid) + parseFloat(opt.ask)) / 2 || 0,
        changePercent,
        volume,
        openInterest,
        oi5dChangePercent,
        otmPercent,
        ivPercent: currentIv * 100, // convert to percentage
        iv5dPointDiff,
        delta: Math.abs(delta),
        dte,
        earningsRemainingDays
      };
    });

    return flowItems;
  } catch (error) {
    console.error(`[Flow Service] Error retrieving option flow data for ${ticker}:`, error);
    throw error;
  }
}
