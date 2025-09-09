#!/usr/bin/env node
// Backfill a range of trading days using Node (no bash date dependency).
// Usage: node scripts/backfillRange.js 2020-01-01 2025-09-08
const { spawnSync } = require('child_process');
const path = require('path');

function run(cmd, args){
  const r = spawnSync(cmd, args, { cwd: path.join(__dirname,'..'), stdio:'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

function* days(start, end){
  const s = new Date(start);
  const e = new Date(end);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate()+1)){
    const dow = d.getDay(); // 0 Sun .. 6 Sat
    if (dow!==0 && dow!==6) yield d.toISOString().slice(0,10);
  }
}

(function main(){
  const start = process.argv[2];
  const end = process.argv[3];
  if (!start || !end){
    console.error('Usage: node scripts/backfillRange.js YYYY-MM-DD YYYY-MM-DD');
    process.exit(1);
  }
  for (const day of days(start, end)){
    console.log('==', day, '==');
    run('node', ['scripts/fetchDailyDataToDb.js', day]);
    run('node', ['scripts/computeScoresToDb.js', day]);
  }
  try { run('node', ['scripts/updateUniverseFromReference.js']); } catch {}
  console.log('Backfill done.');
})();
