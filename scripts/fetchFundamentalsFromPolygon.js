#!/usr/bin/env node
/**
 * scripts/fetchFundamentalsFromPolygon.js
 *
 * Fetch fundamentals from Polygon for a set of tickers and upsert into SQLite.
 * Uses Polygon v3 reference financials endpoint and extracts numeric values via `.value`.
 * Writes both fundamentals_latest and fundamentals_history and logs progress per ticker.
 *
 * Usage examples:
 *   export POLYGON_API_KEY=YOUR_KEY
 *   node scripts/fetchFundamentalsFromPolygon.js --tickers NVDA,AAPL,MSFT
 *   node scripts/fetchFundamentalsFromPolygon.js --universe 2025-09-09 --max 500
 */
const Database = require('better-sqlite3');
const path = require('path');
const axios = require('axios');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'quant.db');
const API_KEY = process.env.POLYGON_API_KEY;
if (!API_KEY) {
  console.error('Set POLYGON_API_KEY in your environment before running.');
  process.exit(1);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function polygonFinancials(ticker, limit = 16) {
  const url = `https://api.polygon.io/v3/reference/financials?ticker=${encodeURIComponent(ticker)}&limit=${limit}&apiKey=${API_KEY}`;
  const { data } = await axios.get(url, { timeout: 30000 });
  return data?.results || [];
}

function val(x) {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  if (typeof x === 'object' && 'value' in x) return x.value;
  return null;
}

function firstNonNull(...xs) {
  for (const x of xs) {
    if (x != null) return x;
  }
  return null;
}

function upsertLatest(row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(c => '@' + c).join(', ');
  const assigns = cols.map(c => `${c} = excluded.${c}`).join(', ');
  const sql = `INSERT INTO fundamentals_latest (${cols.join(',')}) VALUES (${placeholders})
               ON CONFLICT(ticker) DO UPDATE SET ${assigns}`;
  db.prepare(sql).run(row);
}

function upsertHistory(ticker, fin) {
  const inc = fin?.financials?.income_statement || {};

  const eps_basic = firstNonNull(
    val(inc.basic_earnings_per_share),
    val(inc.earnings_per_share_basic),
    val(inc.eps_basic)
  );
  const so = firstNonNull(
    val(inc.weighted_average_shares_outstanding_basic),
    val(inc.weighted_average_shares_outstanding)
  );
  const net_income = firstNonNull(
    val(inc.net_income_loss),
    val(inc.net_income)
  );
  const revenue = firstNonNull(
    val(inc.revenues),
    val(inc.revenue)
  );

  const period_end = firstNonNull(
    fin?.period_of_report_date,
    fin?.end_date,
    fin?.filing_date
  ) || new Date().toISOString().slice(0, 10);

  const row = {
    ticker,
    period_end,
    eps_basic,
    net_income,
    shares_outstanding: so,
    revenue
  };

  const sql = `INSERT INTO fundamentals_history
    (ticker, period_end, eps_basic, net_income, shares_outstanding, revenue)
    VALUES (@ticker, @period_end, @eps_basic, @net_income, @shares_outstanding, @revenue)
    ON CONFLICT(ticker, period_end) DO UPDATE SET
      eps_basic = excluded.eps_basic,
      net_income = excluded.net_income,
      shares_outstanding = excluded.shares_outstanding,
      revenue = excluded.revenue`;
  db.prepare(sql).run(row);
}

function mapToLatestRow(ticker, fin) {
  const inc = fin?.financials?.income_statement || {};
  const bal = fin?.financials?.balance_sheet || {};
  const cfs = fin?.financials?.cash_flow_statement || {};

  const netIncome = firstNonNull(
    val(inc.net_income_loss),
    val(inc.net_income)
  );
  const equity = firstNonNull(
    val(bal.stockholders_equity),
    val(bal.shareholders_equity),
    val(bal.total_shareholders_equity),
    val(bal.total_equity)
  );
  const liabilities = firstNonNull(
    val(bal.liabilities),
    val(bal.total_liabilities)
  );
  const revenue = firstNonNull(
    val(inc.revenues),
    val(inc.revenue),
    val(inc.sales)
  );
  const operatingCashFlow = firstNonNull(
    val(cfs.net_cash_provided_by_used_in_operating_activities),
    val(cfs.net_cash_flow_from_operating_activities),
    val(cfs.net_cash_from_operating_activities)
  );
  const capex = firstNonNull(
    val(cfs.payments_for_property_plant_and_equipment),
    val(cfs.capital_expenditure),
    val(cfs.capital_expenditures)
  );
  const dividends = firstNonNull(
    val(cfs.payments_of_dividends),
    val(cfs.dividends_paid)
  );
  const sharesOutstanding = firstNonNull(
    val(inc.weighted_average_shares_outstanding_basic),
    val(inc.weighted_average_shares_outstanding)
  );
  const filing_date = firstNonNull(
    fin?.period_of_report_date,
    fin?.end_date,
    fin?.start_date,
    fin?.filing_date
  );

  return {
    ticker,
    filing_date: filing_date || null,
    net_income: netIncome,
    shareholders_equity: equity,
    total_liabilities: liabilities,
    revenue: revenue,
    op_cash: operatingCashFlow,
    capex: capex,
    dividends: dividends,
    shares_outstanding: sharesOutstanding,
    updated_at: new Date().toISOString()
  };
}

function universeTickers(date) {
  const u = db.prepare(`SELECT ticker FROM universe WHERE date = ?`).all(date);
  if (u.length) return u.map(r => r.ticker);
  // fallback: all tickers seen in daily_bars on that date
  return db.prepare(`SELECT DISTINCT ticker FROM daily_bars WHERE date=?`).all(date).map(r => r.ticker);
}

async function main() {
  const args = process.argv.slice(2);
  let tickers = [];
  let max = Infinity;
  let date = null;

  if (args.includes('--max')) {
    const maxIndex = args.indexOf('--max') + 1;
    max = parseInt(args[maxIndex] || '0', 10) || Infinity;
  }

  if (args.includes('--tickers')) {
    const list = args[args.indexOf('--tickers') + 1] || '';
    tickers = list.split(',').map(s => s.trim()).filter(Boolean);
  } else if (args.includes('--universe')) {
    date = args[args.indexOf('--universe') + 1];
    if (!date) {
      console.error('--universe requires a date, e.g. 2025-09-09');
      process.exit(1);
    }
    tickers = universeTickers(date);
  } else {
    console.error('Usage: --tickers T1,T2 or --universe YYYY-MM-DD [--max N]');
    process.exit(1);
  }

  if (!tickers.length) {
    console.log('No tickers to process.');
    return;
  }
  if (max !== Infinity) {
    tickers = tickers.slice(0, max);
  }

  console.log(`Fetching fundamentals for ${tickers.length} tickers${date ? ' (universe ' + date + ')' : ''}`);
  let done = 0;
  for (const t of tickers) {
    try {
      const results = await polygonFinancials(t, 16);
      if (results.length) {
        const latest = mapToLatestRow(t, results[0]);
        upsertLatest(latest);
        for (const r of results) {
          upsertHistory(t, r);
        }
        console.log(`[${++done}/${tickers.length}] ${t} — updated (${results.length} reports)`);
      } else {
        console.log(`[${++done}/${tickers.length}] ${t} — no results`);
      }
    } catch (e) {
      done++;
      console.log(`[${done}/${tickers.length}] ${t} — ERROR ${e?.response?.status || ''} ${e?.message}`);
    }
    await sleep(120); // Throttle to respect API limits
  }
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
  });
}