// Type definitions for option chain data

export interface OptionData {
  strike: number;
  type: 'C' | 'P';
  expiration: Date;
  lastPrice: number;
  bid?: number;
  ask?: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  changeInOi?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
}


export interface OptionSnapshot {
  id?: number;
  ticker: string;
  timestamp: Date;
  spotPrice: number;
  dataCount: number;
  market: 'USA' | 'INDIA';
  options?: OptionData[];
}

export interface HistoricalDataQuery {
  ticker: string;
  hoursBack?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface TimestampInfo {
  timestamp: Date;
  spotPrice: number;
}

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface JournalTrade {
  id: string;
  tradeDate: string; // YYYY-MM-DD
  timeEntered: string | null; // HH:MM
  timeExited: string | null; // HH:MM
  ticker: string;
  tradeType: 'Equity' | 'Option';
  strike?: number | null;
  optionType?: 'C' | 'P' | null;
  expiration?: string | null; // YYYY-MM-DD
  direction: 'Buy' | 'Sell';
  quality: 'S' | 'A' | 'B';
  pnl: number;
  pnlPercent: number;
  screenshot?: string | null; // Base64 JPEG string
  rationale?: string | null;
  strategy?: string | null;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  fees?: number | null;
  status?: 'Open' | 'Closed' | null;
  createdAt?: Date;
}

export interface OptionFlowItem {
  id: string;
  time: string;
  ticker: string;
  contractName: string;
  optionType: 'Call' | 'Put';
  strike: number;
  expiration: string;
  stockPrice: number;
  lastPrice: number;
  changePercent: number | null;
  volume: number;
  openInterest: number;
  oiChange: number; // Signed OI change for the selected timeframe
  notionalChange: number; // |oiChange| * lastPrice * 100
  timeframeType: 'Intraday' | 'Daily' | '5-Day' | 'Custom';
  oi5dChangePercent: number | null;
  otmPercent: number;
  ivPercent: number;
  iv5dPointDiff: number | null;
  delta: number;
  dte: number;
  earningsRemainingDays: number | null;
  bid?: number;
  ask?: number;
}

export interface FlowAggregates {
  dominantSentiment: 'Bullish' | 'Bearish' | 'Neutral';
  bullishSentimentPercent: number;
  putCallRatio: number;
  callVolume: number;
  putVolume: number;
  callPremium: number; // Cumulative call notional change
  putPremium: number; // Cumulative put notional change
  callPercentage: number; // Percentage of call volume
  putPercentage: number; // Percentage of put volume
}

export interface OptionsFlowResponse {
  success: boolean;
  data: OptionFlowItem[];
  aggregates: FlowAggregates;
  topNotionalStrikes: OptionFlowItem[];
}



