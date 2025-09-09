#!/usr/bin/env node
/*
 * Fetch daily bars for the SPY ETF from Polygon and insert them into
 * the `spy_daily` table.  Accepts a start and end date in YYYY-MM-DD
 * format.  Usage:
 *   node scripts/fetchSpy.js 2024-01-01 2024-12-31
 *
 * If the end date is omitted, only the start date's bar is fetched.
 */

const axios = require('axios');
const dotenv = require('dotenv');
const db = require('../db/db');

dotenv.config();

const start = process.argv[2];
const end = process.argv[3] || start;
if (!start) {
  console.error('Usage: node scripts/fetchSpy.js <start YYYY-MM-DD> [<end YYYY-MM-DD>]');
  process.exit(1);
}
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error('POLYGON_API_KEY not set in environment.');
  process.exit(1);
}

async function run() {
  const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${start}/${end}?adjusted=true&apiKey=${apiKey}`;
  try {
    const { data } = await axios.get(url);
    if (!data || !Array.isArray(data.results)) {
      console.error('Unexpected response from Polygon:', data);
      return;
    }
    const insert = db.prepare(
      `INSERT INTO spy_daily (date, open, high, low, close, volume)
       VALUES (@date, @o, @h, @l, @c, @v)
       ON CONFLICT(date) DO UPDATE SET
         open=excluded.open,
         high=excluded.high,
         low=excluded.low,
         close=excluded.close,
         volume=excluded.volume`
    );
    const tx = db.transaction((rows) => {
      for (const bar of rows) {
        const iso = new Date(bar.t).toISOString().slice(0, 10);
        insert.run({ date: iso, ...bar });
      }
    });
    tx(data.results);
    console.log(`Inserted ${data.results.length} SPY bars from ${start} to ${end}`);
  } catch (err) {
    console.error('Failed to fetch SPY data:', err.message);
  }
}

run();