# Architecture

```
Browser (public/app.js)  --REST/JSON-->  server.js (routes, auth, roles)  -->  src/engine.js   text rules, retrieval, Proof Verifier, Intent check
  canvas colour summary                                                  -->  src/visual.js   palette, contrast, alt text, size, logo checklist
  DOCX/PDF text extraction (extract.js)                                  -->  src/debugger.js ambiguity analysis, proposals, Stress Test
                                                                         -->  src/receipt.js  hash-chained receipts (src/hash.js: SHA-256)
                                                                         -->  src/store.js    JSON file, atomic write; src/seed.js: demo data + migration
```
Files and images are processed in the browser. The server receives text, and for images only a colour summary and metadata.

## Data flow of a review
1. Creator submits text (and optional images). `runReview` runs text rules, then per image: text-in-image rules and visual rules.
2. Every finding carries a source (clause or fact) and a quote. `verifyAll` re-checks both against the live Brand Brain; failures become "reviewer question".
3. Suggested fixes are applied in a dry run and compared with the creator's must-keep items (boundary-aware match plus word-overlap similarity).
4. Findings set the risk lane. Approval of red findings needs a reviewer or admin and a written reason.
5. Approval issues a receipt: `hash = SHA-256(body including previous receipt hash)`.

## Hardest problems solved
- **Trustworthy findings:** the verifier downgrades any finding whose source or quote is missing. Editing a clause so its quote disappears downgrades findings automatically (tested), and the Debugger refuses clarifications that would remove cited wording.
- **Fixes that keep meaning:** the intent check uses boundary-aware matching so "5%" is not confused with "0.5%".
- **Privacy by architecture:** images and files never leave the browser; the Ledger records what does leave.
- **Tamper evidence without dependencies:** a pure-JavaScript SHA-256 that matches Node's crypto (tested) runs in Node and the browser.

## Data model (JSON file)
`users`, `brain` {clauses, facts, terms, ruleMap, palette}, `submissions` {content, versions, visuals, findings, dismissed, comments, audit, receiptId}, `events`, `proposals`, `brainHistory`, `stress`, `receipts`, `ledger`.

## API (all JSON; Bearer token except login)
| Method and path | Roles |
|---|---|
| POST `/api/login`, GET `/api/me` | public, any |
| GET `/api/brain`; PUT/DELETE `/api/brain/clauses/:id`, `/api/brain/facts/:id` | any; admin |
| POST `/api/intent/suggest` | any |
| GET/POST `/api/submissions`; GET `/api/submissions/:id` | any; creator, manager, admin |
| PUT `/api/submissions/:id/content`; POST `.../findings/:fid/accept`, `.../dismiss`, `.../submit`, `.../withdraw`, `.../comments` | owner or role rules |
| POST `/api/submissions/:id/decision` | manager, reviewer, admin (red needs reviewer, admin) |
| POST/PUT/DELETE `/api/submissions/:id/visuals[/:vid]`; POST `/api/visual/contrast` | owner; any |
| GET `/api/debugger`; POST `.../propose`, `.../stress`; POST `.../proposals/:id/approve|reject`, `.../demo-activity` | staff; admin for approve, reject, demo |
| GET `/api/receipts[/:id]`; POST `/api/receipts/verify`, `/api/receipts/:id/export` | any (creators see own); staff for verify |
| POST `/api/submissions/:id/export`; GET `/api/ledger`, `/api/insights` | any; staff |
