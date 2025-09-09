#!/usr/bin/env node
/*
 * Initialize the SQLite database by executing the schema.  This script
 * reads the DDL from `db/schema.sql` and runs it against the DB
 * specified in `db/db.js`.  If the schema has already been applied,
 * the statements are idempotent and have no effect.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

try {
  db.exec(schema);
  console.log('Database schema initialized.');
} catch (err) {
  console.error('Failed to initialize schema:', err.message);
  process.exit(1);
}