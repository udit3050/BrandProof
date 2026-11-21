# Testing

## Automated (`npm test`, 25 tests, all passing)
| Area | Tests |
|---|---|
| Review engine | clean text passes; superlatives; figure contradiction; expired fact; fact-backed superlative allowed; disclaimer, tone, terminology, accessibility; verifier downgrade; lanes; sentence splitting |
| HTTP workflow | login and auth; end-to-end approval with red-lane gating; accept fixes and versions; dismissal with reason, persistence, insights; role permissions |
| Hashing and import | SHA-256 equals Node crypto; DOCX and PDF extraction; corrupt files fail clearly |
| Visual | WCAG contrast reference values; every visual rule with verified sources; clean image has no findings |
| Images over HTTP | add, review, accept alt fix, edit, remove; bad input rejected (zero size, bad colour); text-in-image goes through text rules; ledger entry |
| Reliability | duplicate create returns the same item; withdraw; login throttle (429); migration of a Round 2 database |
| Receipts and ledger | hash chain verifies; role access; exports logged; content export needs a reason |
| Debugger | demo activity flags a rule; proposal drafted; unsafe edit refused; approval updates clause; second approval refused; Stress Test; broken citation detected |

## Findings during testing, and fixes
- Substring bug: "5%" matched inside "0.5%" in the intent check. Fixed with boundary-aware matching.
- Stress Test found that "NEW" (three letters) was never flagged as all caps. Rule fixed.
- Unsupported "number 1" claim wording was missed. Pattern added.
- Debugger flagged too little when other activity diluted the score. Threshold now also uses dismiss rate.
- Quote protection in clarification approval ignored terminology clauses. Fixed.

## Known imperfect
- The Stress Test deliberately includes one known hard case (spelled-out numbers) that the rules cannot detect.
- No automated browser tests.

## Manual checklist (tick after running it in a browser)
- [ ] Login as each role; wrong password shows an error
- [ ] Sample 1: red Proof Cards with verified sources; accept fixes; versions grow
- [ ] Empty content, huge content, repeated Run review clicks behave
- [ ] Attach a PNG: colours listed, findings appear; contrast checker works
- [ ] Import a DOCX and a PDF; a scanned PDF shows a clear message
- [ ] Manager cannot approve red; reviewer needs a reason; receipt appears; Verify chain passes
- [ ] Admin: demo activity, draft clarifications, approve, run Stress Test
- [ ] Privacy Ledger shows exports and image summaries
- [ ] Keyboard-only walk-through; phone-width layout; dark mode

## User testing
[Add: who tried it, what they did, what confused them, what you changed.]
