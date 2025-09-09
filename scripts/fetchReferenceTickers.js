#!/usr/bin/env node
/**
 * Populate the `reference_tickers` table from Polygon's v3 reference API.
 * Usage:
 *   node scripts/fetchReferenceTickers.js                # US stocks only (default)
 *   node scripts/fetchReferenceTickers.js --all          # include non-US
 *   node scripts/fetchReferenceTickers.js --max 50000    # cap rows
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const db = require('../db/db');
dotenv.config();

const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) { console.error('POLYGON_API_KEY missing'); process.exit(1); }

// ensure table
db.exec(`
CREATE TABLE IF NOT EXISTS reference_tickers (
  ticker TEXT PRIMARY KEY,
  name TEXT,
  market_cap REAL,
  share_class_shares_outstanding REAL,
  currency TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reference_updated_at ON reference_tickers(updated_at);
`);

const args = new Set(process.argv.slice(2));
const ONLY_US = args.has('--all') ? false : true;
const maxIdx = process.argv.indexOf('--max');
const MAX_ROWS = (maxIdx>-1 && process.argv[maxIdx+1]) ? parseInt(process.argv[maxIdx+1],10) : Infinity;

const dataDir = path.join(__dirname,'..','data');
const stateFile = path.join(dataDir,'reference_state.json');
function readState(){ try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{return { next_url:null, total:0 }; } }
function writeState(s){ fs.mkdirSync(dataDir,{recursive:true}); fs.writeFileSync(stateFile, JSON.stringify(s,null,2)); }

const upsert = db.prepare(`
INSERT INTO reference_tickers (ticker,name,market_cap,share_class_shares_outstanding,currency,updated_at)
VALUES (?,?,?,?,?,datetime('now'))
ON CONFLICT(ticker) DO UPDATE SET
  name=excluded.name,
  market_cap=excluded.market_cap,
  share_class_shares_outstanding=excluded.share_class_shares_outstanding,
  currency=excluded.currency,
  updated_at=excluded.updated_at
`);
const tx = db.transaction((rows)=>{ for(const r of rows){ upsert.run(r.ticker,r.name,r.market_cap,r.shares,r.currency); } });

function buildUrl(){
  const u = new URL('https://api.polygon.io/v3/reference/tickers');
  u.searchParams.set('market','stocks');
  u.searchParams.set('active','true');
  if (ONLY_US) u.searchParams.set('locale','us');
  u.searchParams.set('limit','1000');
  u.searchParams.set('sort','ticker');
  u.searchParams.set('apiKey', apiKey);
  return u.toString();
}
async function fetchPage(url){
  const U = new URL(url);
  if (!U.searchParams.get('apiKey')) U.searchParams.set('apiKey', apiKey);
  const { data } = await require('axios').get(U.toString(), { timeout: 60000 });
  return data;
}
function mapRows(list){
  return (list||[]).map(it=> ({
    ticker: it.ticker,
    name: it.name,
    market_cap: it.market_cap ?? null,
    shares: it.share_class_shares_outstanding ?? null,
    currency: it.currency_name ?? null
  })).filter(r=>r.ticker);
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async ()=>{
  let state = readState();
  let url = state.next_url || buildUrl();
  let total = state.total || 0;
  console.log(`Starting reference sync (ONLY_US=${ONLY_US}, MAX=${MAX_ROWS===Infinity?'∞':MAX_ROWS})`);
  while (url && total < MAX_ROWS){
    try {
      const page = await fetchPage(url);
      const rows = mapRows(page.results);
      if (!rows.length){ console.log('No rows on page. Stopping.'); break; }
      const can = Math.max(0, MAX_ROWS-total);
      const batch = rows.slice(0, can);
      tx(batch);
      total += batch.length;
      console.log(`Upserted ${batch.length} (total ${total})`);
      state = { next_url: page.next_url || null, total };
      writeState(state);
      if (page.next_url && total < MAX_ROWS){ await sleep(300); url = page.next_url; } else { url=null; }
    } catch (e){
      console.error('Page failed:', e.response?.status, e.message); await sleep(3000);
    }
  }
  console.log('Done. Total upserted:', total);
  process.exit(0);
})();
