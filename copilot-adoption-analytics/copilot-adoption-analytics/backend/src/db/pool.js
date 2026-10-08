const { Pool, types } = require('pg');
require('dotenv').config();

// node-pg returns BIGINT and NUMERIC as strings and DATE as a JS Date (which
// shifts by timezone when serialized). Parse them so the JSON is clean.
types.setTypeParser(20, (v) => parseInt(v, 10));      // BIGINT  (limits, usage id)
types.setTypeParser(1700, (v) => parseFloat(v));      // NUMERIC (per_token_cost)
types.setTypeParser(1082, (v) => v);                  // DATE -> 'YYYY-MM-DD' string

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5433,
      database: process.env.DB_NAME || 'copilot_adoption',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres123'
    });

pool.on('error', (err) => console.error('Unexpected Postgres pool error', err));

module.exports = pool;
