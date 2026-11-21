'use strict';
// Guideline Debugger: finds rules that people keep dismissing or disagree about, drafts clearer wording
// from their own dismissal reasons, and stress-tests every rule with synthetic drafts.
const engine = require('./engine');
const NOW = () => new Date();

function clauseForRule(brain, rule, sampleText) {
  if (rule === 'terminology') {
    const t = (brain.terms || []).find((x) => sampleText && new RegExp(x.pattern, 'i').test(sampleText));
    if (t) return t.clauseId;
  }
  return (brain.ruleMap[rule] || {}).clauseId || null;
}

function analyze(db) {
  const stats = {};
  for (const e of db.events) { const r = (stats[e.rule] = stats[e.rule] || { rule: e.rule, raised: 0, accepted: 0, dismissed: 0, overridden: 0 }); r[e.action] = (r[e.action] || 0) + 1; }
  const dismissals = [];
  for (const s of db.submissions) for (const [k, d] of Object.entries(s.dismissed || {})) { const i = k.indexOf(':'); dismissals.push({ rule: k.slice(0, i), text: k.slice(i + 1), reason: d.reason, by: d.by }); }
  const rules = Object.values(stats).map((r) => {
    const rejected = r.dismissed + r.overridden;
    const dismissRate = r.raised ? rejected / r.raised : 0;
    const mixed = r.raised ? (2 * Math.min(r.accepted, rejected)) / r.raised : 0; // people disagree: some accept, some dismiss
    const overrideRate = r.raised ? r.overridden / r.raised : 0;
    const score = +Math.min(1, 0.5 * dismissRate + 0.3 * Math.min(1, mixed) + 0.2 * Math.min(1, overrideRate * 2)).toFixed(2);
    const ex = dismissals.filter((d) => d.rule === r.rule);
    return { ...r, dismissRate: +dismissRate.toFixed(2), ambiguity: score, flagged: r.raised >= 3 && (score >= 0.4 || dismissRate >= 0.5),
      clauseId: clauseForRule(db.brain, r.rule, (ex[0] || {}).text), examples: ex.slice(0, 5) };
  }).sort((a, b) => b.ambiguity - a.ambiguity || b.raised - a.raised);
  return rules;
}

const uniq = (a) => [...new Set(a)];
function propose(db, user) {
  const made = [];
  for (const r of analyze(db).filter((x) => x.flagged && x.clauseId)) {
    const clause = db.brain.clauses.find((c) => c.id === r.clauseId);
    if (!clause || db.proposals.some((p) => p.clauseId === clause.id && p.status === 'pending')) continue;
    const reasons = uniq(r.examples.map((e) => e.reason.replace(/\.$/, ''))).slice(0, 3);
    const texts = uniq(r.examples.map((e) => `"${e.text}"`)).slice(0, 3);
    const proposedText = clause.text + (reasons.length ? ` Exceptions, drafted from ${r.examples.length} dismissal(s): ${reasons.join('; ')}.` : '') +
      (texts.length ? ` Wording that people judged acceptable in context: ${texts.join(', ')}.` : '');
    const p = { id: 'P-' + (db.proposals.length + 1), clauseId: clause.id, rule: r.rule, status: 'pending', createdAt: new Date().toISOString(), createdBy: user.name,
      evidence: { raised: r.raised, accepted: r.accepted, dismissed: r.dismissed, overridden: r.overridden, ambiguity: r.ambiguity, examples: r.examples },
      currentText: clause.text, proposedText };
    db.proposals.push(p); made.push(p);
  }
  return made;
}

// ---- Brand Stress Test ----
function cases(brain) {
  const c = [
    { rule: 'claim.superlative', pos: ['Nimbus Pay is the fastest app.', 'Our #1 service for payments.', 'We are number 1 in India.'], neg: ['Nimbus Pay is a fast app.'] },
    { rule: 'claim.guarantee', pos: ['Guaranteed savings every month.', 'Payments that are risk-free.'], neg: ['Savings depend on how you use the app.'] },
    { rule: 'compliance.disclaimer', pos: ['Earn cashback on every order.'], neg: ['Earn cashback on every order. Terms and conditions apply.'] },
    { rule: 'tone.exclamation', pos: ['Great news!! Join now!'], neg: ['Great news! Join now.'] },
    { rule: 'tone.caps', pos: ['Our NEW feature is live.'], neg: ['Pay with UPI today.'] },
    { rule: 'a11y.link_text', pos: ['Click here to join.'], neg: ['Learn more about pricing.'] },
    { rule: 'a11y.alt_text', pos: ['See ![](hero.png) for details.'], neg: ['See ![Customer paying by phone](hero.png) for details.'] },
    { rule: 'fact.unsupported_number', pos: ['Save 45% on every plan today.'], neg: ['Save time on every plan today.'] }
  ];
  for (const t of brain.terms || []) {
    const word = t.pattern.replace(/\\b/g, '').replace(/ \?/g, ' ').replace(/\?/g, '');
    c.push({ rule: 'terminology', label: `terminology: ${word}`, pos: [`We love our ${t.exactGood ? 'nimbuspay' : word} today.`], neg: [`We love our ${t.good} today.`] });
  }
  for (const f of brain.facts) {
    const m = /\d+(?:\.\d+)?/.exec(f.text); if (!m) continue;
    const wrong = f.text.replace(m[0], String(+m[0] + 3));
    c.push({ rule: 'fact.contradiction', label: `fact ${f.id} contradiction`, pos: [wrong], neg: new Date(f.reviewBy + 'T23:59:59Z') < NOW() ? [] : [f.text] });
  }
  // known hard cases: paraphrases the rules cannot see. Listed on purpose so the gaps are visible.
  c.push({ rule: 'fact.contradiction', label: 'paraphrase (spelled-out numbers)', pos: ['Nimbus Pay charges a half-percent fee on every card payment.'], neg: [], adversarial: true });
  return c;
}
function stressTest(brain) {
  const results = [];
  for (const c of cases(brain)) {
    const hit = (t) => engine.review(t, brain, { now: NOW() }).some((f) => f.rule === c.rule);
    const pos = c.pos.map((t) => ({ text: t, detected: hit(t) }));
    const neg = c.neg.map((t) => ({ text: t, falseAlarm: hit(t) }));
    const missed = pos.filter((p) => !p.detected).length, noisy = neg.filter((n) => n.falseAlarm).length;
    results.push({ rule: c.rule, label: c.label || c.rule, adversarial: !!c.adversarial, pos, neg, status: missed ? 'gap' : noisy ? 'noisy' : 'covered' });
  }
  const broken = Object.entries(brain.ruleMap).filter(([, r]) => { const cl = brain.clauses.find((x) => x.id === r.clauseId); return !cl || !cl.text.includes(r.quote); }).map(([rule, r]) => ({ rule, clauseId: r.clauseId, quote: r.quote }));
  const total = results.length, covered = results.filter((r) => r.status === 'covered').length;
  return { at: new Date().toISOString(), total, covered, gaps: results.filter((r) => r.status === 'gap').length, noisy: results.filter((r) => r.status === 'noisy').length, brokenCitations: broken, results };
}
module.exports = { analyze, propose, stressTest };
