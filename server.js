const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { spawnSync } = require('child_process');

// Open the SQLite database.  Use WAL mode for better concurrency.
const dbPath = path.join(__dirname, 'data', 'quant.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Serve static files from the src directory (front‑end)
app.use(express.static(path.join(__dirname, 'src')));

/**
 * Helper to get the latest date from scores table.
 */
function getLatestDate() {
  const row = db.prepare('SELECT MAX(date) AS d FROM scores').get();
  return row && row.d;
}

/**
 * Load weights from config/weights.json; fall back to config/defaultWeights.json.
 */
function loadWeights() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'weights.json'), 'utf8'));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'defaultWeights.json'), 'utf8'));
    } catch {
      return {};
    }
  }
}

/**
 * Persist weights to config/weights.json.
 */
function saveWeights(w) {
  fs.writeFileSync(path.join(__dirname, 'config', 'weights.json'), JSON.stringify(w, null, 2));
}

/**
 * Endpoint: GET /api/latest-date
 * Returns {date: } or {date:null} if no scores.
 */
app.get('/api/latest-date', (req, res) => {
  const d = getLatestDate();
  res.json({ date: d || null });
});

/**
 * Endpoint: GET /api/scores/:date
 * Returns all raw scores for a given date (no filtering, no join).  Used internally.
 */
app.get('/api/scores/:date', (req, res) => {
  const date = req.params.date;
  const rows = db.prepare('SELECT * FROM scores WHERE date = ? ORDER BY composite DESC').all(date);
  res.json(rows);
});

/**
 * Endpoint: GET /api/scores_filtered/:date
 * Returns filtered, paginated scores for a given date with scores and universe fields joined.
 * Query params:
 *   q        – optional substring match for ticker (case‑insensitive)
 *   min_mcap – minimum market cap (USD)
 *   min_vol  – minimum average volume (shares)
 *   limit    – number of rows (default 50, max 500)
 *   offset   – pagination offset (default 0)
 */
app.get('/api/scores_filtered/:date', (req, res) => {
  const date = req.params.date;
  const q = (req.query.q || '').toUpperCase();
  const minCap = parseFloat(req.query.min_mcap || '0');
  const minVol = parseFloat(req.query.min_vol || '0');
  const limit = Math.max(1, Math.min(parseInt(req.query.limit || '50', 10), 500));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));

  const rows = db.prepare(`
    SELECT
      s.ticker, s.date,
      s.momentum, s.volatility, s.volume, s.vwap_dev,
      s.pe, s.pb, s.de, s.fcf_yield, s.peg, s.peg3, s.ps, s.roe, s.dividend_yield,
      s.composite,
      u.market_cap, u.avg_volume
    FROM scores AS s
    LEFT JOIN universe AS u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
      AND (@q = '' OR s.ticker LIKE '%' || @q || '%')
      AND (u.market_cap IS NULL OR u.market_cap >= @minCap)
      AND (u.avg_volume IS NULL OR u.avg_volume >= @minVol)
    ORDER BY s.composite DESC
    LIMIT @limit OFFSET @offset;
  `).all({ date, q, minCap, minVol, limit, offset });

  const total = db.prepare(`
    SELECT COUNT(*) AS n
    FROM scores AS s
    LEFT JOIN universe AS u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
      AND (@q = '' OR s.ticker LIKE '%' || @q || '%')
      AND (u.market_cap IS NULL OR u.market_cap >= @minCap)
      AND (u.avg_volume IS NULL OR u.avg_volume >= @minVol);
  `).get({ date, q, minCap, minVol }).n;

  res.set('Cache-Control', 'public, max-age=30');
  res.json({ total, rows });
});

/**
 * Endpoint: GET /api/top50
 * Returns the top 50 tickers (by composite) for the latest or specified date.
 * Query params:
 *   date – optional date (YYYY-MM-DD). Defaults to latest date.
 */
app.get('/api/top50', (req, res) => {
  const date = req.query.date || getLatestDate();
  if (!date) return res.json([]);
  const rows = db.prepare(`
    SELECT
      s.ticker, s.composite,
      s.pe, s.pb, s.de, s.fcf_yield, s.peg, s.peg3, s.ps, s.roe, s.dividend_yield,
      u.market_cap, u.avg_volume
    FROM scores AS s
    LEFT JOIN universe AS u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
    ORDER BY s.composite DESC
    LIMIT 50;
  `).all({ date });
  res.json(rows);
});

/**
 * Endpoint: GET /api/top10
 * Returns the top 10 tickers (by composite) for the latest or specified date.
 * Query params:
 *   date – optional date (YYYY-MM-DD). Defaults to latest date.
 */
app.get('/api/top10', (req, res) => {
  const date = req.query.date || getLatestDate();
  if (!date) return res.json([]);
  const rows = db.prepare(`
    SELECT
      s.ticker, s.composite,
      s.pe, s.pb, s.de, s.fcf_yield, s.peg, s.peg3, s.ps, s.roe, s.dividend_yield,
      u.market_cap, u.avg_volume
    FROM scores AS s
    LEFT JOIN universe AS u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
    ORDER BY s.composite DESC
    LIMIT 10;
  `).all({ date });
  res.json(rows);
});

/**
 * Endpoint: GET /api/top10_track
 * Tracks the performance of the top 10 tickers chosen on the start date through the end date.
 * Query params:
 *   start – required start date (YYYY-MM-DD)
 *   end   – required end date (YYYY-MM-DD)
 */
app.get('/api/top10_track', (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  if (!start || !end) return res.status(400).json({ error: 'start and end are required (YYYY-MM-DD)' });

  // Pick top 10 tickers on the start date
  const picks = db.prepare(`
    SELECT ticker
    FROM scores
    WHERE date = @start
    ORDER BY composite DESC
    LIMIT 10
  `).all({ start }).map(r => r.ticker);

  if (!picks.length) return res.json({ series: [], summary: { start, end, picks, totalRet: 0 } });

  // Build list of dates within the range
  const dates = db.prepare(`SELECT DISTINCT date FROM daily_bars WHERE date BETWEEN @start AND @end ORDER BY date`)
                  .all({ start, end }).map(r => r.date);
  if (!dates.length) return res.json({ series: [], summary: { start, end, picks, totalRet: 0 } });

  let index = 1.0;
  const series = [];
  let prevPrices = new Map();

  // Seed previous prices with start date closes
  const seedRows = db.prepare(
    `SELECT ticker, close FROM daily_bars WHERE date = @d AND ticker IN (${picks.map(() => '?').join(',')})`
  ).all(...[{ d: start }].flatMap(o => [o.d, ...picks]));
  for (const r of seedRows) prevPrices.set(r.ticker, r.close);

  for (const d of dates) {
    const rows = db.prepare(
      `SELECT ticker, close FROM daily_bars WHERE date = @d AND ticker IN (${picks.map(() => '?').join(',')})`
    ).all(...[{ d }].flatMap(o => [o.d, ...picks]));

    let sumRet = 0;
    let count = 0;
    for (const { ticker, close } of rows) {
      const prev = prevPrices.get(ticker);
      if (prev != null && prev > 0 && close != null) {
        sumRet += (close - prev) / prev;
        count++;
      }
    }
    const dailyRet = count > 0 ? sumRet / count : 0;
    index *= (1 + dailyRet);
    series.push({ date: d, value: index, dailyRet });
    prevPrices = new Map();
    for (const { ticker, close } of rows) {
      prevPrices.set(ticker, close);
    }
  }

  const totalRet = series.length ? (series[series.length - 1].value - 1) : 0;
  res.json({ series, summary: { start, end, picks, totalRet } });
});

/**
 * Weight endpoints:
 *   GET /api/weights        – read current weights or defaults
 *   POST /api/weights       – set new weights (JSON body)
 *   POST /api/weights/reset – reset to default weights
 */
app.get('/api/weights', (_req, res) => {
  res.json(loadWeights());
});

app.post('/api/weights', express.json(), (req, res) => {
  const w = req.body || {};
  saveWeights(w);
  res.json({ ok: true, weights: w });
});

app.post('/api/weights/reset', (_req, res) => {
  try {
    const def = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'defaultWeights.json'), 'utf8'));
    saveWeights(def);
    res.json({ ok: true, weights: def });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Endpoint: GET /api/backtest
 * Parameters:
 *   start – start date (YYYY-MM-DD)
 *   end   – end date (YYYY-MM-DD)
 *   pct   – top percentage (integer between 1 and 100)
 * Returns the cumulative return series for the strategy vs. SPY.
 */
app.get('/api/backtest', (req, res) => {
  const start = req.query.start;
  const end = req.query.end;
  const pct = Math.min(100, Math.max(1, parseInt(req.query.pct || '20', 10)));
  if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

  // Fetch unique dates in range, sorted ascending.
  const dates = db.prepare(
    `SELECT DISTINCT date FROM scores WHERE date BETWEEN @start AND @end ORDER BY date`
  ).all({ start, end }).map(r => r.date);
  if (!dates.length) return res.json({ strategy: [], spy: [] });

  // Preload SPY closes in a map.
  const spyRows = db.prepare(
    `SELECT date, close FROM spy_daily WHERE date BETWEEN @start AND @end`
  ).all({ start, end });
  const spyMap = new Map(spyRows.map(r => [r.date, r.close]));

  let stratIndex = 1;
  let spyIndex = 1;
  const stratSeries = [];
  const spySeries = [];
  let prevSpy = null;

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    // Strategy: pick top pct% of tickers by composite for this date.
    const tickers = db.prepare(
      `SELECT ticker FROM scores WHERE date = @d ORDER BY composite DESC LIMIT @n`
    ).all({ d, n: Math.max(1, Math.floor((pct / 100) * db.prepare('SELECT COUNT(*) FROM scores WHERE date = ?').get(d)["COUNT(*)"])) });
    // Average next day return for each selected ticker.
    let sumRet = 0;
    let count = 0;
    for (const { ticker } of tickers) {
      // Next day close for ticker
      const rows = db.prepare(
        `SELECT close FROM daily_bars WHERE ticker = @ticker AND date = (
          SELECT MIN(date) FROM daily_bars WHERE date > @d AND ticker = @ticker
        )`
      ).all({ ticker, d });
      if (rows.length) {
        const nextPrice = rows[0].close;
        const curPriceRow = db.prepare(
          `SELECT close FROM daily_bars WHERE ticker = @ticker AND date = @d`
        ).get({ ticker, d });
        if (curPriceRow && curPriceRow.close) {
          const ret = (nextPrice - curPriceRow.close) / curPriceRow.close;
          sumRet += ret;
          count++;
        }
      }
    }
    const dailyRet = count > 0 ? sumRet / count : 0;
    stratIndex *= (1 + dailyRet);
    stratSeries.push({ date: d, value: stratIndex });
    // SPY return
    if (prevSpy === null && spyMap.has(d)) {
      prevSpy = spyMap.get(d);
    } else if (prevSpy !== null && spyMap.has(d)) {
      const curSpy = spyMap.get(d);
      const spyRet = (curSpy - prevSpy) / prevSpy;
      spyIndex *= (1 + spyRet);
      spySeries.push({ date: d, value: spyIndex });
      prevSpy = curSpy;
    }
  }
  res.json({ strategy: stratSeries, spy: spySeries });
});

/**
 * Endpoint: GET /api/status
 * Returns scheduler status if present.  This is optional and will be undefined until the scheduler writes to status.json.
 */
app.get('/api/status', (req, res) => {
  const statusFile = path.join(__dirname, 'data', 'status.json');
  try {
    const status = fs.readFileSync(statusFile, 'utf8');
    res.json(JSON.parse(status));
  } catch {
    res.json({ running: false });
  }
});

// Start scheduler if RUN_SCHEDULER is set to 1
// Start scheduler if RUN_SCHEDULER is set to 1.  The schedule script
// executes immediately upon require, so we don't call a start() function.
if (process.env.RUN_SCHEDULER === '1') {
  try {
    require('./scripts/schedule');
    console.log('Scheduler enabled.');
  } catch (e) {
    console.warn('Failed to start scheduler:', e.message);
  }
}

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});