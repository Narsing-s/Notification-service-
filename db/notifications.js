'use strict';
const { getPool } = require('./connection');

function queueUnavailable() {
  const error = new Error('PostgreSQL is not configured; persistent notification storage is unavailable.');
  error.status = 503;
  error.code = 'database_not_configured';
  return error;
}

async function enqueueNotification(input, idempotencyKey) {
  const db = getPool();
  if (!db) throw queueUnavailable();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('A JSON object is required.'), { status: 400, code: 'validation_error' });
  const channel = input.channel;
  if (!['email', 'sms', 'whatsapp'].includes(channel)) throw Object.assign(new Error('channel must be email, sms, or whatsapp.'), { status: 400, code: 'validation_error' });
  if (typeof input.to !== 'string' || !input.to.trim() || input.to.length > 254) throw Object.assign(new Error('A valid recipient is required.'), { status: 400, code: 'validation_error' });
  if (channel === 'email' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) || typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 200)) throw Object.assign(new Error('Email requires a valid recipient and subject (max 200 characters).'), { status: 400, code: 'validation_error' });
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 10000) throw Object.assign(new Error('text is required and must be at most 10000 characters.'), { status: 400, code: 'validation_error' });
  const key = idempotencyKey || require('node:crypto').randomUUID();
  if (key.length > 200) throw Object.assign(new Error('Idempotency key must be at most 200 characters.'), { status: 400, code: 'validation_error' });
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
  if (!Number.isFinite(scheduledAt.getTime())) throw Object.assign(new Error('scheduledAt must be a valid date.'), { status: 400, code: 'validation_error' });
  const inserted = await db.query("INSERT INTO notifications (channel, recipient, subject, body, status, idempotency_key, scheduled_at, next_attempt_at, metadata) VALUES ($1, $2, $3, $4, 'queued', $5, $6, $6, $7::jsonb) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id, channel, status, scheduled_at, created_at", [channel, input.to.trim(), channel === 'email' ? input.subject.trim() : null, input.text, key, scheduledAt.toISOString(), JSON.stringify({ source: 'api' })]);
  if (inserted.rows[0]) return { ...inserted.rows[0], duplicate: false };
  const existing = await db.query('SELECT id, channel, status, scheduled_at, created_at FROM notifications WHERE idempotency_key = $1', [key]);
  if (!existing.rows[0]) throw Object.assign(new Error('Could not confirm queued notification state; retry using the same idempotency key.'), { status: 503, code: 'queue_write_uncertain' });
  return { ...existing.rows[0], duplicate: true };
}

async function getNotification(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const db = getPool();
  if (!db) throw queueUnavailable();
  const result = await db.query('SELECT id, channel, status, provider_message_id, attempts, max_attempts, scheduled_at, accepted_at, sent_at, delivered_at, failed_at, last_error_code, created_at, updated_at FROM notifications WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function listNotifications(query = {}) {
  const db = getPool();
  if (!db) throw queueUnavailable();
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const status = typeof query.status === 'string' && /^[a-z_]{3,30}$/.test(query.status) ? query.status : null;
  const result = await db.query('SELECT id, channel, status, provider_message_id, attempts, max_attempts, scheduled_at, accepted_at, sent_at, delivered_at, failed_at, last_error_code, created_at, updated_at FROM notifications WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3', [status, limit, offset]);
  return { items: result.rows, limit, offset };
}
module.exports = { enqueueNotification, getNotification, listNotifications };
