#!/usr/bin/env node
const axios = require('axios');
const dotenv = require('dotenv');
const db = require('../db/db');

dotenv.config();

const dateArg = process.argv[2];
if (!dateArg) {
  console.error('Usage: node scripts/fetchDailyDataToDb.js YYYY-MM-DD');
  process.exit(1);
}

(async () => {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error('POLYGON_API_KEY missing');

  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${dateArg}?adjusted=true&apiKey=${apiKey}`;
  const { data } = await axios.get(url);
  const rows = Array.isArray(data?.results) ? data.results : [];
  if (!rows.length) {
    console.error('No results from Polygon for', dateArg);
    process.exit(1);
  }

  const upsert = db.prepare(`
    INSERT INTO daily_bars (date, ticker, open, high, low, close, volume, vwap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, ticker) DO UPDATE SET
      open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
      volume=excluded.volume, vwap=excluded.vwap
  `);

  const tx = db.transaction((list) => {
    for (const r of list) {
      const rec = {
        date: dateArg,
        ticker: r.T ?? null,
        open:  (typeof r.o === 'number') ? r.o : null,
        high:  (typeof r.h === 'number') ? r.h : null,
        low:   (typeof r.l === 'number') ? r.l : null,
        close: (typeof r.c === 'number') ? r.c : null,
        volume: Number.isFinite(r.v) ? Math.round(r.v) : null,
        vwap:  (typeof r.vw === 'number') ? r.vw : null
      };
      upsert.run(rec.date, rec.ticker, rec.open, rec.high, rec.low, rec.close, rec.volume, rec.vwap);
    }
  });
  tx(rows);

  console.log(`Upserted ${rows.length} bars for ${dateArg}`);
})().catch(e => { console.error('Failed to fetch daily data:', e.message); process.exit(1); });
