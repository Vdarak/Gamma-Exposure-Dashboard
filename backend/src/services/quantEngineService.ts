import axios from 'axios';
import { pool } from '../db/connection';
import { getCurrentData } from './dataRetrieval';

// Standard normal CDF helper
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// Black-Scholes call option pricer
function bsCallPrice(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, S - K);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
}

/**
 * 1. GARCH(1,1) Volatility Forecasting Suite
 */
export async function getGarchForecast(ticker: string): Promise<any> {
  const symbol = ticker.toUpperCase() === 'SPX' ? '^SPX' : ticker.toUpperCase();
  console.log(`📈 Running GARCH(1,1) on ${symbol}...`);

  try {
    // Fetch 1 year of daily historical close prices from Yahoo Finance
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    const result = response.data?.chart?.result?.[0];
    const prices = result?.indicators?.quote?.[0]?.close?.filter((p: any) => p !== null && p !== undefined) || [];
    
    if (prices.length < 30) {
      throw new Error(`Insufficient historical data for GARCH forecast: found ${prices.length} prices`);
    }

    // 1. Calculate daily log returns: r_t = ln(S_t / S_{t-1})
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }

    // Unconditional variance (V) of returns
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length - 1);
    const standardDeviation = Math.sqrt(variance);

    // 2. Grid-Search Optimizer for GARCH(1,1) MLE
    // variance_t = omega + alpha * return_{t-1}^2 + beta * variance_{t-1}
    // We search over alpha: [0.01, 0.20], beta: [0.70, 0.95] satisfying alpha + beta < 0.99
    let bestAlpha = 0.05;
    let bestBeta = 0.90;
    let maxLikelihood = -Infinity;

    for (let alpha = 0.01; alpha <= 0.22; alpha += 0.02) {
      for (let beta = 0.70; beta <= 0.96; beta += 0.02) {
        if (alpha + beta >= 0.99) continue;

        const omega = variance * (1 - alpha - beta);
        let currentVar = variance; // Initial variance set to unconditional variance
        let logLikelihood = 0;

        for (let t = 1; t < returns.length; t++) {
          // GARCH model recursion
          currentVar = omega + alpha * Math.pow(returns[t - 1], 2) + beta * currentVar;
          // Log-likelihood of standard normal returns under forecasted variance
          logLikelihood += -0.5 * (Math.log(2 * Math.PI) + Math.log(currentVar) + Math.pow(returns[t], 2) / currentVar);
        }

        if (logLikelihood > maxLikelihood) {
          maxLikelihood = logLikelihood;
          bestAlpha = alpha;
          bestBeta = beta;
        }
      }
    }

    const alpha = bestAlpha;
    const beta = bestBeta;
    const omega = variance * (1 - alpha - beta);
    const unconditionalVol = Math.sqrt(variance) * Math.sqrt(252); // Annualized

    // 3. Compute variance forecast for future horizons (1D to 90D)
    // E_t[var_{t+k}] = V + (alpha + beta)^k * (var_t - V)
    const garchVolForecasts: { horizonDays: number; forecastedVol: number }[] = [];
    const horizons = [1, 5, 10, 15, 20, 30, 60, 90];
    
    // final step variance estimate
    let finalVar = variance;
    for (let t = 1; t < returns.length; t++) {
      finalVar = omega + alpha * Math.pow(returns[t - 1], 2) + beta * finalVar;
    }

    horizons.forEach(h => {
      let cumulativeVar = 0;
      for (let k = 1; k <= h; k++) {
        const expectedVarK = variance + Math.pow(alpha + beta, k) * (finalVar - variance);
        cumulativeVar += expectedVarK;
      }
      const avgDailyVar = cumulativeVar / h;
      const annualizedHorizonVol = Math.sqrt(avgDailyVar) * Math.sqrt(252);
      garchVolForecasts.push({
        horizonDays: h,
        forecastedVol: annualizedHorizonVol
      });
    });

    // 4. Compare with Option chain Implied Volatility (IV) Term Structure
    const optionSnapshot = await getCurrentData(ticker.toUpperCase());
    const optionTermStructure: { daysToExpiry: number; expiration: string; averageIv: number }[] = [];
    
    if (optionSnapshot && optionSnapshot.options && optionSnapshot.options.length > 0) {
      const groupedExpiries = new Map<string, number[]>();
      optionSnapshot.options.forEach(opt => {
        const dateStr = opt.expiration.toISOString().split('T')[0];
        if (opt.impliedVolatility > 0.01) {
          if (!groupedExpiries.has(dateStr)) {
            groupedExpiries.set(dateStr, []);
          }
          groupedExpiries.get(dateStr)!.push(opt.impliedVolatility);
        }
      });

      const today = new Date();
      groupedExpiries.forEach((ivs, expiryStr) => {
        const expiryDate = new Date(expiryStr);
        const days = Math.max(1, Math.round((expiryDate.getTime() - today.getTime()) / (1000 * 24 * 60 * 60)));
        const avgIv = ivs.reduce((a, b) => a + b, 0) / ivs.length;
        optionTermStructure.push({
          daysToExpiry: days,
          expiration: expiryStr,
          averageIv: avgIv
        });
      });
      optionTermStructure.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
    }

    return {
      success: true,
      ticker: ticker.toUpperCase(),
      unconditionalVol,
      alpha,
      beta,
      omega,
      garchVolForecasts,
      optionTermStructure
    };
  } catch (error: any) {
    console.error('❌ GARCH forecast error:', error.message);
    return {
      success: false,
      error: error.message || 'Failed to calculate GARCH forecast due to historical data loading issue.'
    };
  }
}

/**
 * 2. Breeden-Litzenberger Implied PDF Map
 */
export async function getProbabilityMap(ticker: string, targetExpiry?: string): Promise<any> {
  try {
    const snapshot = await getCurrentData(ticker.toUpperCase());
    if (!snapshot || !snapshot.options || snapshot.options.length === 0) {
      throw new Error(`No current options snapshot found for ${ticker}`);
    }

    const spot = snapshot.spotPrice;
    
    // 1. Group options by expiration
    const expiryMap = new Map<string, any[]>();
    snapshot.options.forEach(opt => {
      const dateStr = opt.expiration.toISOString().split('T')[0];
      if (!expiryMap.has(dateStr)) {
        expiryMap.set(dateStr, []);
      }
      expiryMap.get(dateStr)!.push(opt);
    });

    const todayStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const todayDate = new Date(todayStr);
    todayDate.setHours(0, 0, 0, 0);

    let expiries = Array.from(expiryMap.keys())
      .filter(expStr => {
        const expDate = new Date(expStr);
        expDate.setHours(23, 59, 59, 999); // Include today's expiration
        return expDate.getTime() >= todayDate.getTime();
      })
      .sort();

    if (expiries.length === 0) {
      expiries = Array.from(expiryMap.keys()).sort();
    }

    // Choose target expiration: either specified, or closest to closest DTE
    const activeExpiry = targetExpiry && expiries.includes(targetExpiry)
      ? targetExpiry
      : expiries[0];

    // Fetch rate once
    const rateResult = await pool.query("SELECT rate FROM interest_rates WHERE rate_key = 'US_RISK_FREE'");
    const r = rateResult.rows.length > 0 ? parseFloat(rateResult.rows[0].rate) : 0.0525;
    const today = new Date();

    const expiriesData = [];

    for (const exp of expiries) {
      const optionsForExpiry = expiryMap.get(exp)!;
      if (!optionsForExpiry || optionsForExpiry.length === 0) continue;

      // Sort options by strike
      optionsForExpiry.sort((a, b) => a.strike - b.strike);

      // Get time to expiration (T)
      const expiryDate = new Date(exp);
      const T = Math.max(1e-5, (expiryDate.getTime() - today.getTime()) / (1000 * 365 * 24 * 60 * 60));

      // Build a dense strike grid: 120 points from 60% to 130% of spot price (-40% to +30%)
      const strikesGrid: number[] = [];
      const minStrike = spot * 0.58;
      const maxStrike = spot * 1.32;
      const gridPoints = 120;
      const dK = (maxStrike - minStrike) / (gridPoints - 1);
      
      for (let i = 0; i < gridPoints; i++) {
        strikesGrid.push(minStrike + i * dK);
      }

      // Clean original market strikes & IVs
      const marketStrikes = optionsForExpiry.map(o => o.strike);
      const marketIVs = optionsForExpiry.map(o => o.impliedVolatility || o.implied_volatility || 0.2);

      // Linear interpolator for IV
      const getInterpolatedIV = (k: number): number => {
        if (marketStrikes.length === 0) return 0.2;
        if (k <= marketStrikes[0]) return marketIVs[0];
        if (k >= marketStrikes[marketStrikes.length - 1]) return marketIVs[marketIVs.length - 1];
        
        let low = 0;
        let high = marketStrikes.length - 1;
        while (high - low > 1) {
          const mid = Math.floor((low + high) / 2);
          if (marketStrikes[mid] < k) low = mid;
          else high = mid;
        }
        
        const k0 = marketStrikes[low];
        const k1 = marketStrikes[high];
        const iv0 = marketIVs[low];
        const iv1 = marketIVs[high];
        
        return iv0 + ((k - k0) / (k1 - k0)) * (iv1 - iv0);
      };

      // Calculate call prices
      const callPrices = strikesGrid.map(k => {
        const iv = getInterpolatedIV(k);
        return bsCallPrice(spot, k, T, r, iv);
      });

      // Numerical second derivative for PDF
      const pdf: { strike: number; density: number; cumulative: number; pctOffset: number }[] = [];
      let cumulativeSum = 0;

      pdf.push({ strike: strikesGrid[0], density: 0, cumulative: 0, pctOffset: ((strikesGrid[0] - spot) / spot) * 100 });

      for (let i = 1; i < gridPoints - 1; i++) {
        const cPrev = callPrices[i - 1];
        const cCurr = callPrices[i];
        const cNext = callPrices[i + 1];
        
        let d2C = (cNext - 2 * cCurr + cPrev) / (dK * dK);
        if (d2C < 0) d2C = 0;

        const density = Math.exp(r * T) * d2C;
        cumulativeSum += density * dK;
        
        pdf.push({
          strike: strikesGrid[i],
          density,
          cumulative: cumulativeSum,
          pctOffset: ((strikesGrid[i] - spot) / spot) * 100
        });
      }
      
      pdf.push({ strike: strikesGrid[gridPoints - 1], density: 0, cumulative: cumulativeSum, pctOffset: ((strikesGrid[gridPoints - 1] - spot) / spot) * 100 });

      // Normalize PDF
      const totalMass = pdf.reduce((acc, p) => acc + p.density * dK, 0);
      if (totalMass > 0) {
        let cumulative = 0;
        pdf.forEach(p => {
          p.density = p.density / totalMass;
          cumulative += p.density * dK;
          p.cumulative = Math.min(1.0, cumulative);
        });
      }

      // Statistical moments
      let mean = 0;
      pdf.forEach(p => {
        mean += p.strike * p.density * dK;
      });

      let variance = 0;
      pdf.forEach(p => {
        variance += Math.pow(p.strike - mean, 2) * p.density * dK;
      });
      const stdDev = Math.sqrt(variance);

      let skewness = 0;
      if (stdDev > 0) {
        pdf.forEach(p => {
          skewness += Math.pow((p.strike - mean) / stdDev, 3) * p.density * dK;
        });
      }

      let kurtosis = 0;
      if (variance > 0) {
        pdf.forEach(p => {
          kurtosis += Math.pow((p.strike - mean) / stdDev, 4) * p.density * dK;
        });
      }

      let maxDensity = -1;
      let pinStrike = spot;
      pdf.forEach(p => {
        if (p.density > maxDensity) {
          maxDensity = p.density;
          pinStrike = p.strike;
        }
      });

      expiriesData.push({
        expiration: exp,
        daysToExpiry: Math.round(T * 365),
        mean,
        stdDev,
        skewness,
        kurtosis,
        pinStrike,
        pdf
      });
    }

    const activeData = expiriesData.find(d => d.expiration === activeExpiry) || expiriesData[0];

    return {
      success: true,
      ticker: ticker.toUpperCase(),
      expiration: activeExpiry,
      availableExpiries: expiries,
      spotPrice: spot,
      mean: activeData?.mean || spot,
      stdDev: activeData?.stdDev || 0,
      skewness: activeData?.skewness || 0,
      kurtosis: activeData?.kurtosis || 0,
      pinStrike: activeData?.pinStrike || spot,
      pdf: activeData?.pdf || [],
      expiries: expiriesData
    };
  } catch (error: any) {
    console.error('❌ Breeden-Litzenberger solver error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 3. Quantum Tunneling wall barrier breakthroughs
 */
export async function getQuantumTunneling(ticker: string, expiries?: string[]): Promise<any> {
  try {
    const snapshot = await getCurrentData(ticker.toUpperCase());
    if (!snapshot || !snapshot.options || snapshot.options.length === 0) {
      throw new Error(`No current options snapshot found for ${ticker}`);
    }

    const spot = snapshot.spotPrice;
    
    let optionsToProcess = snapshot.options;
    if (expiries && expiries.length > 0) {
      const filtered = snapshot.options.filter(opt => {
        const dateStr = opt.expiration.toISOString().split('T')[0];
        return expiries.includes(dateStr);
      });
      if (filtered.length > 0) {
        optionsToProcess = filtered;
      }
    }

    // Group GEX by strikes to find largest walls
    const strikeGexMap = new Map<number, { callGex: number; putGex: number; totalGex: number }>();
    
    optionsToProcess.forEach(opt => {
      const strike = opt.strike;
      if (!strikeGexMap.has(strike)) {
        strikeGexMap.set(strike, { callGex: 0, putGex: 0, totalGex: 0 });
      }
      
      const spotSq = spot * spot;
      const gamma = opt.gamma ?? 0;
      const gexValue = (opt.type === 'C' ? 1 : -1) * spotSq * gamma * opt.openInterest * 100 / 1e9; // in Billions

      const entry = strikeGexMap.get(strike)!;
      if (opt.type === 'C') entry.callGex += gexValue;
      else entry.putGex += gexValue;
      entry.totalGex += gexValue;
    });

    const sortedStrikes = Array.from(strikeGexMap.entries()).map(([strike, gex]) => ({
      strike,
      ...gex
    })).sort((a, b) => b.totalGex - a.totalGex);

    if (sortedStrikes.length === 0) {
      throw new Error('No strikes parsed for tunneling calculation');
    }

    // Top Call Wall: highest call GEX strike nearest to spot price
    const topCallGexStrikes = [...sortedStrikes]
      .filter(s => s.callGex > 0)
      .sort((a, b) => b.callGex - a.callGex)
      .slice(0, 5); // Take top 5 highest call GEX strikes
    
    const topCallWall = topCallGexStrikes.length > 0 
      ? topCallGexStrikes.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0]
      : sortedStrikes[0];

    // Top Put Wall: highest put GEX strike nearest to spot price
    const topPutGexStrikes = [...sortedStrikes]
      .filter(s => s.putGex < 0)
      .sort((a, b) => a.putGex - b.putGex)
      .slice(0, 5); // Take top 5 highest magnitude put GEX strikes
      
    const topPutWall = topPutGexStrikes.length > 0
      ? topPutGexStrikes.sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0]
      : sortedStrikes[0];

    // Calculate daily return standard deviation as energy E (using historical default ~ 1.2% daily vol)
    const E = 0.012; // Daily return standard deviation (~1.2%)

    // Helper to calculate Schrödinger tunneling transmission coefficient
    // P_tunnel = exp(-2 * k * d)
    // distance d is normalized strike distance
    // Barrier height U is related to the wall size relative to average spot strike GEX size
    const avgGexVal = sortedStrikes.reduce((acc, s) => acc + Math.abs(s.totalGex), 0) / sortedStrikes.length;
    
    const calculateWallTunneling = (wallStrike: number, wallGex: number, isCall: boolean) => {
      const distance = Math.abs(spot - wallStrike) / spot;
      const barrierHeight = Math.max(0.1, Math.abs(wallGex) / (avgGexVal || 1.0));
      
      let breakthroughProbability = 0;
      let status = 'Standard';
      
      if (wallGex > 0) {
        // Positive GEX: dealer long gamma, price-stabilizing. High potential energy barrier!
        // kappa = sqrt(U)
        const kappa = Math.sqrt(barrierHeight);
        breakthroughProbability = Math.exp(-2.5 * kappa * (distance * 100)); // amplified distance scaling for visual gauge
        status = 'Strong Pin / Resistance';
      } else {
        // Negative GEX: dealer short gamma, price-accelerating. Magnetic vacuum barrier (easy tunneling/attraction)
        breakthroughProbability = 0.85 * Math.exp(-1.5 * (distance * 100));
        status = 'Magnetic / Accelerating';
      }

      // Bound probability between 1% and 99%
      breakthroughProbability = Math.max(0.01, Math.min(0.99, breakthroughProbability));

      return {
        strike: wallStrike,
        gexBillions: wallGex,
        distancePoints: Math.abs(spot - wallStrike),
        distancePercent: distance * 100,
        barrierStrength: barrierHeight,
        breakthroughProbability,
        status
      };
    };

    const callWallMetrics = calculateWallTunneling(topCallWall.strike, topCallWall.callGex, true);
    const putWallMetrics = calculateWallTunneling(topPutWall.strike, topPutWall.putGex, false);

    return {
      success: true,
      ticker: ticker.toUpperCase(),
      spotPrice: spot,
      averageDailyVolatility: E * 100, // as percentage
      callWall: callWallMetrics,
      putWall: putWallMetrics
    };
  } catch (error: any) {
    console.error('❌ Quantum Tunneling calculation error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}
