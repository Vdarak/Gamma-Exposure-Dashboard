import { pool } from '../db/connection';
import { TradeLog, EquityPoint, BacktestResult } from './types';

// Helper to query mid option price at a given snapshot
async function getOptionPriceAtSnapshot(snapshotId: number, strike: number, type: 'C' | 'P', expiration: string) {
  const result = await pool.query(
    `SELECT bid, ask, last_price as "lastPrice"
     FROM option_data
     WHERE snapshot_id = $1 AND strike = $2 AND option_type = $3`,
    [snapshotId, strike, type]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const bid = row.bid !== null ? parseFloat(row.bid) : null;
  const ask = row.ask !== null ? parseFloat(row.ask) : null;
  const last = row.lastPrice !== null ? parseFloat(row.lastPrice) : null;

  if (bid !== null && ask !== null) return (bid + ask) / 2;
  return last;
}

// Reconstruct recorded legs dynamically for historical suggestion rows that lack it
async function reconstructSuggestionLegs(suggestionId: number, ticker: string, entryTime: Date, spot: number) {
  try {
    // 1. Find closest option snapshot in Postgres matching the suggestion entry timestamp
    const snapResult = await pool.query(
      `SELECT id, timestamp, spot_price as "spotPrice"
       FROM option_snapshots
       WHERE ticker = $1 AND ABS(EXTRACT(EPOCH FROM (timestamp - $2))) < 90
       ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $2))) ASC
       LIMIT 1`,
      [ticker, entryTime]
    );

    if (snapResult.rows.length === 0) {
      return null;
    }

    const snapshotId = snapResult.rows[0].id;
    const snapSpot = parseFloat(snapResult.rows[0].spotPrice);

    // 2. Fetch options details for this snapshot
    const optionRows = await pool.query(
      `SELECT strike, option_type as type, expiration, last_price as "lastPrice", bid, ask, volume, open_interest as "openInterest", implied_volatility as "impliedVolatility", delta, gamma, theta, vega
       FROM option_data
       WHERE snapshot_id = $1`,
      [snapshotId]
    );

    if (optionRows.rows.length === 0) return null;

    const options = optionRows.rows.map((row: any) => ({
      strike: parseFloat(row.strike),
      type: row.type as 'C' | 'P',
      expiration: new Date(row.expiration),
      lastPrice: row.lastPrice !== null ? parseFloat(row.lastPrice) : 0,
      bid: row.bid !== null ? parseFloat(row.bid) : 0,
      ask: row.ask !== null ? parseFloat(row.ask) : 0,
      volume: row.volume !== null ? parseInt(row.volume, 10) : 0,
      openInterest: row.openInterest !== null ? parseInt(row.openInterest, 10) : 0,
      impliedVolatility: row.impliedVolatility !== null ? parseFloat(row.impliedVolatility) : 0.3,
      delta: row.delta !== null ? parseFloat(row.delta) : 0,
      gamma: row.gamma !== null ? parseFloat(row.gamma) : 0,
      theta: row.theta !== null ? parseFloat(row.theta) : 0,
      vega: row.vega !== null ? parseFloat(row.vega) : 0,
    }));

    // 3. Compute suggestion walls and legs
    let totalGEX = 0;
    const gexByStrike: Record<number, number> = {};
    const strikeOpenInterest: Record<number, { callOi: number; putOi: number }> = {};
    
    const expiries = Array.from(new Set(options.map(o => o.expiration.getTime())))
      .map(t => new Date(t))
      .sort((a, b) => a.getTime() - b.getTime());
    const referenceDate = new Date(entryTime);
    referenceDate.setHours(0, 0, 0, 0);
    const selectedExpiry = expiries.find(d => d >= referenceDate) || expiries[0] || new Date();

    options.forEach(opt => {
      const vol = opt.impliedVolatility > 1.0 ? opt.impliedVolatility / 100 : (opt.impliedVolatility > 0.01 ? opt.impliedVolatility : 0.3);
      const daysDiff = Math.max(1, Math.ceil((opt.expiration.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)));
      const T = daysDiff / 262;
      const r = 0.0525;
      const q = 0.0;

      let gamma = 0;
      if (T > 0 && vol > 0) {
        const d1 = (Math.log(snapSpot / opt.strike) + (r - q + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
        const normPdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
        gamma = (Math.exp(-q * T) * normPdf) / (snapSpot * vol * Math.sqrt(T));
      }

      let gexVal = opt.openInterest * 100 * snapSpot * snapSpot * 0.01 * gamma;
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

    const localizedRange = snapSpot * 0.015;
    let maxGexStrike = 0;
    let maxGexVal = 0;
    let hasLocalizedMagnet = false;

    Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
      const strikeNum = parseFloat(strikeStr);
      if (Math.abs(strikeNum - snapSpot) <= localizedRange) {
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

    let callWall = snapSpot * 1.01;
    let putWall = snapSpot * 0.99;
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

    let strikeAbove = snapSpot * 1.01;
    let strikeBelow = snapSpot * 0.99;
    let maxGexAboveVal = 0;
    let maxGexBelowVal = 0;
    let hasLocalizedAbove = false;
    let hasLocalizedBelow = false;

    Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
      const strikeNum = parseFloat(strikeStr);
      if (strikeNum > snapSpot && strikeNum <= snapSpot + localizedRange) {
        if (val > maxGexAboveVal) {
          maxGexAboveVal = val;
          strikeAbove = strikeNum;
          hasLocalizedAbove = true;
        }
      } else if (strikeNum < snapSpot && strikeNum >= snapSpot - localizedRange) {
        if (Math.abs(val) > maxGexBelowVal) {
          maxGexBelowVal = Math.abs(val);
          strikeBelow = strikeNum;
          hasLocalizedBelow = true;
        }
      }
    });

    if (!hasLocalizedAbove) {
      Object.entries(gexByStrike).forEach(([strikeStr, val]) => {
        const strikeNum = parseFloat(strikeStr);
        if (strikeNum > snapSpot) {
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
        if (strikeNum < snapSpot) {
          if (Math.abs(val) > maxGexBelowVal) {
            maxGexBelowVal = Math.abs(val);
            strikeBelow = strikeNum;
          }
        }
      });
    }

    const roundStrikeAbove = Math.round(strikeAbove / 5) * 5;
    const roundStrikeBelow = Math.round(strikeBelow / 5) * 5;

    const proximity = Math.abs(snapSpot - maxGexStrike) / snapSpot;
    let ppi = 40;
    if (totalGEX > 0) ppi += 20; else ppi -= 35;
    if (proximity < 0.001) ppi += 30; else if (proximity < 0.005) ppi += 15; else if (proximity > 0.015) ppi -= 20;
    const finalPpi = Math.max(5, Math.min(95, ppi));
    const isPinRegime = finalPpi >= 55 || (totalGEX < 0 && proximity < 0.008);

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
        last_price: opt.lastPrice,
        bid: opt.bid,
        ask: opt.ask,
        mid_price: opt.bid && opt.ask ? (opt.bid + opt.ask) / 2 : opt.lastPrice,
        volume: opt.volume,
        open_interest: opt.openInterest,
        implied_volatility: opt.impliedVolatility,
        delta: opt.delta,
        gamma: opt.gamma,
        theta: opt.theta,
        vega: opt.vega,
        gex_bs: opt.openInterest * 100 * snapSpot * snapSpot * 0.01 * (opt.gamma || 0) * (opt.type === 'P' ? -1 : 1)
      };
    };

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

    const sortedStrikes = Array.from(new Set(options.map(o => o.strike))).sort((a, b) => a - b);
    const closestStrikeAboveSpot = sortedStrikes.find(s => s >= snapSpot) || snapSpot * 1.001;
    const closestStrikeBelowSpot = [...sortedStrikes].reverse().find(s => s <= snapSpot) || snapSpot * 0.999;

    const singleLegs = {
      atm_call: getOptionDetails(closestStrikeAboveSpot, 'C'),
      atm_put: getOptionDetails(closestStrikeBelowSpot, 'P'),
      otm_25d_call: findOptionByDelta('C', 0.25),
      otm_25d_put: findOptionByDelta('P', 0.25),
      otm_15d_call: findOptionByDelta('C', 0.15),
      otm_15d_put: findOptionByDelta('P', 0.15),
    };

    const strategyLegs: any[] = [];
    if (isPinRegime) {
      const strategyOptionType = totalGEX < 0 ? 'P' : 'C';
      const leg1 = getOptionDetails(maxGexStrike - 10, strategyOptionType);
      const leg2 = getOptionDetails(maxGexStrike, strategyOptionType);
      const leg3 = getOptionDetails(maxGexStrike + 10, strategyOptionType);
      if (leg1) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1 });
      if (leg2) strategyLegs.push({ action: 'SELL', ratio: 2, contract: leg2 });
      if (leg3) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg3 });
    } else {
      const isCallWallProximity = Math.abs(snapSpot - callWall) / snapSpot < 0.003;
      const isPutWallProximity = Math.abs(snapSpot - putWall) / snapSpot < 0.003;
      if (snapSpot >= callWall || isCallWallProximity) {
        const buyStrike = Math.round(callWall / 5) * 5;
        const sellStrike = roundStrikeAbove;
        const leg1 = getOptionDetails(buyStrike, 'C');
        const leg2 = getOptionDetails(sellStrike, 'C');
        if (leg1) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1 });
        if (leg2) strategyLegs.push({ action: 'SELL', ratio: 1, contract: leg2 });
      } else if (snapSpot <= putWall || isPutWallProximity) {
        const buyStrike = Math.round(putWall / 5) * 5;
        const sellStrike = roundStrikeBelow;
        const leg1 = getOptionDetails(buyStrike, 'P');
        const leg2 = getOptionDetails(sellStrike, 'P');
        if (leg1) strategyLegs.push({ action: 'BUY', ratio: 1, contract: leg1 });
        if (leg2) strategyLegs.push({ action: 'SELL', ratio: 1, contract: leg2 });
      } else {
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

    const reconstructed = {
      single_legs: singleLegs,
      strategy_legs: strategyLegs
    };

    // Save reconstructed data back to Postgres so subsequent backtests are instant!
    await pool.query(
      `UPDATE option_suggestions_history 
       SET recorded_legs = $1
       WHERE id = $2`,
      [JSON.stringify(reconstructed), suggestionId]
    );

    return reconstructed;
  } catch (e) {
    console.error(`Error reconstructing suggestion legs for ID ${suggestionId}:`, e);
    return null;
  }
}

export async function runOptionsBacktest(config: {
  ticker: string;
  startDate: string;
  endDate: string;
  strategyClass: 'multileg' | 'atm_call' | 'atm_put' | 'otm_25d_call' | 'otm_25d_put' | 'otm_15d_call' | 'otm_15d_put';
  takeProfitPercent: number;
  stopLossPercent: number;
  initialCapital?: number;
}): Promise<BacktestResult> {
  const ticker = config.ticker || 'SPX';
  const startDate = config.startDate || '2026-01-01';
  const endDate = config.endDate || '2026-12-31';
  const initialCapital = config.initialCapital || 10000;
  const tpLimit = config.takeProfitPercent;
  const slLimit = config.stopLossPercent;

  console.log(`🚀 Running 0DTE Options Backtest: Ticker=${ticker}, Class=${config.strategyClass}, Range=${startDate} to ${endDate}`);

  // 1. Fetch suggestions in the date range
  const suggResult = await pool.query(
    `SELECT id, timestamp, spot_price as "spotPrice", title, suggestion_type as "suggestionType", strikes, recorded_legs as "recordedLegs"
     FROM option_suggestions_history
     WHERE ticker = $1 AND timestamp >= $2 AND timestamp <= $3
     ORDER BY timestamp ASC`,
    [ticker, startDate, endDate]
  );

  const trades: TradeLog[] = [];
  let cash = initialCapital;

  // We will build a daily portfolio value tracking loop to construct the equity curve
  // Initialize equity points at the start of each day
  const dailyEquityCurve: EquityPoint[] = [];

  for (let i = 0; i < suggResult.rows.length; i++) {
    const sRow = suggResult.rows[i];
    const suggestionId = sRow.id;
    const entryTime = new Date(sRow.timestamp);
    const entrySpot = parseFloat(sRow.spotPrice);
    
    let recordedLegs = sRow.recordedLegs;
    if (!recordedLegs) {
      // Reconstruct on-the-fly if missing (permanent DB migration fallback)
      const reconstructed = await reconstructSuggestionLegs(suggestionId, ticker, entryTime, entrySpot);
      if (reconstructed) {
        recordedLegs = reconstructed;
      }
    } else if (typeof recordedLegs === 'string') {
      try {
        recordedLegs = JSON.parse(recordedLegs);
      } catch {
        recordedLegs = null;
      }
    }

    if (!recordedLegs) continue;

    // Define entry legs based on selected strategy class
    let legsToTrade: Array<{ action: 'BUY' | 'SELL'; strike: number; type: 'C' | 'P'; expiration: string; entryPrice: number; ratio: number }> = [];

    if (config.strategyClass === 'multileg') {
      const sLegs = recordedLegs.strategy_legs || [];
      sLegs.forEach((leg: any) => {
        const c = leg.contract || leg;
        if (c) {
          legsToTrade.push({
            action: leg.action || 'BUY',
            strike: parseFloat(c.strike),
            type: c.type,
            expiration: c.expiration,
            entryPrice: c.mid_price || (parseFloat(c.bid) + parseFloat(c.ask)) / 2 || parseFloat(c.last_price) || 0,
            ratio: leg.ratio || 1
          });
        }
      });
    } else {
      const sLegs = recordedLegs.single_legs || {};
      const targetLeg = sLegs[config.strategyClass];
      if (targetLeg) {
        legsToTrade.push({
          action: 'BUY',
          strike: parseFloat(targetLeg.strike),
          type: targetLeg.type,
          expiration: targetLeg.expiration,
          entryPrice: targetLeg.mid_price || (parseFloat(targetLeg.bid) + parseFloat(targetLeg.ask)) / 2 || parseFloat(targetLeg.last_price) || 0,
          ratio: 1
        });
      }
    }

    // Skip if no active legs found
    if (legsToTrade.length === 0) continue;

    // Calculate Net Entry Premium Value: BUY legs are positive, SELL legs are negative
    let V0 = 0;
    legsToTrade.forEach(leg => {
      const sign = leg.action === 'BUY' ? 1 : -1;
      V0 += leg.ratio * sign * leg.entryPrice;
    });

    if (Math.abs(V0) === 0) continue;

    // Simulate trade progress throughout the day
    // Query subsequent option snapshots for the same day
    const nextSnaps = await pool.query(
      `SELECT id, timestamp, spot_price as "spotPrice"
       FROM option_snapshots
       WHERE ticker = $1 AND timestamp::date = $2::date AND timestamp > $2
       ORDER BY timestamp ASC`,
      [ticker, entryTime]
    );

    let exited = false;
    let exitPrice = V0;
    let exitTime = entryTime;
    let exitReason: TradeLog['exitReason'] = 'time_based';
    let lastSpot = entrySpot;

    // Standard position sizing: trade 1 standard lot (size = 100 contracts)
    const lotMultiplier = 100;
    const maxLossLimit = V0 > 0 ? V0 * (slLimit / 100) : (5.00 * (slLimit / 100)); // credit spread width capped max loss estimation

    for (let sIdx = 0; sIdx < nextSnaps.rows.length; sIdx++) {
      const snap = nextSnaps.rows[sIdx];
      const snapId = snap.id;
      const snapTime = new Date(snap.timestamp);
      const snapSpot = parseFloat(snap.spotPrice);
      lastSpot = snapSpot;

      // Price all legs at this snapshot
      let Vt = 0;
      let allPricesFound = true;

      for (const leg of legsToTrade) {
        const price = await getOptionPriceAtSnapshot(snapId, leg.strike, leg.type, leg.expiration);
        if (price !== null) {
          const sign = leg.action === 'BUY' ? 1 : -1;
          Vt += leg.ratio * sign * price;
        } else {
          // If a leg goes missing, fallback to its intrinsic value at spot
          const sign = leg.action === 'BUY' ? 1 : -1;
          const intrinsic = leg.type === 'C' ? Math.max(0, snapSpot - leg.strike) : Math.max(0, leg.strike - snapSpot);
          Vt += leg.ratio * sign * intrinsic;
        }
      }

      // Check exits
      const pnl = Vt - V0;
      let hitStop = false;
      let hitTarget = false;

      if (V0 > 0) {
        // Debit Spread / Long Single Leg Option
        hitStop = Vt <= V0 * (1 - slLimit / 100);
        hitTarget = Vt >= V0 * (1 + tpLimit / 100);
      } else {
        // Credit Spread / Short Option Strategy
        const credit = -V0;
        hitStop = pnl <= -credit * (slLimit / 100);
        hitTarget = pnl >= credit * (tpLimit / 100);
      }

      if (hitStop || hitTarget) {
        exitPrice = Vt;
        exitTime = snapTime;
        exitReason = hitStop ? 'stop_loss' : 'take_profit';
        exited = true;
        break;
      }
    }

    // Force close at end of day if still open
    if (!exited && nextSnaps.rows.length > 0) {
      const lastSnap = nextSnaps.rows[nextSnaps.rows.length - 1];
      const lastSnapId = lastSnap.id;
      exitTime = new Date(lastSnap.timestamp);
      lastSpot = parseFloat(lastSnap.spotPrice);

      let Vt = 0;
      for (const leg of legsToTrade) {
        const price = await getOptionPriceAtSnapshot(lastSnapId, leg.strike, leg.type, leg.expiration);
        const sign = leg.action === 'BUY' ? 1 : -1;
        if (price !== null) {
          Vt += leg.ratio * sign * price;
        } else {
          const intrinsic = leg.type === 'C' ? Math.max(0, lastSpot - leg.strike) : Math.max(0, leg.strike - lastSpot);
          Vt += leg.ratio * sign * intrinsic;
        }
      }

      exitPrice = Vt;
      exitReason = 'time_based';
    }

    // Calculate dollar PnL: BUY pays debit (negative cash impact), SELL collects credit (positive cash impact)
    // PnL per contract point = exitPositionValue - entryPositionValue
    const pnlPoints = exitPrice - V0;
    const tradePnL = pnlPoints * lotMultiplier;
    
    // Percentage Return on Risk calculation
    const riskBasis = V0 > 0 ? V0 : (-V0); // Debit paid, or credit received margin
    const pnlPercent = (pnlPoints / riskBasis) * 100;

    cash += tradePnL;

    const legSummary = legsToTrade.map(l => `${l.action} ${l.ratio}x SPX ${l.strike} ${l.type === 'C' ? 'Call' : 'Put'}`).join(' / ');

    trades.push({
      id: `T-${trades.length + 1}`,
      type: V0 > 0 ? 'long' : 'short',
      entryDate: entryTime.toISOString(),
      entryPrice: V0,
      exitDate: exitTime.toISOString(),
      exitPrice: exitPrice,
      quantity: lotMultiplier,
      pnl: tradePnL,
      pnlPercent: pnlPercent,
      exitReason: exitReason
    });

    dailyEquityCurve.push({
      timestamp: exitTime.toISOString(),
      portfolioValue: cash,
      price: lastSpot
    });
  }

  // Calculate Aggregated Metrics
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const losingTrades = totalTrades - winningTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const totalProfits = trades.filter(t => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
  const totalLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalProfits / totalLosses : totalTrades > 0 && totalLosses === 0 ? 999.0 : 0;

  const totalPnl = cash - initialCapital;
  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const avgPnlPercent = totalTrades > 0 ? trades.reduce((acc, t) => acc + t.pnlPercent, 0) / totalTrades : 0;

  let maxDrawdownPercent = 0;
  let peakVal = initialCapital;
  for (const pt of dailyEquityCurve) {
    if (pt.portfolioValue > peakVal) peakVal = pt.portfolioValue;
    const dd = ((peakVal - pt.portfolioValue) / peakVal) * 100;
    if (dd > maxDrawdownPercent) maxDrawdownPercent = dd;
  }

  return {
    ticker,
    startDate,
    endDate,
    initialCapital,
    finalCapital: cash,
    totalReturnPercent: ((cash - initialCapital) / initialCapital) * 100,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    maxDrawdownPercent,
    sharpeRatio: totalTrades > 1 ? (avgPnl / 100) * Math.sqrt(252) : 0, // annualized estimation
    trades,
    equityCurve: dailyEquityCurve.length > 0 ? dailyEquityCurve : [{ timestamp: startDate, portfolioValue: initialCapital, price: 0 }],
    
    // Detailed stats mapping
    totalPnl,
    avgPnl,
    avgPnlPercent,
    medianPnl: totalTrades > 0 ? trades.map(t => t.pnl).sort((a,b)=>a-b)[Math.floor(totalTrades/2)] : 0,
    avgWin: winningTrades > 0 ? totalProfits / winningTrades : 0,
    avgLoss: losingTrades > 0 ? totalLosses / losingTrades : 0,
    ddStart: startDate,
    ddEnd: endDate,
    ddRecovery: 'N/A',
    ddDurationBars: 0,
    ddDurationDays: 0,
    returnToDrawdown: maxDrawdownPercent > 0 ? ((cash - initialCapital) / initialCapital * 100) / maxDrawdownPercent : 0,
    largestWin: totalTrades > 0 ? Math.max(...trades.map(t => t.pnl), 0) : 0,
    largestLoss: totalTrades > 0 ? Math.min(...trades.map(t => t.pnl), 0) : 0,
    expectancy: totalTrades > 0 ? (winRate / 100) * (totalProfits / Math.max(1, winningTrades)) - ((100 - winRate) / 100) * (totalLosses / Math.max(1, losingTrades)) : 0,
    winningStreak: 0,
    losingStreak: 0
  };
}
