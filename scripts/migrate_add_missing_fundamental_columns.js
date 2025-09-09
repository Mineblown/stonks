#!/usr/bin/env node
// Adds any missing columns expected by fetchFundamentalsToDb.js into the
// `fundamentals` table. Safe to run multiple times (idempotent).

const path = require('path');
const sqlite3 = require('better-sqlite3');

// Path to the SQLite database file. Adjust the relative path if your project
// stores quant.db elsewhere. When run from the project root or from the
// scripts directory, this resolves correctly.
const dbPath = path.join(__dirname, '..', 'data', 'quant.db');
const db = new sqlite3(dbPath);

// List of columns the fundamentals table should include. As the project
// evolves and additional fundamental ratios are added, update this list.
const REQUIRED_COLUMNS = [
  { name: 'ticker', type: 'TEXT' }, // primary key
  { name: 'updated_at', type: 'TEXT' },
  { name: 'fiscal_year', type: 'INTEGER' },
  { name: 'fiscal_period', type: 'TEXT' },
  { name: 'pe', type: 'REAL' },
  { name: 'pb', type: 'REAL' },
  { name: 'ps', type: 'REAL' },
  { name: 'peg', type: 'REAL' },
  { name: 'roe', type: 'REAL' },
  { name: 'fcf_yield', type: 'REAL' },
  { name: 'dividend_yield', type: 'REAL' },
  { name: 'de', type: 'REAL' }
];

// Create the fundamentals table with a minimal schema if it doesn't exist.
function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fundamentals (
      ticker TEXT PRIMARY KEY,
      updated_at TEXT
    );
  `);
}

// Return a set of existing column names for a table.
function getExistingColumns(tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(rows.map(row => row.name));
}

// Add missing columns according to REQUIRED_COLUMNS.
function addMissingColumns(tableName, columns) {
  const existing = getExistingColumns(tableName);
  for (const col of columns) {
    if (!existing.has(col.name)) {
      const sql = `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`;
      console.log(`Adding column ${col.name} to ${tableName}`);
      db.exec(sql);
    }
  }
}

function main() {
  ensureTable();
  addMissingColumns('fundamentals', REQUIRED_COLUMNS);
  console.log('Fundamentals table ensured with required columns.');
}

main();