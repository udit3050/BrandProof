'use strict';
const crypto = require('crypto');
const { hashPassword } = require('./auth');

// Demo organisation: "Nimbus Pay" (fictional). Admins can edit all of this in the Brand Brain screen.
function seedBrain() {
  return {
    org: 'Nimbus Pay (demo organisation)',
    brandNames: ['Nimbus Pay'],
    stopExtra: ['nimbus', 'pay'],
    allowedCaps: ['UPI', 'KYC', 'OTP', 'FAQS', 'EMIS', 'NEFT', 'IMPS'],
    clauses: [
      { id: 'V-1.1', section: 'Voice', text: 'Write in a warm, clear and professional voice. Avoid hype and slang. Use exclamation marks sparingly: at most one per post.' },
      { id: 'V-1.2', section: 'Voice', text: 'Do not write words in all capital letters, except approved acronyms.' },
      { id: 'T-2.1', section: 'Terminology', text: 'Use "customers" instead of "users" in all external content.' },
      { id: 'T-2.2', section: 'Terminology', text: 'Never describe our pricing as "cheap"; say "affordable" or "low-cost".' },
      { id: 'T-2.3', section: 'Terminology', text: 'Always write our name as "Nimbus Pay" (two words, capital N and P).' },
      { id: 'C-4.1', section: 'Claims', text: 'Comparative or superlative claims (best, #1, fastest, leading) must be supported by an approved fact.' },
      { id: 'C-4.2', section: 'Claims', text: 'Do not use the words "guarantee", "guaranteed" or "risk-free" about savings, returns or rewards.' },
      { id: 'C-4.3', section: 'Claims', text: 'Any number, price, fee or percentage must match the Approved Facts.' },
      { id: 'C-4.4', section: 'Claims', text: 'Content that mentions cashback or rewards must include the disclaimer "Terms and conditions apply."' },
      { id: 'A-5.1', section: 'Accessibility', text: 'Links must use descriptive link text; never use "click here".' },
      { id: 'A-5.2', section: 'Accessibility', text: 'Every image must have alt text.' },
      { id: 'A-5.3', section: 'Accessibility', text: 'Alt text must describe what the image shows in 10 to 125 characters; do not start with "image of" or "picture of".' },
      { id: 'A-5.4', section: 'Accessibility', text: 'Text on images must have a contrast ratio of at least 4.5:1 against its background.' },
      { id: 'V-6.1', section: 'Visuals', text: 'Images must use the brand palette. Colours outside the palette may cover no more than 15% of an image, not counting white, black and grey.' },
      { id: 'V-6.3', section: 'Visuals', text: 'Web images must be at least 600 pixels wide and under 1.5 MB, in PNG, JPG, WebP or SVG format.' },
      { id: 'V-6.4', section: 'Visuals', text: 'Ads and banners must include the logo.' }
    ],
    facts: [
      { id: 'F-1', text: 'Nimbus Pay charges a 1% fee on every card payment.', owner: 'Pricing team', reviewBy: '2027-03-31' },
      { id: 'F-2', text: 'Nimbus Pay supports payments in 12 currencies.', owner: 'Product team', reviewBy: '2027-03-31' },
      { id: 'F-3', text: 'Cashback on selected merchants is up to 2% of the order value.', owner: 'Marketing', reviewBy: '2027-01-31' },
      { id: 'F-4', text: 'Nimbus Pay is available in 9 countries.', owner: 'Expansion team', reviewBy: '2026-06-30' }
    ],
    terms: [
      { pattern: '\\busers\\b', good: 'customers', severity: 'minor', clauseId: 'T-2.1', quote: 'Use "customers" instead of "users"' },
      { pattern: '\\buser\\b', good: 'customer', severity: 'minor', clauseId: 'T-2.1', quote: 'Use "customers" instead of "users"' },
      { pattern: '\\bcheap\\b', good: 'affordable', severity: 'major', clauseId: 'T-2.2', quote: 'Never describe our pricing as "cheap"' },
      { pattern: '\\bnimbus ?pay\\b', good: 'Nimbus Pay', exactGood: true, severity: 'minor', clauseId: 'T-2.3', quote: 'Always write our name as "Nimbus Pay"' }
    ],
    palette: [{ name: 'Nimbus Blue', hex: '#2F4BC7' }, { name: 'Midnight', hex: '#1F2A44' }, { name: 'Mint', hex: '#2F9E44' }, { name: 'Amber', hex: '#E8890C' }, { name: 'Cloud', hex: '#EEF1FB' }],
    ruleMap: {
      'claim.superlative': { clauseId: 'C-4.1', quote: 'must be supported by an approved fact' },
      'claim.guarantee': { clauseId: 'C-4.2', quote: 'Do not use the words' },
      'fact.contradiction': { clauseId: 'C-4.3', quote: 'must match the Approved Facts' },
      'fact.unsupported_number': { clauseId: 'C-4.3', quote: 'must match the Approved Facts' },
      'compliance.disclaimer': { clauseId: 'C-4.4', quote: 'must include the disclaimer' },
      'tone.exclamation': { clauseId: 'V-1.1', quote: 'at most one per post' },
      'tone.caps': { clauseId: 'V-1.2', quote: 'all capital letters' },
      'a11y.link_text': { clauseId: 'A-5.1', quote: 'descriptive link text' },
      'a11y.alt_text': { clauseId: 'A-5.2', quote: 'must have alt text' },
      'visual.alt_missing': { clauseId: 'A-5.2', quote: 'must have alt text' },
      'visual.alt_quality': { clauseId: 'A-5.3', quote: 'describe what the image shows' },
      'visual.contrast': { clauseId: 'A-5.4', quote: 'at least 4.5:1' },
      'visual.palette': { clauseId: 'V-6.1', quote: 'brand palette' },
      'visual.size': { clauseId: 'V-6.3', quote: 'at least 600 pixels wide' },
      'visual.logo': { clauseId: 'V-6.4', quote: 'must include the logo' }
    }
  };
}

function seed() {
  const pw = hashPassword('demo1234');
  const mk = (email, name, role) => ({ id: crypto.randomUUID(), email, name, role, passwordHash: pw });
  return {
    secret: crypto.randomBytes(32).toString('hex'),
    users: [
      mk('creator@demo.com', 'Demo Creator', 'creator'),
      mk('manager@demo.com', 'Demo Manager', 'manager'),
      mk('reviewer@demo.com', 'Demo Reviewer', 'reviewer'),
      mk('admin@demo.com', 'Demo Admin', 'admin')
    ],
    brain: seedBrain(),
    submissions: [],
    events: [],
    ledger: [],
    proposals: [],
    receipts: [],
    brainHistory: [],
    stress: null
  };
}
// Upgrade an older database (Round 2 file) without losing data: add missing collections, clauses and rules.
function migrate(d) {
  const fresh = seedBrain();
  for (const k of ['ledger', 'proposals', 'receipts', 'brainHistory']) if (!Array.isArray(d[k])) d[k] = [];
  if (d.stress === undefined) d.stress = null;
  const b = d.brain;
  b.palette = b.palette || fresh.palette;
  for (const c of fresh.clauses) if (!b.clauses.some((x) => x.id === c.id)) b.clauses.push(c);
  for (const [k, v] of Object.entries(fresh.ruleMap)) if (!b.ruleMap[k]) b.ruleMap[k] = v;
  return d;
}
module.exports = { seed, seedBrain, migrate };
