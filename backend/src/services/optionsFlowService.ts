import { pool } from '../db/connection';
import { OptionFlowItem, OptionsFlowResponse, FlowAggregates } from '../types';
import { fetchAndStoreOptionData } from './dataCollector';

/**
 * Fetch and calculate Options Flow records for a given ticker
 * Computes strike-level Open Interest changes relative to a comparison snapshot.
 */
export async function getOptionsFlowData(
  ticker: string,
  timeframe: 'Intraday' | 'Daily' | '5-Day' | 'Custom' = 'Intraday',
  customStartDate?: string
): Promise<OptionsFlowResponse> {
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
      return {
        success: false,
        data: [],
        aggregates: createDefaultAggregates(),
        topNotionalStrikes: []
      };
    }

    const latestSnap = latestSnapshotResult.rows[0];
    const latestSnapId = latestSnap.id;
    const spotPrice = parseFloat(latestSnap.spot_price);
    const snapTime = new Date(latestSnap.timestamp);

    // 3. Find comparison snapshot ID based on timeframe
    let compareSnapId = latestSnapId;
    let compareTime: Date | null = null;

    if (timeframe === 'Intraday') {
      // Find the earliest snapshot of today
      const result = await pool.query(
        `SELECT id, timestamp FROM option_snapshots
         WHERE ticker = $1 AND timestamp >= CURRENT_DATE
         ORDER BY timestamp ASC
         LIMIT 1`,
        [t]
      );
      if (result.rows.length > 0) {
        compareSnapId = result.rows[0].id;
        compareTime = new Date(result.rows[0].timestamp);
      }
      
      // Fallback: If only 1 snapshot today (compareSnapId === latestSnapId), compare to yesterday's close
      if (compareSnapId === latestSnapId) {
        const fallbackResult = await pool.query(
          `SELECT id, timestamp FROM option_snapshots
           WHERE ticker = $1 AND timestamp < CURRENT_DATE
           ORDER BY timestamp DESC
           LIMIT 1`,
          [t]
        );
        if (fallbackResult.rows.length > 0) {
          compareSnapId = fallbackResult.rows[0].id;
          compareTime = new Date(fallbackResult.rows[0].timestamp);
        }
      }
    } else if (timeframe === 'Daily') {
      // Find the last snapshot from yesterday
      const result = await pool.query(
        `SELECT id, timestamp FROM option_snapshots
         WHERE ticker = $1 AND timestamp < CURRENT_DATE
         ORDER BY timestamp DESC
         LIMIT 1`,
        [t]
      );
      if (result.rows.length > 0) {
        compareSnapId = result.rows[0].id;
        compareTime = new Date(result.rows[0].timestamp);
      }
    } else if (timeframe === '5-Day') {
      // Find the snapshot closest to 5 days ago
      const result = await pool.query(
        `SELECT id, timestamp FROM option_snapshots
         WHERE ticker = $1 AND timestamp <= NOW() - INTERVAL '5 days'
         ORDER BY timestamp DESC
         LIMIT 1`,
        [t]
      );
      if (result.rows.length > 0) {
        compareSnapId = result.rows[0].id;
        compareTime = new Date(result.rows[0].timestamp);
      } else {
        // Fallback to earliest snapshot ever
        const fallbackResult = await pool.query(
          `SELECT id, timestamp FROM option_snapshots
           WHERE ticker = $1
           ORDER BY timestamp ASC
           LIMIT 1`,
          [t]
        );
        if (fallbackResult.rows.length > 0) {
          compareSnapId = fallbackResult.rows[0].id;
          compareTime = new Date(fallbackResult.rows[0].timestamp);
        }
      }
    } else if (timeframe === 'Custom') {
      const compareDate = customStartDate ? new Date(customStartDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await pool.query(
        `SELECT id, timestamp FROM option_snapshots
         WHERE ticker = $1 AND timestamp <= $2
         ORDER BY timestamp DESC
         LIMIT 1`,
        [t, compareDate]
      );
      if (result.rows.length > 0) {
        compareSnapId = result.rows[0].id;
        compareTime = new Date(result.rows[0].timestamp);
      } else {
        // Fallback to earliest snapshot
        const fallbackResult = await pool.query(
          `SELECT id, timestamp FROM option_snapshots
           WHERE ticker = $1
           ORDER BY timestamp ASC
           LIMIT 1`,
          [t]
        );
        if (fallbackResult.rows.length > 0) {
          compareSnapId = fallbackResult.rows[0].id;
          compareTime = new Date(fallbackResult.rows[0].timestamp);
        }
      }
    }

    console.log(`[Flow Service] Comparing snap ${latestSnapId} (${snapTime.toISOString()}) vs snap ${compareSnapId} (${compareTime ? compareTime.toISOString() : 'N/A'})`);

    // 4. Query option data for both snapshots joined together
    const query = `
      SELECT 
        o_lat.strike, 
        o_lat.option_type, 
        o_lat.expiration, 
        o_lat.last_price as latest_price, 
        o_lat.bid as latest_bid, 
        o_lat.ask as latest_ask, 
        o_lat.volume as latest_volume, 
        o_lat.open_interest as latest_oi, 
        o_lat.implied_volatility as latest_iv, 
        o_lat.delta as latest_delta, 
        o_comp.open_interest as compare_oi,
        o_comp.implied_volatility as compare_iv,
        o_comp.last_price as compare_price
      FROM option_data o_lat
      LEFT JOIN option_data o_comp ON 
        o_lat.strike = o_comp.strike AND 
        o_lat.option_type = o_comp.option_type AND 
        o_lat.expiration = o_comp.expiration AND 
        o_comp.snapshot_id = $2
      WHERE o_lat.snapshot_id = $1
    `;

    const optionsResult = await pool.query(query, [latestSnapId, compareSnapId]);
    const rows = optionsResult.rows;

    // 5. Query actual next earnings date
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

    // 6. Map and calculate options flow items
    const today = new Date();
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

    // Sentiment metrics
    let totalCallVol = 0;
    let totalPutVol = 0;
    let totalCallPremium = 0;
    let totalPutPremium = 0;
    let bullishPremium = 0;
    let bearishPremium = 0;

    const flowItems: OptionFlowItem[] = rows.map((row) => {
      const strike = parseFloat(row.strike);
      const isCall = row.option_type === 'C';
      const expirationDate = new Date(row.expiration);
      const expStr = expirationDate.toISOString().split('T')[0];
      const typeLabel = isCall ? 'Call' : 'Put';
      
      const lastPrice = parseFloat(row.latest_price) || 0;
      const volume = parseInt(row.latest_volume) || 0;
      const openInterest = parseInt(row.latest_oi) || 0;
      const compareOi = parseInt(row.compare_oi) || 0;
      const currentIv = parseFloat(row.latest_iv) || 0;
      const compareIv = parseFloat(row.compare_iv) || currentIv;
      const comparePrice = parseFloat(row.compare_price) || lastPrice;

      // OI Change calculations
      const oiChange = openInterest - compareOi;
      const notionalChange = Math.abs(oiChange) * lastPrice * 100;

      // Sentiment categorizations
      // Bullish = Call buying (Call OI increase) OR Put selling (Put OI decrease)
      // Bearish = Put buying (Put OI increase) OR Call selling (Call OI decrease)
      if (isCall) {
        totalCallVol += volume;
        totalCallPremium += notionalChange;
        if (oiChange > 0) bullishPremium += notionalChange;
        else if (oiChange < 0) bearishPremium += notionalChange;
      } else {
        totalPutVol += volume;
        totalPutPremium += notionalChange;
        if (oiChange > 0) bearishPremium += notionalChange;
        else if (oiChange < 0) bullishPremium += notionalChange;
      }

      // Calculate DTE
      const expUTC = Date.UTC(expirationDate.getFullYear(), expirationDate.getMonth(), expirationDate.getDate());
      const dte = Math.max(0, Math.round((expUTC - todayUTC) / 86400000));

      // Calculate OTM Percentage
      let otmPercent = 0;
      if (isCall) {
        otmPercent = strike > spotPrice ? ((strike - spotPrice) / spotPrice) * 100 : 0;
      } else {
        otmPercent = strike < spotPrice ? ((spotPrice - strike) / spotPrice) * 100 : 0;
      }

      // Calculate 5-Day OI Change (Percent proxy)
      const oi5dChangePercent = compareOi > 0 ? (oiChange / compareOi) * 100 : 0;

      // Price Change
      let changePercent = null;
      if (comparePrice > 0) {
        changePercent = ((lastPrice - comparePrice) / comparePrice) * 100;
      }

      // IV Point Change
      const iv5dPointDiff = (currentIv - compareIv) * 100;

      // Delta
      let delta = parseFloat(row.latest_delta) || 0;
      if (delta === 0) {
        const distance = Math.abs(strike - spotPrice) / spotPrice;
        delta = Math.max(0.05, Math.min(0.95, 0.5 - (isCall ? 1 : -1) * (strike > spotPrice ? distance * 2 : -distance * 2)));
        if (!isCall) delta = -delta;
      }

      // Format time display
      const hours = String(snapTime.getHours()).padStart(2, '0');
      const minutes = String(snapTime.getMinutes()).padStart(2, '0');
      const seconds = String(snapTime.getSeconds()).padStart(2, '0');
      const month = String(snapTime.getMonth() + 1).padStart(2, '0');
      const date = String(snapTime.getDate()).padStart(2, '0');
      const timeStr = `${month}/${date} ${hours}:${minutes}:${seconds}`;

      return {
        id: `${t}-${expStr}-${strike}-${row.option_type}`,
        time: timeStr,
        ticker: t,
        contractName: `${strike.toFixed(1)} ${typeLabel} ${expStr}`,
        optionType: typeLabel,
        strike,
        expiration: expStr,
        stockPrice: spotPrice,
        lastPrice: lastPrice || (parseFloat(row.latest_bid) + parseFloat(row.latest_ask)) / 2 || 0,
        changePercent,
        volume,
        openInterest,
        oiChange,
        notionalChange,
        timeframeType: timeframe,
        oi5dChangePercent,
        otmPercent,
        ivPercent: currentIv * 100,
        iv5dPointDiff,
        delta: Math.abs(delta),
        dte,
        earningsRemainingDays,
        bid: parseFloat(row.latest_bid) || undefined,
        ask: parseFloat(row.latest_ask) || undefined,
      };
    });

    // 7. Calculate Aggregates
    const totalPremium = bullishPremium + bearishPremium;
    let bullishSentimentPercent = 50;
    if (totalPremium > 0) {
      bullishSentimentPercent = (bullishPremium / totalPremium) * 100;
    }

    let dominantSentiment: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
    if (bullishSentimentPercent > 55) {
      dominantSentiment = 'Bullish';
    } else if (bullishSentimentPercent < 45) {
      dominantSentiment = 'Bearish';
    }

    const putCallRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : 0;

    const totalVol = totalCallVol + totalPutVol;
    const callPercentage = totalVol > 0 ? (totalCallVol / totalVol) * 100 : 50;
    const putPercentage = totalVol > 0 ? (totalPutVol / totalVol) * 100 : 50;

    const aggregates: FlowAggregates = {
      dominantSentiment,
      bullishSentimentPercent,
      putCallRatio,
      callVolume: totalCallVol,
      putVolume: totalPutVol,
      callPremium: totalCallPremium,
      putPremium: totalPutPremium,
      callPercentage,
      putPercentage
    };

    // 8. Sort and extract top 5 strikes by Notional Change
    const sortedByNotional = [...flowItems].sort((a, b) => b.notionalChange - a.notionalChange);
    const topNotionalStrikes = sortedByNotional.slice(0, 5);

    return {
      success: true,
      data: flowItems,
      aggregates,
      topNotionalStrikes
    };
  } catch (error) {
    console.error(`[Flow Service] Error retrieving option flow data for ${ticker}:`, error);
    return {
      success: false,
      data: [],
      aggregates: createDefaultAggregates(),
      topNotionalStrikes: []
    };
  }
}

function createDefaultAggregates(): FlowAggregates {
  return {
    dominantSentiment: 'Neutral',
    bullishSentimentPercent: 50,
    putCallRatio: 1,
    callVolume: 0,
    putVolume: 0,
    callPremium: 0,
    putPremium: 0,
    callPercentage: 50,
    putPercentage: 50
  };
}
