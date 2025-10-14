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
