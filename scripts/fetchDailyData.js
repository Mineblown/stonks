#!/usr/bin/env node
/*
 * Fetch grouped daily market aggregates for a single date.  The script
 * requests Polygon.io's grouped daily endpoint and writes the results
 * to `data/daily/YYYY-MM-DD.json`.
 *
 * Usage:
 *   node scripts/fetchDailyData.js YYYY-MM-DD
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const dateArg = process.argv[2];
if (!dateArg) {
  console.error('Usage: node scripts/fetchDailyData.js <YYYY-MM-DD>');
  process.exit(1);
}
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error('POLYGON_API_KEY is not set.  Define it in your .env file.');
  process.exit(1);
}

async function fetchDaily(date) {
  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}`;
  const params = {
    adjusted: true,
    apiKey
  };
  try {
    const resp = await axios.get(url, { params });
    if (resp.status !== 200) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = resp.data;
    const outDir = path.join(__dirname, '..', 'data', 'daily');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${date}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`Saved daily aggregates to ${outPath}`);
  } catch (err) {
    console.error('Error fetching daily data:', err.message);
  }
}

fetchDaily(dateArg);