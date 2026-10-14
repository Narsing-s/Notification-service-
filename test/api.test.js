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
  for (const id of ['connectionForm', 'apiBase', 'apiKey', 'testConnection', 'disconnectApi', 'emailForm', 'otpForm', 'smsRecord', 'waRecord', 'activityList', 'activitySearch', 'activityChannel', 'activityStatus', 'exportActivityCsv']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /sessionStorage/);
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
