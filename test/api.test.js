const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { server } = require('../server');

let base;
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
});

test('health endpoint reports process state without claiming delivery', async () => {
  const response = await fetch(base + '/api/v1/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'online');
  assert.match(body.note, /not a delivery guarantee/i);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
});

test('send endpoints require an API key', async () => {
  const response = await fetch(base + '/api/v1/email/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'person@example.com', subject: 'Test', text: 'Test' })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthorized');
});

test('API routes remain protected when no API secret is configured', async () => {
  const response = await fetch(base + '/api/v1/not-a-route', { method: 'POST', headers: { 'x-api-key': 'unused' } });
  assert.equal(response.status, 401);
});

test('dashboard JavaScript parses and core connection controls exist', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scriptStart = html.indexOf('<script>');
  const scriptEnd = html.lastIndexOf('</script>');
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, 'dashboard script exists');
  assert.doesNotThrow(() => new vm.Script(html.slice(scriptStart + 8, scriptEnd)));
  for (const id of ['connectionForm', 'apiBase', 'apiKey', 'toggleApiKey', 'testConnection', 'disconnectApi', 'emailForm', 'otpForm', 'smsRecord', 'waRecord', 'activityList', 'activitySearch', 'activityChannel', 'activityStatus', 'exportActivityCsv', 'themeToggle', 'emailTemplate', 'smsTemplate', 'waTemplate']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /sessionStorage/);
  assert.match(html, /function applyTheme/);
  assert.match(html, /function applyTemplate/);
  assert.equal(html.includes('localStorage.setItem(SESSION_API'), false);
});

test('CORS preflight allows only a configured dashboard origin', async () => {
  const origin = 'https://dashboard.example.test';
  process.env.CORS_ORIGIN = origin;
  try {
    const response = await fetch(base + '/api/v1/email/send', {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-api-key' }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(response.headers.get('access-control-allow-headers') || '', /X-API-Key/i);
  } finally {
    delete process.env.CORS_ORIGIN;
  }
});

test('dashboard exposes browser-local custom templates and live character counts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /nexus-notify-custom-templates-v1/);
  assert.match(html, /Save current message as a reusable template/);
  assert.match(html, /Delete selected/);
  assert.match(html, /characters/);
  assert.match(html, /Saved templates stay in this browser only|Your custom templates stay in this browser only/);
  assert.match(html, /function renderSaved/);
  assert.match(html, /near-limit/);
});

test('PWA shell is installable and never caches API responses', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /id="installApp"/);
  assert.match(html, /serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.equal(JSON.parse(manifest).display, 'standalone');
  assert.match(manifest, /nexus-icon\.svg/);
  assert.ok(worker.includes('api\\//i'), 'service worker must explicitly bypass API routes');
  assert.match(worker, /request\.method !== 'GET'/);
});

test('dashboard API requests have bounded timeouts and API key visibility control', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /setTimeout\(\(\)=>controller\.abort\(\),15000\)/);
  assert.match(html, /setTimeout\(\(\)=>controller\.abort\(\),8000\)/);
  assert.match(html, /aria-label="Show API key"/);
  assert.match(html, /keyToggle\.setAttribute\('aria-pressed'/);
  assert.match(html, /sessionStorage\.setItem\(SESSION_API/);
  assert.equal(html.includes('localStorage.setItem(SESSION_API'), false);
});


test('workspace backup and restore are user-friendly and never export API credentials', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['exportWorkspace', 'importWorkspace', 'workspaceBackupFile', 'backupMsg']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /Safe workspace backup\/restore/);
  assert.match(html, /API keys and credentials were excluded/);
  assert.match(html, /maximum 1 MB/);
  assert.match(html, /formatVersion:backupVersion/);
  assert.match(html, /will replace local history, preferences, theme and saved templates/);
  assert.match(html, /API connection settings will not be changed/);
  assert.match(html, /sessionStorage and all API credentials/);
});

test('repository environment example contains placeholders, not live provider secrets', () => {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.match(env, /NEXUS_API_KEY=replace-with-a-long-random-secret/);
  assert.match(env, /SMTP_PASS=replace-with-smtp-password/);
  assert.doesNotMatch(env, /(?:sk_live_|ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', '.env')), false);
});


test('channel character limits match the backend and live OTP explains its fixed expiry', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="smsBody" maxlength="1600"/);
  assert.match(html, /id="waBody" maxlength="4096"/);
  assert.match(html, /function updateOtpMode\(\)/);
  assert.match(html, /server enforces a fixed 5-minute expiry/);
  assert.match(html, /Send verification code by email/);
});

test('server bounds rate-limit memory and configures HTTP timeouts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /rate\.size >= 10000/);
  assert.match(source, /server\.requestTimeout = 30000/);
  assert.match(source, /server\.headersTimeout = 10000/);
  assert.match(source, /server\.keepAliveTimeout = 5000/);
});


test('OTP persistence removes expired or malformed records and caps stored records', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /const MAX_OTP_RECORDS = 10000/);
  assert.match(source, /entry\.expiresAt <= now/);
  assert.match(source, /keys\.length > MAX_OTP_RECORDS/);
  assert.match(source, /delete value\[key\]/);
});


test('API validates JSON content type and provides actionable rate-limit retry guidance', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /contentType !== 'application\/json'/);
  assert.match(source, /unsupported_media_type/);
  assert.match(source, /res\.setHeader\('Retry-After', '60'\)/);
  assert.match(source, /Wait at least 60 seconds before retrying/);
});


test('API responses include a request correlation ID for troubleshooting', async () => {
  const response = await fetch(base + '/api/v1/health');
  const requestId = response.headers.get('x-request-id');
  assert.ok(requestId);
  assert.match(requestId, /^[0-9a-f-]{36}$/i);
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /res\.setHeader\('X-Request-Id', crypto\.randomUUID\(\)\)/);
});


test('PostgreSQL schema includes durable queue, delivery history, roles, preferences and monitoring tables', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  for (const table of ['app_users', 'notification_preferences', 'notifications', 'delivery_attempts', 'notification_templates', 'audit_events', 'system_alerts', 'schema_migrations']) {
    assert.match(schema, new RegExp('CREATE TABLE IF NOT EXISTS ' + table + '\\b'));
  }
  assert.match(schema, /idempotency_key text UNIQUE/);
  assert.match(schema, /next_attempt_at timestamptz/);
  assert.ok(schema.includes("status IN ('queued','processing','accepted','sent','delivered','failed','cancelled','dead_letter')"));
  assert.ok(schema.includes("role IN ('owner','admin','operator','viewer')"));
  assert.match(schema, /quiet_hours_enabled boolean/);
  assert.match(schema, /CREATE INDEX IF NOT EXISTS notifications_status_next_attempt_idx/);
});

test('database migration runner requires configuration and never contains credentials', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate.js'), 'utf8');
  const env = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  assert.ok(runner.includes('if (!connectionString)'));
  assert.match(runner, /BEGIN/);
  assert.match(runner, /ROLLBACK/);
  assert.ok(env.includes('DATABASE_URL=postgresql://USER:PASSWORD@HOST'));
  assert.doesNotMatch(env, /postgres(?:ql)?:\\/\\/[^\s:]+:[^\s@]{8,}@[^\s]+/);
});
