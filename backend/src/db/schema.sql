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
  delta DECIMAL(8, 6),
  gamma DECIMAL(10, 8),
  theta DECIMAL(10, 8),
  vega DECIMAL(10, 8),
  rho DECIMAL(10, 8),
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
  deleted_count INTEGER;
BEGIN
  DELETE FROM option_snapshots
  WHERE timestamp < NOW() - (days_to_keep || ' days')::INTERVAL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
