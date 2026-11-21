'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { token: sessionStorage.getItem('bp_token'), user: null, view: 'list', current: null, receipt: null, draft: null, pv: null, filter: { q: '', status: '', lane: '' }, busy: false, focus: false };

const SAMPLES = [
  'Nimbus Pay is the #1 fastest way to pay!! Our users get guaranteed cashback of 5% on EVERY order. Nimbus Pay now charges just 0.5% fee on every card payment. Click here to see where Nimbus Pay is available in 9 countries.',
  'Meet Nimbus Pay. Our customers can pay in 12 currencies with a 1% fee on every card payment.',
  'Our cheap plans are loved by every user! ![](banner.png) Rewards are waiting for you.'
];

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) logout();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function say(text, good) { $('#msg').innerHTML = text ? `<div class="${good ? 'good' : 'err'}">${esc(text)}</div>` : ''; }
function logout() { S.token = null; S.user = null; sessionStorage.removeItem('bp_token'); render(); }
const laneBadge = (l) => `<span class="badge b-${esc(l)}">${esc({ green: 'Green', amber: 'Amber', red: 'Red' }[l] || l)}</span>`;
const statusLabel = (s) => ({ draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved' }[s] || s);
const can = (...roles) => S.user && roles.includes(S.user.role);
const fmt = (iso) => new Date(iso).toLocaleString();
const hx = (h) => (/^#[0-9a-fA-F]{6}$/.test(h) ? h : '#000000');
const swatch = (h) => `<svg width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="colour ${esc(h)}"><rect width="14" height="14" rx="2" fill="${hx(h)}" stroke="#888"/></svg>`;
const STAFF = ['manager', 'reviewer', 'admin'];

function nav() {
  if (!S.user) { $('#nav').innerHTML = ''; return; }
  const items = [['list', 'Submissions'], ['new', 'New content'], ['brain', 'Brand Brain'], ['receipts', 'Receipts']];
  if (can(...STAFF)) items.push(['insights', 'Insights'], ['debugger', 'Guideline Debugger'], ['ledger', 'Privacy Ledger']);
  const cur = S.view === 'detail' ? 'list' : S.view === 'receipt' ? 'receipts' : S.view;
  $('#nav').innerHTML = items.map(([v, t]) => `<button data-nav="${v}" class="${cur === v ? 'on' : ''}" ${cur === v ? 'aria-current="page"' : ''}>${t}</button>`).join('') +
    `<span class="small">${esc(S.user.name)} (${esc(S.user.role)})</span><button data-act="logout">Log out</button>`;
}

async function render() {
  nav();
  const m = $('#main');
  try {
    if (!S.token) { m.innerHTML = loginView(); return; }
    if (!S.user) S.user = (await api('GET', '/api/me')).user;
    nav();
    const v = { list: listView, new: newView, detail: detailView, brain: brainView, insights: insightsView, debugger: debuggerView, receipts: receiptsView, receipt: receiptView, ledger: ledgerView }[S.view];
    m.innerHTML = await v();
    if (S.focus) { S.focus = false; m.focus(); }
  } catch (e) { say(e.message); }
}

function loginView() {
  return `<div class="card"><h1>Log in</h1>
  <p>Demo accounts (password <b>demo1234</b>): creator@demo.com, manager@demo.com, reviewer@demo.com, admin@demo.com</p>
  <form data-form="login"><label for="em">Email</label><input id="em" type="email" required value="creator@demo.com" autocomplete="username">
  <label for="pw">Password</label><input id="pw" type="password" required value="demo1234" autocomplete="current-password">
  <div class="actions"><button type="submit">Log in</button></div></form>
  <div class="actions"><span class="small">Quick switch:</span>${['creator', 'manager', 'reviewer', 'admin'].map((r) => `<button class="ghost" data-act="quick" data-role="${r}">${r}</button>`).join('')}</div></div>
  <div class="card"><h2>How BrandProof works</h2><ol><li>An admin loads approved guidelines and facts (the Brand Brain).</li><li>A creator submits text, images, a DOCX or a PDF, and says what must be kept.</li>
  <li>Every finding cites its source. Fixes are tested against the creator's intent.</li><li>Managers and reviewers approve. Approval issues a tamper-evident receipt.</li><li>The Guideline Debugger shows which rules are unclear and tests every rule.</li></ol></div>`;
}

async function listView() {
  const all = await api('GET', '/api/submissions'), f = S.filter;
  const rows = all.filter((r) => (!f.status || r.status === f.status) && (!f.lane || r.lane === f.lane) && (!f.q || r.title.toLowerCase().includes(f.q.toLowerCase())));
  const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`;
  const empty = all.length ? '<p>No submissions match these filters.</p>' : `<div><p><b>Nothing here yet.</b> Start with a sample to see how a review works.</p><div class="actions"><button data-nav="new">Create content</button></div></div>`;
  return `<h1>Submissions</h1><div class="card"><div class="row"><div><label for="fq">Search title</label><input id="fq" data-filter="q" value="${esc(f.q)}"></div>
  <div><label for="fs">Status</label><select id="fs" data-filter="status">${opt('', 'All', f.status)}${['draft', 'in_review', 'changes_requested', 'approved'].map((x) => opt(x, statusLabel(x), f.status)).join('')}</select></div>
  <div><label for="fl">Lane</label><select id="fl" data-filter="lane">${opt('', 'All', f.lane)}${['green', 'amber', 'red'].map((x) => opt(x, x, f.lane)).join('')}</select></div></div></div>
  <div class="card">${rows.length ? `<div class="scroll"><table><thead><tr><th>Title</th><th>Status</th><th>Lane</th><th>Open findings</th><th>Owner</th><th>Updated</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td><button class="ghost" data-act="open" data-id="${esc(r.id)}">${esc(r.title)}</button></td><td>${esc(statusLabel(r.status))}</td><td>${laneBadge(r.lane)}</td><td>${r.openFindings}</td><td>${esc(r.ownerName)}</td><td>${esc(fmt(r.updatedAt))}</td></tr>`).join('') + `</tbody></table></div>` : empty}</div>`;
}

function newView() {
  const d = S.draft || { title: '', contentType: 'social post', channel: '', content: '', intent: null };
  const it = d.intent || { goal: '', audience: '', keyMessage: '', mustKeep: [] };
  return `<h1>New content</h1><div class="card"><form data-form="create">
  <label for="t">Title</label><input id="t" required maxlength="120" value="${esc(d.title)}">
  <div class="row"><div><label for="ct">Content type</label><select id="ct">${['social post', 'blog', 'ad', 'banner', 'email', 'slide'].map((x) => `<option ${x === d.contentType ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
  <div><label for="ch">Channel</label><input id="ch" maxlength="60" placeholder="e.g. LinkedIn" value="${esc(d.channel)}"></div></div>
  <label for="c">Content (plain text or Markdown, up to 20,000 characters)</label><textarea id="c" required maxlength="20000">${esc(d.content)}</textarea>
  <label for="imp">Or import a file (.docx, text-based .pdf, .txt, .md). The file is read in your browser and never uploaded.</label><input id="imp" type="file" accept=".docx,.pdf,.txt,.md">
  <div class="actions"><span class="small">Try a sample:</span>${SAMPLES.map((_, i) => `<button type="button" class="ghost" data-act="sample" data-i="${i}">Sample ${i + 1}</button>`).join('')}</div>
  <h2>Intent Lock</h2><p class="small">Tell us what you mean. Suggested fixes are tested against this, and any fix that removes a must-keep item is flagged.</p>
  <div class="actions"><button type="button" class="ghost" data-act="intent">Suggest intent from my content</button></div>
  <label for="g">Goal</label><input id="g" value="${esc(it.goal)}"><label for="a">Audience</label><input id="a" value="${esc(it.audience)}">
  <label for="k">Key message</label><input id="k" value="${esc(it.keyMessage)}">
  <label for="m">Must-keep items (comma separated)</label><input id="m" value="${esc((it.mustKeep || []).join(', '))}">
  <div class="actions"><button type="submit">Run review</button></div></form></div>`;
}
function readDraft() {
  return { title: $('#t').value, contentType: $('#ct').value, channel: $('#ch').value, content: $('#c').value,
    intent: { goal: $('#g').value, audience: $('#a').value, keyMessage: $('#k').value, mustKeep: $('#m').value.split(',').map((x) => x.trim()).filter(Boolean) } };
}

async function importFile(file) {
  if (file.size > 10e6) throw new Error('File is larger than 10 MB.');
  const name = file.name.toLowerCase(), u8 = new Uint8Array(await file.arrayBuffer());
  const inflate = (fmtName) => async (d) => {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open DOCX or PDF files. Paste the text instead.');
    const ds = new DecompressionStream(fmtName), w = ds.writable.getWriter(); w.write(d); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  };
  if (name.endsWith('.docx')) return window.BPExtract.docxText(u8, { inflateRaw: inflate('deflate-raw') });
  if (name.endsWith('.pdf')) return window.BPExtract.pdfText(u8, { inflate: inflate('deflate') });
  if (/\.(txt|md)$/.test(name)) return new TextDecoder().decode(u8);
  throw new Error('Supported files: .docx, .pdf, .txt, .md');
}
function analyzeImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 20e6) return reject(new Error('Image is larger than 20 MB.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || 300, h = img.naturalHeight || 150, sc = Math.min(1, 96 / Math.max(w, h));
        const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc));
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0, cv.width, cv.height);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data, b = {}; let n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; const k = (d[i] >> 5) + ',' + (d[i + 1] >> 5) + ',' + (d[i + 2] >> 5); const o = b[k] || (b[k] = { n: 0, r: 0, g: 0, b: 0 }); o.n++; o.r += d[i]; o.g += d[i + 1]; o.b += d[i + 2]; n++; }
        const dominant = Object.values(b).sort((x, y) => y.n - x.n).slice(0, 6).map((o) => ({ hex: '#' + [o.r, o.g, o.b].map((v) => Math.round(v / o.n).toString(16).padStart(2, '0')).join('').toUpperCase(), share: +(o.n / n).toFixed(3) }));
        URL.revokeObjectURL(url); resolve({ name: file.name, width: w, height: h, bytes: file.size, type: file.type, dominant });
      } catch (e) { reject(new Error('Could not analyse this image.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be read. Use PNG, JPG, WebP or SVG.')); };
    img.src = url;
  });
}

function highlight(content, findings) {
  const open = findings.filter((f) => f.status === 'open' && (f.target || { type: 'content' }).type === 'content' && f.flagged.end > f.flagged.start).sort((a, b) => a.flagged.start - b.flagged.start);
  let out = '', pos = 0;
  for (const f of open) { if (f.flagged.start < pos) continue; out += esc(content.slice(pos, f.flagged.start)) + `<mark class="lane-${esc(f.lane)}">${esc(content.slice(f.flagged.start, f.flagged.end))}</mark>`; pos = f.flagged.end; }
  return out + esc(content.slice(pos));
}
function targetText(f, s) {
  const t = f.target || { type: 'content' }; if (t.type === 'content') return s.content;
  const v = s.visuals.find((x) => x.id === t.visualId) || {}; return t.type === 'transcript' ? v.transcript || '' : v.alt || '';
}
function findingCard(f, s) {
  const editable = S.user.id === s.ownerId && ['draft', 'changes_requested'].includes(s.status), open = f.status === 'open', g = f.suggestion;
  const canDismiss = open && (can('reviewer', 'admin') || (editable && f.lane !== 'red'));
  let sug = '';
  if (g) {
    const was = targetText(f, s).slice(g.start, g.end);
    sug = `<div class="quote diff"><b>Suggested fix:</b> ${g.end > g.start ? `<del>${esc(was)}</del> ` : ''}<ins>${esc(g.replacement.trim() || '(remove)')}</ins>
    <div class="small">${g.status === 'safe' ? `<span class="badge b-green">Intent safe</span>` : `<span class="badge b-amber">Intent warning</span> This changes must-keep: ${esc(g.intent.missing.join(', ') || 'meaning')}. Accept only if intended.`} Similarity ${g.intent.similarity}</div></div>`;
  } else if (f.advice) sug = `<div class="quote"><b>What to do:</b> ${esc(f.advice)}</div>`;
  return `<div class="card finding lane-${esc(f.lane)} ${open ? '' : 'done'}"><h3>${laneBadge(f.lane)} ${esc(f.title)} ${open ? '' : `<span class="badge b-grey">${esc(f.status)}</span>`}</h3>
  <div class="meta">${esc(f.scope || 'Text')}</div><div>Flagged: <mark class="lane-${esc(f.lane)}">${esc(f.flagged.text)}</mark></div><p>${esc(f.why)}</p>
  <div class="quote"><b>Source ${esc(f.source.type)} ${esc(f.source.id)}:</b> "${esc(f.source.quote)}" ${f.verified ? '<span class="badge b-green">Source verified</span>' : '<span class="badge b-amber">Not verified: needs a human</span>'}</div>
  ${sug}<div class="meta">Method: ${esc(f.method)} | Confidence ${f.confidence}</div>
  ${open ? `<div class="actions">${g && editable ? `<button class="ok" data-act="accept" data-fid="${esc(f.id)}">Accept fix</button>` : ''}
  ${canDismiss ? `<input id="r-${esc(f.id)}" placeholder="Reason to dismiss (required)" aria-label="Reason to dismiss ${esc(f.title)}"><button class="ghost" data-act="dismiss" data-fid="${esc(f.id)}">Dismiss</button>` : ''}</div>` : ''}</div>`;
}

function visualCard(v, editable) {
  const dis = editable ? '' : 'disabled';
  return `<div class="card"><h3>${esc(v.name)} <span class="meta">${v.width}x${v.height}px, ${(v.bytes / 1024).toFixed(0)} KB, ${esc(v.type)}</span></h3>
  <div>${(v.dominant || []).map((d) => `${swatch(d.hex)} <span class="small">${esc(d.hex)} ${Math.round(d.share * 100)}%</span>`).join(' &nbsp; ')}</div>
  <label for="al-${esc(v.id)}">Alt text</label><input id="al-${esc(v.id)}" maxlength="500" value="${esc(v.alt)}" ${dis}>
  <label for="tr-${esc(v.id)}">Text shown in the image (type it here; it is checked like normal text)</label><textarea id="tr-${esc(v.id)}" maxlength="5000" ${dis}>${esc(v.transcript)}</textarea>
  <div class="row"><div><label><input type="checkbox" id="ht-${esc(v.id)}" ${v.hasText ? 'checked' : ''} ${dis}> Image contains text (check contrast)</label></div>
  <div><label for="fg-${esc(v.id)}">Text colour</label><input id="fg-${esc(v.id)}" placeholder="#RRGGBB" value="${esc(v.fg)}" ${dis}></div><div><label for="bg-${esc(v.id)}">Background</label><input id="bg-${esc(v.id)}" placeholder="#RRGGBB" value="${esc(v.bg)}" ${dis}></div>
  <div><label for="lg-${esc(v.id)}">Logo present?</label><select id="lg-${esc(v.id)}" ${dis}><option value="" ${v.logo === null ? 'selected' : ''}>Not sure</option><option value="yes" ${v.logo === true ? 'selected' : ''}>Yes</option><option value="no" ${v.logo === false ? 'selected' : ''}>No</option></select></div></div>
  ${editable ? `<div class="actions"><button data-act="vsave" data-vid="${esc(v.id)}">Save and re-check</button><button class="danger" data-act="vremove" data-vid="${esc(v.id)}">Remove image</button></div>` : ''}</div>`;
}

function detailView() {
  const s = S.current; if (!s) return '<p>Nothing selected.</p>';
  const mine = S.user.id === s.ownerId, editable = mine && ['draft', 'changes_requested'].includes(s.status);
  const reviewer = can(...STAFF) && s.status === 'in_review', reds = s.findings.filter((f) => f.status === 'open' && f.lane === 'red').length;
  const open = s.findings.filter((f) => f.status === 'open').length;
  return `<h1>${esc(s.title)}</h1>
  <div class="card"><div>${laneBadge(s.lane)} <span class="badge b-grey">${esc(statusLabel(s.status))}</span> <span class="meta">by ${esc(s.ownerName)} | ${esc(s.contentType)} | version ${s.versions.length}</span>
  ${s.receiptId ? `<button class="ghost" data-act="openreceipt" data-id="${esc(s.receiptId)}">Receipt ${esc(s.receiptId)}</button>` : ''}</div>
  <h2>Content with flagged passages</h2><div class="content">${highlight(s.content, s.findings)}</div>
  <p class="small"><b>Intent:</b> ${esc(s.intent.goal)} | Audience: ${esc(s.intent.audience)} | Must keep: ${(s.intent.mustKeep || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('') || 'none'}</p>
  ${editable ? `<label for="ed">Edit content (creates a new version and re-runs the review)</label><textarea id="ed" maxlength="20000">${esc(s.content)}</textarea>
  <div class="actions"><button data-act="save">Save and re-review</button><button class="ok" data-act="submit">Submit for approval</button></div>` : ''}
  ${mine && s.status === 'in_review' ? `<div class="actions"><button class="ghost" data-act="withdraw">Withdraw to edit</button></div>` : ''}
  <div class="actions"><button class="ghost" data-act="export">Export summary (no text)</button>${can(...STAFF) || mine ? `<input id="exr" placeholder="Reason, to export with text" aria-label="Reason to export with text"><button class="ghost" data-act="exportfull">Export with text</button>` : ''}</div>
  <div id="exo"></div></div>
  <h2>Images (${s.visuals.length})</h2>
  ${s.visuals.map((v) => visualCard(v, editable)).join('') || '<div class="card small">No images attached. Images are analysed in your browser; only a colour summary and size are sent.</div>'}
  ${editable ? `<div class="card"><h3>Add an image</h3><label for="vf">Choose a PNG, JPG, WebP or SVG</label><input id="vf" type="file" accept="image/*"><div id="vsum" class="small" aria-live="polite">${S.pv ? `${esc(S.pv.name)}: ${S.pv.width}x${S.pv.height}px, ${S.pv.dominant.length} dominant colours found` : ''}</div>
  <label for="va">Alt text</label><input id="va" maxlength="500"><label for="vt">Text shown in the image</label><textarea id="vt" maxlength="5000"></textarea>
  <div class="row"><div><label><input type="checkbox" id="vh"> Image contains text</label></div><div><label for="vfg">Text colour</label><input id="vfg" placeholder="#RRGGBB"></div><div><label for="vbg">Background</label><input id="vbg" placeholder="#RRGGBB"></div>
  <div><label for="vl">Logo present?</label><select id="vl"><option value="">Not sure</option><option value="yes">Yes</option><option value="no">No</option></select></div></div>
  <div class="actions"><button data-act="vadd">Add image</button></div>
  <h3>Contrast checker</h3><div class="row"><div><label for="cfg">Text colour</label><input id="cfg" placeholder="#777777"></div><div><label for="cbg">Background</label><input id="cbg" placeholder="#FFFFFF"></div></div>
  <div class="actions"><button class="ghost" data-act="contrast">Check contrast</button></div><div id="cres" aria-live="polite"></div></div>` : ''}
  <h2>Findings (${open} open)</h2>
  ${s.findings.length ? s.findings.map((f) => findingCard(f, s)).join('') : '<div class="card">No issues found against the Brand Brain.</div>'}
  ${reviewer ? `<div class="card"><h2>Decision</h2>${reds ? `<p class="err">${reds} open critical finding(s): only a reviewer or admin may approve, with a written reason.</p>` : ''}
  <label for="dn">Note / override reason</label><input id="dn" placeholder="Required for changes or red-lane approval">
  <div class="actions"><button class="ok" data-act="approve">Approve</button><button class="danger" data-act="changes">Request changes</button></div></div>` : ''}
  <div class="card"><h2>Comments</h2>${s.comments.map((c) => `<p><b>${esc(c.by)}</b> (${esc(c.role)}) <span class="meta">${esc(fmt(c.at))}</span><br>${esc(c.text)}</p>`).join('') || '<p class="meta">No comments yet.</p>'}
  <label for="cm">Add a comment</label><input id="cm" maxlength="1000"><div class="actions"><button class="ghost" data-act="comment">Post comment</button></div></div>
  <div class="card"><h2>Version history</h2><ul class="log">${s.versions.map((v) => `<li>v${v.n} - ${esc(v.reason)} by ${esc(v.by)} (${esc(fmt(v.at))})</li>`).join('')}</ul>
  <h2>Audit log</h2><ul class="log">${s.audit.map((a) => `<li>${esc(fmt(a.at))} - ${esc(a.by)} (${esc(a.role)}): ${esc(a.action)} ${esc(a.detail)}</li>`).join('')}</ul></div>`;
}

async function brainView() {
  const b = await api('GET', '/api/brain'), admin = can('admin');
  return `<h1>Brand Brain</h1><p class="meta">${esc(b.org)}. Every finding cites one of these clauses or facts.</p>
  <div class="card"><h2>Brand palette</h2><p>${b.palette.map((p) => `${swatch(p.hex)} ${esc(p.name)} ${esc(p.hex)}`).join(' &nbsp; ')}</p></div>
  <div class="card"><h2>Guideline clauses</h2><div class="scroll"><table><thead><tr><th>ID</th><th>Section</th><th>Text</th></tr></thead><tbody>${b.clauses.map((c) => `<tr><td>${esc(c.id)}</td><td>${esc(c.section)}</td><td>${esc(c.text)}</td></tr>`).join('')}</tbody></table></div>
  ${admin ? `<h3>Add or update a clause</h3><form data-form="clause"><div class="row"><div><label for="ci">ID</label><input id="ci" required pattern="[\\w.\\-]{1,20}"></div><div><label for="cs">Section</label><input id="cs" required maxlength="40"></div></div><label for="ct2">Text</label><input id="ct2" required maxlength="1000"><div class="actions"><button type="submit">Save clause</button></div></form>` : ''}</div>
  <div class="card"><h2>Approved facts</h2><div class="scroll"><table><thead><tr><th>ID</th><th>Fact</th><th>Owner</th><th>Review by</th></tr></thead><tbody>${b.facts.map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.text)}</td><td>${esc(f.owner)}</td><td>${esc(f.reviewBy)} ${new Date(f.reviewBy + 'T23:59:59Z') < new Date() ? '<span class="badge b-amber">Expired</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
  ${admin ? `<h3>Add or update a fact</h3><form data-form="fact"><div class="row"><div><label for="fi">ID</label><input id="fi" required pattern="[\\w.\\-]{1,20}"></div><div><label for="fo">Owner</label><input id="fo" maxlength="60"></div><div><label for="fr">Review by</label><input id="fr" type="date" required></div></div><label for="ft">Fact</label><input id="ft" required maxlength="500"><div class="actions"><button type="submit">Save fact</button></div></form>` : ''}</div>`;
}

async function insightsView() {
  const d = await api('GET', '/api/insights');
  return `<h1>Governance insights</h1><div class="card"><p>Submissions: <b>${d.totalSubmissions}</b> ${Object.entries(d.byStatus).map(([k, v]) => `<span class="chip">${esc(statusLabel(k))}: ${v}</span>`).join('')}</p>
  ${d.rules.length ? `<div class="scroll"><table><thead><tr><th>Rule</th><th>Raised</th><th>Accepted</th><th>Dismissed</th><th>Overridden</th><th>Dismiss rate</th><th>Note</th></tr></thead><tbody>` +
    d.rules.map((r) => `<tr><td>${esc(r.rule)}</td><td>${r.raised}</td><td>${r.accepted}</td><td>${r.dismissed}</td><td>${r.overridden}</td><td>${Math.round(r.dismissRate * 100)}%</td><td>${r.possiblyUnclear ? '<span class="badge b-amber">Possibly unclear rule</span>' : ''}</td></tr>`).join('') + '</tbody></table></div>' : '<p>No data yet. Run a few reviews first.</p>'}
  <h2>Repeated mistakes</h2>${(d.repeated || []).length ? `<ul>${d.repeated.map((r) => `<li>${esc(r.owner)} triggered <b>${esc(r.rule)}</b> ${r.times} times</li>`).join('')}</ul>` : '<p class="meta">None yet.</p>'}
  <p class="meta">Open the Guideline Debugger to see why a rule may be unclear and to test every rule.</p></div>`;
}

async function debuggerView() {
  const d = await api('GET', '/api/debugger'), admin = can('admin'), mgr = can('manager', 'admin');
  const st = d.stress;
  return `<h1>Guideline Debugger</h1><p class="meta">Finds rules people keep dismissing, drafts clearer wording from their own reasons, and tests that every rule can really be detected.</p>
  <div class="card"><h2>1. Which rules look unclear?</h2>${d.rules.length ? `<div class="scroll"><table><thead><tr><th>Rule</th><th>Clause</th><th>Raised</th><th>Accepted</th><th>Dismissed</th><th>Overridden</th><th>Ambiguity</th><th></th></tr></thead><tbody>` +
    d.rules.map((r) => `<tr><td>${esc(r.rule)}</td><td>${esc(r.clauseId || '-')}</td><td>${r.raised}</td><td>${r.accepted}</td><td>${r.dismissed}</td><td>${r.overridden}</td><td>${r.ambiguity}</td><td>${r.flagged ? '<span class="badge b-amber">Looks unclear</span>' : ''}</td></tr>`).join('') + '</tbody></table></div>' : '<p>No review activity yet.</p>'}
  <div class="actions">${mgr ? '<button data-act="propose">Draft clearer wording for flagged rules</button>' : ''}${admin ? '<button class="ghost" data-act="demoact">Add demo activity (4 sample dismissals)</button>' : ''}</div></div>
  <div class="card"><h2>2. Proposed clarifications</h2>${d.proposals.length ? d.proposals.map((p) => `<div class="card"><h3>${esc(p.id)} for clause ${esc(p.clauseId)} <span class="badge b-${p.status === 'approved' ? 'green' : p.status === 'rejected' ? 'red' : 'amber'}">${esc(p.status)}</span></h3>
    <p class="small">Evidence: raised ${p.evidence.raised}, accepted ${p.evidence.accepted}, dismissed ${p.evidence.dismissed}, overridden ${p.evidence.overridden}.</p>
    <div class="quote"><b>Current:</b> ${esc(p.currentText)}</div>
    ${p.status === 'pending' && admin ? `<label for="pt-${esc(p.id)}">Proposed (you can edit before approving)</label><textarea id="pt-${esc(p.id)}">${esc(p.proposedText)}</textarea>
    <div class="actions"><button class="ok" data-act="papprove" data-pid="${esc(p.id)}">Approve and update clause</button><input id="pr-${esc(p.id)}" placeholder="Reason to reject" aria-label="Reason to reject"><button class="danger" data-act="preject" data-pid="${esc(p.id)}">Reject</button></div>`
      : `<div class="quote"><b>Proposed:</b> ${esc(p.proposedText)}</div>`}</div>`).join('') : '<p>No proposals yet.</p>'}</div>
  <div class="card"><h2>3. Brand Stress Test</h2><p class="small">Generates tricky sample drafts for every rule and checks that each one is caught, and that clean wording is not flagged.</p>
  <div class="actions"><button data-act="stress">Run Stress Test</button></div>
  ${st ? `<p><b>${st.covered}</b> of ${st.total} checks fully covered. Gaps: <b>${st.gaps}</b>. Noisy: <b>${st.noisy}</b>. Broken citations: <b>${st.brokenCitations.length}</b>. <span class="meta">Last run ${esc(fmt(st.at))} by ${esc(st.by || '')}</span></p>
  <div class="scroll"><table><thead><tr><th>Check</th><th>Status</th><th>Caught</th><th>False alarms</th></tr></thead><tbody>${st.results.map((r) => `<tr><td>${esc(r.label)}${r.adversarial ? ' <span class="chip">known hard case</span>' : ''}</td><td><span class="badge b-${r.status === 'covered' ? 'green' : r.status === 'gap' ? 'red' : 'amber'}">${esc(r.status)}</span></td><td>${r.pos.filter((x) => x.detected).length}/${r.pos.length}</td><td>${r.neg.filter((x) => x.falseAlarm).length}/${r.neg.length}</td></tr>`).join('')}</tbody></table></div>
  ${st.brokenCitations.length ? `<p class="err">Rules whose cited wording is missing from the clause: ${st.brokenCitations.map((b) => esc(b.rule)).join(', ')}</p>` : ''}` : ''}</div>
  ${d.history.length ? `<div class="card"><h2>Clause change history</h2><ul class="log">${d.history.map((h) => `<li>${esc(fmt(h.at))}: ${esc(h.clauseId)} updated by ${esc(h.by)} (proposal ${esc(h.proposalId)})</li>`).join('')}</ul></div>` : ''}`;
}

async function receiptsView() {
  const rows = await api('GET', '/api/receipts');
  return `<h1>Review Receipts</h1><p class="meta">Every approval issues a receipt. Each receipt includes the hash of the one before it, so changes are detectable.</p>
  <div class="card">${can(...STAFF) ? '<div class="actions"><button data-act="verify">Verify the whole chain</button></div><div id="vres" aria-live="polite"></div>' : ''}
  ${rows.length ? `<div class="scroll"><table><thead><tr><th>Receipt</th><th>Item</th><th>Approved by</th><th>Decision</th><th>Hash</th></tr></thead><tbody>${rows.map((r) => `<tr><td><button class="ghost" data-act="openreceipt" data-id="${esc(r.id)}">${esc(r.id)}</button></td><td>${esc(r.title)}</td><td>${esc(r.approvedBy.name)} (${esc(r.approvedBy.role)})</td><td>${esc(r.decision.replace(/_/g, ' '))}</td><td class="small">${esc(r.hash.slice(0, 12))}...</td></tr>`).join('')}</tbody></table></div>` : '<p>No receipts yet. Approve an item to issue one.</p>'}</div>`;
}
async function receiptView() {
  const r = S.receipt; if (!r) return '<p>Nothing selected.</p>';
  return `<h1>Receipt ${esc(r.id)}: ${esc(r.title)}</h1><div class="card receipt"><p><b>${esc(r.decision.replace(/_/g, ' '))}</b> by ${esc(r.approvedBy.name)} (${esc(r.approvedBy.role)}) on ${esc(fmt(r.approvedAt))}, version ${r.version}.</p>
  ${r.overrideReason ? `<p class="quote">Override: ${esc(r.overrideReason)}</p>` : ''}
  <h3>What was checked</h3><p class="small">${r.checksRun.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</p>
  <h3>Findings</h3><p>Distinct findings raised: ${r.findings.distinctRaised}. Fixed by the creator: ${r.findings.fixedByCreator}. Dismissed: ${r.findings.dismissed.length}. Open at approval: ${r.findings.openAtApproval.length}.</p>
  ${r.findings.dismissed.map((d) => `<p class="small">Dismissed ${esc(d.rule)} by ${esc(d.by)}: ${esc(d.reason)}</p>`).join('')}${r.findings.openAtApproval.map((d) => `<p class="small">Open at approval: ${esc(d.rule)} (${esc(d.lane)}) "${esc(d.text)}"</p>`).join('')}
  <h3>Sources relied on</h3><ul class="log">${r.sourcesCited.map((c) => `<li>${esc(c.type)} ${esc(c.id)}: ${esc(c.text || '')}</li>`).join('') || '<li>None</li>'}</ul>
  <h3>Data handling</h3><p>External services called: <b>${r.dataHandling.externalServicesCalled}</b>. Images stored on the server: <b>${r.dataHandling.imagesStoredOnServer ? 'yes' : 'no'}</b>. Ledger entries for this item: ${r.dataHandling.ledgerEntriesForThisItem}.</p>
  <h3>Tamper evidence</h3><p class="small">Content hash: ${esc(r.contentHash)}<br>Brand Brain snapshot: ${esc(r.brain.snapshotHash)}<br>Previous receipt: ${esc(r.prevHash)}<br>This receipt: ${esc(r.hash)}</p>
  <div class="actions noprint"><button data-act="rexport">Show JSON export</button><button class="ghost" data-act="print">Print</button></div><div id="rjson"></div></div>`;
}
async function ledgerView() {
  const d = await api('GET', '/api/ledger');
  return `<h1>Privacy Ledger</h1><div class="card"><p>Calls to external services: <b>${d.externalServiceCalls}</b>. ${Object.entries(d.byKind).map(([k, v]) => `<span class="chip">${esc(k.replace(/_/g, ' '))}: ${v}</span>`).join('')}</p>
  <h2>Where data lives</h2><div class="scroll"><table><thead><tr><th>Data</th><th>Where</th><th>When it leaves</th></tr></thead><tbody>${d.inventory.map((i) => `<tr><td>${esc(i.data)}</td><td>${esc(i.where)}</td><td>${esc(i.leaves)}</td></tr>`).join('')}</tbody></table></div>
  <h2>Recent entries</h2>${d.entries.length ? `<div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>${d.entries.map((e) => `<tr><td>${esc(fmt(e.at))}</td><td>${esc(e.user)} (${esc(e.role)})</td><td>${esc(e.kind.replace(/_/g, ' '))}</td><td>${esc(e.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="meta">Nothing has left the system yet.</p>'}</div>`;
}

async function openSub(id) { S.current = await api('GET', '/api/submissions/' + id); S.view = 'detail'; S.focus = true; await render(); }
async function setSub(p) { S.current = await p; await render(); }
const val = (id) => ($(id) ? $(id).value : '');

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault(); if (S.busy) return; S.busy = true; document.body.classList.add('busy'); say('');
  try {
    if (f.dataset.form === 'login') { const r = await api('POST', '/api/login', { email: val('#em'), password: val('#pw') }); S.token = r.token; S.user = r.user; sessionStorage.setItem('bp_token', r.token); S.view = 'list'; await render(); }
    else if (f.dataset.form === 'create') { S.draft = readDraft(); const s = await api('POST', '/api/submissions', S.draft); S.draft = null; S.current = s; S.view = 'detail'; S.focus = true; await render(); say('Review complete. Every finding below cites its source.', true); }
    else if (f.dataset.form === 'clause') { await api('PUT', '/api/brain/clauses/' + encodeURIComponent(val('#ci')), { section: val('#cs'), text: val('#ct2') }); await render(); say('Clause saved.', true); }
    else if (f.dataset.form === 'fact') { await api('PUT', '/api/brain/facts/' + encodeURIComponent(val('#fi')), { text: val('#ft'), owner: val('#fo'), reviewBy: val('#fr') }); await render(); say('Fact saved.', true); }
  } catch (err) { say(err.message); } finally { S.busy = false; document.body.classList.remove('busy'); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.filter) { S.filter[t.dataset.filter] = t.value; return render(); }
  try {
    if (t.id === 'imp' && t.files[0]) { const text = await importFile(t.files[0]); const d = readDraft(); d.content = text.slice(0, 20000); if (!d.title) d.title = t.files[0].name; S.draft = d; await render(); say(`Imported ${t.files[0].name}${text.length > 20000 ? ' (truncated to 20,000 characters)' : ''}.`, true); }
    if (t.id === 'vf' && t.files[0]) { S.pv = await analyzeImage(t.files[0]); $('#vsum').textContent = `${S.pv.name}: ${S.pv.width}x${S.pv.height}px, ${S.pv.dominant.length} dominant colours found. Choose "Add image" to check it.`; if (!val('#vbg') && S.pv.dominant[0]) $('#vbg').value = S.pv.dominant[0].hex; }
  } catch (err) { say(err.message); }
});
document.addEventListener('input', (e) => { if (e.target.dataset && e.target.dataset.filter === 'q') { S.filter.q = e.target.value; clearTimeout(S.qt); S.qt = setTimeout(() => { const p = e.target.selectionStart; render().then(() => { const el = $('#fq'); if (el) { el.focus(); el.setSelectionRange(p, p); } }); }, 250); } });

document.addEventListener('click', async (e) => {
  const nb = e.target.closest('[data-nav]');
  if (nb) { if (S.busy) return; S.view = nb.dataset.nav; S.focus = true; say(''); return render(); }
  const b = e.target.closest('[data-act]'); if (!b || S.busy) return;
  const a = b.dataset.act, s = S.current; S.busy = true; document.body.classList.add('busy'); say('');
  const logo = (id) => (val(id) === 'yes' ? true : val(id) === 'no' ? false : null);
  try {
    if (a === 'logout') return logout();
    if (a === 'quick') { const r = await api('POST', '/api/login', { email: b.dataset.role + '@demo.com', password: 'demo1234' }); S.token = r.token; S.user = r.user; sessionStorage.setItem('bp_token', r.token); S.view = 'list'; return await render(); }
    if (a === 'open') return await openSub(b.dataset.id);
    if (a === 'sample') { S.draft = { ...readDraft(), content: SAMPLES[+b.dataset.i] }; return await render(); }
    if (a === 'intent') { const d = readDraft(); if (!d.content.trim()) return say('Add some content first.'); d.intent = await api('POST', '/api/intent/suggest', { content: d.content, contentType: d.contentType, audience: d.intent.audience }); S.draft = d; return await render(); }
    if (a === 'save') return await setSub(api('PUT', `/api/submissions/${s.id}/content`, { content: val('#ed') }));
    if (a === 'submit') { await setSub(api('POST', `/api/submissions/${s.id}/submit`)); return say('Submitted for approval.', true); }
    if (a === 'withdraw') { await setSub(api('POST', `/api/submissions/${s.id}/withdraw`)); return say('Withdrawn. You can edit again.', true); }
    if (a === 'accept') return await setSub(api('POST', `/api/submissions/${s.id}/findings/${b.dataset.fid}/accept`));
    if (a === 'dismiss') return await setSub(api('POST', `/api/submissions/${s.id}/findings/${b.dataset.fid}/dismiss`, { reason: val('#r-' + b.dataset.fid) }));
    if (a === 'comment') return await setSub(api('POST', `/api/submissions/${s.id}/comments`, { text: val('#cm') }));
    if (a === 'approve') { await setSub(api('POST', `/api/submissions/${s.id}/decision`, { decision: 'approve', overrideReason: val('#dn') })); return say('Approved. A receipt was issued.', true); }
    if (a === 'changes') { await setSub(api('POST', `/api/submissions/${s.id}/decision`, { decision: 'request_changes', note: val('#dn') })); return say('Changes requested.', true); }
    if (a === 'vadd') {
      if (!S.pv) return say('Choose an image first.');
      await setSub(api('POST', `/api/submissions/${s.id}/visuals`, { ...S.pv, alt: val('#va'), transcript: val('#vt'), hasText: $('#vh').checked, fg: val('#vfg'), bg: val('#vbg'), logo: logo('#vl') })); S.pv = null; return say('Image added and checked.', true);
    }
    if (a === 'vsave') { const v = b.dataset.vid; return await setSub(api('PUT', `/api/submissions/${s.id}/visuals/${v}`, { alt: val('#al-' + v), transcript: val('#tr-' + v), hasText: $('#ht-' + v).checked, fg: val('#fg-' + v), bg: val('#bg-' + v), logo: logo('#lg-' + v) })); }
    if (a === 'vremove') return await setSub(api('DELETE', `/api/submissions/${s.id}/visuals/${b.dataset.vid}`));
    if (a === 'contrast') { const r = await api('POST', '/api/visual/contrast', { fg: val('#cfg'), bg: val('#cbg') }); $('#cres').innerHTML = `<p><b>${r.ratio}:1</b> AA normal text: ${r.aaNormal ? 'pass' : 'fail'}. AA large text: ${r.aaLarge ? 'pass' : 'fail'}. AAA: ${r.aaaNormal ? 'pass' : 'fail'}.${r.suggestedForeground ? ` Try ${swatch(r.suggestedForeground)} ${esc(r.suggestedForeground)}.` : ''}</p>`; return; }
    if (a === 'export' || a === 'exportfull') {
      const full = a === 'exportfull', r = await api('POST', `/api/submissions/${s.id}/export`, { withContent: full, reason: val('#exr') });
      $('#exo').innerHTML = `<p class="small">Export recorded in the Privacy Ledger. Copy the JSON below.</p><textarea readonly>${esc(JSON.stringify(r, null, 2))}</textarea>`; return;
    }
    if (a === 'openreceipt') { S.receipt = await api('GET', '/api/receipts/' + b.dataset.id); S.view = 'receipt'; S.focus = true; return await render(); }
    if (a === 'rexport') { const r = await api('POST', `/api/receipts/${S.receipt.id}/export`); $('#rjson').innerHTML = `<p class="small">Export recorded in the Privacy Ledger. Copy the JSON below.</p><textarea readonly>${esc(JSON.stringify(r, null, 2))}</textarea>`; return; }
    if (a === 'print') return window.print();
    if (a === 'verify') { const r = await api('POST', '/api/receipts/verify'); $('#vres').innerHTML = r.ok ? `<p class="good">Chain verified: ${r.checked} receipt(s), no changes detected.</p>` : `<div class="err"><p>Problems found:</p><ul>${r.problems.map((p) => `<li>${esc(p.receipt)}: ${esc(p.problem)}</li>`).join('')}</ul></div>`; return; }
    if (a === 'propose') { const r = await api('POST', '/api/debugger/propose'); await render(); return say(r.created ? `${r.created} clarification(s) drafted.` : 'No new proposals: nothing is flagged, or a proposal is already pending.', true); }
    if (a === 'demoact') { await api('POST', '/api/debugger/demo-activity'); await render(); return say('Demo activity added.', true); }
    if (a === 'papprove') { await api('POST', `/api/debugger/proposals/${b.dataset.pid}/approve`, { text: val('#pt-' + b.dataset.pid) }); await render(); return say('Clause updated and recorded in the history.', true); }
    if (a === 'preject') { await api('POST', `/api/debugger/proposals/${b.dataset.pid}/reject`, { reason: val('#pr-' + b.dataset.pid) }); await render(); return say('Proposal rejected.', true); }
    if (a === 'stress') { await api('POST', '/api/debugger/stress'); await render(); return say('Stress Test complete.', true); }
  } catch (err) { say(err.message); } finally { S.busy = false; document.body.classList.remove('busy'); }
});

render();
