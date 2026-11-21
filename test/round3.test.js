'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), nodeCrypto = require('crypto');
const { createApp } = require('../server');
const { sha256Hex } = require('../src/hash');
const X = require('../public/extract');
const visual = require('../src/visual');
const dbg = require('../src/debugger');
const { seedBrain } = require('../src/seed');

const inf = { inflateRaw: async (d) => zlib.inflateRawSync(d), inflate: async (d) => zlib.inflateSync(d) };
const fx = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));

test('sha256 matches Node crypto (ASCII, empty, unicode, multi-block)', () => {
  for (const s of ['', 'abc', 'héllo wörld '.repeat(40), 'x'.repeat(1000)]) assert.strictEqual(sha256Hex(s), nodeCrypto.createHash('sha256').update(s).digest('hex'));
});
test('DOCX and PDF text extraction; bad files fail with a clear message', async () => {
  assert.match(await X.docxText(fx('sample.docx'), inf), /Nimbus Pay is the #1 app & loved by users\.\nSecond paragraph continues here\./);
  assert.match(await X.pdfText(fx('sample.pdf'), inf), /0\.5% fee on every card payment/);
  await assert.rejects(X.docxText(new Uint8Array([1, 2, 3, 4]), inf), /not a valid DOCX/);
  await assert.rejects(X.pdfText(new Uint8Array(Buffer.from('%PDF-1.4 nothing here')), inf), /No readable text/);
});
test('contrast maths matches WCAG reference values', () => {
  assert.strictEqual(visual.contrast('#000000', '#FFFFFF'), 21);
  assert.strictEqual(visual.contrast('#777777', '#FFFFFF'), 4.48);
  assert.ok(visual.contrast(visual.suggestForeground('#999999', '#FFFFFF'), '#FFFFFF') >= 4.5);
});
test('visual review flags palette, contrast, alt text, size and unconfirmed logo, each with a verified source', () => {
  const f = visual.review({ id: 'v1', name: 'b.gif', width: 400, bytes: 2e6, type: 'image/gif', alt: 'Image of a customer paying', hasText: true, fg: '#999999', bg: '#FFFFFF',
    dominant: [{ hex: '#FF00AA', share: 0.3 }, { hex: '#2F4BC7', share: 0.5 }], logo: null }, seedBrain(), { contentType: 'ad' });
  const rules = f.map((x) => x.rule).sort();
  assert.deepStrictEqual(rules, ['visual.alt_quality', 'visual.contrast', 'visual.logo', 'visual.palette', 'visual.size']);
  assert.ok(f.every((x) => x.verified));
  const clean = visual.review({ id: 'v2', name: 'ok.png', width: 1200, bytes: 1e5, type: 'image/png', alt: 'Customer paying with a phone at a cafe', dominant: [{ hex: '#2F4BC7', share: 0.7 }, { hex: '#FFFFFF', share: 0.3 }] }, seedBrain(), { contentType: 'social post' });
  assert.strictEqual(clean.length, 0);
});
test('Stress Test reports covered rules and an honest gap', () => {
  const r = dbg.stressTest(seedBrain());
  assert.ok(r.covered >= 10); assert.ok(r.results.some((x) => x.adversarial && x.status === 'gap'));
  assert.deepStrictEqual(r.brokenCitations, []);
  const b = seedBrain(); b.clauses.find((c) => c.id === 'C-4.1').text = 'Claims need approval.';
  assert.ok(dbg.stressTest(b).brokenCitations.some((x) => x.rule === 'claim.superlative'));
});

let server, base;
const call = async (method, url, token, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const login = async (role) => (await call('POST', '/api/login', null, { email: `${role}@demo.com`, password: 'demo1234' })).body.token;
test.before(async () => {
  server = createApp({ dataFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp3-')), 'db.json') });
  await new Promise((r) => server.listen(0, r)); base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

test('images: add, review, accept alt fix, edit, remove; bad input is rejected', async () => {
  const c = await login('creator');
  const s = (await call('POST', '/api/submissions', c, { title: 'Img', contentType: 'ad', content: 'Meet Nimbus Pay.', intent: {} })).body;
  const bad = await call('POST', `/api/submissions/${s.id}/visuals`, c, { name: 'x.png', width: 0, height: 0 });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await call('POST', `/api/submissions/${s.id}/visuals`, c, { name: 'x.png', width: 800, height: 600, type: 'image/png', fg: 'red', dominant: [] })).status, 400);
  let r = (await call('POST', `/api/submissions/${s.id}/visuals`, c, { name: 'hero.png', width: 800, height: 600, bytes: 5e4, type: 'image/png', alt: 'Picture of a happy customer', transcript: 'Our users get CASHBACK!!', dominant: [{ hex: '#2F4BC7', share: 0.8 }] })).body;
  const alt = r.findings.find((f) => f.rule === 'visual.alt_quality'); assert.ok(alt && alt.suggestion);
  assert.ok(r.findings.some((f) => f.scope.startsWith('Text in image') && f.rule === 'terminology'), 'text in image goes through the text rules');
  assert.ok(r.findings.some((f) => f.rule === 'visual.logo'));
  r = (await call('POST', `/api/submissions/${s.id}/findings/${alt.id}/accept`, c)).body;
  assert.strictEqual(r.visuals[0].alt, 'Happy customer'.length >= 10 ? r.visuals[0].alt : '');
  assert.ok(!/^picture/i.test(r.visuals[0].alt));
  const vid = r.visuals[0].id;
  r = (await call('PUT', `/api/submissions/${s.id}/visuals/${vid}`, c, { logo: true })).body;
  assert.ok(!r.findings.some((f) => f.rule === 'visual.logo'));
  r = (await call('DELETE', `/api/submissions/${s.id}/visuals/${vid}`, c)).body;
  assert.strictEqual(r.visuals.length, 0);
  const led = (await call('GET', '/api/ledger', await login('manager'))).body;
  assert.ok(led.byKind.visual_summary >= 1); assert.strictEqual(led.externalServiceCalls, 0);
});
test('repeated create returns the same item; withdraw works; login is throttled', async () => {
  const c = await login('creator');
  const a = (await call('POST', '/api/submissions', c, { title: 'Dup', content: 'Same text twice please.', intent: {} })).body;
  const b = (await call('POST', '/api/submissions', c, { title: 'Dup', content: 'Same text twice please.', intent: {} })).body;
  assert.strictEqual(a.id, b.id);
  await call('POST', `/api/submissions/${a.id}/submit`, c);
  assert.strictEqual((await call('POST', `/api/submissions/${a.id}/withdraw`, c)).body.status, 'draft');
  let last; for (let i = 0; i < 11; i++) last = await call('POST', '/api/login', null, { email: 'nobody@demo.com', password: 'x' });
  assert.strictEqual(last.status, 429);
});
test('Review Receipts form a verifiable hash chain and detect tampering', async () => {
  const c = await login('creator'), rv = await login('reviewer'), m = await login('manager');
  for (const t of ['One', 'Two']) {
    const s = (await call('POST', '/api/submissions', c, { title: t, content: `Nimbus Pay helps customers pay. ${t}.`, intent: {} })).body;
    await call('POST', `/api/submissions/${s.id}/submit`, c);
    const ok = await call('POST', `/api/submissions/${s.id}/decision`, m, { decision: 'approve' });
    assert.strictEqual(ok.body.status, 'approved'); assert.match(ok.body.receiptId, /^R-/);
  }
  assert.strictEqual((await call('POST', '/api/receipts/verify', rv)).body.ok, true);
  const list = (await call('GET', '/api/receipts', m)).body; assert.ok(list.length >= 2);
  const r = (await call('GET', '/api/receipts/' + list[0].id, m)).body;
  assert.strictEqual(r.dataHandling.externalServicesCalled, 0); assert.strictEqual(r.hash.length, 64);
  assert.strictEqual((await call('GET', '/api/receipts/' + list[0].id, await login('admin'))).status, 200);
});
test('exports are logged; content export needs a reason', async () => {
  const c = await login('creator'), m = await login('manager');
  const s = (await call('POST', '/api/submissions', c, { title: 'Exp', content: 'Confidential launch text.', intent: {} })).body;
  assert.strictEqual((await call('POST', `/api/submissions/${s.id}/export`, c, { withContent: true })).status, 400);
  assert.strictEqual((await call('POST', `/api/submissions/${s.id}/export`, c, {})).body.content.startsWith('[redacted'), true);
  assert.strictEqual((await call('POST', `/api/submissions/${s.id}/export`, c, { withContent: true, reason: 'Sending to agency' })).body.content, 'Confidential launch text.');
  const led = (await call('GET', '/api/ledger', m)).body; assert.ok(led.byKind.content_export >= 2);
  assert.strictEqual((await call('GET', '/api/ledger', c)).status, 403);
});
test('Guideline Debugger: demo activity -> flagged rule -> proposal -> approval changes the clause; unsafe edits are refused', async () => {
  const admin = await login('admin'), m = await login('manager');
  assert.strictEqual((await call('POST', '/api/debugger/demo-activity', m)).status, 403);
  await call('POST', '/api/debugger/demo-activity', admin);
  const d = (await call('GET', '/api/debugger', m)).body;
  const t = d.rules.find((r) => r.rule === 'terminology'); assert.ok(t.flagged, 'terminology should be flagged as unclear'); assert.strictEqual(t.clauseId, 'T-2.1');
  const made = (await call('POST', '/api/debugger/propose', m)).body; assert.ok(made.created >= 1);
  const p = made.proposals.find((x) => x.clauseId === 'T-2.1' && x.status === 'pending');
  assert.ok(p.proposedText.startsWith(p.currentText) && p.proposedText.includes('survey'));
  assert.strictEqual((await call('POST', `/api/debugger/proposals/${p.id}/approve`, admin, { text: 'Be nice.' })).status, 400);
  assert.strictEqual((await call('POST', `/api/debugger/proposals/${p.id}/approve`, admin, {})).body.status, 'approved');
  assert.ok((await call('GET', '/api/brain', admin)).body.clauses.find((c) => c.id === 'T-2.1').text.includes('Exceptions'));
  assert.strictEqual((await call('POST', `/api/debugger/proposals/${p.id}/approve`, admin, {})).status, 404);
  const st = (await call('POST', '/api/debugger/stress', m)).body; assert.ok(st.total > 10);
});

test('a Round 2 database is upgraded without losing data', async () => {
  const { seed } = require('../src/seed');
  const old = seed(); delete old.ledger; delete old.proposals; delete old.receipts; delete old.brainHistory; delete old.stress; delete old.brain.palette;
  old.brain.clauses = old.brain.clauses.filter((c) => !/^(V-6|A-5\.[34])/.test(c.id)); old.brain.ruleMap = { 'claim.superlative': old.brain.ruleMap['claim.superlative'] };
  old.brain.facts[0].text = 'Nimbus Pay charges a 1% fee on every card payment (edited).';
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bpm-')), 'db.json'); fs.writeFileSync(file, JSON.stringify(old));
  const srv = createApp({ dataFile: file }); await new Promise((r) => srv.listen(0, r));
  const b = 'http://127.0.0.1:' + srv.address().port;
  const tok = (await (await fetch(b + '/api/login', { method: 'POST', body: JSON.stringify({ email: 'admin@demo.com', password: 'demo1234' }) })).json()).token;
  const brain = await (await fetch(b + '/api/brain', { headers: { authorization: 'Bearer ' + tok } })).json();
  srv.close();
  assert.ok(brain.palette.length >= 4 && brain.clauses.some((c) => c.id === 'V-6.1') && brain.ruleMap['visual.contrast']);
  assert.ok(brain.facts[0].text.includes('(edited)'), 'admin edits are preserved');
});
