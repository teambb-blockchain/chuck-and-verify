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
