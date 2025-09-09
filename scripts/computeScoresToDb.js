#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const dateArg = process.argv[2];
if (!dateArg) {
  console.error('Usage: node scripts/computeScoresToDb.js YYYY-MM-DD');
  process.exit(1);
}

// Load weights with safe fallback
let weights = {
  momentum: 0.15, volatility: 0.10, volume: 0.08, vwap: 0.07,
  pe: 0.10, pb: 0.10, de: 0.05, fcf_yield: 0.07, peg: 0.03,
  ps: 0.05, roe: 0.12, dividend_yield: 0.08
};
try {
  const raw = fs.readFileSync(path.join(__dirname,'..','config','weights.json'), 'utf8');
  const parsed = JSON.parse(raw);
  weights = { ...weights, ...parsed };
} catch (e) {
  console.warn('Warning: failed to load weights; using defaults.', e.message);
}

function zScores(arr){
  const n = arr.length;
  if (!n) return [];
  const mean = arr.reduce((a,b)=>a+b,0)/n;
  const variance = arr.reduce((a,b)=>a+Math.pow(b-mean,2),0)/n;
  const std = Math.sqrt(variance);
  return std===0 ? arr.map(()=>0) : arr.map(v => (v-mean)/std);
}

function getFundamentals(ticker){
  const row = db.prepare(`SELECT * FROM fundamentals_latest WHERE ticker=?`).get(ticker);
  return row || null;
}

function computeMetricsForTicker(bar){
  const t = bar.ticker;
  const price = bar.close || 0;
  const prev = db.prepare(`SELECT close FROM daily_bars WHERE date = date(?, '-7 day') AND ticker=?`).get(bar.date, t);
  const momentum = (prev && prev.close) ? (price - prev.close)/prev.close : ((bar.open||0)>0 ? (price - bar.open)/bar.open : 0);
  const volatility = (bar.open||0) ? (bar.high - bar.low)/bar.open : 0;
  const volume = bar.volume || 0;
  const vwap_dev = (bar.vwap && bar.vwap!==0) ? (price - bar.vwap)/bar.vwap : 0;

  const f = getFundamentals(t) || {};
  const shares = f.shares_outstanding || null;
  const eps = (f.net_income!=null && shares>0) ? (f.net_income / shares) : null;
  const bvps = (f.shareholders_equity!=null && shares>0) ? (f.shareholders_equity / shares) : null;
  const revps = (f.revenue!=null && shares>0) ? (f.revenue / shares) : null;
  const pe = (eps && eps!==0) ? price/eps : null;
  const pb = (bvps && bvps!==0) ? price/bvps : null;
  const de = (f.total_liabilities!=null && f.shareholders_equity) ? (f.total_liabilities / f.shareholders_equity) : null;
  const fcf_yield = (f.op_cash!=null && f.capex!=null && shares>0 && price!==0) ? ((f.op_cash - f.capex)/shares)/price : null;
  const peg = null; // requires EPS growth history
  const ps = (revps && revps!==0) ? price/revps : null;
  const roe = (f.net_income!=null && f.shareholders_equity) ? (f.net_income / f.shareholders_equity) : null;
  const dividend_yield = (f.dividends!=null && shares>0 && price!==0) ? ((f.dividends/shares)/price) : null;

  return { momentum, volatility, volume, vwap_dev, pe, pb, de, fcf_yield, peg, ps, roe, dividend_yield };
}

(() => {
  const bars = db.prepare(`SELECT * FROM daily_bars WHERE date=?`).all(dateArg);
  if (!bars.length) {
    console.error('No daily bars found for', dateArg, '. Run fetchDailyDataToDb.js first.');
    process.exit(0);
  }
  const tickers = bars.map(b=>b.ticker);
  const metrics = bars.map(computeMetricsForTicker);

  const arrays = {
    momentum: metrics.map(m=>m.momentum || 0),
    volatility: metrics.map(m=>m.volatility || 0),
    volume: metrics.map(m=>m.volume || 0),
    vwap_dev: metrics.map(m=>m.vwap_dev || 0),
    pe_inv: metrics.map(m=> (m.pe && m.pe!==0) ? 1/m.pe : 0),
    pb_inv: metrics.map(m=> (m.pb && m.pb!==0) ? 1/m.pb : 0),
    de_inv: metrics.map(m=> (m.de && m.de!==0) ? 1/m.de : 0),
    fcf_yield: metrics.map(m=> m.fcf_yield || 0),
    peg_inv: metrics.map(m=> (m.peg && m.peg!==0) ? 1/m.peg : 0),
    ps_inv: metrics.map(m=> (m.ps && m.ps!==0) ? 1/m.ps : 0),
    roe: metrics.map(m=> m.roe || 0),
    dividend_yield: metrics.map(m=> m.dividend_yield || 0)
  };
  const z = {};
  for (const k of Object.keys(arrays)) z[k]=zScores(arrays[k]);

  const upsert = db.prepare(`
    INSERT INTO scores
      (date,ticker,momentum,volatility,volume,vwap_dev,pe,pb,de,fcf_yield,peg,ps,roe,dividend_yield,composite)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(date,ticker) DO UPDATE SET
      momentum=excluded.momentum, volatility=excluded.volatility, volume=excluded.volume, vwap_dev=excluded.vwap_dev,
      pe=excluded.pe, pb=excluded.pb, de=excluded.de, fcf_yield=excluded.fcf_yield, peg=excluded.peg, ps=excluded.ps,
      roe=excluded.roe, dividend_yield=excluded.dividend_yield, composite=excluded.composite
  `);

  const tx = db.transaction(() => {
    for (let i=0;i<tickers.length;i++){
      const comp = 
        (z.momentum[i]||0)*(weights.momentum||0) +
        (z.volatility[i]||0)*(weights.volatility||0) +
        (z.volume[i]||0)*(weights.volume||0) +
        (z.vwap_dev[i]||0)*(weights.vwap||0) +
        (z.pe_inv[i]||0)*(weights.pe||0) +
        (z.pb_inv[i]||0)*(weights.pb||0) +
        (z.de_inv[i]||0)*(weights.de||0) +
        (z.fcf_yield[i]||0)*(weights.fcf_yield||0) +
        (z.peg_inv[i]||0)*(weights.peg||0) +
        (z.ps_inv[i]||0)*(weights.ps||0) +
        (z.roe[i]||0)*(weights.roe||0) +
        (z.dividend_yield[i]||0)*(weights.dividend_yield||0);

      upsert.run(
        dateArg, tickers[i],
        metrics[i].momentum, metrics[i].volatility, metrics[i].volume, metrics[i].vwap_dev,
        metrics[i].pe, metrics[i].pb, metrics[i].de, metrics[i].fcf_yield, metrics[i].peg, metrics[i].ps, metrics[i].roe, metrics[i].dividend_yield,
        comp
      );
    }
  });
  tx();
  console.log(`Computed ${tickers.length} scores for ${dateArg}`);
})();
