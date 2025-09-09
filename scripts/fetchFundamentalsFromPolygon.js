// scripts/fetchFundamentalsFromPolygon.js
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const axios = require('axios').default;
const Database = require('better-sqlite3');


const DB_PATH = path.join(__dirname, '..', 'data', 'quant.db');
const db = new Database(DB_PATH);

const PRIMARY_KEY = process.env.POLYGON_API_KEY;
const VX_KEY = process.env.POLYGON_API_KEY_VX || PRIMARY_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Safe getter for nested financials values
 */
function gv(obj, pathArr) {
    let cur = obj;
    for (const k of pathArr) {
        if (!cur || typeof cur !== 'object' || !(k in cur)) return null;
        cur = cur[k];
    }
    if (cur == null) return null;
    if (typeof cur === 'object' && 'value' in cur) return cur.value;
    return cur;
}

/**
 * Create tables if missing (idempotent)
 */
function ensureTables() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS fundamentals_history (
      ticker TEXT NOT NULL,
      period_end TEXT NOT NULL,
      filing_date TEXT,
      timeframe TEXT,
      fiscal_period TEXT,
      fiscal_year INTEGER,
      revenue REAL,
      net_income REAL,
      operating_cash_flow REAL,
      capital_expenditures REAL,
      dividends REAL,
      shares_outstanding REAL,
      shareholders_equity REAL,
      total_liabilities REAL,
      PRIMARY KEY (ticker, period_end, timeframe)
    );

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
      -- valuation columns (nullable, computed elsewhere)
      pe REAL, pb REAL, ps REAL, peg REAL, roe REAL, fcf_yield REAL, dividend_yield REAL, de REAL,
      operating_cash_flow REAL, free_cash_flow REAL, ebitda REAL,
      capital_expenditures REAL, total_assets REAL, total_debt REAL, total_equity REAL,
      gross_margin REAL, operating_margin REAL, net_margin REAL, payout_ratio REAL, ev_ebitda REAL,
      fiscal_year INTEGER, fiscal_period TEXT
    );
  `);
}

const upsertHistory = db.prepare(`
  INSERT INTO fundamentals_history (
    ticker, period_end, filing_date, timeframe, fiscal_period, fiscal_year,
    revenue, net_income, operating_cash_flow, capital_expenditures, dividends,
    shares_outstanding, shareholders_equity, total_liabilities
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(ticker, period_end, timeframe) DO UPDATE SET
    filing_date=excluded.filing_date,
    fiscal_period=excluded.fiscal_period,
    fiscal_year=excluded.fiscal_year,
    revenue=excluded.revenue,
    net_income=excluded.net_income,
    operating_cash_flow=excluded.operating_cash_flow,
    capital_expenditures=excluded.capital_expenditures,
    dividends=excluded.dividends,
    shares_outstanding=excluded.shares_outstanding,
    shareholders_equity=excluded.shareholders_equity,
    total_liabilities=excluded.total_liabilities
`);

const upsertLatest = db.prepare(`
  INSERT INTO fundamentals_latest (
    ticker, filing_date,
    net_income, shareholders_equity, total_liabilities, revenue,
    op_cash, capex, dividends, shares_outstanding,
    updated_at, fiscal_year, fiscal_period
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(ticker) DO UPDATE SET
    filing_date=excluded.filing_date,
    net_income=excluded.net_income,
    shareholders_equity=excluded.shareholders_equity,
    total_liabilities=excluded.total_liabilities,
    revenue=excluded.revenue,
    op_cash=excluded.op_cash,
    capex=excluded.capex,
    dividends=excluded.dividends,
    shares_outstanding=excluded.shares_outstanding,
    updated_at=excluded.updated_at,
    fiscal_year=excluded.fiscal_year,
    fiscal_period=excluded.fiscal_period
`);

async function fetchVXFinancialsPaged(ticker, timeframe, limitPerPage = 50) {
    let url = `https://api.polygon.io/vX/reference/financials?ticker=${encodeURIComponent(
        ticker
    )}&timeframe=${timeframe}&order=desc&sort=filing_date&limit=${limitPerPage}&apiKey=${VX_KEY}`;

    const all = [];
    while (url) {
        try {
            const { data } = await axios.get(url, { timeout: 30000 });
            if (Array.isArray(data?.results)) {
                all.push(...data.results);
            }
            // follow cursor if present
            if (data?.next_url) {
                // next_url from polygon does not include apiKey; append it
                const sep = data.next_url.includes('?') ? '&' : '?';
                url = `${data.next_url}${sep}apiKey=${VX_KEY}`;
            } else {
                url = null;
            }
            // polite throttle to avoid burst (and to play nice with Starter plans)
            await sleep(140);
        } catch (err) {
            const status = err?.response?.status;
            const body = err?.response?.data;
            console.error(`[polygonFinancials] ${ticker} ${status || ''} on ${url}`);
            if (body) {
                try {
                    console.error(typeof body === 'string' ? body : JSON.stringify(body));
                } catch (_) {/* noop */ }
            }
            // For 404, just stop paging (no more data or not entitled).
            if (status === 404) break;
            // For rate limits, pause a bit longer
            if (status === 429) { await sleep(1000); continue; }
            // For other errors, bail this ticker
            break;
        }
    }
    return all;
}

function normalizeRow(ticker, r) {
    const fin = r?.financials || {};
    // Fields we care about (with multiple fallbacks)
    const revenue = gv(fin, ['income_statement', 'revenues']) ?? null;

    const netIncome =
        gv(fin, ['income_statement', 'net_income_loss_attributable_to_parent']) ??
        gv(fin, ['income_statement', 'net_income_loss']) ??
        null;

    const ocf =
        gv(fin, ['cash_flow_statement', 'net_cash_flow_from_operating_activities']) ??
        gv(fin, ['cash_flow_statement', 'net_cash_flow_from_operating_activities_continuing']) ??
        null;

    // CapEx is not always labeled the same; try several common keys
    const capex =
        gv(fin, ['cash_flow_statement', 'capital_expenditures']) ??
        gv(fin, ['cash_flow_statement', 'payments_to_acquire_property_plant_and_equipment']) ??
        gv(fin, ['cash_flow_statement', 'purchase_of_property_and_equipment']) ??
        null;

    // Dividends (may be absent; keep null)
    const dividends =
        gv(fin, ['cash_flow_statement', 'dividends_paid']) ??
        gv(fin, ['cash_flow_statement', 'payments_of_dividends']) ??
        null;

    // Shares outstanding: prefer balance sheet if provided; else use average shares
    const sharesOutstanding =
        gv(fin, ['balance_sheet', 'common_stock_shares_outstanding']) ??
        gv(fin, ['income_statement', 'basic_average_shares']) ??
        gv(fin, ['income_statement', 'diluted_average_shares']) ??
        null;

    const equity =
        gv(fin, ['balance_sheet', 'equity_attributable_to_parent']) ??
        gv(fin, ['balance_sheet', 'equity']) ??
        null;

    const totalLiabilities =
        gv(fin, ['balance_sheet', 'liabilities']) ??
        null;

    return {
        ticker,
        period_end: r?.end_date ?? null,
        filing_date: r?.end_date ?? null, // fallback if filing_date not provided in vX (many payloads use end_date)
        timeframe: r?.timeframe ?? null,
        fiscal_period: r?.fiscal_period ?? null,
        fiscal_year: r?.fiscal_year ? Number(r.fiscal_year) : null,
        revenue,
        net_income: netIncome,
        operating_cash_flow: ocf,
        capital_expenditures: capex,
        dividends,
        shares_outstanding: sharesOutstanding,
        shareholders_equity: equity,
        total_liabilities: totalLiabilities,
    };
}

function writeHistory(rows) {
    const tx = db.transaction((items) => {
        for (const it of items) {
            upsertHistory.run(
                it.ticker,
                it.period_end,
                it.filing_date,
                it.timeframe,
                it.fiscal_period,
                it.fiscal_year,
                it.revenue,
                it.net_income,
                it.operating_cash_flow,
                it.capital_expenditures,
                it.dividends,
                it.shares_outstanding,
                it.shareholders_equity,
                it.total_liabilities
            );
        }
    });
    tx(rows);
}

function computeTTMAndWriteLatest(ticker) {
    // Last 4 quarterly rows by period_end
    const q = db.prepare(`
    SELECT *
    FROM fundamentals_history
    WHERE ticker = ? AND timeframe = 'quarterly' AND period_end IS NOT NULL
    ORDER BY DATE(period_end) DESC
    LIMIT 8
  `).all(ticker);

    const last4 = q.slice(0, 4);

    const sum = (arr, key) =>
        arr.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

    const ttmRevenue = last4.length ? sum(last4, 'revenue') : null;
    const ttmNI = last4.length ? sum(last4, 'net_income') : null;
    const ttmOCF = last4.length ? sum(last4, 'operating_cash_flow') : null;
    const ttmCapex = last4.length ? sum(last4, 'capital_expenditures') : null;
    const ttmDiv = last4.length ? sum(last4, 'dividends') : null;

    // Use the most recent known shares/equity/liabilities
    const latest = q[0] || db.prepare(`
    SELECT *
    FROM fundamentals_history
    WHERE ticker = ?
    ORDER BY DATE(period_end) DESC
    LIMIT 1
  `).get(ticker);

    const filing_date = latest?.filing_date || latest?.period_end || new Date().toISOString().slice(0, 10);

    upsertLatest.run(
        ticker,
        filing_date,
        ttmNI,                                  // net_income (TTM)
        latest?.shareholders_equity ?? null,     // shareholders_equity (point-in-time)
        latest?.total_liabilities ?? null,       // total_liabilities (point-in-time)
        ttmRevenue,                              // revenue (TTM)
        ttmOCF,                                  // op_cash (TTM)
        ttmCapex,                                // capex (TTM)
        ttmDiv,                                  // dividends (TTM)
        latest?.shares_outstanding ?? null,      // shares_outstanding (latest known)
        new Date().toISOString(),
        latest?.fiscal_year ?? null,
        latest?.fiscal_period ?? null
    );
}

async function updateOneTicker(ticker) {
    const rowsQ = await fetchVXFinancialsPaged(ticker, 'quarterly');
    const rowsA = await fetchVXFinancialsPaged(ticker, 'annual');

    const normQ = rowsQ.map((r) => normalizeRow(ticker, r)).filter(r => r.period_end);
    const normA = rowsA.map((r) => normalizeRow(ticker, r)).filter(r => r.period_end);

    if (!normQ.length && !normA.length) {
        console.log(`[${ticker}] no financials found (plan entitlement or old ticker?)`);
        return;
    }

    writeHistory(normQ);
    writeHistory(normA);
    computeTTMAndWriteLatest(ticker);
    console.log(`[${ticker}] history upserted: Q=${normQ.length}, A=${normA.length} — latest/TTM updated`);
}
// DELETE or comment out these two lines:
// const yargs = require('yargs/yargs');
// const { hideBin } = require('yargs/helpers');

// ADD this helper:
function parseArgs(argv = process.argv.slice(2)) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const [k, v] = a.replace(/^--/, '').split('=');
            if (typeof v !== 'undefined') out[k] = v;
            else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) out[k] = argv[++i];
            else out[k] = true;
        } else if (a.startsWith('-')) {
            const k = a.replace(/^-+/, '');
            if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) out[k] = argv[++i];
            else out[k] = true;
        } else out._.push(a);
    }
    return out;
}

async function run() {
    ensureTables();

    const argv = parseArgs();

    let tickers = [];
    if (argv.tickers) {
        tickers = argv.tickers.split(',').map((t) => t.trim()).filter(Boolean);
    } else if (argv.universe) {
        // pull from universe table
        const uu = db.prepare(
            `SELECT ticker FROM universe WHERE date = ? ORDER BY ticker ASC`
        ).all(argv.universe);
        tickers = uu.map((r) => r.ticker);
    } else {
        console.error('Provide --tickers AAPL,MSFT or --universe YYYY-MM-DD');
        process.exit(2);
    }

    if (argv.max && Number.isFinite(argv.max)) {
        tickers = tickers.slice(0, argv.max);
    }

    console.log(`Fetching fundamentals for ${tickers.length} tickers (vX)`);
    let i = 0;
    for (const t of tickers) {
        i += 1;
        process.stdout.write(`[${i}/${tickers.length}] ${t} ... `);
        await updateOneTicker(t);
    }
    console.log('Done.');
}

if (require.main === module) {
    run().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
