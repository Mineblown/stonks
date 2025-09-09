#!/usr/bin/env node
/*
 * Robust auto-runner for StonksFYI.
 * This script processes the current trading day by fetching daily bars,
 * computing scores and refreshing the universe snapshot.  It logs warnings
 * instead of exiting when a step fails.  Intended to be run on a 30‑minute
 * schedule by your process manager (e.g. pm2).
 */
const { spawnSync } = require('child_process');
const path = require('path');

function runStep(label, args) {
  const result = spawnSync('node', args, {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.warn(`warn: ${label} failed with exit code ${result.status}`);
  }
}

function main() {
  // Determine the date to process: today's date in UTC.
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[AutoRunner] Processing ${today}`);
  // Step 1: fetch daily bars
  runStep('fetchDailyDataToDb', ['scripts/fetchDailyDataToDb.js', today]);
  // Step 2: compute scores
  runStep('computeScoresToDb', ['scripts/computeScoresToDb.js', today]);
  // Step 3: refresh universe snapshot
  runStep('updateUniverseFromReference', ['scripts/updateUniverseFromReference.js']);
  console.log(`[AutoRunner] Done for ${today}`);
}

main();
