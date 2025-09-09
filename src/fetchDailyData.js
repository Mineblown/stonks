#!/usr/bin/env node
/*
 * fetchDailyData.js
 *
 * Download daily aggregated OHLCV data for all U.S. equities from Polygon’s
 * grouped daily endpoint.  The script expects a single date argument in
 * YYYY‑MM‑DD format.  It saves the response JSON into the directory
 * specified by DATA_DIR (default: data/daily).
 */

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error('Usage: node fetchDailyData.js <YYYY-MM-DD>');
    process.exit(1);
  }
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    console.error('POLYGON_API_KEY is not set in your environment.');
    process.exit(1);
  }

  const dataDir = process.env.DATA_DIR || 'data';
  const dailyDir = path.join(dataDir, 'daily');
  await fs.mkdir(dailyDir, { recursive: true });

  const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&include_otc=false&apiKey=${apiKey}`;
  console.log(`Fetching daily market aggregates for ${date}...`);
  try {
    const { data } = await axios.get(url);
    const outPath = path.join(dailyDir, `${date}.json`);
    await fs.writeFile(outPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Saved file to ${outPath}`);
  } catch (err) {
    console.error('Error fetching market data:', err?.response?.data || err.message);
  }
}

main();