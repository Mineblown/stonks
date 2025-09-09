#!/usr/bin/env node
/*
 * fetchFundamentals.js
 *
 * Fetch fundamental financial statements for a list of tickers from Polygon’s
 * experimental financials endpoint.  The script accepts one or more ticker
 * symbols on the command line and writes the latest filings into
 * DATA_DIR/fundamentals/<TICKER>.json.  You can call this script repeatedly
 * as new filings become available.
 */

import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function fetchFundamental(ticker) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    throw new Error('POLYGON_API_KEY is not set in your environment.');
  }
  const url = `https://api.polygon.io/v3/reference/financials?ticker=${ticker}&timeframe=annual&limit=4&apiKey=${apiKey}`;
  try {
    const { data } = await axios.get(url);
    return data;
  } catch (err) {
    throw new Error(err?.response?.data?.error || err.message);
  }
}

async function main() {
  const tickers = process.argv.slice(2).map(t => t.toUpperCase()).filter(Boolean);
  if (tickers.length === 0) {
    console.error('Usage: node fetchFundamentals.js <TICKER> [TICKER ...]');
    process.exit(1);
  }
  const fundamentalsDir = path.join(process.env.DATA_DIR || 'data', 'fundamentals');
  await fs.mkdir(fundamentalsDir, { recursive: true });
  for (const ticker of tickers) {
    console.log(`Fetching fundamentals for ${ticker}...`);
    try {
      const fundamental = await fetchFundamental(ticker);
      const outPath = path.join(fundamentalsDir, `${ticker}.json`);
      await fs.writeFile(outPath, JSON.stringify(fundamental, null, 2), 'utf-8');
      console.log(`Saved fundamentals to ${outPath}`);
    } catch (err) {
      console.error(`Failed to fetch fundamentals for ${ticker}: ${err.message}`);
    }
  }
}

main();