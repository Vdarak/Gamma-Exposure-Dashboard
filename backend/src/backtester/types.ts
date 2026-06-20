export interface IndicatorCondition {
  indicator1: string; // e.g. "close", "sma_20", "rsi_14", "bb_upper_20_2"
  operator: 'greater_than' | 'less_than' | 'crosses_above' | 'crosses_below' | 'equals';
  indicator2: string | number; // e.g. "sma_50", 30, 70
}

export interface IndicatorConfig {
  type: 'sma' | 'ema' | 'rsi' | 'macd' | 'bb' | 'atr';
  period1: number;
  period2?: number; // for MACD (slow)
  signalPeriod?: number; // for MACD (signal)
  stdDev?: number; // for Bollinger Bands
}

export interface BacktestConfig {
  ticker: string;
  assetClass: 'equity' | 'option';
  startDate: string;
  endDate: string;
  initialCapital: number;
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '1d';
  strategyType?: 'long' | 'short' | 'both';
  commission?: number; // flat fee per trade or share
  slippagePercent?: number; // e.g. 0.05%
  
  // Strategy details
  indicators: IndicatorConfig[];
  entryRules: {
    indicators: IndicatorCondition[];
  };
  exitRules: {
    stopLossPercent?: number; // standard stop loss (e.g. 2% under entry)
    trailingStopPercent?: number; // trailing stop loss (e.g. 1.5% trail)
    takeProfitPercent?: number; // target profit (e.g. 5% gain)
    timeBasedExitDays?: number; // close after N calendar/trading days
    indicators: IndicatorCondition[];
  };
}

export interface TradeLog {
  id: string;
  type: 'long' | 'short';
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  exitReason: 'stop_loss' | 'trailing_stop' | 'take_profit' | 'indicator' | 'time_based' | 'end_of_data';
}

export interface EquityPoint {
  timestamp: string;
  portfolioValue: number;
  price: number;
}

export interface TradeMarker {
  timestamp: string;
  type: 'buy' | 'sell';
  price: number;
  text: string;
}

export interface OHLCVSeries {
  timestamp: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface BacktestResult {
  ticker: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  finalCapital: number;
  totalReturnPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  trades: TradeLog[];
  equityCurve: EquityPoint[];
  indicatorSeries?: Record<string, number[]>;
  ohlcv?: OHLCVSeries;
  tradeMarkers?: TradeMarker[];
  
  // Rich performance & risk metrics
  totalPnl: number;
  avgPnl: number;
  avgPnlPercent: number;
  medianPnl: number;
  avgWin: number;
  avgLoss: number;
  ddStart: string;
  ddEnd: string;
  ddRecovery: string;
  ddDurationBars: number;
  ddDurationDays: number;
  returnToDrawdown: number;
  largestWin: number;
  largestLoss: number;
  expectancy: number;
  winningStreak: number;
  losingStreak: number;
}

