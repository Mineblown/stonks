#!/usr/bin/env node
/*
 * Compute quant scores for a single date and write them to disk.
 *
 * Usage:
 *   node scripts/computeScores.js YYYY-MM-DD
 *
 * The script reads the daily aggregate file from `data/daily/YYYY-MM-DD.json`,
 * computes a set of simple metrics for each ticker and combines them into a
 * single score using weights defined in `config/weights.json`.  It writes
 * the results to `data/scores/YYYY-MM-DD.json`.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const { computeScores } = require('./scoreUtils');

// Read date argument
const dateArg = process.argv[2];
if (!dateArg) {
  console.error('Usage: node scripts/computeScores.js <YYYY-MM-DD>');
  process.exit(1);
}
// Load weights from config
const weightsPath = path.join(__dirname, '..', 'config', 'weights.json');
let weights;
try {
  weights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
} catch (err) {
  console.error('Unable to read weights from', weightsPath, err.message);
  process.exit(1);
}

try {
  const results = computeScores(dateArg, weights);
  const outDir = path.join(__dirname, '..', 'data', 'scores');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${dateArg}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`Scores written to ${outPath}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}