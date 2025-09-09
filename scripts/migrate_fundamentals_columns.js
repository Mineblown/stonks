#!/usr/bin/env node
/*
 * Ensure that the `fundamentals` table contains all columns required by the
 * fundamentals fetcher.  This migration is idempotent: it checks for the
 * presence of each column and adds any that are missing.  It also creates
 * the table if it does not yet exist.  Run this script before
 * scripts/fetchFundamentalsToDb.js when you add new fields to that script.
 */
const path = require('path');
const sqlite3 = require('better-sqlite3');

const db = new sqlite3(path.join(__dirname, '..', 'data', 'quant.db'));

// Fields expected by fetchFundamentalsToDb.js.  Expand this list when
// additional fields are added to the fetcher.
const REQUIRED_COLUMNS = [
  { name: 'ticker', type: 'TEXT' },
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
  { name: 'de', type: 'REAL' },
  // Cash flow fields
  { name: 'operating_cash_flow', type: 'REAL' },
  { name: 'free_cash_flow', type: 'REAL' },
  { name: 'capital_expenditures', type: 'REAL' },
  // Income statement fields
  { name: 'revenue', type: 'REAL' },
  { name: 'ebitda', type: 'REAL' },
  { name: 'net_income', type: 'REAL' },
  // Balance sheet fields
  { name: 'total_assets', type: 'REAL' },
  { name: 'total_liabilities', type: 'REAL' },
  { name: 'total_debt', type: 'REAL' },
  { name: 'total_equity', type: 'REAL' },
  { name: 'shares_outstanding', type: 'REAL' },
  // Margin metrics
  { name: 'gross_margin', type: 'REAL' },
  { name: 'operating_margin', type: 'REAL' },
  { name: 'net_margin', type: 'REAL' },
  { name: 'payout_ratio', type: 'REAL' },
  { name: 'ev_ebitda', type: 'REAL' }
];

function ensureTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS fundamentals (ticker TEXT PRIMARY KEY, updated_at TEXT);`);
}

function existingColumns() {
  return db.prepare(`PRAGMA table_info(fundamentals)`).all().map(row => row.name);
}

function addMissingColumns() {
  const existing = new Set(existingColumns());
  let added = false;
  for (const col of REQUIRED_COLUMNS) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE fundamentals ADD COLUMN ${col.name} ${col.type}`);
      console.log(`Added column '${col.name}'`);
      added = true;
    }
  }
  if (!added) {
    console.log('No columns added; fundamentals table already up to date.');
  } else {
    console.log('Fundamentals schema migration complete.');
  }
}

function main() {
  ensureTable();
  addMissingColumns();
}

main();
