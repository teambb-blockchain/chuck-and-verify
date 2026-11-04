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

### 2026-10-15 — Supply-chain skeleton and credential registry scaffold

- **Tool:** Cursor agent
- **Request:** Implement checkpoint deliverable #3 (supply-chain contract skeleton) with a minimal CredentialRegistry so each write can check `isValid`
- **Outcome:** Added `ICredentialRegistry`, `CredentialRegistry` (admin grant/revoke/isValid with expiry and revocation), and `BeefSupplyChain` with `registerBatch`, `recordInspection`, `recordShipment`, `confirmReceipt`, and `recordRecall`, each gated on PROCESSOR / INSPECTOR / CUSTODIAN credentials. Added Hardhat tests for authorized and unauthorized writes plus registry revoke/expiry cases.
- **Verification:** `npm test` — 21 passing (BeefSupplyChain, CredentialRegistry, ProjectAnchor)
- **What it got wrong:** Nothing found; registry uses a single admin issuer (issuer-per-type left for Britt’s follow-up on deliverable #2)

### 2026-10-15 — CredentialRegistry issuer-per-type

- **Tool:** Cursor agent
- **Request:** Implement checkpoint deliverable #2: issuers grant and revoke only their own credential type; `isValid` checks expiry and revocation
- **Outcome:** Added `setIssuer` (admin-only) and `issuerOf` mapping; `grant`/`revoke` now require `msg.sender == issuerOf[credentialType]`. Rewrote CredentialRegistry tests for cross-type isolation, revoke, and expiry; BeefSupplyChain tests set admin as issuer for all three types before granting.
- **Verification:** `npm test` — 28 passing (BeefSupplyChain, CredentialRegistry, ProjectAnchor)
- **What it got wrong:** Nothing found

### 2026-10-15 — DIDLab deploy/setup scripts for BeefSupplyChain

- **Tool:** Cursor agent
- **Request:** Mirror `deploy-credential-registry.mjs` to cover BeefSupplyChain deploy plus post-deploy `setIssuer` / `grant` setup; later, review and tighten `.env.example`
- **Outcome:** Added `scripts/deploy-beef-supply-chain.mjs` (`npm run deploy:supply-chain`, requires `CREDENTIAL_REGISTRY_ADDRESS`) and `scripts/setup-credential-registry.mjs` (`npm run setup:registry`: admin sets issuer for all three types, grants demo holders, verifies `isValid`). Updated README deploy steps and `docs/references/notes.md` placeholders. Rewrote `.env.example` so Hardhat-safe vars are uncommented (`DIDLAB_RPC_URL`, `PORT`, `CREDENTIAL_REGISTRY_ADDRESS`), optional `DEMO_*` / TTL stay commented, and `DIDLAB_PRIVATE_KEY` is documented as shell-export only (no assignment line), with a note that plain Node deploy scripts do not load `.env`.
- **Verification:** Scripts not run against DIDLab in this session (need shell-exported key); artifacts already present from prior compile; `.env.example` checked against README and script `process.env` usage
- **What it got wrong:** First `.env.example` pass left every line commented and still showed a private-key assignment; fixed in the tighten pass

### 2026-10-16 — BeefSupplyChain custom-error failure-path tests

- **Tool:** Cursor agent
- **Request:** Close the test gap in `test/BeefSupplyChain.test.js` by covering EmptyBatchId, BatchAlreadyExists, BatchNotFound (recordInspection plus one other), ZeroAddress, NotCurrentHolder, NoPendingShipment, and NotPendingReceiver — one custom-error assertion per test, without changing `contracts/` or `scripts/`
- **Outcome:** Added eight failure-path tests: rejects an empty batch id; rejects registering a batch that already exists; rejects inspecting a batch that does not exist; rejects recalling a batch that does not exist; rejects shipping to the zero address; rejects a shipment from someone who is not the current holder; rejects confirming receipt when no shipment is pending; rejects confirming receipt by someone who is not the pending receiver
- **Verification:** `npm test` — 36 passing (BeefSupplyChain, CredentialRegistry, ProjectAnchor)
- **What it got wrong:** Nothing found

### 2026-10-16 — Live-site deployed addresses and network status

- **Tool:** Cursor agent (Auto / Composer)
- **Request:** Edit `frontend/index.html`: show deployed BeefSupplyChain and CredentialRegistry addresses with chain ID 252501; add a live network status line with four wallet/network states, `chainChanged`/`accountsChanged` listeners, numeric hex chain comparison, and a "Switch to DIDLab" button (`wallet_switchEthereumChain` with `wallet_addEthereumChain` fallback); keep batch reads on the DIDLab RPC; no explorer links (none given); append this AI_RECORD entry; do not commit
- **Outcome:** Updated `frontend/index.html` with a Deployed contracts section (addresses as constants reused by the read path), an `aria-live` network status line plus warning styling that does not rely on color alone, live status via `eth_accounts`/`eth_chainId` and wallet event listeners (no page reload), and a wrong-network-only Switch to DIDLab button. Appended this entry.
- **Verification:** `npm test` — 36 passing; visual inspection locally
- **What it got wrong:** No-wallet status said "No Ethereum wallet detected" instead of "No Wallet Detected"

### 2026-10-18 — Merge Checkpoint 2 draft into CHECKPOINT_REPORT

- **Tool:** Cursor agent (Auto / Composer)
- **Request:** Use `docs/references/Checkpoint2 - DRAFT.md` to update `docs/CHECKPOINT_REPORT.md` and the draft itself; append this AI_RECORD entry
- **Outcome:** Filled report §6–§8 and §15 from the draft; replaced §11–§14 with CP2 content (AI record, contributions, risks, CP3 plan). Sections 1–5 left unchanged. Completed empty draft §6/§8: deployment addresses plus creation TX hashes from the DIDLab Blockscout API, and Hardhat testing evidence (`npm test` — 32 passing after scaffold removal). Fixed draft typos (`fun` → `run`; checkpoint title Foundation → On Chain). Marked the draft as merged into the report.
- **Verification:** Checked cited commits against `git log`; confirmed addresses match `frontend/index.html`; confirmed creation TXs via explorer API for both contracts; ran `npm test` (32 passing)
- **What it got wrong:** Nothing found

### 2026-11-02 — Migrate selected Guided Lab work from britt-test into main

- **Tool:** Claude Code (Claude Fable 5.1)
- **Request:** Bring only the project-relevant work from the read-only `britt-test` branch into `main` on `migrate/britt-test-selected`, file by file with one approval per change; never touch `britt-test` or push to `main`; main wins on conflicts; scan every diff for secrets; run `npx hardhat compile && npm test` before each commit; no deployment to chain 252501
- **Outcome:** Seven commits (dca9f5f, e92e703, f859dbb, d671e0a, 965ccfe, 839a437, 5434f8f). `.env.example` documents the DEPLOYER_KEY format and the optional `CREDENTIAL_REGISTRY_ADDRESS`, `DEMO_*` and `CREDENTIAL_TTL_SECONDS` variables. `scripts/deploy.js` asserts `admin()` and `registry()` after deploying. `scripts/setupCredentials.js` now sets all three issuers, grants PROCESSOR, INSPECTOR and CUSTODIAN to env-configurable holders (plus CUSTODIAN to the processor) with a 30-day TTL, is idempotent, and reads back `isValid`. `package.json` gains `deploy:didlab`, `setup:credentials` and `register:batch`. README gains a Deploy to DIDLab section. The 2026-10-15 deploy/setup AI record entry was carried over verbatim. `frontend/index.html` simulates `registerBatch` before `writeContract` and reports `WOULD REVERT: <error>` for Unauthorized, EmptyBatchId and BatchAlreadyExists. The lab's plain-ethers `.mjs` scripts were merged into main's Hardhat scripts rather than copied. Not migrated: `frontend/public/*` (duplicate page with an incompatible hashed batch-id scheme), root `index.html`/`index.js`/`frontend/server.js` rewrites (nginx and `index.js` already serve the page), `hardhat.config.js` rename, `package-lock.json`, AnchorRegistry, VulnerableVault/SafeVault/Reenterer and their tests, `docs/SECURITY_REVIEW.md`, `tamper.mjs`, `verify-stored.mjs`, `deploy-registry.js`, `grant.js`, `.gitignore` `retrieved.bin`, and the other lab AI record entries (all Guided Lab exercises, not project features)
- **Verification:** `npx hardhat compile && npm test` after each change (32 passing); diffs scanned for 64-hex keys, mnemonics and RPC credentials (the six 64-hex strings on britt-test are transaction hashes in lab docs and were not migrated); deploy and setup scripts dry-run on the Hardhat network with the chain guard removed in a scratch copy; `frontend/index.html` loaded via `index.js` with no console errors, BEEF-001 read from DIDLab, and the simulate path decoded Unauthorized and BatchAlreadyExists with read-only calls; `origin/britt-test` confirmed unchanged at 87e343b throughout
- **What it got wrong:** First dry-run copies in the scratchpad failed to resolve `hardhat` until `NODE_PATH` pointed at the project's `node_modules`; the README draft said `http://localhost:3000/index.html` when `index.js` serves the page at `/`; a grep for the `registry` getter missed `ICredentialRegistry public immutable registry` because it assumed `address public`

### 2026-11-04 — Serve DApp at domain root without `/frontend/` bounce

- **Tool:** Cursor agent (Auto / Composer)
- **Request:** MetaMask connect seemed broken and the site was redirecting to `https://teambb.didlab.org/frontend/index.html`; then make the DApp show at `/` without bouncing to `/frontend/`
- **Outcome:** Diagnosed the redirect as root `index.html` (intentional stub), not MetaMask; Cursor’s embedded browser has no `window.ethereum` so status stays “No Wallet Detected.” Killed stale local servers that still pointed at a deleted `frontend/public/` tree. Moved the live page to repo-root `index.html`; `frontend/index.html` now redirects to `/` for old links. Updated `index.js` to serve only `/` and `/frontend/index.html` from the repo root (no `.env` / contracts exposure). Updated README structure and run notes. Live host still serves the old layout until redeploy.
- **Verification:** `PORT=3456 node index.js`: `/` returns the Connect MetaMask page (~22KB); `/frontend/index.html` redirects to `/`; `package.json` and `.env` return 404. Browser: `/frontend/index.html` ends at `http://127.0.0.1:3456/` with the full DApp.
- **What it got wrong:** Nothing found in this pass; earlier same-day vertical-slice work under `frontend/public/` had left orphan Express processes that 404’d after that tree was removed
