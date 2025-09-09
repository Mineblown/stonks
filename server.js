
/* server.js - fixed fundamentals selection + new endpoints + weights + scheduler-safe */
const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'quant.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const CONFIG_DIR = path.join(__dirname, 'config');
const WEIGHTS_PATH = path.join(CONFIG_DIR, 'weights.json');
const DEFAULT_WEIGHTS_PATH = path.join(CONFIG_DIR, 'defaultWeights.json');

function loadWeights() {
  try {
    if (fs.existsSync(WEIGHTS_PATH)) {
      return JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8'));
    }
  } catch(e) { console.warn('Failed reading weights.json:', e.message); }
  return JSON.parse(fs.readFileSync(DEFAULT_WEIGHTS_PATH, 'utf-8'));
}

function saveWeights(w) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(w, null, 2));
}

function sqlDateOrLatest(date) {
  if (date) return date;
  const row = db.prepare("SELECT date FROM scores ORDER BY date DESC LIMIT 1").get();
  return row ? row.date : null;
}

/* --- API: scores_filtered ---
   IMPORTANT: Select fundamentals from scores (s.*) and market fields from universe (u.*)
*/
app.get('/api/scores_filtered/:date', (req, res) => {
  const date = req.params.date;
  const q = (req.query.q || '').trim();
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const minMcap = parseFloat(req.query.min_mcap || '0');
  const minVol = parseFloat(req.query.min_vol || '0');

  const st = db.prepare(`
    SELECT
      s.ticker, s.date,
      s.momentum, s.volatility, s.volume, s.vwap_dev,
      s.pe, s.pb, s.de, s.fcf_yield, s.peg, s.peg3, s.ps, s.roe, s.dividend_yield,
      s.composite,
      u.market_cap, u.avg_volume
    FROM scores s
    LEFT JOIN universe u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
      AND (@q = '' OR s.ticker LIKE '%' || @q || '%')
      AND (u.market_cap IS NULL OR u.market_cap >= @minMcap)
      AND (u.avg_volume IS NULL OR u.avg_volume >= @minVol)
    ORDER BY s.composite DESC
    LIMIT @limit OFFSET @offset;
  `);

  const countSt = db.prepare(`
    SELECT COUNT(*) AS total
    FROM scores s
    LEFT JOIN universe u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
      AND (@q = '' OR s.ticker LIKE '%' || @q || '%')
      AND (u.market_cap IS NULL OR u.market_cap >= @minMcap)
      AND (u.avg_volume IS NULL OR u.avg_volume >= @minVol);
  `);

  const params = { date, q, limit, offset, minMcap, minVol };
  const rows = st.all(params);
  const total = countSt.get(params).total;
  res.json({ total, rows });
});

/* --- API: top50 (unchanged but corrected select source) --- */
app.get('/api/top50', (req, res) => {
  const date = sqlDateOrLatest(req.query.date);
  if (!date) return res.json([]);
  const st = db.prepare(`
    SELECT
      s.ticker, s.date,
      s.momentum, s.volatility, s.volume, s.vwap_dev,
      s.pe, s.pb, s.de, s.fcf_yield, s.peg, s.peg3, s.ps, s.roe, s.dividend_yield,
      s.composite,
      u.market_cap, u.avg_volume
    FROM scores s
    LEFT JOIN universe u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
    ORDER BY s.composite DESC
    LIMIT 50;
  `);
  res.json(st.all({ date }));
});

/* --- API: top10 --- */
app.get('/api/top10', (req, res) => {
  const date = sqlDateOrLatest(req.query.date);
  if (!date) return res.json([]);
  const st = db.prepare(`
    SELECT s.ticker, s.date, s.composite,
           s.pe, s.pb, s.peg, s.peg3, s.ps, s.roe, s.fcf_yield,
           u.market_cap, u.avg_volume
    FROM scores s
    LEFT JOIN universe u
      ON u.date = s.date AND u.ticker = s.ticker
    WHERE s.date = @date
    ORDER BY s.composite DESC
    LIMIT 10;
  `);
  res.json(st.all({ date }));
});

/* --- API: top10_track --- */
function getCloseDict(date) {
  const rows = db.prepare(`SELECT ticker, close FROM daily_bars WHERE date=@date`).all({ date });
  const out = {};
  rows.forEach(r => out[r.ticker] = r.close);
  return out;
}
app.get('/api/top10_track', (req, res) => {
  const start = req.query.start;
  const end = req.query.end || start;
  if (!start) return res.status(400).json({ error: 'start is required' });

  const picks = db.prepare(`
    SELECT ticker FROM scores
    WHERE date=@start
    ORDER BY composite DESC
    LIMIT 10;
  `).all({ start }).map(r => r.ticker);

  if (!picks.length) return res.json({ series: [], summary: { start, end, picks, totalRet: 0 } });

  const dateRows = db.prepare(`
    SELECT DISTINCT date FROM daily_bars
    WHERE date >= @start AND date <= @end
    ORDER BY date ASC;
  `).all({ start, end });

  const series = [];
  let index = 1.0;
  let prevCloses = null;

  for (const dr of dateRows) {
    const closes = getCloseDict(dr.date);
    if (prevCloses) {
      let sumRet = 0, n=0;
      for (const t of picks) {
        const pc = prevCloses[t];
        const c = closes[t];
        if (pc && c) { sumRet += (c - pc)/pc; n++; }
      }
      const dailyRet = n ? (sumRet/n) : 0;
      index *= (1 + dailyRet);
      series.push({ date: dr.date, value: index, dailyRet });
    } else {
      series.push({ date: dr.date, value: index, dailyRet: 0 });
    }
    prevCloses = closes;
  }

  const totalRet = index - 1;
  res.json({ series, summary: { start, end, picks, totalRet }});
});

/* --- API: weights management --- */
app.get('/api/weights', (req, res) => res.json(loadWeights()));
app.post('/api/weights', (req, res) => {
  saveWeights(req.body || {});
  res.json({ ok: true });
});
app.post('/api/weights/reset', (req, res) => {
  const def = JSON.parse(fs.readFileSync(DEFAULT_WEIGHTS_PATH, 'utf-8'));
  saveWeights(def);
  res.json({ ok: true, reset: true });
});

/* Scheduler safe require (no .start()) */
if (process.env.RUN_SCHEDULER === '1') {
  try {
    require('./scripts/schedule'); // must be side-effect only
    console.log('Scheduler enabled.');
  } catch (e) {
    console.warn('Failed to start scheduler:', e.message);
  }
}

const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log({ address: '0.0.0.0', port: PORT });
});
