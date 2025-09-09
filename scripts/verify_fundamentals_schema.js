#!/usr/bin/env node
// verify_fundamentals_schema.js
// Prints the fundamentals table columns to verify migration.
const path = require('path');
const sqlite3 = require('better-sqlite3');
const db = new sqlite3(path.join(__dirname, '..', 'data', 'quant.db'));
const cols = db.prepare('PRAGMA table_info(fundamentals)').all();
console.log('fundamentals columns:');
for (const c of cols) console.log('-', c.name, c.type);
