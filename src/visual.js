'use strict';
/** Image review: palette match, WCAG contrast, alt-text quality, size/format, logo checklist.
 *  Works on a small summary produced in the browser (dominant colours + metadata); the image itself is never uploaded. */
const crypto = require('crypto');
const engine = require('./engine');

const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c) => '#' + c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function contrast(a, b) {
  const A = rgb(a), B = rgb(b); if (!A || !B) return null;
  const l1 = lum(A), l2 = lum(B);
  return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
}
function suggestForeground(fg, bg, target = 4.5) {
  const F = rgb(fg), B = rgb(bg); if (!F || !B) return null;
  const to = lum(B) < 0.18 ? 255 : 0;
  for (let i = 0; i <= 20; i++) { const c = toHex(F.map((x) => x + (to - x) * (i / 20))); if (contrast(c, bg) >= target) return c; }
  return to ? '#FFFFFF' : '#000000';
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const neutral = (c) => Math.max(...c) - Math.min(...c) < 24;
const GENERIC = new Set(['image', 'photo', 'picture', 'banner', 'logo', 'graphic', 'img', 'screenshot']);

function review(v, brain, opts = {}) {
  const found = [];
  const add = (rule, severity, title, why, extra = {}) => {
    const src = brain.ruleMap[rule] || {};
    const key = rule + ':' + v.id;
    found.push({ id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 10), key, rule, severity, lane: engine.LANE[severity], title, why,
      flagged: { text: v.name, start: -1, end: -1 }, source: { type: 'clause', id: src.clauseId, quote: src.quote },
      confidence: extra.confidence || 0.9, method: extra.method || 'rule', suggestion: extra.suggestion || null, advice: extra.advice || null, status: 'open' });
  };
  // palette
  const palette = (brain.palette || []).map((p) => ({ ...p, c: rgb(p.hex) })).filter((p) => p.c);
  if (palette.length) {
    const off = [];
    for (const d of v.dominant || []) {
      const c = rgb(d.hex); if (!c || d.share < 0.05 || neutral(c)) continue;
      const near = palette.map((p) => ({ p, d: dist(c, p.c) })).sort((a, b) => a.d - b.d)[0];
      if (near.d > 60) off.push({ hex: d.hex.toUpperCase(), share: d.share, near: near.p });
    }
    const share = off.reduce((s, x) => s + x.share, 0);
    if (share > 0.15) add('visual.palette', 'major', `Off-palette colours cover ${Math.round(share * 100)}% of the image`,
      `Colours outside the brand palette: ${off.map((x) => x.hex).join(', ')}. The limit is 15%.`,
      { advice: 'Nearest brand colours: ' + off.map((x) => `${x.hex} -> ${x.near.name} ${x.near.hex}`).join('; ') + '.', confidence: 0.8 });
  }
  // contrast (only when the creator says the image contains text)
  if (v.hasText && rgb(v.fg) && rgb(v.bg)) {
    const r = contrast(v.fg, v.bg);
    if (r < 4.5) add('visual.contrast', r < 3 ? 'critical' : 'major', `Text contrast is ${r}:1 (needs 4.5:1)`,
      `Text colour ${v.fg} on ${v.bg} is hard to read for many people.`, { advice: `Try ${suggestForeground(v.fg, v.bg)} for the text (reaches 4.5:1).`, confidence: 0.99 });
  }
  // alt text
  const alt = (v.alt || '').trim();
  const altFix = (replacement) => ({ start: 0, end: alt.length, replacement });
  if (!alt) add('visual.alt_missing', 'major', 'Image has no alt text', 'Screen-reader users cannot tell what this image shows.', { advice: 'Write 10 to 125 characters describing what the image shows.' });
  else {
    const bare = alt.replace(/^(image|picture|photo|graphic)( of| showing)?\s+/i, '');
    if (bare !== alt && bare.length >= 10) add('visual.alt_quality', 'minor', 'Alt text starts with "image of"', 'Screen readers already announce that it is an image.', { suggestion: altFix(bare.charAt(0).toUpperCase() + bare.slice(1)) });
    else if (GENERIC.has(alt.toLowerCase()) || /\.(png|jpe?g|gif|webp|svg)$/i.test(alt) || /^(img|dsc|image)[-_ ]?\d+/i.test(alt)) add('visual.alt_quality', 'minor', 'Alt text is generic or a file name', 'It does not tell the reader what the image shows.', { advice: 'Describe the content and purpose of the image.' });
    else if (alt.length < 10) add('visual.alt_quality', 'minor', `Alt text is very short (${alt.length} characters)`, 'Short alt text rarely describes what an image shows.', { advice: 'Use 10 to 125 characters.' });
    else if (alt.length > 125) add('visual.alt_quality', 'minor', `Alt text is long (${alt.length} characters)`, 'Long alt text is tiring to listen to.', { advice: 'Shorten to 125 characters or fewer.' });
  }
  // size and format
  const types = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  const probs = [];
  if (v.width && v.width < 600) probs.push(`${v.width}px wide (minimum 600)`);
  if (v.bytes && v.bytes > 1.5 * 1024 * 1024) probs.push(`${(v.bytes / 1048576).toFixed(1)} MB (maximum 1.5 MB)`);
  if (v.type && !types.includes(v.type)) probs.push(`format ${v.type}`);
  if (probs.length) add('visual.size', 'minor', 'Image size or format outside the guideline', probs.join('; ') + '.', { advice: 'Resize, compress or export in PNG, JPG, WebP or SVG.' });
  // logo (declared by the creator; not detected automatically)
  if (['ad', 'banner'].includes(opts.contentType) && v.logo !== true) add('visual.logo', 'minor', v.logo === false ? 'Logo missing from an ad or banner' : 'Logo presence not confirmed',
    'Ads and banners must include the logo. This is a creator declaration, not an automatic detection.', { method: 'declared', advice: 'Add the logo, or confirm that it is present.', confidence: 0.7 });
  return engine.verifyAll(found, '', brain);
}
module.exports = { review, contrast, suggestForeground, rgb, toHex };
