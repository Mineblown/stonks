
/**
 * scripts/recomputeScores.js
 * Recomputes valuation/quality ratios in `scores` for a given date
 * using fundamentals_latest + daily_bars close.
 * Also computes PEG(3y) from fundamentals_history EPS CAGR when possible.
 * Usage: node scripts/recomputeScores.js 2025-09-09
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'quant.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function compute(date) {
  db.exec(`
    WITH px AS (
      SELECT ticker, close FROM daily_bars WHERE date='${date}'
    ),
    eps AS (
      -- compute EPS CAGR over ~3 years from fundamentals_history
      SELECT a.ticker,
             a.eps_basic AS eps_now,
             b.eps_basic AS eps_then,
             CASE
               WHEN a.eps_basic IS NOT NULL AND b.eps_basic IS NOT NULL AND b.eps_basic != 0
               THEN (a.eps_basic / b.eps_basic) ** (1.0/3.0) - 1.0
             END AS eps_cagr_3y
      FROM (
        SELECT fh1.* FROM fundamentals_history fh1
        JOIN (SELECT ticker, MAX(period_end) AS pe FROM fundamentals_history GROUP BY ticker) m
          ON m.ticker = fh1.ticker AND m.pe = fh1.period_end
      ) a
      LEFT JOIN (
        SELECT fh2.* FROM fundamentals_history fh2
      ) b
        ON b.ticker = a.ticker
       AND DATE(b.period_end) <= DATE(a.period_end, '-36 months')
      GROUP BY a.ticker
    )
    UPDATE scores AS s
    SET
      pe = CASE
        WHEN f.net_income > 0 AND f.shares_outstanding > 0 AND p.close IS NOT NULL
        THEN (p.close * f.shares_outstanding) / f.net_income
      END,
      pb = CASE
        WHEN f.shareholders_equity > 0 AND f.shares_outstanding > 0 AND p.close IS NOT NULL
        THEN (p.close * f.shares_outstanding) / f.shareholders_equity
      END,
      ps = CASE
        WHEN f.revenue > 0 AND f.shares_outstanding > 0 AND p.close IS NOT NULL
        THEN (p.close * f.shares_outstanding) / f.revenue
      END,
      roe = CASE WHEN f.shareholders_equity != 0 THEN f.net_income / f.shareholders_equity END,
      fcf_yield = CASE
        WHEN f.shares_outstanding > 0 AND p.close IS NOT NULL
        THEN (COALESCE(f.operating_cash_flow, f.op_cash) - COALESCE(f.capital_expenditures, f.capex))
             / (p.close * f.shares_outstanding)
      END,
      dividend_yield = CASE
        WHEN f.shares_outstanding > 0 AND p.close IS NOT NULL AND f.dividends IS NOT NULL
        THEN f.dividends / (p.close * f.shares_outstanding)
      END,
      de = CASE
        WHEN COALESCE(f.total_equity, f.shareholders_equity) > 0
        THEN COALESCE(f.total_debt, f.total_liabilities) / COALESCE(f.total_equity, f.shareholders_equity)
      END,
      peg3 = CASE
        WHEN e.eps_cagr_3y IS NOT NULL AND e.eps_cagr_3y > 0
             AND f.net_income > 0 AND f.shares_outstanding > 0 AND p.close IS NOT NULL
        THEN ((p.close * f.shares_outstanding) / f.net_income) / e.eps_cagr_3y
      END
    FROM fundamentals_latest f
    LEFT JOIN px p ON p.ticker = s.ticker
    LEFT JOIN eps e ON e.ticker = s.ticker
    WHERE s.date = '${date}' AND s.ticker = f.ticker;
  `);
}

function main(){
  const date = process.argv[2];
  if (!date) { console.error('Usage: node scripts/recomputeScores.js YYYY-MM-DD'); process.exit(1); }
  compute(date);
  console.log('Recomputed scores for', date);
}
if (require.main === module) main();
