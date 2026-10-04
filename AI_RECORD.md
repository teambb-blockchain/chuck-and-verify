# AI Record

Log of AI-assisted design and implementation for this project.

## How to use

Add an entry whenever AI tools help with architecture, code, docs, or debugging in a meaningful way.

## Entries

### 2026-09-27 — M1 proposal review and revisions

- **Tool:** Claude
- **Request:** Adversarial review of the M1 draft against the rubric; revised wording for B3, D4, C2, C3 and E1; concept explanations; grammar and clarity review
- **Outcome:** Gap list against the rubric; draft text for B3, D4, C2, C3 and E1, edited by the team before inclusion
- **Verification:** Checked each change against the rubric and our Part A analysis; rejected changes that contradicted our design; read cited sources before use
- **What it got wrong:** Assumed "IoT sensors" meant temperature monitoring and kept reintroducing it; framed QR codes as the consumer's entry point rather than custody capture; proposed on-chain events for rejected scans, which cannot exist; cited D3 for a redesign D3 did not require; some source summaries did not match the sources

### 2026-09-27 — Format the keep-retail-sales-off-chain decision

- **Tool:** Cursor agent
- **Request:** Clean up and format the decision to keep retail sales data off chain
- **Outcome:** Wrote `docs/decisions/0001-keep-retail-sales-off-chain.md` as an accepted ADR: status, date, and deciders, then Context, Decision, Alternatives considered, and Consequences. On-chain retail records are limited to custody facts (which retailer received the batch, when, and how many lbs). Sales data stays off chain.
- **Verification:** Read the full ADR against our C1 and D1 reasoning to confirm it matched the decision we made; made small wording edits.
- **What it got wrong:** Nothing substantive; minor wording only.

### 2026-09-27 — Team charter from the teambb example

- **Tool:** Cursor agent
- **Request:** Use the first blockchain project's `TEAM_CHARTER.md` as the example and incorporate it into this repo; start logging AI usage in `AI_RECORD.md`
- **Outcome:** Filled `docs/TEAM_CHARTER.md` from that charter (same team, roles, and agreements). Paths point at this repo: ADRs in `docs/decisions/`, this log at the repo root. Linked the charter from `README.md`.
- **Verification:** Read the full charter against our original charter to confirm the roles, meeting times and consequences carried over correctly.
- **What it got wrong:** Nothing found

### 2026-09-27 — Hardhat starter from the first blockchain project

- **Tool:** Cursor agent
- **Request:** Copy the first blockchain project as a starter template, including configuration and the example Solidity contracts
- **Outcome:** Brought over `hardhat.config.js`, `.gitignore`, `.env.example`, `contracts/SimpleStorage.sol`, `contracts/ProjectAnchor.sol`, and `test/ProjectAnchor.test.js`. Pointed `package.json` at this repo and set `npm test` / `npm run compile` to Hardhat. Did not copy `.env`, `node_modules/`, `artifacts/`, or `cache/`. Proposal and architecture/decision stubs landed under `docs/`.
- **Verification:** `npx hardhat compile` succeeded and all 4 `ProjectAnchor` tests passed; confirmed chain ID 252501 from a read-only console check against DIDLab
- **What it got wrong:** Nothing found

### 2026-10-02 — Static project page

- **Tool:** Cursor agent
- **Request:** A static frontend page with the project name, the problem statement, Team BB, and the GitHub repository link
- **Outcome:** Added `frontend/index.html`. The page gives the project name (Chuck and Verify: Tamper-Evident Inspection and Custody Records for the Beef Supply Chain), the problem statement, Team BB, and a link to https://github.com/teambb-blockchain/chuck-and-verify.
- **Verification:** Opened the page at desktop and phone width and confirmed the repository link.
- **What it got wrong:** Nothing found

### 2026-10-02 — Deploy entry point for the project page

- **Tool:** Cursor agent
- **Request:** Troubleshoot `Error: Cannot find module '/srv/app/index.js'` on deploy, make the server useful for a public page, and support HTTPS
- **Outcome:** Added `index.js` and `npm start`. The host looks for `/srv/app/index.js` because `package.json` sets `"main": "index.js"` and the repo had no such file. The process serves `frontend/index.html` over HTTP on `PORT` (3000 locally). It does not read a certificate path from `.env`. The public `https://` address is the host in front of this process.
- **Verification:** `npm start` on port 8767 returned the project page for `/` and 404 for a missing path. Confirmed `package.json` `main` is `index.js` and `start` is `node index.js`.
- **What it got wrong:** The first log line treated `0.0.0.0` as a link to open. A later pass tried to load a TLS certificate and key from file paths in `.env`, which a public host does not provide. Removed that. The process stays HTTP so the host can terminate HTTPS in front of it.

### 2026-10-04 — Serve the project page at domain root

- **Tool:** Cursor agent
- **Request:** Make https://teambb.didlab.org/ show the project page instead of only https://teambb.didlab.org/frontend/index.html
- **Outcome:** Live probes showed `/` as nginx 403 and `/frontend/index.html` as 200 with the project page. Inferred the host docroot is the repo checkout (URL paths match tree paths; no nginx config inspected). Added repo-root `index.html` that redirects to `/frontend/index.html`; kept the full page in `frontend/index.html`. Kept `index.js` / `npm start` for local serving and any host path that still expects `/srv/app/index.js`. Root fix not live until deploy — `/` still 403.
- **Verification:** `curl` on live host: `/` body identifies `nginx/1.24.0 (Ubuntu)`; `/frontend/index.html` returns 200 with project content. Cloudflare is the edge `Server` header. Local root file is a redirect, not the full page.
- **What it got wrong:** Oct 2 entry treated Node as what answered the public HTTPS URL. Proven wrong by the nginx 403 page. That Node served locally was verified; that it served teambb.didlab.org was not.
