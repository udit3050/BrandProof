'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');

let server, base;
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const login = async (role) => (await call('POST', '/api/login', null, { email: `${role}@demo.com`, password: 'demo1234' })).body.token;

test.before(async () => {
  server = createApp({ dataFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp-')), 'db.json') });
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

const SAMPLE = 'Nimbus Pay is the #1 fastest way to pay!! Our users get guaranteed cashback of 5% on EVERY order.';

test('auth: bad password rejected, API needs a token', async () => {
  assert.strictEqual((await call('POST', '/api/login', null, { email: 'creator@demo.com', password: 'nope' })).status, 401);
  assert.strictEqual((await call('GET', '/api/submissions')).status, 401);
});
test('end-to-end workflow with red-lane gating', async () => {
  const creator = await login('creator'), manager = await login('manager'), reviewer = await login('reviewer');
  const intent = (await call('POST', '/api/intent/suggest', creator, { content: SAMPLE })).body;
  const c = await call('POST', '/api/submissions', creator, { title: 'Launch post', content: SAMPLE, intent });
  assert.strictEqual(c.status, 200); assert.strictEqual(c.body.lane, 'red');
  const id = c.body.id;
  // creator cannot dismiss a red finding
  const red = c.body.findings.find((f) => f.lane === 'red');
  assert.strictEqual((await call('POST', `/api/submissions/${id}/findings/${red.id}/dismiss`, creator, { reason: 'looks fine to me' })).status, 403);
  // submit, then manager cannot approve with open red findings
  assert.strictEqual((await call('POST', `/api/submissions/${id}/submit`, creator)).status, 200);
  assert.strictEqual((await call('POST', `/api/submissions/${id}/decision`, manager, { decision: 'approve' })).status, 403);
  // reviewer needs a written reason
  assert.strictEqual((await call('POST', `/api/submissions/${id}/decision`, reviewer, { decision: 'approve' })).status, 400);
  const ok = await call('POST', `/api/submissions/${id}/decision`, reviewer, { decision: 'approve', overrideReason: 'Legal confirmed wording offline' });
  assert.strictEqual(ok.status, 200); assert.strictEqual(ok.body.status, 'approved');
  assert.ok(ok.body.audit.some((a) => a.action === 'approved_with_override'));
});
test('accepting suggested fixes creates versions and clears findings', async () => {
  const creator = await login('creator');
  const c = await call('POST', '/api/submissions', creator, { title: 'Fix me', content: 'Our users love Nimbus Pay!! Click here.', intent: { mustKeep: ['Nimbus Pay'] } });
  let s = c.body; const before = s.findings.filter((f) => f.status === 'open').length; assert.ok(before >= 3);
  for (let i = 0; i < 6; i++) {
    const f = s.findings.find((x) => x.status === 'open' && x.suggestion);
    if (!f) break;
    s = (await call('POST', `/api/submissions/${s.id}/findings/${f.id}/accept`, creator)).body;
  }
  assert.strictEqual(s.findings.filter((x) => x.status === 'open').length, 0);
  assert.strictEqual(s.content, 'Our customers love Nimbus Pay! Learn more.');
  assert.ok(s.versions.length > 3);
});
test('dismissal needs a reason, persists across re-review, and shows up in insights', async () => {
  const creator = await login('creator'), manager = await login('manager');
  const c = await call('POST', '/api/submissions', creator, { title: 'Tone', content: 'Our users are great.', intent: {} });
  const f = c.body.findings.find((x) => x.rule === 'terminology');
  assert.strictEqual((await call('POST', `/api/submissions/${c.body.id}/findings/${f.id}/dismiss`, creator, { reason: 'x' })).status, 400);
  const d = await call('POST', `/api/submissions/${c.body.id}/findings/${f.id}/dismiss`, creator, { reason: 'Quoting a user survey' });
  assert.strictEqual(d.body.findings.find((x) => x.id === f.id).status, 'dismissed');
  const e = await call('PUT', `/api/submissions/${c.body.id}/content`, creator, { content: 'Our users are great. Thanks.' });
  assert.strictEqual(e.body.findings.find((x) => x.rule === 'terminology').status, 'dismissed');
  const ins = await call('GET', '/api/insights', manager);
  assert.ok(ins.body.rules.find((r) => r.rule === 'terminology').dismissed >= 1);
  assert.strictEqual((await call('GET', '/api/insights', creator)).status, 403);
});
test('only admin can edit the Brand Brain; creators only see their own submissions', async () => {
  const creator = await login('creator'), admin = await login('admin');
  assert.strictEqual((await call('PUT', '/api/brain/clauses/X-9', creator, { section: 'S', text: 'T' })).status, 403);
  assert.strictEqual((await call('PUT', '/api/brain/clauses/X-9', admin, { section: 'S', text: 'T' })).status, 200);
  const list = (await call('GET', '/api/submissions', creator)).body;
  assert.ok(list.every((s) => s.ownerName === 'Demo Creator'));
});
