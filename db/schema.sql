-- SQLite schema for the quant app.  Tables are designed to capture
-- end‑of‑day aggregates, financial fundamentals, computed scores and
-- reference series like the SPY benchmark.  All tables use TEXT keys
-- for dates in ISO 8601 (YYYY‑MM‑DD) format.

CREATE TABLE IF NOT EXISTS daily_bars (
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume INTEGER,
  vwap REAL,
  PRIMARY KEY (date, ticker)
);

CREATE TABLE IF NOT EXISTS fundamentals (
  ticker TEXT NOT NULL,
  filing_date TEXT NOT NULL,
  net_income REAL,
  shareholders_equity REAL,
  total_liabilities REAL,
  revenue REAL,
  op_cash REAL,
  capex REAL,
  dividends REAL,
  shares_outstanding REAL,
  PRIMARY KEY (ticker, filing_date)
);

-- Keep only the most recent fundamental per ticker in a convenience table.
CREATE TABLE IF NOT EXISTS fundamentals_latest (
  ticker TEXT PRIMARY KEY,
  filing_date TEXT NOT NULL,
  net_income REAL,
  shareholders_equity REAL,
  total_liabilities REAL,
  revenue REAL,
  op_cash REAL,
  capex REAL,
  dividends REAL,
  shares_outstanding REAL
);

CREATE TABLE IF NOT EXISTS scores (
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  momentum REAL,
  volatility REAL,
  volume REAL,
  vwap_dev REAL,
  pe REAL,
  pb REAL,
  de REAL,
  fcf_yield REAL,
  peg REAL,
  ps REAL,
  roe REAL,
  dividend_yield REAL,
  composite REAL NOT NULL,
  PRIMARY KEY (date, ticker)
);

CREATE TABLE IF NOT EXISTS spy_daily (
  date TEXT PRIMARY KEY,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume INTEGER
);

CREATE INDEX IF NOT EXISTS idx_daily_bars_date ON daily_bars (date);
CREATE INDEX IF NOT EXISTS idx_scores_date ON scores (date);
CREATE INDEX IF NOT EXISTS idx_scores_composite ON scores (date, composite DESC);