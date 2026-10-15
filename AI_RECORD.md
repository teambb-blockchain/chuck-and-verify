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

### 2026-10-15 — DApp vertical slice activity 01 (local frontend server)

- **Tool:** Cursor agent
- **Request:** Start Guided Lab activity 01 from `docs/references/DApp Vertical Slice.html`; match the listed example code and `frontend/` hierarchy
- **Outcome:** Added `frontend/package.json`, `frontend/server.js` (Express static on `PORT`/`3000`), and `frontend/public/{index.html,abi.js,app.js}` from the lab examples (`abi.js`/`app.js` stubs for later activities). Moved the prior marketing page to `frontend/public/project-page.html`. Pointed root `index.js` at `frontend/public` so repo-root `npm start` still serves the static tree.
- **Verification:** `cd frontend && npm install && npm start` printed `listening on 3000`; `curl` of `/` returned the lab page and `/app.js` / `/abi.js` were 200
- **What it got wrong:** Nothing found

### 2026-10-15 — DApp vertical slice activity 02 (export ABI)

- **Tool:** Cursor agent
- **Request:** Activity 02 — export contract ABI via the lab shell one-liner; heed Watch out (regenerate on contract change) and Expected (`export const abi = [`)
- **Outcome:** Ran the lab `node -e` command with `BeefSupplyChain` (not the placeholder `YourContract`) writing `frontend/public/abi.js`. Freed leftover process on port 3000 from activity 01.
- **Verification:** File begins `export const abi = [`; ABI includes writes (`registerBatch`, `recordInspection`, `recordShipment`, `confirmReceipt`, `recordRecall`), read (`getBatch`, `registry`, credential constants), and events (`BatchRegistered`, `InspectionRecorded`, …)
- **What it got wrong:** Nothing found; Watch out called out that a stale ABI encodes cleanly then fails on chain — regenerate after every contract change / recompile

### 2026-10-15 — DApp vertical slice activity 03 (read chain, no wallet)

- **Tool:** Cursor agent
- **Request:** Activity 03 — write `frontend/public/app.js` from the lab example (viem public client, DIDLab chain, block number into `#network`)
- **Outcome:** Replaced the stub with the lab imports/setup; set `CONTRACT` to BeefSupplyChain `0x981aE7CcD177a5F137CF49Eed2CA7122B3F783D8` from `docs/references/notes.md` (not the placeholder)
- **Verification:** Two `eth_blockNumber` RPCs to `https://eth.didlab.org` ~2s apart returned increasing hex block numbers (chain is live). Browser Expected (reload shows rising block) needs a local `npm start` + page load
- **What it got wrong:** Nothing found

### 2026-10-15 — DApp vertical slice activity 04 (wallet connect + chain guard)

- **Tool:** Cursor agent
- **Request:** Activity 04 — append connect/guard logic to `app.js`
- **Outcome:** Appended lab code: `connect()` via `createWalletClient` + `custom(window.ethereum)`, request address, switch/add DIDLab (252501) on mismatch (4902 → `addChain`), enable Submit only after connect; reload on `chainChanged` / `accountsChanged`
- **Verification:** Code matches lab snippet; browser Expected (Connect opens wallet, address shown, Submit enabled) requires MetaMask on DIDLab against the running `npm start` page
- **What it got wrong:** Nothing found

### 2026-10-15 — DApp vertical slice activity 05 (read + render state)

- **Tool:** Cursor agent
- **Request:** Activity 05 — append `loadState()` / render into `#state`
- **Outcome:** First pass used `registry` (lab placeholder was `current`). Review against `CHECKPOINT_REPORT.md` showed that is admin plumbing, not the operational read consumers need. Rewired to `getBatch(keccak256(batchLabel))` with labeled fields; **Load batch** works without a wallet
- **Verification:** Live `getBatch` on unknown id reverts `BatchNotFound()`
- **What it got wrong:** First chose `registry` for a no-arg lab fit; corrected to match Chuck and Verify batch lineage (§4–§5)

### 2026-10-15 — DApp vertical slice activity 06 (simulate before send)

- **Tool:** Cursor agent
- **Request:** Activity 06 — append `buildArgs` / `simulate`
- **Outcome:** Lab `anchor` → `registerBatch`; args `[keccak256(batchLabel), 1000n]` (demo weight). `simulateContract` uses connected `account` so Unauthorized / EmptyBatchId / BatchAlreadyExists surface before gas
- **Verification:** Code appended; end-to-end simulate needs Connect as PROCESSOR (demo grants in notes). Submit wiring is activity 07
- **What it got wrong:** Nothing found

### 2026-10-15 — DApp vertical slice activity 07 (send + wait for receipt)

- **Tool:** Cursor agent
- **Request:** Activity 07 — append `submit()` and wire the Submit button
- **Outcome:** Lab flow unchanged: simulate → `walletClient.writeContract(request)` → `waitForTransactionReceipt`; status line shows simulating / awaiting signature / pending hash / receipt status+block+gas. Uses existing `registerBatch` simulate
- **Verification:** Code matches lab; browser Expected needs PROCESSOR wallet on DIDLab, unique batch id, approve in MetaMask, then confirm hash on explorer
- **What it got wrong:** Nothing found

### 2026-10-15 — DApp vertical slice activity 08 (four outcomes)

- **Tool:** Cursor agent
- **Request:** Activity 08 — replace `submit()` with pending / confirmed / reverted / rejected handling
- **Outcome:** Replaced submit with lab try/catch/finally: disable button while in flight; map `UserRejectedRequestError` and simulation `ContractFunctionRevertedError`; distinguish receipt `reverted` vs `confirmed`
- **Verification:** Code matches lab. Browser: duplicate batch id or empty → `would revert: …`; Reject in wallet → cancelled; happy path → confirmed. On-chain revert screenshot needs console bypass (adapted): `registerBatch` + `args: [zeroHash, 1000n]` + manual `gas` (EmptyBatchId)
- **What it got wrong:** Console bypass cannot see ES module locals; exposed `globalThis.dapp` so the lab snippet works after Connect

### 2026-10-15 — DApp vertical slice activity 09 (re-render from events)

- **Tool:** Cursor agent
- **Request:** Activity 09 — append `watchContractEvent` so Current state / Activity refresh from the chain
- **Outcome:** Lab `CommitmentAnchored` → `BatchRegistered`. On logs: prepend Activity list item, then `loadState()` — not called from `submit`
- **Verification:** Code matches lab pattern; Expected needs a successful `registerBatch` then a short poll delay (HTTP transport). Teammate writes on same contract should update this page too
- **What it got wrong:** Nothing found

### 2026-10-15 — DApp vertical slice activity 10 (prove it does not lie)

- **Tool:** Cursor agent
- **Request:** Activity 10 — verify state updates are event-driven only; failed tx must not change Current state
- **Outcome:** Confirmed `submit()` never calls `loadState()` (`loadState` only from Load/Enter, initial load, and `BatchRegistered` watcher). No code change required
- **Verification:** Static check of `app.js` call sites. Browser Part D: note state → run Activity 8 on-chain revert console snippet → status shows failure, Current state and Activity list unchanged (no `BatchRegistered`)
- **What it got wrong:** Lab Expected says status reports failure, but the console bypass never touches the DOM — so after DEMO-LOT-1 load the whole UI looked frozen. That is correct for Current state/Activity (no event). Exposed `setStatus` on `dapp` so a console snippet can update status without calling `loadState`

