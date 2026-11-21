'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { review, suggestIntent, highestLane } = require('../src/engine');
const { seedBrain } = require('../src/seed');
const NOW = new Date('2026-11-13');
const run = (t, brain = seedBrain(), mustKeep = []) => review(t, brain, { now: NOW, mustKeep });

test('clean content produces no findings', () => {
  assert.strictEqual(run('Nimbus Pay helps customers pay in 12 currencies.').length, 0);
});
test('unsupported superlative is critical, cited and verified', () => {
  const f = run('We are the best app.').find((x) => x.rule === 'claim.superlative');
  assert.ok(f); assert.strictEqual(f.lane, 'red'); assert.strictEqual(f.source.id, 'C-4.1'); assert.ok(f.verified);
});
test('numeric contradiction cites the approved fact and warns about intent', () => {
  const t = 'Nimbus Pay charges a 0.5% fee on every card payment.';
  const f = run(t, seedBrain(), suggestIntent(t, seedBrain()).mustKeep).find((x) => x.rule === 'fact.contradiction');
  assert.ok(f); assert.strictEqual(f.source.id, 'F-1'); assert.strictEqual(f.suggestion.replacement, '1%');
  assert.strictEqual(f.suggestion.status, 'intent_warning'); assert.deepStrictEqual(f.suggestion.intent.missing, ['0.5%']);
});
test('matching figure is accepted; expired fact is flagged as outdated', () => {
  assert.ok(!run('Nimbus Pay charges a 1% fee on every card payment.').some((x) => x.rule.startsWith('fact.')));
  const f = run('Nimbus Pay is available in 9 countries.').find((x) => x.rule === 'fact.outdated');
  assert.ok(f); assert.strictEqual(f.source.id, 'F-4');
});
test('superlative backed by an approved fact is allowed', () => {
  const b = seedBrain(); b.facts.push({ id: 'F-9', text: 'Nimbus Pay is the fastest checkout in the 2026 benchmark.', owner: 'x', reviewBy: '2027-12-31' });
  assert.ok(!run('Our checkout is the fastest.', b).some((x) => x.rule === 'claim.superlative'));
});
test('disclaimer, tone, terminology and accessibility rules fire', () => {
  const f = run('Our USERS love cashback!! Click here. ![](a.png)');
  const rules = new Set(f.map((x) => x.rule));
  ['compliance.disclaimer', 'tone.exclamation', 'tone.caps', 'terminology', 'a11y.link_text', 'a11y.alt_text'].forEach((r) => assert.ok(rules.has(r), r));
});
test('Proof Verifier downgrades a finding when the cited clause text changed', () => {
  const b = seedBrain();
  b.clauses.find((c) => c.id === 'C-4.1').text = 'Claims are reviewed by legal.';
  const f = run('We are the best app.', b).find((x) => x.rule === 'claim.superlative');
  assert.strictEqual(f.verified, false); assert.strictEqual(f.severity, 'question'); assert.strictEqual(f.suggestion, null);
});
test('lane is the highest open lane', () => {
  assert.strictEqual(highestLane(run('We are the best app.')), 'red');
  assert.strictEqual(highestLane([]), 'green');
});
test('sentence splitting keeps decimals together', () => {
  assert.ok(!run('Fee is 2.5% today. Thanks.').some((x) => x.flagged.text === '5%'));
});
