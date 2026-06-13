-- Option Chain Data Collection Schema

-- Create snapshots table to store metadata for each data collection
CREATE TABLE IF NOT EXISTS option_snapshots (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  spot_price DECIMAL(12, 4) NOT NULL,
  data_count INTEGER NOT NULL DEFAULT 0,
  market VARCHAR(10) DEFAULT 'USA',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_snapshots_ticker_timestamp ON option_snapshots(ticker, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON option_snapshots(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_ticker ON option_snapshots(ticker);

-- Create option_data table to store individual option details
CREATE TABLE IF NOT EXISTS option_data (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES option_snapshots(id) ON DELETE CASCADE,
  strike DECIMAL(12, 4) NOT NULL,
  option_type CHAR(1) NOT NULL CHECK (option_type IN ('C', 'P')),
  expiration DATE NOT NULL,
  last_price DECIMAL(12, 4),
  bid DECIMAL(12, 4),
  ask DECIMAL(12, 4),
  volume INTEGER DEFAULT 0,
  open_interest INTEGER DEFAULT 0,
  implied_volatility DECIMAL(8, 6),
  delta DECIMAL(12, 6),
  gamma DECIMAL(16, 8),
  theta DECIMAL(16, 8),
  vega DECIMAL(16, 8),
  rho DECIMAL(16, 8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for option_data
CREATE INDEX IF NOT EXISTS idx_option_data_snapshot ON option_data(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_option_data_strike ON option_data(strike);
CREATE INDEX IF NOT EXISTS idx_option_data_expiration ON option_data(expiration);
CREATE INDEX IF NOT EXISTS idx_option_data_type ON option_data(option_type);

-- Create a view for easy querying
CREATE OR REPLACE VIEW latest_snapshots AS
SELECT DISTINCT ON (ticker)
  id, ticker, timestamp, spot_price, data_count, market
FROM option_snapshots
ORDER BY ticker, timestamp DESC;

-- Function to clean old data (called by backend)
CREATE OR REPLACE FUNCTION clean_old_snapshots(days_to_keep INTEGER DEFAULT 3)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  -- Data is persisted permanently. Automated cleanup is disabled.
  -- DELETE FROM option_snapshots WHERE timestamp < NOW() - (days_to_keep || ' days')::INTERVAL;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- Trading Journal Schema
-- ==========================================

CREATE TABLE IF NOT EXISTS journal_trades (
  id VARCHAR(50) PRIMARY KEY,
  trade_date DATE NOT NULL,
  time_entered TIME,
  time_exited TIME,
  ticker VARCHAR(15) NOT NULL,
  trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('Equity', 'Option')),
  strike DECIMAL(12, 4),
  option_type CHAR(1) CHECK (option_type IN ('C', 'P')),
  expiration DATE,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('Buy', 'Sell')),
  quality CHAR(1) NOT NULL CHECK (quality IN ('S', 'A', 'B')),
  pnl DECIMAL(12, 2) NOT NULL,
  pnl_percent DECIMAL(8, 2) NOT NULL,
  screenshot TEXT, -- Base64 JPEG
  rationale TEXT,
  strategy VARCHAR(50),
  quantity DECIMAL(12, 4) NOT NULL DEFAULT 0,
  entry_price DECIMAL(12, 4) NOT NULL DEFAULT 0,
  exit_price DECIMAL(12, 4) NOT NULL DEFAULT 0,
  fees DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(10) DEFAULT 'Closed' CHECK (status IN ('Open', 'Closed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for sorting and filtering
CREATE INDEX IF NOT EXISTS idx_journal_trades_date ON journal_trades(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_trades_ticker ON journal_trades(ticker);

-- Migration for existing tables
ALTER TABLE journal_trades ADD COLUMN IF NOT EXISTS status VARCHAR(10) DEFAULT 'Closed' CHECK (status IN ('Open', 'Closed'));

-- Settings table for journal configuration
CREATE TABLE IF NOT EXISTS journal_settings (
  key VARCHAR(50) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);

-- Seed default balance if it doesn't exist
INSERT INTO journal_settings (key, value) VALUES ('start_balance', '2566.19') ON CONFLICT (key) DO NOTHING;

-- Earnings dates for companies
CREATE TABLE IF NOT EXISTS earnings_dates (
  ticker VARCHAR(10) PRIMARY KEY,
  next_earnings_date DATE NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index to optimize 5-day delta queries
CREATE INDEX IF NOT EXISTS idx_option_data_exp_strike_type ON option_data(expiration, strike, option_type);

-- Migration to alter option_data column types to support larger precisions and avoid numeric field overflows (e.g. for SPX)
ALTER TABLE option_data ALTER COLUMN implied_volatility TYPE DECIMAL(12, 6);
ALTER TABLE option_data ALTER COLUMN delta TYPE DECIMAL(12, 6);
ALTER TABLE option_data ALTER COLUMN gamma TYPE DECIMAL(16, 8);
ALTER TABLE option_data ALTER COLUMN theta TYPE DECIMAL(16, 8);
ALTER TABLE option_data ALTER COLUMN vega TYPE DECIMAL(16, 8);
ALTER TABLE option_data ALTER COLUMN rho TYPE DECIMAL(16, 8);


