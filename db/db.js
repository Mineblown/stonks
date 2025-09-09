const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Create the data directory if it doesn't exist.  The DB file lives in
// ../data/quant.db relative to this module.
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'quant.db');
const db = new Database(dbPath);

// Set some pragmas to balance durability and performance.  Write‑ahead
// logging mode improves concurrency and crash resistance.  NORMAL
// synchronous mode is typically sufficient for analytics workloads.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

module.exports = db;