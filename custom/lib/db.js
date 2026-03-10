'use strict';

// DB_TYPE dispatcher
// Set DB_TYPE=postgresql in .env to use PostgreSQL.
// Default: sqlite (uses better-sqlite3, file path controlled by DB_PATH).
//
// PostgreSQL env vars: PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD, PG_SSL
const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();

if (DB_TYPE === 'postgresql') {
  module.exports = require('./db-pg');
} else {
  module.exports = require('./db-sqlite');
}