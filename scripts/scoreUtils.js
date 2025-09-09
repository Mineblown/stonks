const fs = require('fs');
const path = require('path');
const { subDays, parseISO, formatISO } = require('date-fns');

// Helper to load daily data from the JSON files.  Returns an array of
// aggregated bars for all tickers on the requested date or null if
// the file does not exist.  Each element in the array has the
// following structure (see Polygon docs for details):
// {
//   T: ticker symbol,
//   v: volume,
//   o: open,
//   c: close,
//   h: high,
//   l: low,
//   vw: volume weighted average price (may be null)
// }
function loadDaily(date) {
  const filePath = path.join(__dirname, '..', 'data', 'daily', `${date}.json`);
  if (!fs.existsSync(filePath)) return null;
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return json.results || null;
}

// Load fundamental data for a given ticker.  Fundamental files are written by
// scripts/fetchFundamentals.js into data/fundamentals/<TICKER>.json.  If no
// file exists, returns null.  The function attempts to extract the most
// recent filing from the Polygon API response.  See the README for notes on
// the schema.  If a file exists but cannot be parsed, null is returned.
function loadFundamentals(ticker) {
  const fundamentalsDir = path.join(__dirname, '..', 'data', 'fundamentals');
  const file = path.join(fundamentalsDir, `${ticker}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!json || !Array.isArray(json.results) || json.results.length === 0) {
      return null;
    }
    // Sort results by filing date descending and take the most recent
    const sorted = json.results.slice().sort((a, b) => {
      const dateA = new Date(a.filing_date || a.period_of_report || 0);
      const dateB = new Date(b.filing_date || b.period_of_report || 0);
      return dateB - dateA;
    });
    return sorted[0] || null;
  } catch (err) {
    return null;
  }
}

// Helper to safely extract a numeric field from a nested object.  Accepts
// multiple possible field paths and returns the first non‑undefined value.
function getField(obj, paths) {
  for (const p of paths) {
    let current = obj;
    for (const key of p.split('.')) {
      if (current && Object.prototype.hasOwnProperty.call(current, key)) {
        current = current[key];
      } else {
        current = undefined;
        break;
      }
    }
    if (current != null && !isNaN(Number(current))) {
      return Number(current);
    }
  }
  return undefined;
}

// Compute fundamental ratios for a given ticker and closing price.  Returns
// an object with keys `pe`, `pb`, `de`, `fcf_yield`, `peg`, `ps`, `roe`,
// `dividend_yield`.  If fundamentals are missing or a ratio cannot be
// calculated, the corresponding value will be undefined.
function computeFundamentalMetrics(ticker, price) {
  const filing = loadFundamentals(ticker);
  if (!filing) {
    return {};
  }
  const fin = filing.financials || {};
  const income = fin.income_statement || {};
  const balance = fin.balance_sheet || {};
  const cashFlow = fin.cash_flow_statement || {};
  // Shares outstanding – try diluted shares first, then basic
  const shares = getField(fin, [
    'weighted_avg_diluted_shares_outstanding',
    'weighted_avg_shares_outstanding_diluted',
    'weighted_avg_shares_outstanding',
    'weighted_average_shares_outstanding',
    'income_statement.weightedAverageShsOutDil',
    'income_statement.weightedAverageShsOut'
  ]);
  // Net income
  const netIncome = getField(fin, [
    'income_statement.net_income',
    'income_statement.net_income_loss',
    'income_statement.netIncome',
    'income_statement.netIncomeLoss'
  ]);
  // Total revenue
  const revenue = getField(fin, [
    'income_statement.revenue',
    'income_statement.total_revenue',
    'income_statement.revenue_net',
    'income_statement.sales_and_services_net',
    'income_statement.salesRevenueNet'
  ]);
  // Total assets and liabilities
  const totalAssets = getField(fin, [
    'balance_sheet.total_assets',
    'balance_sheet.assets',
    'balance_sheet.totalAssets'
  ]);
  const totalLiabilities = getField(fin, [
    'balance_sheet.total_liabilities',
    'balance_sheet.liabilities',
    'balance_sheet.totalLiabilities'
  ]);
  // Stockholders' equity
  const equity = getField(fin, [
    'balance_sheet.stockholders_equity',
    'balance_sheet.total_shareholders_equity',
    'balance_sheet.shareholders_equity',
    'balance_sheet.totalStockholdersEquity'
  ]);
  // Cash flow items
  const opCash = getField(fin, [
    'cash_flow_statement.net_cash_provided_by_used_in_operating_activities',
    'cash_flow_statement.net_cash_from_operating_activities',
    'cash_flow_statement.net_cash_flow_from_operating_activities',
    'cash_flow_statement.cash_from_operations'
  ]);
  const capex = getField(fin, [
    'cash_flow_statement.capital_expenditures',
    'cash_flow_statement.purchase_of_property_plant_equipment',
    'cash_flow_statement.capex'
  ]);
  const dividends = getField(fin, [
    'cash_flow_statement.dividends_paid',
    'cash_flow_statement.dividend_paid',
    'income_statement.cashDividendsPaid',
    'income_statement.cash_dividends_paid'
  ]);
  // Compute per‑share values
  let eps;
  if (netIncome != null && shares > 0) {
    eps = netIncome / shares;
  }
  let bookValuePerShare;
  if (equity != null && shares > 0) {
    bookValuePerShare = equity / shares;
  }
  let revenuePerShare;
  if (revenue != null && shares > 0) {
    revenuePerShare = revenue / shares;
  }
  // Compute current year EPS growth rate using previous filing if available
  let epsGrowth;
  if (shares > 0 && netIncome != null) {
    // Find previous filing (the second most recent)
    const filingAll = loadFundamentals(ticker);
    // Already sorted; the current is index 0, previous is index 1
    let prev; // we can't call loadFundamentals again to fetch previous; we will rely on the fact that loadFundamentals returns most recent; can't easily fetch previous.
    // Without previous filings, we cannot compute growth; leave undefined
  }
  // Ratio calculations
  const metrics = {};
  // P/E – price divided by EPS
  if (eps != null && eps !== 0) {
    metrics.pe = price / eps;
  }
  // P/B – price divided by book value per share
  if (bookValuePerShare != null && bookValuePerShare !== 0) {
    metrics.pb = price / bookValuePerShare;
  }
  // D/E – total liabilities divided by equity
  if (totalLiabilities != null && equity != null && equity !== 0) {
    metrics.de = totalLiabilities / equity;
  }
  // Free cash flow yield – (opCash - capex) / (shares * price)
  if (opCash != null && capex != null && shares > 0 && price !== 0) {
    const fcf = opCash - capex;
    metrics.fcf_yield = (fcf / shares) / price;
  }
  // PEG – P/E divided by EPS growth rate (skip if no growth)
  if (metrics.pe != null && epsGrowth != null && epsGrowth !== 0) {
    metrics.peg = metrics.pe / epsGrowth;
  }
  // P/S – price divided by revenue per share
  if (revenuePerShare != null && revenuePerShare !== 0) {
    metrics.ps = price / revenuePerShare;
  }
  // ROE – net income divided by equity
  if (netIncome != null && equity != null && equity !== 0) {
    metrics.roe = netIncome / equity;
  }
  // Dividend yield – annual dividends per share divided by price
  if (dividends != null && shares > 0 && price !== 0) {
    const divPerShare = dividends / shares;
    metrics.dividend_yield = divPerShare / price;
  }
  return metrics;
}

// Compute z‑scores for an array of numeric values.  Z‑scores are
// calculated as (value − mean) / standardDeviation.  When the
// standard deviation is zero (all values equal), returns an array of
// zeros to avoid division by zero.
function zScores(values) {
  const n = values.length;
  if (n === 0) return [];
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return values.map(() => 0);
  return values.map((v) => (v - mean) / std);
}

// Compute scores for all tickers on the given date.  The weights
// parameter should be an object with keys `momentum`, `volatility`,
// `volume` and `vwap` representing how much each metric should
// contribute to the final score.  Returns an array of objects
// containing the raw metrics and the final score sorted in descending
// order by score.
function computeScores(date, weights) {
  const todayData = loadDaily(date);
  if (!todayData) {
    throw new Error(`No daily data found for ${date}.  Download it with fetchDailyData.js first.`);
  }
  // Determine the date one week prior.  We subtract 7 calendar days for simplicity.
  const prevDate = formatISO(subDays(parseISO(date), 7), { representation: 'date' });
  const prevData = loadDaily(prevDate) || [];
  const prevClose = {};
  for (const bar of prevData) {
    prevClose[bar.T] = bar.c;
  }
  // Prepare raw metric arrays
  const raw = {
    momentum: [],
    volatility: [],
    volume: [],
    vwap: [],
    pe_inv: [],     // inverted P/E (for z‑scoring)
    pb_inv: [],     // inverted P/B
    de_inv: [],     // inverted D/E
    fcf_yield: [],
    peg_inv: [],    // inverted PEG (lower is better)
    ps_inv: [],     // inverted P/S
    roe: [],
    dividend_yield: []
  };
  const tickers = [];
  // Loop through each ticker and compute all raw metrics
  for (const bar of todayData) {
    const tkr = bar.T;
    tickers.push(tkr);
    // Price‑based metrics
    const prevC = prevClose[tkr];
    const mom = prevC != null ? (bar.c - prevC) / prevC : (bar.o !== 0 ? (bar.c - bar.o) / bar.o : 0);
    const vol = bar.o !== 0 ? (bar.h - bar.l) / bar.o : 0;
    const volu = bar.v;
    const vwapMetric = bar.vw != null && bar.vw !== 0 ? (bar.c - bar.vw) / bar.vw : 0;
    raw.momentum.push(mom);
    raw.volatility.push(vol);
    raw.volume.push(volu);
    raw.vwap.push(vwapMetric);
    // Fundamental metrics
    const fm = computeFundamentalMetrics(tkr, bar.c);
    // For ratios where lower is better, invert them before z‑score
    raw.pe_inv.push(fm.pe != null && fm.pe !== 0 ? 1 / fm.pe : 0);
    raw.pb_inv.push(fm.pb != null && fm.pb !== 0 ? 1 / fm.pb : 0);
    raw.de_inv.push(fm.de != null && fm.de !== 0 ? 1 / fm.de : 0);
    raw.fcf_yield.push(fm.fcf_yield != null ? fm.fcf_yield : 0);
    raw.peg_inv.push(fm.peg != null && fm.peg !== 0 ? 1 / fm.peg : 0);
    raw.ps_inv.push(fm.ps != null && fm.ps !== 0 ? 1 / fm.ps : 0);
    raw.roe.push(fm.roe != null ? fm.roe : 0);
    raw.dividend_yield.push(fm.dividend_yield != null ? fm.dividend_yield : 0);
  }
  // Compute z‑scores for each array
  const z = {};
  for (const key of Object.keys(raw)) {
    z[key] = zScores(raw[key]);
  }
  // Build the result array with raw metrics and z‑scores
  const results = [];
  for (let i = 0; i < tickers.length; i++) {
    const score =
      (z.momentum[i] || 0) * (weights.momentum || 0) +
      (z.volatility[i] || 0) * (weights.volatility || 0) +
      (z.volume[i] || 0) * (weights.volume || 0) +
      (z.vwap[i] || 0) * (weights.vwap || 0) +
      (z.pe_inv[i] || 0) * (weights.pe || 0) +
      (z.pb_inv[i] || 0) * (weights.pb || 0) +
      (z.de_inv[i] || 0) * (weights.de || 0) +
      (z.fcf_yield[i] || 0) * (weights.fcf_yield || 0) +
      (z.peg_inv[i] || 0) * (weights.peg || 0) +
      (z.ps_inv[i] || 0) * (weights.ps || 0) +
      (z.roe[i] || 0) * (weights.roe || 0) +
      (z.dividend_yield[i] || 0) * (weights.dividend_yield || 0);
    results.push({
      ticker: tickers[i],
      momentum: raw.momentum[i],
      volatility: raw.volatility[i],
      volume: raw.volume[i],
      vwap: raw.vwap[i],
      pe: raw.pe_inv[i] !== 0 ? 1 / raw.pe_inv[i] : null,
      pb: raw.pb_inv[i] !== 0 ? 1 / raw.pb_inv[i] : null,
      de: raw.de_inv[i] !== 0 ? 1 / raw.de_inv[i] : null,
      fcf_yield: raw.fcf_yield[i],
      peg: raw.peg_inv[i] !== 0 ? 1 / raw.peg_inv[i] : null,
      ps: raw.ps_inv[i] !== 0 ? 1 / raw.ps_inv[i] : null,
      roe: raw.roe[i],
      dividend_yield: raw.dividend_yield[i],
      score
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

module.exports = {
  computeScores,
  loadDaily
};