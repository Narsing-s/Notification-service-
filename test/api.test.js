const { test } = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

let base;
test('health endpoint reports process state without claiming delivery', async (t) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
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

test('unknown API routes return 404', async () => {
  const response = await fetch(base + '/api/v1/not-a-route', { method: 'POST', headers: { 'x-api-key': 'unused' } });
  assert.equal(response.status, 404);
});
