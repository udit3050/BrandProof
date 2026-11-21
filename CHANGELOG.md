# Changelog

## 1.0.0 (Round 3)
Three committed improvements
- Guideline Debugger with Brand Stress Test (`src/debugger.js`, `/api/debugger/*`)
- Visual and accessibility review, DOCX and PDF import (`src/visual.js`, `public/extract.js`, `/api/submissions/:id/visuals`)
- Review Receipts and Privacy Ledger (`src/receipt.js`, `src/hash.js`, `/api/receipts/*`, `/api/ledger`)

Other improvements
- Repeated-click and retry protection (identical create within 60 s returns the same item), buttons lock while a request runs
- Login throttling (10 failures per 5 minutes), request size limits, stricter input validation with clear messages
- Withdraw an item from review; list search and filters; real empty states; keyboard focus moves to the page heading; print styles for receipts
- Database migration: databases from Round 2 are upgraded without losing data
- Repeated-mistake insights per person
- Rules: "number 1", "no. 1" claims; three-letter all-caps words (found by the Stress Test)
- Tests grew from 14 to 25; added documentation

## 0.2.0 (Round 2)
Core workflow: Brand Brain, review engine, Proof Cards and Verifier, Intent Lock, risk lanes, roles, comments, versions, audit log, insights.
