# BrandProof (Team Tech Gig)

Pre-publication brand governance where **every finding comes with proof**, every fix is tested against the creator's **intent**, and **humans make the final call**.

- Live demo: `<ADD YOUR LIVE LINK>` (browser-only build, see "Live demo build" below)
- Demo logins (password `demo1234`): `creator@demo.com`, `manager@demo.com`, `reviewer@demo.com`, `admin@demo.com`

## Run it (Node 20+, no install step, no dependencies)
```bash
node server.js     # http://localhost:3000   (PORT and DATA_FILE are optional env vars)
npm test           # 25 automated tests
docker build -t brandproof . && docker run -p 3000:3000 brandproof
```
Deploy: any Node host. `render.yaml` is included (build command: none, start command: `node server.js`). Data lives in `data/db.json`; on hosts with a temporary disk it resets on redeploy, so mount a persistent disk for real use.

Live demo build: `python3 tools/build-single-file.py out.html` bundles the same engine and the same API routes into one HTML file that runs in the browser and keeps data in that browser only.

## Easiest way to run on Windows

1. Install Node.js 20 or newer from https://nodejs.org.
2. Extract this ZIP.
3. Double-click `RUN_BRANDPROOF.bat` (or open a terminal in this folder and run `node server.js`).
4. Keep the black terminal window open.
5. Open http://localhost:3000 in Chrome.

Demo password for all four demo accounts: `demo1234`.
- Creator: `creator@demo.com`
- Manager: `manager@demo.com`
- Reviewer: `reviewer@demo.com`
- Admin: `admin@demo.com`

To stop the server, focus the terminal window and press `Ctrl+C`.

## Features
| Area | What it does |
|---|---|
| Brand Brain | Numbered guideline clauses, approved facts with owner and review-by date, terminology, brand palette. Admin edits in the UI. |
| Text review | Terminology and brand name, unsupported superlatives, guarantee wording, figures vs approved facts (contradiction, outdated, unsupported), required disclaimer, tone (exclamations, all caps), link text and alt text. |
| Proof Cards + Proof Verifier | Each finding cites a clause or fact and a quote. Code re-checks that the source and quote exist now; otherwise the finding becomes a "reviewer question". |
| Intent Lock | Goal, audience, key message and must-keep items. Every suggested fix is dry-run tested ("Intent safe" or "Intent warning"). |
| **Visual and accessibility review** | Attach images (analysed in the browser; only a colour summary is sent): palette match, WCAG contrast, alt-text quality, size and format, logo checklist. Text shown in the image is typed in and runs through every text rule. Import `.docx`, text-based `.pdf`, `.txt`, `.md` (read in the browser). Built-in contrast checker. |
| **Guideline Debugger** | Ambiguity score per rule from dismissals, overrides and mixed outcomes; drafts clearer wording from people's own dismissal reasons; admin approves or rejects (cited wording is protected); clause change history; **Brand Stress Test** with synthetic good and bad drafts for every rule plus a deliberate "known hard case". |
| **Review Receipts** | Every approval issues a hash-chained receipt: what was checked, sources relied on, fixes, dismissals, open findings, approver, content and Brand Brain hashes. "Verify chain" detects edits. |
| **Privacy Ledger** | Records every export and every image summary received, shows where each kind of data lives, and counts external service calls (zero). Exports are redacted unless a reason is given. |
| Workflow | Roles (creator, manager, reviewer, admin), risk lanes, red findings need a reviewer plus written override reason, comments, versions, audit log, withdraw from review. |
| Insights | Per-rule counts, possibly-unclear flags, repeated mistakes per person. |

## Documentation
`docs/ARCHITECTURE.md` (design and API), `docs/TESTING.md` (tests and manual checklist), `docs/ROADMAP.md`, `CHANGELOG.md`.

## Known limitations (read before judging)
- **No OCR.** Text inside images is typed by the creator into a "text shown in the image" box and then checked like normal text.
- **Logo presence is declared by the creator**, not detected.
- PDF import works for text-based PDFs with standard fonts; scanned or font-encoded PDFs are refused with a clear message. DOCX import reads the main document text (not headers or footers).
- Fact matching is lexical: paraphrases and spelled-out numbers can be missed (the Stress Test lists this as a known gap).
- Receipts are tamper-evident, not tamper-proof: someone who can rewrite the whole database file can rewrite the whole chain. Digital signatures are on the roadmap.
- JSON file storage, single process. The hosted demo build keeps data per browser. Shared demo password, no SSO or password reset.
- The user interface has no automated browser tests; see `docs/TESTING.md` for the manual checklist.

## Disclosure
- No third-party runtime libraries: Node.js built-ins only (`http`, `crypto`, `fs`, `zlib` in tests, `node:test`). Browser APIs used: Canvas, DecompressionStream.
- Development disclosure: an AI coding assistant was used during development and the team reviewed the code, as the event rules require us to disclose. The product itself calls no external service.
- The demo organisation "Nimbus Pay" and all its data are fictional.
