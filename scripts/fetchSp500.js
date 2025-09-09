#!/usr/bin/env node
/*
 * Fetch daily bars for the SPDR S&P 500 ETF (ticker: SPY) between two
 * dates.  The script queries Polygon.io's aggregates endpoint and
 * stores the results in `data/sp500/spy.json`.
 *
 * Usage:
 *   node scripts/fetchSp500.js <start-date> <end-date>
 *
 * Example:
 *   node scripts/fetchSp500.js 2023-01-01 2023-12-31
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const start = process.argv[2];
const end = process.argv[3];
if (!start || !end) {
  console.error('Usage: node scripts/fetchSp500.js <start-date> <end-date>');
  process.exit(1);
}
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) {
  console.error('POLYGON_API_KEY is not set.  Define it in your .env file.');
  process.exit(1);
}

async function fetchSp500(startDate, endDate) {
  const url = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${startDate}/${endDate}`;
  const params = {
    adjusted: true,
    apiKey
  };
  try {
    const resp = await axios.get(url, { params });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const data = resp.data;
    const outDir = path.join(__dirname, '..', 'data', 'sp500');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'spy.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`Saved SPY data to ${outPath}`);
  } catch (err) {
    console.error('Error fetching SPY data:', err.message);
  }
}

fetchSp500(start, end);