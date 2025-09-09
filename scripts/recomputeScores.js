#!/usr/bin/env node
/**
 * scripts/recomputeScores.js
 *
 * Recomputes valuation/quality ratios into `scores` for a given date.
 * Uses JavaScript for calculations (no SQLite `**`) and computes PEG3 using EPS CAGR.
 *
 * Usage:
 *   node scripts/recomputeScores.js YYYY-MM-DD
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'quant.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function cagr3(now, then) {
  if (now == null || then == null || then === 0) return null;
  const ratio = now / then;
  if (ratio <= 0) return null;
  return Math.pow(ratio, 1 / 3) - 1;
}

function nearestThreeYearsBack(historyRows) {
  if (!historyRows || historyRows.length === 0) {
    return null;
  }
  const last = historyRows[historyRows.length - 1];
  const lastDate = new Date(last.period_end);
  let candidate = null;
  let bestDiff = Infinity;
  for (const r of historyRows.slice(0, -1)) {
    const d = new Date(r.period_end);
    const months = (lastDate.getFullYear() - d.getFullYear()) * 12 +
                   (lastDate.getMonth() - d.getMonth());
    const diff = Math.abs(months - 36);
    if (months >= 30 && diff < bestDiff) {
      bestDiff = diff;
      candidate = r;
    }
  }
  return { now: last, then: candidate };
}

function getHistory(ticker) {
  return db.prepare(
    `SELECT period_end, eps_basic
     FROM fundamentals_history
     WHERE ticker = ?
     ORDER BY DATE(period_end) ASC`
  ).all(ticker);
}

function recomputeForDate(date) {
  const tickers = db.prepare(
    `SELECT ticker FROM scores WHERE date = ?`
  ).all(date).map(r => r.ticker);

  const selectFund = db.prepare(
    `SELECT * FROM fundamentals_latest WHERE ticker = ?`
  );
  const selectPx = db.prepare(
    `SELECT close FROM daily_bars WHERE date = ? AND ticker = ?`
  );

  const update = db.prepare(
    `UPDATE scores
     SET pe = @pe, pb = @pb, ps = @ps, roe = @roe,
         fcf_yield = @fcf_yield, dividend_yield = @dividend_yield,
         de = @de, peg3 = @peg3
     WHERE date = @date AND ticker = @ticker`
  );

  const tx = db.transaction((work) => {
    work();
  });

  tx(() => {
    for (const ticker of tickers) {
      const f = selectFund.get(ticker);
      const priceRow = selectPx.get(date, ticker);
      const px = priceRow ? priceRow.close : null;

      let pe = null, pb = null, ps = null, roe = null;
      let fcf_yield = null, div_yield = null, de = null, peg3 = null;

      if (f && px != null) {
        const so = f.shares_outstanding ?? null;
        const marketCap = (so != null) ? px * so : null;
        const netIncome = f.net_income ?? null;
        const equity = (f.total_equity ?? f.shareholders_equity) ?? null;
        const revenue = f.revenue ?? null;
        const ocf = (f.operating_cash_flow ?? f.op_cash) ?? null;
        const capex = (f.capital_expenditures ?? f.capex) ?? null;
        const dividends = f.dividends ?? null;
        const totalDebt = f.total_debt ?? null;
        const totalLiab = f.total_liabilities ?? null;

        if (marketCap != null && netIncome > 0) pe = marketCap / netIncome;
        if (marketCap != null && equity > 0) pb = marketCap / equity;
        if (marketCap != null && revenue > 0) ps = marketCap / revenue;
        if (equity != null && equity !== 0 && netIncome != null) {
          roe = netIncome / equity;
        }
        if (marketCap != null && so != null && ocf != null && capex != null) {
          const fcf = ocf - capex;
          fcf_yield = marketCap !== 0 ? (fcf / marketCap) : null;
        }
        if (marketCap != null && so != null && dividends != null) {
          div_yield = marketCap !== 0 ? (dividends / marketCap) : null;
        }
        const equityForDE = (f.total_equity ?? f.shareholders_equity) ?? null;
        const debtForDE = (totalDebt ?? totalLiab) ?? null;
        if (equityForDE > 0 && debtForDE != null) {
          de = debtForDE / equityForDE;
        }

        const history = getHistory(ticker);
        const pair = nearestThreeYearsBack(history);
        if (pair && pair.now && pair.then &&
            pair.now.eps_basic != null && pair.then.eps_basic != null) {
          const growth = cagr3(pair.now.eps_basic, pair.then.eps_basic);
          if (growth && growth > 0 && pe != null) {
            peg3 = pe / growth;
          }
        }
      }

      update.run({
        date,
        ticker,
        pe, pb, ps, roe,
        fcf_yield, dividend_yield: div_yield,
        de, peg3
      });
    }
  });

  console.log(`Recomputed ${tickers.length} rows for ${date}`);
}

function main() {
  const date = process.argv[2];
  if (!date) {
    console.error('Usage: node scripts/recomputeScores.js YYYY-MM-DD');
    process.exit(1);
  }
  recomputeForDate(date);
}

if (require.main === module) {
  main();
}