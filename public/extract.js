/* Text extraction from DOCX and text-based PDF, run inside the browser (files never leave the device).
   UMD: works in Node (tests) and in the page (window.BPExtract). Inflate functions are injected. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.BPExtract = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const utf8 = (u8) => new TextDecoder('utf-8').decode(u8);
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };

  async function unzipEntry(u8, name, inflateRaw) {
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (u32(u8, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('This is not a valid DOCX file.');
    const n = u16(u8, e + 10); let p = u32(u8, e + 16);
    for (let k = 0; k < n && u32(u8, p) === 0x02014b50; k++) {
      const method = u16(u8, p + 10), csize = u32(u8, p + 20), nl = u16(u8, p + 28), el = u16(u8, p + 30), cl = u16(u8, p + 32), lho = u32(u8, p + 42);
      if (utf8(u8.subarray(p + 46, p + 46 + nl)) === name) {
        const start = lho + 30 + u16(u8, lho + 26) + u16(u8, lho + 28);
        const data = u8.subarray(start, start + csize);
        return method === 0 ? data : inflateRaw(data);
      }
      p += 46 + nl + el + cl;
    }
    return null;
  }
  const entities = (s) => s.replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  async function docxText(u8, { inflateRaw }) {
    const xml = await unzipEntry(u8, 'word/document.xml', inflateRaw);
    if (!xml) throw new Error('No document text found in this DOCX.');
    let out = '';
    for (const m of utf8(xml).matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\/>|<w:br[^>]*\/>/g)) out += m[1] !== undefined ? m[1] : m[0] === '<w:tab/>' ? '\t' : '\n';
    return entities(out).replace(/\n{3,}/g, '\n\n').trim();
  }

  function a85(s) {
    s = s.replace(/\s/g, ''); if (s.startsWith('<~')) s = s.slice(2); const end = s.indexOf('~>'); if (end >= 0) s = s.slice(0, end);
    const out = []; let g = [];
    const flush = (n) => { const pad = g.slice(); while (pad.length < 5) pad.push(84); let v = 0; for (const x of pad) v = v * 85 + x; const b = [(v / 16777216) & 255, (v / 65536) & 255, (v / 256) & 255, v & 255]; out.push(...b.slice(0, n)); };
    for (const ch of s) { if (ch === 'z' && !g.length) { out.push(0, 0, 0, 0); continue; } g.push(ch.charCodeAt(0) - 33); if (g.length === 5) { flush(4); g = []; } }
    if (g.length > 1) flush(g.length - 1);
    return new Uint8Array(out);
  }
  const unescapePdf = (s) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (m, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] !== undefined ? { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] : /^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ''));

  function pageText(src) {
    let out = '', lastY = null;
    const re = /\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj|\[((?:\\[\s\S]|[^\]])*)\]\s*TJ|(-?[\d.]+)\s+(-?[\d.]+)\s+Td|(?:-?[\d.]+\s+){5}(-?[\d.]+)\s+Tm|T\*|ET/g;
    for (const m of src.matchAll(re)) {
      if (m[1] !== undefined) out += unescapePdf(m[1]);
      else if (m[2] !== undefined) { for (const t of m[2].matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)|(-?[\d.]+)/g)) { if (t[1] !== undefined) out += unescapePdf(t[1]); else if (+t[2] < -200) out += ' '; } }
      else if (m[4] !== undefined) { if (+m[4] !== 0) out += '\n'; }
      else if (m[5] !== undefined) { if (lastY !== null && +m[5] !== lastY) out += '\n'; lastY = +m[5]; }
      else if (m[0] === 'T*') out += '\n';
      else if (m[0] === 'ET') { out += '\n'; lastY = null; }
    }
    return out;
  }
  async function pdfText(u8, { inflate }) {
    const s = latin1(u8); let out = '';
    for (const m of s.matchAll(/stream\r?\n/g)) {
      const dictStart = s.lastIndexOf('obj', m.index), dict = s.slice(dictStart, m.index);
      const end = s.indexOf('endstream', m.index + m[0].length); if (end < 0) continue;
      let data = u8.subarray(m.index + m[0].length, end);
      const f = (/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict) || [])[1] || '';
      try {
        for (const name of f.match(/\/\w+/g) || []) { if (name === '/ASCII85Decode') data = a85(latin1(data)); else if (name === '/FlateDecode') data = await inflate(data); else throw new Error('x'); }
      } catch (e) { continue; }
      const text = latin1(data);
      if (text.includes('BT')) out += pageText(text) + '\n';
    }
    out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!out) throw new Error('No readable text found. Scanned or font-encoded PDFs are not supported; paste the text instead.');
    return out;
  }
  return { docxText, pdfText };
});
