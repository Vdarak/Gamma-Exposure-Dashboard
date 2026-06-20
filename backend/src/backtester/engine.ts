import { BacktestConfig, BacktestResult, TradeLog, EquityPoint, TradeMarker } from './types';
import { loadHistoricalData, PriceBar } from './duckdbService';
import { precomputeIndicators } from './indicators';

function parseValue(val: string | number, precomputed: Record<string, number[]>, idx: number): number {
  if (typeof val === 'number') return val;
  const num = parseFloat(val as string);
  if (!isNaN(num)) return num;
  
  if (typeof val === 'string') {
    let valLower = val.toLowerCase().trim();
    if (valLower === 'price') valLower = 'close';
    
    // Try exact lower-case match first
    if (precomputed[valLower] && !isNaN(precomputed[valLower][idx])) {
      return precomputed[valLower][idx];
    }
    
    // Fallback to case-insensitive lookup
    const foundKey = Object.keys(precomputed).find(k => k.toLowerCase() === valLower);
    if (foundKey && precomputed[foundKey] && !isNaN(precomputed[foundKey][idx])) {
      return precomputed[foundKey][idx];
    }
  }
  
  return NaN;
}

function evaluateCondition(
  cond: any,
  precomputed: Record<string, number[]>,
  idx: number
): boolean {
  const val1 = parseValue(cond.indicator1, precomputed, idx);
  const val2 = parseValue(cond.indicator2, precomputed, idx);
  
  const prevVal1 = parseValue(cond.indicator1, precomputed, idx - 1);
  const prevVal2 = parseValue(cond.indicator2, precomputed, idx - 1);

  if (isNaN(val1) || isNaN(val2)) return false;

  let op = typeof cond.operator === 'string' ? cond.operator.toLowerCase().trim() : '';
  if (op === '>' || op === '>=' || op === 'greaterthan' || op === 'greater_than') op = 'greater_than';
  if (op === '<' || op === '<=' || op === 'lessthan' || op === 'less_than') op = 'less_than';
  if (op === '=' || op === '==' || op === '===' || op === 'equals') op = 'equals';
  if (op === 'crossesabove' || op === 'crosses_above') op = 'crosses_above';
  if (op === 'crossesbelow' || op === 'crosses_below') op = 'crosses_below';

  switch (op) {
    case 'greater_than':
      return val1 > val2;
    case 'less_than':
      return val1 < val2;
    case 'equals':
      return Math.abs(val1 - val2) < 0.0001;
    case 'crosses_above':
      if (isNaN(prevVal1) || isNaN(prevVal2)) return false;
      return prevVal1 <= prevVal2 && val1 > val2;
    case 'crosses_below':
      if (isNaN(prevVal1) || isNaN(prevVal2)) return false;
      return prevVal1 >= prevVal2 && val1 < val2;
    default:
      return false;
  }
}

function evaluateRules(
  rules: any[],
  precomputed: Record<string, number[]>,
  idx: number
): boolean {
  if (rules.length === 0) return false;
  // All rules must be true (AND logic)
  return rules.every(rule => evaluateCondition(rule, precomputed, idx));
}

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const bars = await loadHistoricalData(
    config.ticker,
    config.timeframe,
    config.startDate,
    config.endDate
  );

  if (bars.length < 2) {
    throw new Error(`Insufficient historical data found for ticker ${config.ticker} in range ${config.startDate} to ${config.endDate}`);
  }

  // Precompute all technical indicators requested
  const precomputed = precomputeIndicators(bars, config.indicators);
  
  let cash = config.initialCapital;
  const commission = config.commission || 0;
  const slippagePercent = config.slippagePercent || 0;
  
  const trades: TradeLog[] = [];
  const equityCurve: EquityPoint[] = [];
  const tradeMarkers: TradeMarker[] = [];

  let position = {
    active: false,
    type: 'long' as 'long' | 'short',
    entryPrice: 0,
    entryDate: '',
    quantity: 0,
    highestPrice: 0,
    lowestPrice: 0,
    stopLossPrice: 0,
    trailingStopPrice: 0,
    takeProfitPrice: 0,
    barsHeld: 0
  };

  const strategyType = config.strategyType || 'both';

  // Push initial equity point
  equityCurve.push({
    timestamp: bars[0].timestamp,
    portfolioValue: cash,
    price: bars[0].close
  });

  // Loop through price bars tick-by-tick (preventing lookahead bias)
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    
    // Evaluate current portfolio value
    const currentPrice = bar.close;
    let unrealizedValue = 0;
    if (position.active) {
      if (position.type === 'long') {
        unrealizedValue = position.quantity * currentPrice;
      } else {
        unrealizedValue = position.quantity * (position.entryPrice - currentPrice);
      }
    }
    const portfolioValue = cash + unrealizedValue;
    
    equityCurve.push({
      timestamp: bar.timestamp,
      portfolioValue: portfolioValue,
      price: currentPrice
    });

    if (position.active) {
      position.barsHeld++;
      
      let shouldExit = false;
      let exitPrice = bar.close;
      let exitReason: TradeLog['exitReason'] = 'indicator';

      if (position.type === 'long') {
        position.highestPrice = Math.max(position.highestPrice, bar.high);

        // Update trailing stop trigger price if price moves up
        if (config.exitRules.trailingStopPercent && position.highestPrice > position.entryPrice) {
          const trailPrice = position.highestPrice * (1 - config.exitRules.trailingStopPercent / 100);
          position.trailingStopPrice = Math.max(position.trailingStopPrice, trailPrice);
        }

        // Check exits:
        // 1. Standard Stop Loss
        if (position.stopLossPrice > 0 && bar.low <= position.stopLossPrice) {
          shouldExit = true;
          exitPrice = position.stopLossPrice;
          exitReason = 'stop_loss';
        }
        // 2. Trailing Stop Loss
        else if (position.trailingStopPrice > 0 && bar.low <= position.trailingStopPrice) {
          shouldExit = true;
          exitPrice = position.trailingStopPrice;
          exitReason = 'trailing_stop';
        }
        // 3. Take Profit
        else if (position.takeProfitPrice > 0 && bar.high >= position.takeProfitPrice) {
          shouldExit = true;
          exitPrice = position.takeProfitPrice;
          exitReason = 'take_profit';
        }
        // 4. Time-based Exit
        else if (config.exitRules.timeBasedExitDays && position.barsHeld >= config.exitRules.timeBasedExitDays) {
          shouldExit = true;
          exitPrice = bar.close;
          exitReason = 'time_based';
        }
        // 5. Technical Indicator Exits
        else if (evaluateRules(config.exitRules.indicators, precomputed, i)) {
          shouldExit = true;
          exitPrice = bar.close;
          exitReason = 'indicator';
        }

        if (shouldExit) {
          // Adjust exit price for slippage (selling)
          const exitSlippage = exitPrice * (slippagePercent / 100);
          const exitPriceFinal = exitPrice - exitSlippage;
          
          const grossPnl = (exitPriceFinal - position.entryPrice) * position.quantity;
          const netPnl = grossPnl - commission;
          cash += (position.quantity * exitPriceFinal) - commission;
          
          trades.push({
            id: `T-${trades.length + 1}`,
            type: 'long',
            entryDate: position.entryDate,
            entryPrice: position.entryPrice,
            exitDate: bar.timestamp,
            exitPrice: exitPriceFinal,
            quantity: position.quantity,
            pnl: netPnl,
            pnlPercent: (netPnl / (position.entryPrice * position.quantity)) * 100,
            exitReason
          });

          tradeMarkers.push({
            timestamp: bar.timestamp,
            type: 'sell',
            price: exitPriceFinal,
            text: `SELL Exit (${exitReason}): $${exitPriceFinal.toFixed(2)} (${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} PnL)`
          });

          position.active = false;
        }
      } else {
        // Short Position
        position.lowestPrice = Math.min(position.lowestPrice, bar.low);

        // Update trailing stop trigger price if price moves down (for short, we tighten when price drops)
        if (config.exitRules.trailingStopPercent && position.lowestPrice < position.entryPrice) {
          const trailPrice = position.lowestPrice * (1 + config.exitRules.trailingStopPercent / 100);
          position.trailingStopPrice = position.trailingStopPrice === 0 
            ? trailPrice 
            : Math.min(position.trailingStopPrice, trailPrice);
        }

        // Check exits for SHORT:
        // 1. Standard Stop Loss (triggers when price rises)
        if (position.stopLossPrice > 0 && bar.high >= position.stopLossPrice) {
          shouldExit = true;
          exitPrice = position.stopLossPrice;
          exitReason = 'stop_loss';
        }
        // 2. Trailing Stop Loss (triggers when price rises)
        else if (position.trailingStopPrice > 0 && bar.high >= position.trailingStopPrice) {
          shouldExit = true;
          exitPrice = position.trailingStopPrice;
          exitReason = 'trailing_stop';
        }
        // 3. Take Profit (triggers when price falls)
        else if (position.takeProfitPrice > 0 && bar.low <= position.takeProfitPrice) {
          shouldExit = true;
          exitPrice = position.takeProfitPrice;
          exitReason = 'take_profit';
        }
        // 4. Time-based Exit
        else if (config.exitRules.timeBasedExitDays && position.barsHeld >= config.exitRules.timeBasedExitDays) {
          shouldExit = true;
          exitPrice = bar.close;
          exitReason = 'time_based';
        }
        // 5. Technical Indicator Exits (for short, entryRules indicators trigger the short exit)
        else if (evaluateRules(config.entryRules.indicators, precomputed, i)) {
          shouldExit = true;
          exitPrice = bar.close;
          exitReason = 'indicator';
        }

        if (shouldExit) {
          // Adjust exit price for slippage (buying back shares costs more)
          const exitSlippage = exitPrice * (slippagePercent / 100);
          const exitPriceFinal = exitPrice + exitSlippage;
          
          const grossPnl = (position.entryPrice - exitPriceFinal) * position.quantity;
          const netPnl = grossPnl - commission;
          cash -= (position.quantity * exitPriceFinal) + commission; // cover the short
          
          trades.push({
            id: `T-${trades.length + 1}`,
            type: 'short',
            entryDate: position.entryDate,
            entryPrice: position.entryPrice,
            exitDate: bar.timestamp,
            exitPrice: exitPriceFinal,
            quantity: position.quantity,
            pnl: netPnl,
            pnlPercent: (netPnl / (position.entryPrice * position.quantity)) * 100,
            exitReason
          });

          tradeMarkers.push({
            timestamp: bar.timestamp,
            type: 'buy', // buy back shares to close short
            price: exitPriceFinal,
            text: `BUY Cover (${exitReason}): $${exitPriceFinal.toFixed(2)} (${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} PnL)`
          });

          position.active = false;
        }
      }
    } else {
      // Evaluate entry criteria when flat
      const isLongEntry = strategyType !== 'short' && evaluateRules(config.entryRules.indicators, precomputed, i);
      const isShortEntry = strategyType !== 'long' && evaluateRules(config.exitRules.indicators, precomputed, i);

      if (isLongEntry) {
        // Enter LONG
        const entryPrice = bar.close;
        const entrySlippage = entryPrice * (slippagePercent / 100);
        const entryPriceFinal = entryPrice + entrySlippage;

        const maxShares = Math.floor((cash - commission) / entryPriceFinal);
        
        if (maxShares > 0) {
          const totalCost = maxShares * entryPriceFinal + commission;
          cash -= totalCost;
          
          position = {
            active: true,
            type: 'long',
            entryPrice: entryPriceFinal,
            entryDate: bar.timestamp,
            quantity: maxShares,
            highestPrice: bar.high,
            lowestPrice: bar.low,
            stopLossPrice: config.exitRules.stopLossPercent 
              ? entryPriceFinal * (1 - config.exitRules.stopLossPercent / 100) 
              : 0,
            trailingStopPrice: config.exitRules.trailingStopPercent
              ? entryPriceFinal * (1 - config.exitRules.trailingStopPercent / 100)
              : 0,
            takeProfitPrice: config.exitRules.takeProfitPercent
              ? entryPriceFinal * (1 + config.exitRules.takeProfitPercent / 100)
              : 0,
            barsHeld: 0
          };

          tradeMarkers.push({
            timestamp: bar.timestamp,
            type: 'buy',
            price: entryPriceFinal,
            text: `BUY Entry (Long): ${maxShares} shares at $${entryPriceFinal.toFixed(2)}`
          });
        }
      } else if (isShortEntry) {
        // Enter SHORT
        const entryPrice = bar.close;
        const entrySlippage = entryPrice * (slippagePercent / 100);
        const entryPriceFinal = entryPrice - entrySlippage; // Sell proceeds reduced by slippage

        const maxShares = Math.floor((cash - commission) / entryPriceFinal);
        
        if (maxShares > 0) {
          const proceeds = maxShares * entryPriceFinal - commission;
          cash += proceeds; // proceeds credited to cash
          
          position = {
            active: true,
            type: 'short',
            entryPrice: entryPriceFinal,
            entryDate: bar.timestamp,
            quantity: maxShares,
            highestPrice: bar.high,
            lowestPrice: bar.low,
            stopLossPrice: config.exitRules.stopLossPercent 
              ? entryPriceFinal * (1 + config.exitRules.stopLossPercent / 100) 
              : 0,
            trailingStopPrice: config.exitRules.trailingStopPercent
              ? entryPriceFinal * (1 + config.exitRules.trailingStopPercent / 100)
              : 0,
            takeProfitPrice: config.exitRules.takeProfitPercent
              ? entryPriceFinal * (1 - config.exitRules.takeProfitPercent / 100)
              : 0,
            barsHeld: 0
          };

          tradeMarkers.push({
            timestamp: bar.timestamp,
            type: 'sell',
            price: entryPriceFinal,
            text: `SELL Entry (Short): ${maxShares} shares at $${entryPriceFinal.toFixed(2)}`
          });
        }
      }
    }
  }

  // Force close any open position at end of simulation
  if (position.active) {
    const lastBar = bars[bars.length - 1];
    const exitPrice = lastBar.close;
    
    if (position.type === 'long') {
      const exitSlippage = exitPrice * (slippagePercent / 100);
      const exitPriceFinal = exitPrice - exitSlippage;
      
      const grossPnl = (exitPriceFinal - position.entryPrice) * position.quantity;
      const netPnl = grossPnl - commission;
      cash += (position.quantity * exitPriceFinal) - commission;
      
      trades.push({
        id: `T-${trades.length + 1}`,
        type: 'long',
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        exitDate: lastBar.timestamp,
        exitPrice: exitPriceFinal,
        quantity: position.quantity,
        pnl: netPnl,
        pnlPercent: (netPnl / (position.entryPrice * position.quantity)) * 100,
        exitReason: 'end_of_data'
      });

      tradeMarkers.push({
        timestamp: lastBar.timestamp,
        type: 'sell',
        price: exitPriceFinal,
        text: `SELL Force Close (EOD): $${exitPriceFinal.toFixed(2)}`
      });
    } else {
      const exitSlippage = exitPrice * (slippagePercent / 100);
      const exitPriceFinal = exitPrice + exitSlippage;
      
      const grossPnl = (position.entryPrice - exitPriceFinal) * position.quantity;
      const netPnl = grossPnl - commission;
      cash -= (position.quantity * exitPriceFinal) + commission;
      
      trades.push({
        id: `T-${trades.length + 1}`,
        type: 'short',
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        exitDate: lastBar.timestamp,
        exitPrice: exitPriceFinal,
        quantity: position.quantity,
        pnl: netPnl,
        pnlPercent: (netPnl / (position.entryPrice * position.quantity)) * 100,
        exitReason: 'end_of_data'
      });

      tradeMarkers.push({
        timestamp: lastBar.timestamp,
        type: 'buy',
        price: exitPriceFinal,
        text: `BUY Force Close (EOD): $${exitPriceFinal.toFixed(2)}`
      });
    }
  }

  // Calculate backtest stats
  const finalCapital = cash;
  const totalReturnPercent = ((finalCapital - config.initialCapital) / config.initialCapital) * 100;
  
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const losingTrades = totalTrades - winningTrades;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
  
  const totalProfits = trades.filter(t => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
  const totalLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalProfits / totalLosses : totalTrades > 0 && totalLosses === 0 ? 999.0 : 0;

  // 2. Total P&L
  const totalPnl = finalCapital - config.initialCapital;

  // 5. Avg P&L
  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
  const avgPnlPercent = totalTrades > 0 
    ? trades.reduce((acc, t) => acc + t.pnlPercent, 0) / totalTrades 
    : 0;

  // 6. Median P&L
  let medianPnl = 0;
  if (totalTrades > 0) {
    const sortedPnls = trades.map(t => t.pnl).sort((a, b) => a - b);
    const half = Math.floor(sortedPnls.length / 2);
    medianPnl = sortedPnls.length % 2 !== 0 
      ? sortedPnls[half] 
      : (sortedPnls[half - 1] + sortedPnls[half]) / 2;
  }

  // 7. Avg Win
  const avgWin = winningTrades > 0 ? totalProfits / winningTrades : 0;

  // 8. Avg Loss
  const avgLoss = losingTrades > 0 ? totalLosses / losingTrades : 0;

  // 9. Max DD, DD Start, DD Valley (End), DD Recovery & Durations
  let peakIndex = 0;
  let maxDrawdownPercent = 0;
  let maxDrawdownPeakIdx = 0;
  let maxDrawdownValleyIdx = 0;

  for (let i = 0; i < equityCurve.length; i++) {
    const point = equityCurve[i];
    if (point.portfolioValue > equityCurve[peakIndex].portfolioValue) {
      peakIndex = i;
    }
    const peakVal = equityCurve[peakIndex].portfolioValue;
    const drawdownPct = ((peakVal - point.portfolioValue) / peakVal) * 100;
    if (drawdownPct > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPct;
      maxDrawdownPeakIdx = peakIndex;
      maxDrawdownValleyIdx = i;
    }
  }

  const ddStart = equityCurve.length > 0 ? equityCurve[maxDrawdownPeakIdx].timestamp : config.startDate;
  const ddEnd = equityCurve.length > 0 ? equityCurve[maxDrawdownValleyIdx].timestamp : config.endDate;
  
  let ddRecovery = 'Unrecovered';
  let ddRecoveryIdx = -1;
  if (equityCurve.length > 0 && maxDrawdownPercent > 0) {
    const peakVal = equityCurve[maxDrawdownPeakIdx].portfolioValue;
    for (let i = maxDrawdownValleyIdx + 1; i < equityCurve.length; i++) {
      if (equityCurve[i].portfolioValue >= peakVal) {
        ddRecovery = equityCurve[i].timestamp;
        ddRecoveryIdx = i;
        break;
      }
    }
  }

  // Durations
  const ddDurationBars = ddRecoveryIdx !== -1 
    ? ddRecoveryIdx - maxDrawdownPeakIdx 
    : (equityCurve.length > 0 ? (equityCurve.length - 1) - maxDrawdownPeakIdx : 0);

  let ddDurationDays = 0;
  if (equityCurve.length > 0) {
    const startDt = new Date(ddStart);
    const endDt = new Date(ddRecoveryIdx !== -1 ? ddRecovery : equityCurve[equityCurve.length - 1].timestamp);
    ddDurationDays = Math.round(Math.abs(endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60 * 24));
  }

  // 13. Return-to-DD (Calmar Ratio)
  const returnToDrawdown = maxDrawdownPercent > 0 ? totalReturnPercent / maxDrawdownPercent : 0;

  // 14. Largest Win
  const largestWin = totalTrades > 0 ? Math.max(...trades.map(t => t.pnl), 0) : 0;

  // 15. Largest Loss
  const largestLoss = totalTrades > 0 ? Math.min(...trades.map(t => t.pnl), 0) : 0;

  // 16. Expectancy
  const expectancy = totalTrades > 0 
    ? (winRate / 100) * avgWin - (losingTrades / totalTrades) * avgLoss 
    : 0;

  // 17 & 18. Streaks
  let tempWin = 0;
  let tempLoss = 0;
  let winningStreak = 0;
  let losingStreak = 0;

  for (const trade of trades) {
    if (trade.pnl > 0) {
      tempWin++;
      losingStreak = Math.max(losingStreak, tempLoss);
      tempLoss = 0;
    } else if (trade.pnl < 0) {
      tempLoss++;
      winningStreak = Math.max(winningStreak, tempWin);
      tempWin = 0;
    } else {
      winningStreak = Math.max(winningStreak, tempWin);
      losingStreak = Math.max(losingStreak, tempLoss);
      tempWin = 0;
      tempLoss = 0;
    }
  }
  winningStreak = Math.max(winningStreak, tempWin);
  losingStreak = Math.max(losingStreak, tempLoss);

  // 19. Sharpe Ratio Calculation (Simplified Trade-Based Sharpe)
  let sharpeRatio = 0;
  if (totalTrades > 1) {
    const tradeReturns = trades.map(t => t.pnlPercent);
    const avgReturn = tradeReturns.reduce((a, b) => a + b, 0) / totalTrades;
    const variance = tradeReturns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (totalTrades - 1);
    const stdDev = Math.sqrt(variance);
    // Assume a risk-free rate of 0% for trade-by-trade Sharpe
    sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // annualized scaling
  }

  return {
    ticker: config.ticker,
    startDate: config.startDate,
    endDate: config.endDate,
    initialCapital: config.initialCapital,
    finalCapital,
    totalReturnPercent,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    maxDrawdownPercent,
    sharpeRatio,
    trades,
    equityCurve,
    indicatorSeries: precomputed,
    ohlcv: {
      timestamp: bars.map(b => b.timestamp),
      open: bars.map(b => b.open),
      high: bars.map(b => b.high),
      low: bars.map(b => b.low),
      close: bars.map(b => b.close),
      volume: bars.map(b => b.volume)
    },
    tradeMarkers,
    
    // Rich performance & risk metrics
    totalPnl,
    avgPnl,
    avgPnlPercent,
    medianPnl,
    avgWin,
    avgLoss,
    ddStart,
    ddEnd,
    ddRecovery,
    ddDurationBars,
    ddDurationDays,
    returnToDrawdown,
    largestWin,
    largestLoss,
    expectancy,
    winningStreak,
    losingStreak
  };
}

