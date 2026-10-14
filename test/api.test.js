const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
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
