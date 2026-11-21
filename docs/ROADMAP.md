# Roadmap

Audience: marketing and communications teams, agencies and student or community organisations that publish through many people.

| Phase | Build | Why and how |
|---|---|---|
| 1 (weeks 1-3) Production base | Express plus MongoDB storage behind the existing `Store` class, real sessions and SSO, persistent hosting, backups | Today's JSON file is single-process. Routes and storage are already isolated, so this is a port, not a rewrite. |
| 2 (weeks 4-7) Detection depth | OCR for text in images (Tesseract.js), logo detection by template matching against approved logo assets, vector retrieval for paraphrased claims, spelled-out numbers | Closes the two documented gaps (no OCR, declared logo) and the Stress Test's known hard case. Measure with a labelled test set. |
| 3 (weeks 8-11) Where people write | Google Docs and Word add-ins, CMS and scheduler webhooks, Slack approval notifications | Review must happen before publishing, where the writing happens. |
| 4 (weeks 12-16) Trust and scale | Signed receipts (Ed25519) with a public verification page, multiple organisations, reviewer calibration reports, accuracy dashboard (precision and false alarms over time) | Makes approvals auditable by third parties and proves the findings are reliable. |

Success measures: false-alarm rate under 10 percent on the labelled set, time to approval versus the manual baseline, repeat-mistake rate per team.
