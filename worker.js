'use strict';
// Durable PostgreSQL queue worker. Run separately from the HTTP API with: npm run worker
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000,
  application_name: 'nexus-notify-worker'
}) : null;
let mailer;
function emailTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) return null;
  if (!mailer) {
    const port = Number(process.env.SMTP_PORT || 587);
    mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port,
      secure: String(process.env.SMTP_SECURE || (port === 465)).toLowerCase() === 'true',
      requireTLS: port !== 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      disableFileAccess: true, disableUrlAccess: true
    });
  }
  return mailer;
}
async function claimOne() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query(
      "SELECT id, channel, recipient, subject, body, attempts, max_attempts FROM notifications WHERE ((status = 'queued' AND next_attempt_at <= now()) OR (status = 'processing' AND updated_at < now() - interval '5 minutes')) ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1"
    );
    if (!selected.rows[0]) { await client.query('COMMIT'); return null; }
    const row = selected.rows[0];
    const attempt = Number(row.attempts) + 1;
    await client.query("UPDATE notifications SET status = 'processing', attempts = $2, updated_at = now() WHERE id = $1", [row.id, attempt]);
    await client.query("INSERT INTO delivery_attempts (notification_id, attempt_number, outcome) VALUES ($1, $2, 'started') ON CONFLICT (notification_id, attempt_number) DO NOTHING", [row.id, attempt]);
    await client.query('COMMIT');
    return { ...row, attempts: attempt };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function deliver(row) {
  if (row.channel === 'email') {
    const transport = emailTransport();
    if (!transport) throw Object.assign(new Error('Email provider is not configured'), { code: 'email_not_configured', permanent: true });
    const result = await transport.sendMail({ from: process.env.SMTP_FROM, to: row.recipient, subject: row.subject, text: row.body });
    return { providerMessageId: result.messageId || null, providerStatus: 'accepted_by_smtp' };
  }
  const isSms = row.channel === 'sms';
  const endpoint = process.env[isSms ? 'SMS_GATEWAY_URL' : 'WHATSAPP_GATEWAY_URL'];
  const token = process.env[isSms ? 'SMS_GATEWAY_TOKEN' : 'WHATSAPP_GATEWAY_TOKEN'];
  if (!endpoint) throw Object.assign(new Error('Message gateway is not configured'), { code: 'channel_not_configured', permanent: true });
  let url;
  try { url = new URL(endpoint); } catch { throw Object.assign(new Error('Message gateway configuration is invalid'), { code: 'invalid_gateway_config', permanent: true }); }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw Object.assign(new Error('Production gateway must use HTTPS'), { code: 'insecure_gateway_config', permanent: true });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify({ to: row.recipient, text: row.body, ...(row.channel === 'whatsapp' ? {} : {}), messageId: row.id }),
      signal: controller.signal
    });
    if (!response.ok) throw Object.assign(new Error('Message gateway rejected the request'), {
      code: 'gateway_http_' + response.status,
      permanent: response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
    });
    let responseBody = {};
    try { responseBody = await response.json(); } catch {}
    return { providerMessageId: responseBody.messageId || responseBody.providerMessageId || null, providerStatus: 'accepted_by_gateway' };
  } catch (error) {
    if (error.code || error.permanent) throw error;
    throw Object.assign(new Error('Message gateway request failed'), { code: error.name === 'AbortError' ? 'gateway_timeout' : 'gateway_unreachable' });
  } finally { clearTimeout(timeout); }
}
async function recordSuccess(row, result) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE notifications SET status = 'accepted', provider_message_id = $2, accepted_at = now(), updated_at = now(), last_error_code = NULL, last_error_message = NULL WHERE id = $1", [row.id, result.providerMessageId]);
    await client.query("UPDATE delivery_attempts SET outcome = 'accepted', provider_status = $3, finished_at = now() WHERE notification_id = $1 AND attempt_number = $2", [row.id, row.attempts, result.providerStatus]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
async function recordFailure(row, error) {
  const permanent = Boolean(error.permanent);
  const exhausted = permanent || row.attempts >= Number(row.max_attempts);
  const status = exhausted ? 'dead_letter' : 'queued';
  const delaySeconds = Math.min(3600, 15 * (2 ** Math.min(row.attempts - 1, 8)));
  const code = String(error.code || 'provider_error').slice(0, 80);
  const message = String(error.message || 'Provider request failed').slice(0, 300);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE notifications SET status = $2, next_attempt_at = CASE WHEN $2 = 'queued' THEN now() + ($3 * interval '1 second') ELSE next_attempt_at END, failed_at = CASE WHEN $2 = 'dead_letter' THEN now() ELSE failed_at END, last_error_code = $4, last_error_message = $5, updated_at = now() WHERE id = $1", [row.id, status, delaySeconds, code, message]);
    await client.query("UPDATE delivery_attempts SET outcome = $3, error_code = $4, error_message = $5, finished_at = now() WHERE notification_id = $1 AND attempt_number = $2", [row.id, row.attempts, exhausted ? 'permanent_error' : 'retryable_error', code, message]);
    await client.query('COMMIT');
  } catch (dbError) { await client.query('ROLLBACK').catch(() => {}); throw dbError; }
  finally { client.release(); }
}
async function main() {
  if (!pool) throw new Error('DATABASE_URL is required to run the durable notification worker.');
  await pool.query('SELECT 1');
  console.log('Nexus Notify worker started; message bodies and credentials are not logged.');
  const pollMs = Math.max(250, Number(process.env.WORKER_POLL_MS || 1000));
  while (true) {
    let row;
    try { row = await claimOne(); }
    catch (error) {
      console.error('Queue claim failed:', error.code || 'database_error');
      await sleep(pollMs); continue;
    }
    if (!row) { await sleep(pollMs); continue; }
    try {
      const result = await deliver(row);
      await recordSuccess(row, result);
    } catch (error) {
      try { await recordFailure(row, error); }
      catch (dbError) { console.error('Queue result could not be saved:', dbError.code || 'database_error'); }
    }
  }
}
if (require.main === module) {
  main().catch(async error => {
    console.error('Worker could not start:', error.code || 'configuration_error', error.message);
    if (pool) await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}
module.exports = { claimOne, deliver, recordSuccess, recordFailure };
