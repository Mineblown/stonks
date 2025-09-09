
/**
 * scripts/fetchFundamentalsFromPolygon.js
 * Populates fundamentals_latest and fundamentals_history using Polygon.io.
 * Requires env: POLYGON_API_KEY
 * Usage:
 *   node scripts/fetchFundamentalsFromPolygon.js --tickers NVDA,AAPL,MSFT
 *   node scripts/fetchFundamentalsFromPolygon.js --universe 2025-09-09
 */
const Database = require('better-sqlite3');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'quant.db');
const API_KEY = process.env.POLYGON_API_KEY;
if (!API_KEY) {
  console.error('Set POLYGON_API_KEY in your environment'); process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Ensure tables exist
db.exec(`
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
  shares_outstanding REAL,
  updated_at TEXT,
  pe REAL, pb REAL, ps REAL, peg REAL, roe REAL, fcf_yield REAL, dividend_yield REAL, de REAL,
  operating_cash_flow REAL, free_cash_flow REAL, ebitda REAL, capital_expenditures REAL,
  total_assets REAL, total_debt REAL, total_equity REAL, gross_margin REAL,
  operating_margin REAL, net_margin REAL, payout_ratio REAL, ev_ebitda REAL,
  fiscal_year INTEGER, fiscal_period TEXT
);
CREATE TABLE IF NOT EXISTS fundamentals_history (
  ticker TEXT NOT NULL,
  period_end TEXT NOT NULL,
  eps_basic REAL,
  net_income REAL,
  shares_outstanding REAL,
  revenue REAL,
  PRIMARY KEY (ticker, period_end)
);
`);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function getPolygonFinancials(ticker, limit=20) {
  // Annual & quarterly mixed; you can filter via type param if desired.
  const url = `https://api.polygon.io/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&limit=${limit}&apiKey=${API_KEY}`;
  const { data } = await axios.get(url, { timeout: 30000 });
  return data;
}

function mapToLatestRow(ticker, fin) {
  // Try to map Polygon fields defensively
  const i = fin;
  const NI = i?.income_statement?.net_income_loss || i?.income_statement?.net_income || null;
  const SH_EQ = i?.balance_sheet?.stockholders_equity || i?.balance_sheet?.shareholders_equity || null;
  const TOT_LIAB = i?.balance_sheet?.liabilities || i?.balance_sheet?.total_liabilities || null;
  const REV = i?.income_statement?.revenues || i?.income_statement?.revenue || null;
  const OCF = i?.cash_flow_statement?.net_cash_provided_by_used_in_operating_activities || i?.cash_flow_statement?.net_cash_flow_from_operating_activities || null;
  const CAPEX = i?.cash_flow_statement?.payments_for_property_plant_and_equipment || i?.cash_flow_statement?.capital_expenditure || null;
  const DIV = i?.cash_flow_statement?.payments_of_dividends || i?.cash_flow_statement?.dividends_paid || null;
  const SO = i?.income_statement?.weighted_average_shares_outstanding_basic || i?.income_statement?.weighted_average_shares_outstanding || null;

  return {
    ticker,
    filing_date: i?.fiscal_period || i?.end_date || i?.filing_date || null,
    net_income: NI,
    shareholders_equity: SH_EQ,
    total_liabilities: TOT_LIAB,
    revenue: REV,
    op_cash: OCF,
    capex: CAPEX,
    dividends: DIV,
    shares_outstanding: SO,
    updated_at: new Date().toISOString()
  };
}

function upsertLatest(row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(c => '@'+c).join(', ');
  const assigns = cols.map(c => `${c}=excluded.${c}`).join(', ');
  const sql = `INSERT INTO fundamentals_latest (${cols.join(',')}) VALUES (${placeholders})
               ON CONFLICT(ticker) DO UPDATE SET ${assigns}`;
  db.prepare(sql).run(row);
}

function upsertHistory(ticker, i) {
  const eps_basic = i?.income_statement?.basic_earnings_per_share || i?.income_statement?.earnings_per_share_basic || null;
  const so = i?.income_statement?.weighted_average_shares_outstanding_basic || i?.income_statement?.weighted_average_shares_outstanding || null;
  const row = {
    ticker,
    period_end: i?.end_date || i?.calendar_date || i?.fiscal_period || new Date().toISOString().slice(0,10),
    eps_basic,
    net_income: i?.income_statement?.net_income_loss || i?.income_statement?.net_income || null,
    shares_outstanding: so,
    revenue: i?.income_statement?.revenues || i?.income_statement?.revenue || null
  };
  const sql = `INSERT INTO fundamentals_history (ticker, period_end, eps_basic, net_income, shares_outstanding, revenue)
               VALUES (@ticker, @period_end, @eps_basic, @net_income, @shares_outstanding, @revenue)
               ON CONFLICT(ticker, period_end) DO UPDATE SET
                 eps_basic=excluded.eps_basic,
                 net_income=excluded.net_income,
                 shares_outstanding=excluded.shares_outstanding,
                 revenue=excluded.revenue`;
  db.prepare(sql).run(row);
}

async function fetchForTicker(t) {
  try {
    const data = await getPolygonFinancials(t, 32);
    const results = data?.results || [];
    if (!results.length) return;
    // Latest first
    const latest = mapToLatestRow(t, results[0]);
    upsertLatest(latest);
    results.forEach(r => upsertHistory(t, r));
  } catch (e) {
    console.error('fetch error for', t, e?.response?.status, e?.message);
  }
}

function getUniverseTickersForDate(date) {
  const rows = db.prepare(`SELECT ticker FROM universe WHERE date=@date`).all({ date });
  if (rows.length) return rows.map(r=>r.ticker);
  // fallback: distinct tickers from daily_bars
  return db.prepare(`SELECT DISTINCT ticker FROM daily_bars WHERE date=@date`).all({ date }).map(r=>r.ticker);
}

async function main() {
  const args = process.argv.slice(2);
  let tickers = [];
  if (args.includes('--tickers')) {
    const idx = args.indexOf('--tickers');
    tickers = (args[idx+1] || '').split(',').map(s=>s.trim()).filter(Boolean);
  } else if (args.includes('--universe')) {
    const idx = args.indexOf('--universe');
    const date = args[idx+1];
    if (!date) { console.error('--universe requires a date'); process.exit(1); }
    tickers = getUniverseTickersForDate(date);
  } else {
    console.error('Usage: node scripts/fetchFundamentalsFromPolygon.js --tickers AAPL,MSFT or --universe 2025-09-09');
    process.exit(1);
  }

  for (const t of tickers) {
    await fetchForTicker(t);
    await sleep(120); // be gentle with API rate limits
  }
  console.log('Done.');
}

if (require.main === module) main();
