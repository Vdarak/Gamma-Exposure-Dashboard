import { PriceBar } from './duckdbService';

export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - j];
    }
    sma.push(sum / period);
  }
  return sma;
}

export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  if (prices.length === 0) return ema;

  const k = 2 / (period + 1);
  let prevEma = prices[0]; // Seed with the first price
  ema.push(prevEma);

  for (let i = 1; i < prices.length; i++) {
    const currentEma = prices[i] * k + prevEma * (1 - k);
    ema.push(currentEma);
    prevEma = currentEma;
  }
  return ema;
}

export function calculateRSI(prices: number[], period: number): number[] {
  const rsi: number[] = [];
  if (prices.length < 2) {
    return new Array(prices.length).fill(NaN);
  }

  const gains: number[] = [];
  const losses: number[] = [];

  // Calculate changes
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // Pre-fill leading values with NaN
  for (let i = 0; i <= period; i++) {
    rsi.push(NaN);
  }

  // First average gain and average loss (simple average)
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

  // Subsequent values using Wilder's smoothing
  for (let i = period + 1; i < prices.length; i++) {
    const gain = gains[i - 1];
    const loss = losses[i - 1];

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }

  return rsi;
}

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function calculateMACD(
  prices: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult {
  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);
  
  const macd: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macd.push(fastEma[i] - slowEma[i]);
  }

  // Filter out NaN from the beginning of MACD for signal calculation
  const signal = calculateEMA(macd, signalPeriod);
  const histogram: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    histogram.push(macd[i] - signal[i]);
  }

  return { macd, signal, histogram };
}

export interface BBResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function calculateBB(
  prices: number[],
  period = 20,
  stdDevMultiplier = 2
): BBResult {
  const middle = calculateSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    const mean = middle[i];
    let varianceSum = 0;
    
    for (let j = 0; j < period; j++) {
      varianceSum += Math.pow(prices[i - j] - mean, 2);
    }
    
    const stdDev = Math.sqrt(varianceSum / period);
    upper.push(mean + stdDevMultiplier * stdDev);
    lower.push(mean - stdDevMultiplier * stdDev);
  }

  return { upper, middle, lower };
}

export function calculateATR(bars: PriceBar[], period = 14): number[] {
  const atr: number[] = [];
  if (bars.length === 0) return atr;

  const tr: number[] = [];
  
  // Calculate True Range (TR)
  tr.push(bars[0].high - bars[0].low);
  for (let i = 1; i < bars.length; i++) {
    const hL = bars[i].high - bars[i].low;
    const hCprev = Math.abs(bars[i].high - bars[i - 1].close);
    const lCprev = Math.abs(bars[i].low - bars[i - 1].close);
    tr.push(Math.max(hL, hCprev, lCprev));
  }

  // Calculate Average True Range (Wilder's MA of TR)
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      atr.push(NaN);
      continue;
    }
    
    if (i === period - 1) {
      const initialAtr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
      atr.push(initialAtr);
      continue;
    }

    const currentAtr = (atr[i - 1] * (period - 1) + tr[i]) / period;
    atr.push(currentAtr);
  }

  return atr;
}

/**
 * Precomputes all indicators declared in strategy configuration
 */
export function precomputeIndicators(bars: PriceBar[], configs: any[]): Record<string, number[]> {
  const results: Record<string, number[]> = {};
  const closePrices = bars.map(b => b.close);

  results['close'] = closePrices;
  results['open'] = bars.map(b => b.open);
  results['high'] = bars.map(b => b.high);
  results['low'] = bars.map(b => b.low);

  for (const config of configs) {
    if (config.type === 'sma') {
      const key = `sma_${config.period1}`;
      results[key] = calculateSMA(closePrices, config.period1);
    } else if (config.type === 'ema') {
      const key = `ema_${config.period1}`;
      results[key] = calculateEMA(closePrices, config.period1);
    } else if (config.type === 'rsi') {
      const key = `rsi_${config.period1}`;
      results[key] = calculateRSI(closePrices, config.period1);
    } else if (config.type === 'macd') {
      const fast = config.period1;
      const slow = config.period2 || 26;
      const signal = config.signalPeriod || 9;
      const keyMacd = `macd_line_${fast}_${slow}_${signal}`;
      const keySignal = `macd_signal_${fast}_${slow}_${signal}`;
      const keyHist = `macd_hist_${fast}_${slow}_${signal}`;
      
      const res = calculateMACD(closePrices, fast, slow, signal);
      results[keyMacd] = res.macd;
      results[keySignal] = res.signal;
      results[keyHist] = res.histogram;
    } else if (config.type === 'bb') {
      const period = config.period1;
      const multiplier = config.stdDev || 2;
      const keyUpper = `bb_upper_${period}_${multiplier}`;
      const keyMiddle = `bb_middle_${period}_${multiplier}`;
      const keyLower = `bb_lower_${period}_${multiplier}`;
      
      const res = calculateBB(closePrices, period, multiplier);
      results[keyUpper] = res.upper;
      results[keyMiddle] = res.middle;
      results[keyLower] = res.lower;
    } else if (config.type === 'atr') {
      const key = `atr_${config.period1}`;
      results[key] = calculateATR(bars, config.period1);
    }
  }

  return results;
}
