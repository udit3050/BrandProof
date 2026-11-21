'use strict';
// Review Receipt: a tamper-evident (hash-chained) record of what was checked and who approved.
const { sha256Hex } = require('./hash');
const canon = (o) => JSON.stringify(o);
const contentHash = (s) => sha256Hex(canon({ content: s.content, visuals: (s.visuals || []).map((v) => ({ name: v.name, alt: v.alt, transcript: v.transcript })) }));
const brainHash = (b) => sha256Hex(canon({ c: b.clauses.map((x) => [x.id, x.text]), f: b.facts.map((x) => [x.id, x.text, x.reviewBy]) }));

function build(sub, brain, user, prevHash, ledgerCount, id, now) {
  const cited = new Map();
  for (const f of sub.findings) { const item = (f.source.type === 'fact' ? brain.facts : brain.clauses).find((x) => x.id === f.source.id); if (item) cited.set(f.source.type + f.source.id, { type: f.source.type, id: f.source.id, textHash: sha256Hex(item.text).slice(0, 16) }); }
  const open = sub.findings.filter((f) => f.status === 'open');
  const body = {
    id, submissionId: sub.id, title: sub.title, version: sub.versions.length, approvedAt: now,
    approvedBy: { name: user.name, role: user.role },
    decision: open.some((f) => f.lane === 'red') ? 'approved_with_override' : 'approved',
    overrideReason: (sub.audit.slice().reverse().find((a) => a.action === 'approved_with_override') || {}).detail || '',
    contentHash: contentHash(sub),
    brain: { clauses: brain.clauses.length, facts: brain.facts.length, snapshotHash: brainHash(brain) },
    checksRun: Object.keys(brain.ruleMap).concat((brain.terms || []).length ? ['terminology'] : []).sort(),
    findings: {
      distinctRaised: Object.keys(sub.seen).length,
      fixedByCreator: sub.audit.filter((a) => a.action === 'accepted_fix').length,
      dismissed: Object.entries(sub.dismissed).map(([k, d]) => ({ rule: k.split(':')[0], reason: d.reason, by: d.by })),
      openAtApproval: open.map((f) => ({ rule: f.rule, lane: f.lane, text: f.flagged.text.slice(0, 80) }))
    },
    sourcesCited: [...cited.values()],
    dataHandling: { externalServicesCalled: 0, imagesStoredOnServer: false, ledgerEntriesForThisItem: ledgerCount },
    prevHash
  };
  return { ...body, hash: sha256Hex(canon(body)) };
}
function verify(receipts, submissions) {
  const problems = []; let prev = 'GENESIS';
  receipts.forEach((r, i) => {
    const { hash, ...body } = r;
    if (r.prevHash !== prev) problems.push({ receipt: r.id, problem: 'Chain link broken: previous hash does not match' });
    if (sha256Hex(canon(body)) !== hash) problems.push({ receipt: r.id, problem: 'Receipt contents were changed after it was issued' });
    const s = submissions.find((x) => x.id === r.submissionId);
    if (s && contentHash(s) !== r.contentHash) problems.push({ receipt: r.id, problem: 'The approved content no longer matches the receipt' });
    prev = hash;
  });
  return { ok: problems.length === 0, checked: receipts.length, problems };
}
module.exports = { build, verify, contentHash, brainHash };
