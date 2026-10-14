'use strict';
const { Pool } = require('pg');

let pool;
function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
function getPool() {
  if (!databaseConfigured()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
      max: Number(process.env.PGPOOL_MAX || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      application_name: 'nexus-notify'
    });
    pool.on('error', () => {
      // Never log connection strings, provider payloads or credentials.
    });
  }
  return pool;
}
async function checkDatabase() {
  const db = getPool();
  if (!db) return { configured: false, status: 'not_configured' };
  try {
    await db.query('SELECT 1');
    return { configured: true, status: 'connected' };
  } catch (error) {
    return { configured: true, status: 'unavailable', code: error.code || 'database_error' };
  }
}
async function closeDatabase() {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}
module.exports = { databaseConfigured, getPool, checkDatabase, closeDatabase };
