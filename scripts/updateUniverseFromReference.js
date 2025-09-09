#!/usr/bin/env node
/**
 * Build/refresh `universe` snapshot using reference_tickers + recent volume.
 * - Ensures required tables exist
 * - If reference_tickers is empty, exits with a helpful message
 */
const db = require('../db/db');

// ensure universe table
db.exec(`
CREATE TABLE IF NOT EXISTS universe (
  date TEXT NOT NULL,
  ticker TEXT NOT NULL,
  market_cap REAL,
  avg_volume REAL,
  PRIMARY KEY(date, ticker)
);
`);

// ensure reference table exists
db.exec(`
CREATE TABLE IF NOT EXISTS reference_tickers (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  market_cap REAL,
  share_class_shares_outstanding REAL,
  currency TEXT,
  updated_at TEXT
);
`);

// use latest trading date in daily_bars
const latest = db.prepare(`SELECT MAX(date) AS d FROM daily_bars`).get()?.d;
if (!latest){ console.error('No daily_bars found. Run fetchDailyDataToDb.js first.'); process.exit(1); }

const haveRef = db.prepare(`SELECT COUNT(1) AS n FROM reference_tickers`).get()?.n || 0;
if (!haveRef){
  console.error('reference_tickers is empty. Run: node scripts/fetchReferenceTickers.js');
  process.exit(2);
}

// Avg volume over last 20 trading days per ticker
const avgVol = db.prepare(`
  SELECT ticker, AVG(volume) AS avg_volume
  FROM daily_bars
  WHERE date <= ? AND date >= (SELECT MAX(date) FROM daily_bars WHERE date<=? LIMIT 1)
  GROUP BY ticker
`).all(latest, latest).reduce((m,r)=>{ m[r.ticker]=r.avg_volume; return m; }, {});

// market cap from reference
const caps = db.prepare(`SELECT ticker, market_cap FROM reference_tickers`).all()
  .reduce((m,r)=>{ m[r.ticker]=r.market_cap; return m; }, {});

const up = db.prepare(`
INSERT INTO universe(date, ticker, market_cap, avg_volume)
VALUES (?,?,?,?)
ON CONFLICT(date,ticker) DO UPDATE SET
  market_cap=excluded.market_cap,
  avg_volume=excluded.avg_volume
`);

const tx = db.transaction((rows)=>{ for (const r of rows) up.run(latest,r.ticker,r.cap,r.avg); });

// build rows from tickers we have bars for on 'latest'
const tickers = db.prepare(`SELECT DISTINCT ticker FROM daily_bars WHERE date=?`).all(latest).map(r=>r.ticker);
const rows = tickers.map(t=>({ ticker:t, cap:caps[t] ?? null, avg:avgVol[t] ?? null }));
tx(rows);
console.log(`Updated universe for ${latest}: ${rows.length} tickers`);
