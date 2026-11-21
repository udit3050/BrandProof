'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./src/store');
const auth = require('./src/auth');
const { seed, migrate } = require('./src/seed');
const engine = require('./src/engine');
const visual = require('./src/visual');
const dbg = require('./src/debugger');
const receipt = require('./src/receipt');

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const EDITABLE = ['draft', 'changes_requested'];

function createApp(opts = {}) {
  const store = new Store(opts.dataFile || process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));
  store.load(seed);
  migrate(store.data); store.save();
  const db = () => store.data;
  const nowIso = () => new Date().toISOString();

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
  const need = (cond, code, msg) => { if (!cond) throw new HttpError(code, msg); };
  const str = (v, max, name) => { need(typeof v === 'string', 400, `${name} is required`); need(v.length <= max, 400, `${name} is too long`); return v; };
  const audit = (sub, user, action, detail) => sub.audit.push({ at: nowIso(), by: user.name, role: user.role, action, detail: detail || '' });
  const event = (rule, action, sub) => db().events.push({ at: nowIso(), rule, action, submissionId: sub.id, owner: sub.ownerName });
  const ledger = (user, kind, sub, detail) => db().ledger.push({ id: crypto.randomUUID(), at: nowIso(), user: user.name, role: user.role, kind, submissionId: sub ? sub.id : null, detail });
  const fails = {};

  async function runReview(sub) {
    const d = db(), now = new Date();
    const tag = (f, target, scope, prefix) => { f.target = target; f.scope = scope; if (prefix) { f.key = prefix + '|' + f.key; f.id = crypto.createHash('sha1').update(f.key + f.flagged.start).digest('hex').slice(0, 10); } return f; };
    let found = engine.review(sub.content, d.brain, { mustKeep: sub.intent.mustKeep, now }).map((f) => tag(f, { type: 'content' }, 'Text'));
    for (const v of sub.visuals || []) {
      if ((v.transcript || '').trim()) found.push(...engine.review(v.transcript, d.brain, { mustKeep: [], now }).map((f) => tag(f, { type: 'transcript', visualId: v.id }, 'Text in image: ' + v.name, v.id)));
      found.push(...visual.review(v, d.brain, { contentType: sub.contentType }).map((f) => tag(f, { type: 'visual', visualId: v.id }, 'Image: ' + v.name)));
    }
    found.sort((a, b) => (a.scope === 'Text' ? 0 : 1) - (b.scope === 'Text' ? 0 : 1) || a.flagged.start - b.flagged.start);
    for (const f of found) {
      if (sub.dismissed[f.key]) f.status = 'dismissed';
      if (!sub.seen[f.key]) { sub.seen[f.key] = 1; event(f.rule, 'raised', sub); }
    }
    sub.findings = found;
    sub.lane = engine.highestLane(found);
    sub.updatedAt = nowIso();
  }
  function addVersion(sub, content, user, reason) {
    sub.content = content;
    sub.versions.push({ n: sub.versions.length + 1, content, at: nowIso(), by: user.name, reason });
  }

  const canSee = (u, s) => u.role !== 'creator' || s.ownerId === u.id;
  const view = (s) => s;
  const getSub = (user, id) => {
    const s = db().submissions.find((x) => x.id === id);
    need(s, 404, 'Submission not found');
    need(canSee(user, s), 403, 'Not allowed');
    return s;
  };
  const owns = (u, s) => s.ownerId === u.id;

  const routes = [];
  const R = (method, re, roles, fn) => routes.push({ method, re, roles, fn });

  R('POST', /^\/api\/login$/, 'public', async ({ body }) => {
    const email = String(body.email || '').toLowerCase().slice(0, 100);
    const recent = (fails[email] = (fails[email] || []).filter((t) => Date.now() - t < 300000));
    need(recent.length < 10, 429, 'Too many failed attempts. Please wait a few minutes.');
    const u = db().users.find((x) => x.email === email);
    if (!(u && auth.verifyPassword(String(body.password || ''), u.passwordHash))) { recent.push(Date.now()); throw new HttpError(401, 'Wrong email or password'); }
    return { token: auth.sign({ uid: u.id, exp: Date.now() + 12 * 3600e3 }, db().secret), user: publicUser(u) };
  });
  R('GET', /^\/api\/me$/, null, async ({ user }) => ({ user: publicUser(user) }));

  // Brand Brain
  R('GET', /^\/api\/brain$/, null, async () => db().brain);
  R('PUT', /^\/api\/brain\/clauses\/([\w.-]{1,20})$/, ['admin'], async ({ params, body }) => {
    const c = { id: params[0], section: str(body.section, 40, 'section'), text: str(body.text, 1000, 'text'), updatedAt: nowIso() };
    const list = db().brain.clauses; const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = c; else list.push(c);
    store.save(); return c;
  });
  R('DELETE', /^\/api\/brain\/clauses\/([\w.-]{1,20})$/, ['admin'], async ({ params }) => {
    db().brain.clauses = db().brain.clauses.filter((x) => x.id !== params[0]); store.save(); return { ok: true };
  });
  R('PUT', /^\/api\/brain\/facts\/([\w.-]{1,20})$/, ['admin'], async ({ params, body }) => {
    need(/^\d{4}-\d{2}-\d{2}$/.test(body.reviewBy || ''), 400, 'reviewBy must be YYYY-MM-DD');
    const f = { id: params[0], text: str(body.text, 500, 'text'), owner: str(body.owner || '', 60, 'owner'), reviewBy: body.reviewBy };
    const list = db().brain.facts; const i = list.findIndex((x) => x.id === f.id);
    if (i >= 0) list[i] = f; else list.push(f);
    store.save(); return f;
  });
  R('DELETE', /^\/api\/brain\/facts\/([\w.-]{1,20})$/, ['admin'], async ({ params }) => {
    db().brain.facts = db().brain.facts.filter((x) => x.id !== params[0]); store.save(); return { ok: true };
  });

  // Intent Lock
  R('POST', /^\/api\/intent\/suggest$/, null, async ({ body }) =>
    engine.suggestIntent(str(body.content, 20000, 'content'), db().brain, { contentType: body.contentType, audience: body.audience }));

  // Submissions
  R('GET', /^\/api\/submissions$/, null, async ({ user }) =>
    db().submissions.filter((s) => canSee(user, s)).map((s) => ({ id: s.id, title: s.title, status: s.status, lane: s.lane, ownerName: s.ownerName,
      contentType: s.contentType, updatedAt: s.updatedAt, openFindings: s.findings.filter((f) => f.status === 'open').length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  R('POST', /^\/api\/submissions$/, ['creator', 'admin', 'manager'], async ({ user, body }) => {
    const content = str(body.content, 20000, 'content');
    need(content.trim().length > 0, 400, 'content is empty');
    const dup = db().submissions.find((x) => x.ownerId === user.id && x.versions[0].content === content && Date.now() - Date.parse(x.createdAt) < 60000);
    if (dup) return view(dup); // repeated click or retry: return the same item instead of creating a copy
    const it = body.intent || {};
    const sub = {
      id: crypto.randomUUID(), title: str(body.title || 'Untitled', 120, 'title'), contentType: str(body.contentType || 'social post', 40, 'contentType'),
      channel: str(body.channel || '', 60, 'channel'), ownerId: user.id, ownerName: user.name, status: 'draft', lane: 'green',
      intent: { goal: str(it.goal || '', 300, 'goal'), audience: str(it.audience || '', 200, 'audience'), keyMessage: str(it.keyMessage || '', 300, 'keyMessage'),
        mustKeep: (Array.isArray(it.mustKeep) ? it.mustKeep : []).map(String).filter(Boolean).slice(0, 20) },
      content: '', versions: [], visuals: [], findings: [], dismissed: {}, seen: {}, comments: [], audit: [], createdAt: nowIso(), updatedAt: nowIso()
    };
    addVersion(sub, content, user, 'Created');
    audit(sub, user, 'created', sub.title);
    await runReview(sub);
    db().submissions.push(sub); store.save(); return view(sub);
  });
  R('GET', /^\/api\/submissions\/([\w-]+)$/, null, async ({ user, params }) => view(getSub(user, params[0])));

  R('PUT', /^\/api\/submissions\/([\w-]+)\/content$/, null, async ({ user, params, body }) => {
    const s = getSub(user, params[0]);
    need(owns(user, s) && EDITABLE.includes(s.status), 403, 'Only the owner can edit, and only before review');
    addVersion(s, str(body.content, 20000, 'content'), user, 'Edited');
    audit(s, user, 'edited', `version ${s.versions.length}`);
    await runReview(s); store.save(); return view(s);
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/findings\/(\w+)\/accept$/, null, async ({ user, params }) => {
    const s = getSub(user, params[0]);
    need(owns(user, s) && EDITABLE.includes(s.status), 403, 'Only the owner can accept fixes, and only before review');
    const f = s.findings.find((x) => x.id === params[1] && x.status === 'open');
    need(f, 404, 'Finding not found (it may already be resolved). Refresh.');
    need(f.suggestion, 400, 'This finding has no automatic suggestion');
    const g = f.suggestion, tg = f.target || { type: 'content' };
    const apply = (t) => t.slice(0, g.start) + g.replacement + t.slice(g.end);
    if (tg.type === 'content') addVersion(s, apply(s.content), user, `Accepted fix: ${f.rule}`);
    else { const v = s.visuals.find((x) => x.id === tg.visualId); need(v, 404, 'Image not found'); if (tg.type === 'transcript') v.transcript = apply(v.transcript || ''); else v.alt = g.replacement; }
    audit(s, user, 'accepted_fix', `${f.rule} (${f.source.id})${g.status === 'intent_warning' ? ' [intent warning acknowledged]' : ''}`);
    event(f.rule, 'accepted', s);
    await runReview(s); store.save(); return view(s);
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/findings\/(\w+)\/dismiss$/, null, async ({ user, params, body }) => {
    const s = getSub(user, params[0]);
    const f = s.findings.find((x) => x.id === params[1] && x.status === 'open');
    need(f, 404, 'Finding not found. Refresh.');
    const reason = str(body.reason || '', 300, 'reason').trim();
    need(reason.length >= 5, 400, 'A short reason (5+ characters) is required to dismiss');
    const privileged = ['reviewer', 'admin'].includes(user.role);
    need(privileged || (owns(user, s) && EDITABLE.includes(s.status) && f.lane !== 'red'), 403,
      f.lane === 'red' ? 'Critical (red) findings can only be dismissed by a reviewer or admin' : 'Not allowed');
    s.dismissed[f.key] = { reason, by: user.name, at: nowIso() };
    f.status = 'dismissed';
    audit(s, user, 'dismissed', `${f.rule}: ${reason}`);
    event(f.rule, f.lane === 'red' ? 'overridden' : 'dismissed', s);
    s.lane = engine.highestLane(s.findings); s.updatedAt = nowIso(); store.save(); return view(s);
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/submit$/, null, async ({ user, params }) => {
    const s = getSub(user, params[0]);
    need(owns(user, s) && EDITABLE.includes(s.status), 403, 'Only the owner can submit a draft');
    s.status = 'in_review'; audit(s, user, 'submitted_for_review', `lane ${s.lane}`); s.updatedAt = nowIso(); store.save(); return view(s);
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/comments$/, null, async ({ user, params, body }) => {
    const s = getSub(user, params[0]);
    const c = { id: crypto.randomUUID(), by: user.name, role: user.role, at: nowIso(), text: str(body.text || '', 1000, 'text').trim(), findingId: body.findingId || null };
    need(c.text, 400, 'Comment is empty');
    s.comments.push(c); audit(s, user, 'commented', c.text.slice(0, 60)); s.updatedAt = nowIso(); store.save(); return view(s);
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/decision$/, ['manager', 'reviewer', 'admin'], async ({ user, params, body }) => {
    const s = getSub(user, params[0]);
    need(s.status === 'in_review', 400, 'Submission is not waiting for review');
    if (body.decision === 'request_changes') {
      s.status = 'changes_requested'; audit(s, user, 'changes_requested', str(body.note || '', 500, 'note'));
    } else if (body.decision === 'approve') {
      const open = s.findings.filter((f) => f.status === 'open');
      const reds = open.filter((f) => f.lane === 'red');
      if (reds.length) {
        need(['reviewer', 'admin'].includes(user.role), 403, 'Open critical (red) findings need an authorised reviewer to approve');
        const why = str(body.overrideReason || '', 500, 'overrideReason').trim();
        need(why.length >= 10, 400, 'A written override reason (10+ characters) is required to approve with open critical findings');
        reds.forEach((f) => event(f.rule, 'overridden', s));
        audit(s, user, 'approved_with_override', `${reds.length} critical finding(s). Reason: ${why}`);
      } else audit(s, user, 'approved', `${open.length} open minor/major finding(s)`);
      s.status = 'approved';
      const prev = db().receipts.length ? db().receipts[db().receipts.length - 1].hash : 'GENESIS';
      const r = receipt.build(s, db().brain, user, prev, db().ledger.filter((l) => l.submissionId === s.id).length, 'R-' + (db().receipts.length + 1), nowIso());
      db().receipts.push(r); s.receiptId = r.id; audit(s, user, 'receipt_issued', r.id);
    } else throw new HttpError(400, 'decision must be approve or request_changes');
    s.updatedAt = nowIso(); store.save(); return view(s);
  });

  // ---- Visual review (the image stays in the browser; only a small summary is sent) ----
  const editableBy = (user, s) => { need(owns(user, s) && EDITABLE.includes(s.status), 403, 'Only the owner can change images, and only before review'); };
  const hexOk = (h) => h === '' || /^#[0-9a-fA-F]{6}$/.test(h || '');
  const cleanVisual = (b, old = {}) => {
    const dom = (Array.isArray(b.dominant) ? b.dominant : old.dominant || []).slice(0, 8).filter((d) => /^#[0-9a-fA-F]{6}$/.test(d.hex) && d.share >= 0 && d.share <= 1).map((d) => ({ hex: d.hex.toUpperCase(), share: +d.share }));
    need(hexOk(b.fg === undefined ? old.fg || '' : b.fg) && hexOk(b.bg === undefined ? old.bg || '' : b.bg), 400, 'Colours must look like #AABBCC');
    const pick = (k, max) => (b[k] === undefined ? old[k] || '' : str(String(b[k]), max, k));
    return { name: pick('name', 120) || 'image', width: +b.width || old.width || 0, height: +b.height || old.height || 0, bytes: +b.bytes || old.bytes || 0, type: pick('type', 40),
      dominant: dom, alt: pick('alt', 500), transcript: pick('transcript', 5000), fg: pick('fg', 7), bg: pick('bg', 7),
      hasText: b.hasText === undefined ? !!old.hasText : !!b.hasText, logo: b.logo === undefined ? (old.logo === undefined ? null : old.logo) : (b.logo === true || b.logo === false ? b.logo : null) };
  };
  R('POST', /^\/api\/submissions\/([\w-]+)\/visuals$/, null, async ({ user, params, body }) => {
    const s = getSub(user, params[0]); editableBy(user, s);
    need(s.visuals.length < 10, 400, 'At most 10 images per item');
    const v = { id: crypto.randomUUID().slice(0, 8), ...cleanVisual(body) };
    need(v.width > 0 && v.height > 0, 400, 'Image size is missing');
    s.visuals.push(v); audit(s, user, 'image_added', v.name);
    ledger(user, 'visual_summary', s, `Colour summary and metadata for "${v.name}" received (${JSON.stringify(v).length} bytes). The image itself stayed in the browser.`);
    await runReview(s); store.save(); return view(s);
  });
  R('PUT', /^\/api\/submissions\/([\w-]+)\/visuals\/(\w+)$/, null, async ({ user, params, body }) => {
    const s = getSub(user, params[0]); editableBy(user, s);
    const i = s.visuals.findIndex((x) => x.id === params[1]); need(i >= 0, 404, 'Image not found');
    s.visuals[i] = { ...cleanVisual(body, s.visuals[i]), id: s.visuals[i].id }; audit(s, user, 'image_updated', s.visuals[i].name);
    await runReview(s); store.save(); return view(s);
  });
  R('DELETE', /^\/api\/submissions\/([\w-]+)\/visuals\/(\w+)$/, null, async ({ user, params }) => {
    const s = getSub(user, params[0]); editableBy(user, s);
    const v = s.visuals.find((x) => x.id === params[1]); need(v, 404, 'Image not found');
    s.visuals = s.visuals.filter((x) => x !== v); audit(s, user, 'image_removed', v.name);
    await runReview(s); store.save(); return view(s);
  });
  R('POST', /^\/api\/visual\/contrast$/, null, async ({ body }) => {
    const r = visual.contrast(body.fg, body.bg); need(r !== null, 400, 'Enter two colours like #1F2A44');
    return { ratio: r, aaNormal: r >= 4.5, aaLarge: r >= 3, aaaNormal: r >= 7, suggestedForeground: r >= 4.5 ? null : visual.suggestForeground(body.fg, body.bg) };
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/withdraw$/, null, async ({ user, params }) => {
    const s = getSub(user, params[0]);
    need(owns(user, s) && s.status === 'in_review', 403, 'Only the owner can withdraw an item that is in review');
    s.status = 'draft'; audit(s, user, 'withdrawn', ''); s.updatedAt = nowIso(); store.save(); return view(s);
  });

  // ---- Guideline Debugger ----
  R('GET', /^\/api\/debugger$/, ['manager', 'reviewer', 'admin'], async () => ({ rules: dbg.analyze(db()), proposals: db().proposals, stress: db().stress, history: db().brainHistory.slice(-20) }));
  R('POST', /^\/api\/debugger\/propose$/, ['manager', 'admin'], async ({ user }) => { const made = dbg.propose(db(), user); store.save(); return { created: made.length, proposals: db().proposals }; });
  R('POST', /^\/api\/debugger\/proposals\/([\w-]+)\/approve$/, ['admin'], async ({ user, params, body }) => {
    const p = db().proposals.find((x) => x.id === params[0]); need(p && p.status === 'pending', 404, 'Proposal not found or already decided');
    const text = str(body.text || p.proposedText, 1000, 'text');
    const c = db().brain.clauses.find((x) => x.id === p.clauseId); need(c, 404, 'Clause no longer exists');
    const quotes = Object.values(db().brain.ruleMap).concat(db().brain.terms || []).filter((r) => r.clauseId === c.id).map((r) => r.quote);
    need(quotes.every((q) => text.includes(q)), 400, 'The edited text no longer contains the wording that findings cite. Keep that wording so Proof Cards stay verifiable.');
    db().brainHistory.push({ clauseId: c.id, oldText: c.text, newText: text, by: user.name, at: nowIso(), proposalId: p.id });
    c.text = text; c.updatedAt = nowIso(); p.status = 'approved'; p.decidedBy = user.name; p.decidedAt = nowIso(); store.save(); return p;
  });
  R('POST', /^\/api\/debugger\/proposals\/([\w-]+)\/reject$/, ['admin'], async ({ user, params, body }) => {
    const p = db().proposals.find((x) => x.id === params[0]); need(p && p.status === 'pending', 404, 'Proposal not found or already decided');
    p.status = 'rejected'; p.reason = str(body.reason || '', 300, 'reason'); p.decidedBy = user.name; p.decidedAt = nowIso(); store.save(); return p;
  });
  R('POST', /^\/api\/debugger\/stress$/, ['manager', 'reviewer', 'admin'], async ({ user }) => { db().stress = { ...dbg.stressTest(db().brain), by: user.name }; store.save(); return db().stress; });
  R('POST', /^\/api\/debugger\/demo-activity$/, ['admin'], async ({ user }) => {
    const creator = db().users.find((u) => u.role === 'creator');
    const reasons = ['Quoting a customer survey verbatim', 'Direct quote from a customer interview', 'Legal name of a partner product', 'Quoting a customer survey verbatim'];
    for (let i = 0; i < 4; i++) {
      const sub = { id: crypto.randomUUID(), title: `[Demo ${i + 1}] Survey quote post`, contentType: 'social post', channel: 'demo', ownerId: creator.id, ownerName: creator.name, status: 'draft', lane: 'green',
        intent: { goal: 'Share customer feedback', audience: 'Customers', keyMessage: '', mustKeep: [] }, content: '', versions: [], visuals: [], findings: [], dismissed: {}, seen: {}, comments: [], audit: [], createdAt: nowIso(), updatedAt: nowIso() };
      addVersion(sub, `One customer said: "The users in my team love it" (survey ${i + 1}).`, creator, 'Created (demo activity)'); audit(sub, creator, 'created', 'demo activity');
      await runReview(sub);
      for (const f of sub.findings.filter((x) => x.rule === 'terminology')) { sub.dismissed[f.key] = { reason: reasons[i], by: creator.name, at: nowIso() }; f.status = 'dismissed'; event(f.rule, 'dismissed', sub); }
      sub.lane = engine.highestLane(sub.findings); db().submissions.push(sub);
    }
    store.save(); return { ok: true, created: 4 };
  });

  // ---- Review Receipts and Privacy Ledger ----
  R('GET', /^\/api\/receipts$/, null, async ({ user }) => db().receipts.filter((r) => user.role !== 'creator' || (db().submissions.find((s) => s.id === r.submissionId) || {}).ownerId === user.id)
    .map((r) => ({ id: r.id, title: r.title, approvedAt: r.approvedAt, approvedBy: r.approvedBy, decision: r.decision, hash: r.hash })).reverse());
  R('GET', /^\/api\/receipts\/([\w-]+)$/, null, async ({ user, params }) => {
    const r = db().receipts.find((x) => x.id === params[0]); need(r, 404, 'Receipt not found');
    const s = db().submissions.find((x) => x.id === r.submissionId); need(s && canSee(user, s), 403, 'Not allowed'); return r;
  });
  R('POST', /^\/api\/receipts\/verify$/, ['manager', 'reviewer', 'admin'], async () => receipt.verify(db().receipts, db().submissions));
  R('POST', /^\/api\/receipts\/([\w-]+)\/export$/, null, async ({ user, params }) => {
    const r = db().receipts.find((x) => x.id === params[0]); need(r, 404, 'Receipt not found');
    const s = db().submissions.find((x) => x.id === r.submissionId); need(s && canSee(user, s), 403, 'Not allowed');
    ledger(user, 'receipt_export', s, `Receipt ${r.id} exported (hashes only, no content text).`); store.save(); return r;
  });
  R('POST', /^\/api\/submissions\/([\w-]+)\/export$/, null, async ({ user, params, body }) => {
    const s = getSub(user, params[0]);
    const withContent = !!body.withContent;
    if (withContent) { need(['manager', 'reviewer', 'admin'].includes(user.role) || owns(user, s), 403, 'Not allowed'); need(String(body.reason || '').trim().length >= 5, 400, 'Say why you are exporting the text (5+ characters)'); }
    ledger(user, 'content_export', s, withContent ? `Content text exported. Reason: ${String(body.reason).slice(0, 200)}` : 'Summary exported without content text.');
    store.save();
    return { title: s.title, status: s.status, lane: s.lane, owner: s.ownerName, versions: s.versions.length, openFindings: s.findings.filter((f) => f.status === 'open').length,
      images: s.visuals.map((v) => ({ name: v.name, alt: v.alt })), content: withContent ? s.content : '[redacted: export without content]' };
  });
  R('GET', /^\/api\/ledger$/, ['manager', 'reviewer', 'admin'], async () => {
    const entries = db().ledger.slice(-200).reverse(); const byKind = {};
    db().ledger.forEach((l) => { byKind[l.kind] = (byKind[l.kind] || 0) + 1; });
    return { externalServiceCalls: 0, byKind, entries, inventory: [
      { data: 'Submitted text and version history', where: 'Server database file', leaves: 'Only through an export you trigger' },
      { data: 'Images', where: 'Your browser only', leaves: 'Never. Only a colour summary and size are sent' },
      { data: 'DOCX and PDF files', where: 'Your browser only', leaves: 'Never. Only the text you choose to submit is sent' },
      { data: 'Brand Brain and receipts', where: 'Server database file', leaves: 'Receipts export hashes only' }] };
  });

  R('GET', /^\/api\/insights$/, ['manager', 'reviewer', 'admin'], async () => {
    const byRule = {};
    for (const e of db().events) { const r = (byRule[e.rule] = byRule[e.rule] || { rule: e.rule, raised: 0, accepted: 0, dismissed: 0, overridden: 0 }); r[e.action]++; }
    const rules = Object.values(byRule).map((r) => {
      const rate = r.raised ? +((r.dismissed + r.overridden) / r.raised).toFixed(2) : 0;
      return { ...r, dismissRate: rate, possiblyUnclear: r.raised >= 3 && rate >= 0.5 };
    }).sort((a, b) => b.raised - a.raised);
    const subs = db().submissions;
    const status = {}; subs.forEach((s) => { status[s.status] = (status[s.status] || 0) + 1; });
    const pair = {};
    for (const e of db().events) if (e.action === 'raised' && e.owner) { const k = e.owner + '|' + e.rule; pair[k] = (pair[k] || 0) + 1; }
    const repeated = Object.entries(pair).filter(([, n]) => n >= 2).map(([k, n]) => ({ owner: k.split('|')[0], rule: k.split('|')[1], times: n })).sort((a, b) => b.times - a.times).slice(0, 10);
    return { totalSubmissions: subs.length, byStatus: status, rules, repeated };
  });

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'");
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = routes.map((r) => ({ r, m: url.pathname.match(r.re) })).find((x) => x.m && x.r.method === req.method);
        need(route, 404, 'Not found');
        let user = null;
        if (route.r.roles !== 'public') {
          const p = auth.verifyToken((req.headers.authorization || '').replace(/^Bearer /, ''), db().secret);
          user = p && db().users.find((u) => u.id === p.uid);
          need(user, 401, 'Please log in');
          need(!Array.isArray(route.r.roles) || route.r.roles.includes(user.role), 403, 'Your role cannot do this');
        }
        let body = {};
        if (req.method === 'POST' || req.method === 'PUT') {
          const chunks = []; let size = 0;
          for await (const c of req) { size += c.length; need(size < 1e6, 413, 'Request too large'); chunks.push(c); }
          try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
        }
        const out = await route.r.fn({ req, user, body, params: route.m.slice(1) });
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
      }
      let file = url.pathname === '/' ? '/index.html' : url.pathname;
      const full = path.join(__dirname, 'public', path.normalize(file));
      need(full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile(), 404, 'Not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : 500;
      if (code === 500) console.error(e);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: code === 500 ? 'Server error' : e.message }));
    }
  }
  return http.createServer(handler);
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`BrandProof running on http://localhost:${port}`));
}
module.exports = { createApp };
