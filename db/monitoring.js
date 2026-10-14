'use strict';
const { getPool } = require('./connection');

async function getMonitoringSummary() {
  const db = getPool();
  if (!db) {
    const error = new Error('PostgreSQL is not configured; persistent monitoring is unavailable.');
    error.status = 503; error.code = 'database_not_configured'; throw error;
  }
  const result = await db.query(`SELECT
    count(*) FILTER (WHERE status = 'queued' AND next_attempt_at <= now())::int AS queued_due,
    count(*) FILTER (WHERE status = 'processing')::int AS processing,
    count(*) FILTER (WHERE status = 'processing' AND updated_at < now() - interval '5 minutes')::int AS stale_processing,
    count(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter,
    count(*) FILTER (WHERE status = 'failed' AND failed_at >= now() - interval '1 hour')::int AS failed_last_hour
    FROM notifications`);
  const metrics = result.rows[0];
  const backlogThreshold = Math.max(1, Number.parseInt(process.env.QUEUE_BACKLOG_ALERT_THRESHOLD, 10) || 100);
  const deadLetterThreshold = Math.max(1, Number.parseInt(process.env.DEAD_LETTER_ALERT_THRESHOLD, 10) || 1);
  const alerts = [];
  if (metrics.queued_due >= backlogThreshold) alerts.push({
    severity: 'warning', component: 'queue', title: 'Notification queue backlog is high',
    message: metrics.queued_due + ' due notifications are waiting for a worker.',
    fingerprint: 'queue-backlog-high'
  });
  if (metrics.stale_processing > 0) alerts.push({
    severity: 'warning', component: 'worker', title: 'Stale notifications are processing',
    message: metrics.stale_processing + ' notification(s) have remained in processing for over five minutes.',
    fingerprint: 'stale-processing'
  });
  if (metrics.dead_letter >= deadLetterThreshold) alerts.push({
    severity: 'critical', component: 'delivery', title: 'Notifications require dead-letter review',
    message: metrics.dead_letter + ' notification(s) are in the dead-letter queue.',
    fingerprint: 'dead-letter-present'
  });
  for (const alert of alerts) {
    await db.query(`INSERT INTO system_alerts (severity, component, title, message, fingerprint)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (fingerprint) WHERE acknowledged_at IS NULL AND fingerprint IS NOT NULL DO NOTHING`,
    [alert.severity, alert.component, alert.title, alert.message, alert.fingerprint]);
  }
  const open = await db.query(`SELECT id, severity, component, title, message, created_at
    FROM system_alerts WHERE acknowledged_at IS NULL ORDER BY
    CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT 50`);
  return {
    generatedAt: new Date().toISOString(),
    metrics,
    thresholds: { queueBacklogWarning: backlogThreshold, deadLetterCritical: deadLetterThreshold },
    openAlerts: open.rows,
    note: 'Alerts are persisted in PostgreSQL. External email, SMS, or paging dispatch is not configured by this endpoint.'
  };
}
module.exports = { getMonitoringSummary };
