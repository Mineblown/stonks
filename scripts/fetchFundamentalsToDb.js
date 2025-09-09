#!/usr/bin/env node
/*
 * Fetch Polygon financials for one or more tickers and persist them
 * into SQLite.  The fundamentals table holds historical filings
 * (annual) while fundamentals_latest stores the most recent filing
 * for quick access.  You can fetch specific tickers by passing
 * them as arguments, or fetch all tickers traded on the most
 * recent trading day by passing --all-latest-date.  See README for
 * usage examples.
 */

const axios = require('axios');
const dotenv = require('dotenv');
const db = require('../db/db');

dotenv.config();

const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error('POLYGON_API_KEY missing in environment');
  process.exit(1);
}

// Helpers
function uniq(arr) {
  return [...new Set(arr)].filter(Boolean);
}

async function fetchOne(ticker) {
  // Try vX then v3 endpoints to maximise compatibility
  const url1 = `https://api.polygon.io/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=annual&limit=50&apiKey=${apiKey}`;
  try {
    const { data } = await axios.get(url1);
    return Array.isArray(data?.results) ? data.results : [];
  } catch {}
  try {
    const url2 = `https://api.polygon.io/v3/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=annual&limit=50&apiKey=${apiKey}`;
    const { data } = await axios.get(url2);
    return Array.isArray(data?.results) ? data.results : [];
  } catch (err) {
    console.warn('Financials fetch failed for', ticker, err.message);
    return [];
  }
}

function pick(obj, path) {
  let v = obj;
  for (const k of path) {
    v = v?.[k];
  }
  return typeof v === 'number' ? v : null;
}

const ins = db.prepare(`
  INSERT INTO fundamentals(
    ticker, filing_date, fiscal_period, fiscal_year,
    revenue, net_income, shareholders_equity,
    operating_cash_flow, capital_expenditures, dividends, total_liabilities
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(ticker, filing_date) DO UPDATE SET
    revenue=excluded.revenue,
    net_income=excluded.net_income,
    shareholders_equity=excluded.shareholders_equity,
    operating_cash_flow=excluded.operating_cash_flow,
    capital_expenditures=excluded.capital_expenditures,
    dividends=excluded.dividends,
    total_liabilities=excluded.total_liabilities
`);

const upLatest = db.prepare(`
  INSERT INTO fundamentals_latest(
    ticker, filing_date, revenue, net_income, shareholders_equity, op_cash, capex, dividends, total_liabilities, shares_outstanding, updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))
  ON CONFLICT(ticker) DO UPDATE SET
    filing_date=excluded.filing_date,
    revenue=excluded.revenue,
    net_income=excluded.net_income,
    shareholders_equity=excluded.shareholders_equity,
    op_cash=excluded.op_cash,
    capex=excluded.capex,
    dividends=excluded.dividends,
    total_liabilities=excluded.total_liabilities,
    shares_outstanding=excluded.shares_outstanding,
    updated_at=excluded.updated_at
`);

function mapRows(fin, ticker) {
  const rows = [];
  for (const f of fin) {
    const s = f.financials || f;
    rows.push({
      ticker,
      filing_date: f.filing_date || f.end_date || null,
      fiscal_period: f.fiscal_period || s?.income_statement?.period || null,
      fiscal_year: f.fiscal_year || s?.income_statement?.fiscal_year || null,
      revenue: pick(s, ['income_statement', 'revenues']) ?? pick(s, ['income_statement', 'revenue']),
      net_income: pick(s, ['income_statement', 'net_income']) ?? pick(s, ['income_statement', 'net_income_loss']),
      shareholders_equity: pick(s, ['balance_sheet', 'shareholders_equity']) ?? pick(s, ['balance_sheet', 'stockholders_equity']),
      operating_cash_flow: pick(s, ['cash_flow_statement', 'net_cash_flow_from_operating_activities']),
      capital_expenditures: pick(s, ['cash_flow_statement', 'capital_expenditure']) ?? pick(s, ['cash_flow_statement', 'payments_to_acquire_property_plant_and_equipment']),
      dividends: pick(s, ['comprehensive_income', 'common_stock_dividends']) ?? null,
      total_liabilities: pick(s, ['balance_sheet', 'total_liabilities'])
    });
  }
  return rows;
}

(async () => {
  // Determine tickers to fetch
  let tickers = process.argv.slice(2).filter((t) => !t.startsWith('--'));
  if (process.argv.includes('--all-latest-date')) {
    const latest = db.prepare('SELECT MAX(date) AS d FROM daily_bars').get()?.d;
    if (!latest) {
      console.error('No daily_bars available to infer tickers from.');
      process.exit(1);
    }
    tickers = db.prepare('SELECT DISTINCT ticker FROM daily_bars WHERE date = ?').all(latest).map((r) => r.ticker);
  }
  tickers = uniq(tickers);
  if (!tickers.length) {
    console.error('Provide one or more tickers or --all-latest-date');
    process.exit(1);
  }
  for (const t of tickers) {
    try {
      const fin = await fetchOne(t);
      const rows = mapRows(fin, t);
      const tx = db.transaction(() => {
        for (const r of rows) {
          ins.run(r.ticker, r.filing_date, r.fiscal_period, r.fiscal_year, r.revenue, r.net_income, r.shareholders_equity, r.operating_cash_flow, r.capital_expenditures, r.dividends, r.total_liabilities);
        }
        const last = db.prepare('SELECT * FROM fundamentals WHERE ticker = ? ORDER BY filing_date DESC LIMIT 1').get(t);
        if (last) {
          const shares = db.prepare('SELECT share_class_shares_outstanding FROM reference_tickers WHERE ticker = ?').get(t)?.share_class_shares_outstanding ?? null;
          upLatest.run(t, last.filing_date, last.revenue, last.net_income, last.shareholders_equity, last.operating_cash_flow, last.capital_expenditures, last.dividends, last.total_liabilities, shares);
        }
      });
      tx();
      console.log(`Updated fundamentals for ${t}: ${rows.length} filings`);
    } catch (err) {
      console.warn('Ticker failed', t, err.message);
    }
  }
})();