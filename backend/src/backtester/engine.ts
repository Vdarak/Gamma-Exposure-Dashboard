import { BacktestConfig, BacktestResult, TradeLog, EquityPoint } from './types';
import { loadHistoricalData, PriceBar } from './duckdbService';
import { precomputeIndicators } from './indicators';

function parseValue(val: string | number, precomputed: Record<string, number[]>, idx: number): number {
  if (typeof val === 'number') return val;
  const num = parseFloat(val);
  if (!isNaN(num)) return num;
  
  if (precomputed[val] && !isNaN(precomputed[val][idx])) {
    return precomputed[val][idx];
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

  switch (cond.operator) {
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

  let position = {
    active: false,
    entryPrice: 0,
    entryDate: '',
    quantity: 0,
    highestPrice: 0,
    stopLossPrice: 0,
    trailingStopPrice: 0,
    takeProfitPrice: 0,
    barsHeld: 0
  };

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
    const unrealizedValue = position.active ? position.quantity * currentPrice : 0;
    const portfolioValue = cash + unrealizedValue;
    
    equityCurve.push({
      timestamp: bar.timestamp,
      portfolioValue: portfolioValue,
      price: currentPrice
    });

    if (position.active) {
      position.barsHeld++;
      position.highestPrice = Math.max(position.highestPrice, bar.high);

      // Update trailing stop trigger price if price moves up
      if (config.exitRules.trailingStopPercent && position.highestPrice > position.entryPrice) {
        const trailPrice = position.highestPrice * (1 - config.exitRules.trailingStopPercent / 100);
        position.trailingStopPrice = Math.max(position.trailingStopPrice, trailPrice);
      }

      let shouldExit = false;
      let exitPrice = bar.close;
      let exitReason: TradeLog['exitReason'] = 'indicator';

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
        // Adjust exit price for slippage
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

        // Reset position
        position.active = false;
      }
    } else {
      // Evaluate entry criteria
      if (evaluateRules(config.entryRules.indicators, precomputed, i)) {
        // Calculate maximum shares we can afford
        const entryPrice = bar.close;
        const entrySlippage = entryPrice * (slippagePercent / 100);
        const entryPriceFinal = entryPrice + entrySlippage;

        const maxShares = Math.floor((cash - commission) / entryPriceFinal);
        
        if (maxShares > 0) {
          const totalCost = maxShares * entryPriceFinal + commission;
          cash -= totalCost;
          
          position = {
            active: true,
            entryPrice: entryPriceFinal,
            entryDate: bar.timestamp,
            quantity: maxShares,
            highestPrice: bar.high,
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
        }
      }
    }
  }

  // Force close any open position at end of simulation
  if (position.active) {
    const lastBar = bars[bars.length - 1];
    const exitPrice = lastBar.close;
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

  // Max Drawdown Calculation
  let peak = config.initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.portfolioValue > peak) {
      peak = point.portfolioValue;
    }
    const drawdown = ((peak - point.portfolioValue) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Sharpe Ratio Calculation (Simplified Trade-Based Sharpe)
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
    maxDrawdownPercent: maxDrawdown,
    sharpeRatio,
    trades,
    equityCurve
  };
}
