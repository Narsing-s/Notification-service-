'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required. Copy .env.example to a private environment file and configure your PostgreSQL connection there.');
    process.exitCode = 1;
    return;
  }
  const client = new Client({
    connectionString,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000
  });
  try {
    await client.connect();
    await client.query('BEGIN');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await client.query(schema);
    await client.query('COMMIT');
    console.log('Nexus Notify database schema is up to date.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Database migration failed:', error.code || 'database_error', error.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(error => {
  console.error('Migration runner failed:', error.message);
  process.exitCode = 1;
});
