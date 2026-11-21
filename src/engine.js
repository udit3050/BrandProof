'use strict';
/**
 * BrandProof review engine.
 * Pipeline: deterministic rules -> lexical retrieval over approved facts -> Proof Verifier -> Intent check.
 * Every finding cites a clause or fact; the verifier re-checks the citation against the live Brand Brain.
 */
const crypto = require('crypto');

const LANE = { minor: 'green', major: 'amber', critical: 'red', question: 'amber' };
const LANE_RANK = { green: 1, amber: 2, red: 3 };
const STOP = new Set(('and are for from has have its our that the their this with you your will can now just every all any more most new ' +
  'get got also into than then them they was were what when who why how not yes here where there see click').split(' '));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
function words(s, extraStop) {
  const out = [];
  for (const w of (s.toLowerCase().match(/[a-z]+/g) || [])) {
    if (w.length < 3 || STOP.has(w) || extraStop.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function sentences(text) {
  const out = [];
  const re = /[^\n]+?(?:[.!?]+(?=\s|$)|$)/gm;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (m[0].trim()) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// Numbers with unit kind. Years and "#1" style ranks are ignored.
function numbersIn(text) {
  const re = /(?<![#\w.])([$\u20B9\u20AC\u00A3]\s?)?(\d+(?:[.,]\d+)*)(%|\s?(?:percent|million|billion|lakh|crore)\b)?/gi;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const norm = (m[2] || '').replace(/,/g, '');
    if (/^(19|20)\d\d$/.test(norm) && !m[1] && !m[3]) continue;
    const kind = m[3] ? (m[3].trim() === '%' || m[3].trim() === 'percent' ? 'pct' : 'unit') : m[1] ? 'cur' : 'plain';
    out.push({ text: m[0], norm: norm + (kind === 'pct' ? '%' : ''), kind, start: m.index, end: m.index + m[0].length,
      claimLike: kind !== 'plain' });
  }
  return out;
}

function matchCase(from, to) {
  return /^[A-Z]/.test(from) ? to.charAt(0).toUpperCase() + to.slice(1) : to;
}
function eatSpace(text, s, e) { // when removing a word, also remove one adjoining space
  if (text[e] === ' ') return [s, e + 1];
  if (s > 0 && text[s - 1] === ' ') return [s - 1, e];
  return [s, e];
}

function mustKeepCheck(original, rewritten, mustKeep) {
  const has = (text, tok) => new RegExp('(?<![\\w.])' + esc(tok) + '(?!\\w)', 'i').test(text);
  const missing = (mustKeep || []).filter((m) => m && has(original, m) && !has(rewritten, m));
  const ws = (t) => new Set(t.toLowerCase().match(/[a-z0-9%#]+/g) || []);
  const a = ws(original), b = ws(rewritten);
  let inter = 0; a.forEach((w) => { if (b.has(w)) inter++; });
  const union = a.size + b.size - inter;
  const similarity = union ? +(inter / union).toFixed(2) : 1;
  return { passed: missing.length === 0 && similarity >= 0.6, missing, similarity };
}

function suggestionFor(content, span, replacement, mustKeep) {
  const result = content.slice(0, span.start) + replacement + content.slice(span.end);
  const intent = mustKeepCheck(content, result, mustKeep);
  return { start: span.start, end: span.end, replacement, intent, status: intent.passed ? 'safe' : 'intent_warning' };
}

function review(content, brain, opts = {}) {
  const now = opts.now || new Date();
  const mustKeep = opts.mustKeep || [];
  const extraStop = new Set(brain.stopExtra || []);
  const allowedCaps = new Set((brain.allowedCaps || []).concat(['USA', 'UK', 'UAE', 'API', 'SMS', 'ATM', 'PIN', 'FAQ', 'EMI', 'PDF', 'CEO', 'KYC', 'UPI', 'OTP', 'AI']).map((x) => x.toUpperCase()));
  const found = [];

  const add = (rule, severity, title, why, span, source, extra = {}) => {
    const flagged = { text: content.slice(span.start, span.end), start: span.start, end: span.end };
    const key = rule + ':' + flagged.text.toLowerCase();
    found.push({
      id: crypto.createHash('sha1').update(key + ':' + span.start).digest('hex').slice(0, 10),
      key, rule, severity, lane: LANE[severity], title, why, flagged, source,
      confidence: extra.confidence || 0.95, method: extra.method || 'rule',
      suggestion: extra.suggestion || null, advice: extra.advice || null, status: 'open'
    });
  };
  const ruleSource = (rule) => {
    const r = brain.ruleMap[rule];
    return r ? { type: 'clause', id: r.clauseId, quote: r.quote } : { type: 'clause', id: '?', quote: '' };
  };
  const suggest = (span, replacement) => suggestionFor(content, span, replacement, mustKeep);

  // 1. Terminology (data-driven)
  for (const t of brain.terms || []) {
    const re = new RegExp(t.pattern, 'gi');
    let m;
    while ((m = re.exec(content))) {
      if (t.exactGood && m[0] === t.good) continue;
      const span = { start: m.index, end: m.index + m[0].length };
      add('terminology', t.severity, `Use "${t.good}" instead of "${m[0]}"`,
        `Approved terminology prefers "${t.good}".`, span, { type: 'clause', id: t.clauseId, quote: t.quote },
        { suggestion: suggest(span, t.exactGood ? t.good : matchCase(m[0], t.good)) });
    }
  }

  // 2. Superlative claims: allowed only if an approved fact contains the same word
  const factText = (brain.facts || []).map((f) => f.text.toLowerCase()).join(' ');
  const sup = /\b(best|fastest|cheapest|leading|top[- ]rated|most trusted|unbeatable|world[- ]class|number[- ](?:one|1)|no\.? ?1)\b|#1/gi;
  const supMap = { best: 'great', fastest: 'fast', cheapest: 'affordable', unbeatable: 'competitive', 'world-class': 'high-quality', 'world class': 'high-quality' };
  let m;
  while ((m = sup.exec(content))) {
    if (factText.includes(m[0].toLowerCase())) continue;
    let span = { start: m.index, end: m.index + m[0].length };
    const rep = supMap[m[0].toLowerCase()];
    const shown = { ...span };
    if (rep === undefined) { const [s, e] = eatSpace(content, span.start, span.end); span = { start: s, end: e }; }
    add('claim.superlative', 'critical', `Unsupported claim: "${m[0]}"`,
      'Comparative and superlative claims need an approved fact. None in the Brand Brain supports this one.',
      shown, ruleSource('claim.superlative'), { suggestion: suggest(span, rep === undefined ? '' : matchCase(m[0], rep)) });
  }

  // 3. Guarantee language
  const gua = /\b(guarantees|guaranteed|guarantee|risk[- ]free)\b/gi;
  const guaMap = { guarantees: 'helps with', guaranteed: 'expected', guarantee: 'help with', 'risk-free': 'designed with safeguards', 'risk free': 'designed with safeguards' };
  while ((m = gua.exec(content))) {
    const span = { start: m.index, end: m.index + m[0].length };
    add('claim.guarantee', 'critical', `Guarantee language: "${m[0]}"`,
      'Guarantees about savings or rewards cannot be made without legal approval.', span, ruleSource('claim.guarantee'),
      { suggestion: suggest(span, matchCase(m[0], guaMap[m[0].toLowerCase()])) });
  }

  // 4. Numbers vs approved facts (lexical retrieval: shared meaningful words)
  const factIdx = (brain.facts || []).map((f) => ({ f, toks: new Set(words(f.text, extraStop)), nums: numbersIn(f.text) }));
  for (const s of sentences(content)) {
    const nums = numbersIn(s.text).map((n) => ({ ...n, start: n.start + s.start, end: n.end + s.start }));
    if (!nums.length) continue;
    const stoks = new Set(words(s.text, extraStop));
    const matched = factIdx.filter((fi) => { let c = 0; fi.toks.forEach((t) => { if (stoks.has(t)) c++; }); return c >= 2; });
    const factNums = new Set(); matched.forEach((fi) => fi.nums.forEach((n) => factNums.add(n.norm)));
    for (const n of nums) {
      if (factNums.has(n.norm)) {
        for (const fi of matched) {
          if (fi.nums.some((x) => x.norm === n.norm) && fi.f.reviewBy && new Date(fi.f.reviewBy + 'T23:59:59Z') < now) {
            add('fact.outdated', 'major', `Outdated fact: ${fi.f.id} passed its review date`,
              `This figure relies on approved fact ${fi.f.id}, whose review-by date (${fi.f.reviewBy}) has passed. Ask ${fi.f.owner || 'the owner'} to confirm it is still true.`,
              { start: n.start, end: n.end }, { type: 'fact', id: fi.f.id, quote: fi.f.text }, { method: 'retrieval', confidence: 0.85,
                advice: `Ask ${fi.f.owner || 'the fact owner'} to re-confirm ${fi.f.id}, or update the fact in the Brand Brain.` });
          }
        }
        continue;
      }
      const same = matched.map((fi) => ({ fi, n: fi.nums.find((x) => x.kind === n.kind) })).find((x) => x.n);
      if (same) {
        add('fact.contradiction', 'critical', `Figure does not match approved fact ${same.fi.f.id}`,
          `The content says ${n.text.trim()}, but the approved fact says "${same.fi.f.text}"`,
          { start: n.start, end: n.end }, { type: 'fact', id: same.fi.f.id, quote: same.fi.f.text },
          { method: 'retrieval', confidence: 0.85, suggestion: suggest({ start: n.start, end: n.end }, same.n.text) });
      } else if (n.claimLike) {
        add('fact.unsupported_number', 'major', `Number not found in approved facts: ${n.text.trim()}`,
          'Prices, fees and percentages must match the Approved Facts, and none matches this one.',
          { start: n.start, end: n.end }, ruleSource('fact.unsupported_number'),
          { method: 'retrieval', confidence: 0.75, advice: 'Replace with an approved figure, add the fact to the Brand Brain, or remove the claim.' });
      }
    }
  }

  // 5. Required disclaimer
  const cb = /\b(cashback|rewards?)\b/i.exec(content);
  if (cb && !/terms and conditions apply/i.test(content)) {
    const end = content.length;
    add('compliance.disclaimer', 'major', 'Required disclaimer missing',
      'Mentions of cashback or rewards must carry the standard disclaimer.',
      { start: cb.index, end: cb.index + cb[0].length }, ruleSource('compliance.disclaimer'),
      { suggestion: suggest({ start: end, end }, (/\s$/.test(content) ? '' : ' ') + 'Terms and conditions apply.') });
  }

  // 6. Tone
  const runs = [...content.matchAll(/!+/g)];
  runs.forEach((r, i) => {
    if (i === 0 && r[0].length === 1) return;
    const span = { start: r.index, end: r.index + r[0].length };
    add('tone.exclamation', 'minor', 'Too many exclamation marks', 'Brand voice allows at most one exclamation mark per post.',
      span, ruleSource('tone.exclamation'), { suggestion: suggest(span, i === 0 ? '!' : '.') });
  });
  const caps = /\b[A-Z]{3,}\b/g;
  while ((m = caps.exec(content))) {
    if (allowedCaps.has(m[0])) continue;
    const span = { start: m.index, end: m.index + m[0].length };
    const prev = content.slice(0, m.index).trimEnd();
    const startOfSentence = prev === '' || /[.!?]$/.test(prev);
    const low = m[0].toLowerCase();
    add('tone.caps', 'minor', `All-caps word: "${m[0]}"`, 'Avoid shouting; write in sentence case.', span, ruleSource('tone.caps'),
      { suggestion: suggest(span, startOfSentence ? low.charAt(0).toUpperCase() + low.slice(1) : low) });
  }

  // 7. Accessibility (text and markdown)
  const alt = /!\[\s*\]\(([^)]*)\)/g;
  while ((m = alt.exec(content))) {
    const span = { start: m.index, end: m.index + m[0].length };
    add('a11y.alt_text', 'major', 'Image has no alt text', 'Screen-reader users cannot tell what this image shows.', span,
      ruleSource('a11y.alt_text'), { suggestion: suggest(span, `![Describe the image here](${m[1]})`) });
  }
  const link = /\bclick here\b/gi;
  while ((m = link.exec(content))) {
    const span = { start: m.index, end: m.index + m[0].length };
    add('a11y.link_text', 'minor', 'Non-descriptive link text', 'Link text should say where the link goes.', span,
      ruleSource('a11y.link_text'), { suggestion: suggest(span, matchCase(m[0], 'learn more')) });
  }

  return verifyAll(found, content, brain).sort((a, b) => a.flagged.start - b.flagged.start);
}

// Proof Verifier: a finding only keeps its severity if its citation is real and its flagged text is really in the content.
function verifyAll(findings, content, brain) {
  return findings.map((f) => {
    const item = f.source.type === 'fact' ? (brain.facts || []).find((x) => x.id === f.source.id)
      : (brain.clauses || []).find((x) => x.id === f.source.id);
    const quoteOk = !!item && !!f.source.quote && item.text.includes(f.source.quote);
    const spanOk = f.flagged.start < 0 || content.slice(f.flagged.start, f.flagged.end) === f.flagged.text;
    f.verified = quoteOk && spanOk;
    if (!f.verified) {
      f.title = 'Reviewer question: ' + f.title;
      f.severity = 'question'; f.lane = LANE.question; f.suggestion = null;
      f.why = (f.why || '') + ' (The cited source could not be verified against the current Brand Brain, so a human must decide.)';
    }
    return f;
  });
}

function suggestIntent(content, brain, { contentType, audience } = {}) {
  const mustKeep = [];
  for (const b of brain.brandNames || []) if (new RegExp(esc(b), 'i').test(content)) mustKeep.push(b);
  for (const n of numbersIn(content)) if (n.claimLike && !mustKeep.includes(n.text.trim())) mustKeep.push(n.text.trim());
  const first = (sentences(content)[0] || { text: '' }).text.trim();
  const goals = { 'social post': 'Inform and engage customers with a short social post', blog: 'Explain a topic to customers in a blog article',
    ad: 'Promote a product or offer', email: 'Inform customers by email', slide: 'Support a presentation' };
  return { goal: goals[contentType] || 'Communicate a message to customers', audience: audience || 'Existing and prospective customers',
    keyMessage: first.slice(0, 140), mustKeep };
}

function highestLane(findings) {
  let best = 'green';
  for (const f of findings) if (f.status === 'open' && LANE_RANK[f.lane] > LANE_RANK[best]) best = f.lane;
  return findings.some((f) => f.status === 'open') ? best : 'green';
}

module.exports = { LANE, review, verifyAll, suggestIntent, mustKeepCheck, highestLane, sentences, numbersIn };
