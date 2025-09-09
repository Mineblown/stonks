// scripts/recomputeScores.js
/* eslint-disable no-console */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'quant.db');
const db = new Database(DB_PATH);

function ensureScoresColumns() {
    // most schemas already have these columns, but be defensive
    db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      date TEXT NOT NULL,
      ticker TEXT NOT NULL,
      momentum REAL, volatility REAL, volume INTEGER, vwap_dev REAL,
      pe REAL, pb REAL, ps REAL, roe REAL, fcf_yield REAL, dividend_yield REAL, de REAL, peg REAL, peg3 REAL,
      market_cap REAL, avg_volume INTEGER,
      composite REAL,
      PRIMARY KEY (date, ticker)
    );
  `);
}

function recompute(dateStr) {
    ensureScoresColumns();

    // tickers we have bars for this date
    const bars = db.prepare(`
    SELECT ticker, close
    FROM daily_bars
    WHERE date = ?
  `).all(dateStr);

    // upsert prepared statement
    const upd = db.prepare(`
    UPDATE scores SET
      pe=@pe, pb=@pb, ps=@ps, roe=@roe, fcf_yield=@fcf_yield, dividend_yield=@dividend_yield, de=@de, peg3=@peg3,
      market_cap=@market_cap
    WHERE date=@date AND ticker=@ticker
  `);

    const selLatest = db.prepare(`
    SELECT *
    FROM fundamentals_latest
    WHERE ticker = ?
  `);

    const selAvgVol = db.prepare(`
    SELECT avg_volume FROM scores WHERE date=? AND ticker=?
  `);

    let updated = 0;
    const tx = db.transaction(() => {
        for (const b of bars) {
            const latest = selLatest.get(b.ticker);
            if (!latest) continue;

            const price = Number(b.close) || null;
            const so = Number(latest.shares_outstanding) || null;

            const marketCap = (price && so) ? price * so : null;

            const niTTM = Number(latest.net_income) || null;
            const revTTM = Number(latest.revenue) || null;
            const ocfTTM = Number(latest.op_cash) || null;
            const capexTTM = Number(latest.capex) || null;
            const fcfTTM = (ocfTTM != null && capexTTM != null) ? (ocfTTM - capexTTM) : null;
            const dividendsTTM = Number(latest.dividends) || null;

            const equity = Number(latest.shareholders_equity) || null;
            const liabilities = Number(latest.total_liabilities) || null;
            const debtToEquity = (equity > 0 && liabilities != null) ? (liabilities / equity) : null;

            // Basic ratios
            const epsTTM = (so && niTTM != null) ? (niTTM / so) : null;
            const pe = (price && epsTTM) ? (price / epsTTM) : null;

            const pb = (marketCap && equity) ? (marketCap / equity) : null;
            const ps = (marketCap && revTTM) ? (marketCap / revTTM) : null;
            const roe = (equity && niTTM != null) ? (niTTM / equity) : null;
            const fcf_yield = (marketCap && fcfTTM != null) ? (fcfTTM / marketCap) : null;

            // dividend_yield: requires trailing dividends per share; we only have cash amount total (company-level).
            // If shares_outstanding exists, approximate DPS = dividendsTTM / so; yield = DPS / price
            const dividend_yield = (dividendsTTM != null && so && price) ? ((dividendsTTM / so) / price) : null;

            const peg3 = null; // left null unless you have a 3y EPS growth model

            upd.run({
                date: dateStr,
                ticker: b.ticker,
                pe, pb, ps, roe, fcf_yield, dividend_yield, de: debtToEquity, peg3,
                market_cap: marketCap
            });
            updated += 1;
        }
    });
    tx();

    console.log(`Recomputed ${updated} rows for ${dateStr}`);
}

function main() {
    const dateStr = process.argv[2];
    if (!dateStr) {
        console.error('Usage: node scripts/recomputeScores.js YYYY-MM-DD');
        process.exit(2);
    }
    recompute(dateStr);
}

if (require.main === module) main();
