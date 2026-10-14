'use strict';
const { getPool } = require('./connection');

async function getAnalyticsSummary(requestedDays) {
  const db = getPool();
  if (!db) {
    const error = new Error('PostgreSQL is not configured; persistent analytics are unavailable.');
    error.status = 503; error.code = 'database_not_configured'; throw error;
  }
  const parsed = Number.parseInt(requestedDays, 10);
  const days = Math.min(90, Math.max(1, Number.isFinite(parsed) ? parsed : 7));
  const [totals, channels, daily] = await Promise.all([
    db.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE status = 'queued')::int AS queued,
      count(*) FILTER (WHERE status = 'processing')::int AS processing,
      count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
      count(*) FILTER (WHERE status = 'sent')::int AS sent,
      count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('failed','dead_letter'))::int AS failed
      FROM notifications WHERE created_at >= now() - ($1 * interval '1 day')`, [days]),
    db.query(`SELECT channel, status, count(*)::int AS count FROM notifications
      WHERE created_at >= now() - ($1 * interval '1 day')
      GROUP BY channel, status ORDER BY channel, status`, [days]),
    db.query(`SELECT date_trunc('day', created_at)::date AS day,
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('failed','dead_letter'))::int AS failed
      FROM notifications WHERE created_at >= now() - ($1 * interval '1 day')
      GROUP BY date_trunc('day', created_at)::date ORDER BY day`, [days])
  ]);
  const counts = totals.rows[0];
  const completed = counts.delivered + counts.failed;
  return {
    periodDays: days,
    generatedAt: new Date().toISOString(),
    totals: counts,
    deliveryRate: completed ? Number((counts.delivered / completed * 100).toFixed(1)) : null,
    byChannelAndStatus: channels.rows,
    dailyTrend: daily.rows,
    note: 'Metrics are based on persisted queue status. Accepted by a provider is not confirmed delivery; delivery rate is only meaningful when provider receipts update delivered status.'
  };
}
module.exports = { getAnalyticsSummary };
