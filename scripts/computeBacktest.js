#!/usr/bin/env node
/*
 * Backtest a simple ranking strategy.  The strategy recomputes
 * scores every 30 days (calendar days), selects the top N percent
 * of tickers based on the composite score and holds them until the
 * next rebalance.  Within each holding period the portfolio is
 * equally weighted across the selected tickers.  The backtest also
 * calculates the cumulative return of the SPDR S&P 500 ETF (SPY) as
 * a benchmark.
 *
 * The backtest makes no attempt to account for trading costs,
 * liquidity or survivorship bias and should be considered a very
 * simplified demonstration.  All returns are computed from daily
 * closing prices available in the grouped daily files.  See
 * README.md for usage instructions.
 */

const fs = require('fs');
const path = require('path');
const { parseISO, formatISO, addDays, isAfter, isBefore, min: dateMin } = require('date-fns');
const { computeScores, loadDaily } = require('./scoreUtils');

// Helper to load the closing price map for a date.  Returns an
// object mapping ticker symbols to closing prices.
function getCloseMap(dateStr) {
  const daily = loadDaily(dateStr);
  const map = {};
  if (!daily) return map;
  for (const bar of daily) {
    map[bar.T] = bar.c;
  }
  return map;
}

/**
 * Run the backtest.
 *
 * @param {string} startDateStr ISO date string for the start of the backtest.
 * @param {string} endDateStr ISO date string for the end of the backtest.
 * @param {number} topPercent The percentage of tickers to select each rebalance (0–100).
 * @param {object} weights Weight object for computeScores.
 * @returns {{portfolioSeries: Array, spSeries: Array}} Two arrays of objects with
 *          the cumulative portfolio and SPY values for each date.
 */
function computeBacktest(startDateStr, endDateStr, topPercent, weights) {
  const startDate = parseISO(startDateStr);
  const endDate = parseISO(endDateStr);
  // Validate inputs
  if (isAfter(startDate, endDate)) {
    throw new Error('Start date must be on or before end date');
  }
  const topPct = topPercent / 100;
  const portfolioSeries = [];
  const spSeries = [];
  let portfolioValue = 1.0;
  let spValue = 1.0;
  let currentDate = startDate;
  // We'll store previous day's close map to compute returns
  let prevCloseMap = null;
  let prevSpClose = null;
  // Loop until the entire range is covered
  while (!isAfter(currentDate, endDate)) {
    const dateStr = formatISO(currentDate, { representation: 'date' });
    // At the beginning of each rebalance period we compute new scores
    let selectedTickers = [];
    try {
      const scores = computeScores(dateStr, weights);
      const total = scores.length;
      const count = Math.max(1, Math.floor(total * topPct));
      selectedTickers = scores.slice(0, count).map((r) => r.ticker);
    } catch (err) {
      // Missing daily file, skip to next day
      currentDate = addDays(currentDate, 1);
      continue;
    }
    // Determine the next rebalance date: 30 days later or endDate
    const rebalanceEnd = dateMin(addDays(currentDate, 30), endDate);
    let day = currentDate;
    while (!isAfter(day, rebalanceEnd)) {
      const dStr = formatISO(day, { representation: 'date' });
      const closeMap = getCloseMap(dStr);
      const spClose = closeMap['SPY'];
      if (prevCloseMap && Object.keys(prevCloseMap).length > 0) {
        // Compute portfolio return as average of ticker returns
        let sumRet = 0;
        let count = 0;
        for (const t of selectedTickers) {
          const prevC = prevCloseMap[t];
          const c = closeMap[t];
          if (prevC != null && c != null && prevC !== 0) {
            sumRet += (c - prevC) / prevC;
            count++;
          }
        }
        const portRet = count > 0 ? sumRet / count : 0;
        portfolioValue *= 1 + portRet;
        // Compute SPY return
        if (prevSpClose != null && spClose != null && prevSpClose !== 0) {
          const spRet = (spClose - prevSpClose) / prevSpClose;
          spValue *= 1 + spRet;
        }
        portfolioSeries.push({ date: dStr, value: portfolioValue });
        spSeries.push({ date: dStr, value: spValue });
      }
      prevCloseMap = closeMap;
      prevSpClose = spClose;
      day = addDays(day, 1);
    }
    // Move to the day after the rebalance end for the next iteration
    currentDate = addDays(rebalanceEnd, 1);
  }
  return { portfolioSeries, spSeries };
}

// If the script is executed directly, perform the backtest and save results
if (require.main === module) {
  const start = process.argv[2];
  const end = process.argv[3];
  const top = process.argv[4] ? parseFloat(process.argv[4]) : 20;
  if (!start || !end) {
    console.error('Usage: node scripts/computeBacktest.js <start-date> <end-date> [top-percent]');
    process.exit(1);
  }
  // Load weights
  const weightsPath = path.join(__dirname, '..', 'config', 'weights.json');
  let weights;
  try {
    weights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  } catch (err) {
    console.error('Unable to read weights from', weightsPath, err.message);
    process.exit(1);
  }
  try {
    const result = computeBacktest(start, end, top, weights);
    const outDir = path.join(__dirname, '..', 'data', 'backtest');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `backtest_${start}_${end}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`Backtest results saved to ${outPath}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = computeBacktest;