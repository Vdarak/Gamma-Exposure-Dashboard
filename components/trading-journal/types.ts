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
  createdAt?: string;
}

