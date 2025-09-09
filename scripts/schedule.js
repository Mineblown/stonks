#!/usr/bin/env node
/*
 * Simple scheduler to run autoRunner.js on a fixed interval. The schedule
 * interval is currently set to 30 minutes. On startup it immediately
 * executes autoRunner.js once, then schedules subsequent runs. If you wish
 * to adjust the interval (e.g. to 15 minutes), modify the setInterval
 * argument below. This scheduler relies on the environment variable
 * RUN_SCHEDULER being set (and truthy) when the server starts. See
 * server.js for how this is invoked.
 */

const { spawn } = require('child_process');
const path = require('path');

function runJob() {
  const child = spawn('node', ['scripts/autoRunner.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  child.on('exit', code => {
    if (code !== 0) {
      console.error(`[scheduler] autoRunner exited with code ${code}`);
    }
  });
}

// Kick off immediately
runJob();

// Run every 30 minutes (1800 seconds)
setInterval(runJob, 30 * 60 * 1000);