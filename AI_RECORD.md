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

### 2026-10-25 — Anchoring lab activity 02 (retrieve and verify digest)

- **Tool:** Cursor agent
- **Request:** Start Guided Lab 2 activity 02; pull the example from the lab (tagged DApp Vertical Slice; the verify script is in Anchoring and Authorization)
- **Outcome:** Added `scripts/verify-stored.mjs` from the lab example. Ran it against the activity 01 gateway URL and ciphertext SHA-256. Digest matched (`true`). Gitignored `retrieved.bin`.
- **Verification:** `bytes 12355`, `sha256 afe5eb481bbcd5e4329aa884ab05e5d2d319cc5567dee386867751503cdfe66e`, `match true`. Retrieved file is binary `data`, not a directory listing
- **What it got wrong:** Tagged file was Guided Lab 1; activity 02 lives in Guided Lab 2. Bundle `size` is 12366 vs retrieved 12355 (plaintext 12339 + 16-byte GCM tag); digest still matches the ciphertext the portal hashed

### 2026-10-25 — Anchoring lab activity 03 (the tamper test)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 03 — flip one bit of the retrieved ciphertext and show the digest no longer matches
- **Outcome:** Added `scripts/tamper.mjs` from the lab example. It hashes `retrieved.bin`, flips one bit in memory (`bytes[0] ^= 0x01`), and hashes again. The file on disk is unchanged.
- **Verification:** `before afe5eb481bbcd5e4329aa884ab05e5d2d319cc5567dee386867751503cdfe66e` (same digest as activity 02), `after 8f064ff72f1d46abf0b5261b55aaceee6e2b8cae1409f8ef25d28b837970cb97`, `changed 1 bit of 98840`, `same? false`. The two digests differ in 143 of 256 bits and share 2 of 64 hex characters. Disk SHA-256 of `retrieved.bin` still matches `before`.
- **What it got wrong:** Nothing found

### 2026-10-25 — Anchoring lab activity 04 (what goes on chain)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 04 — fill the on-chain table for Chuck and Verify, with the record identifier kept free of person-identifying keys
- **Outcome:** Decision only; no contract change. Record id is `batchId`, a product-lot key (random `bytes32` in the QR, or `keccak256` of a lot code that names the lot alone). `keccak256` in `app.js` is a fixed-width key, not a privacy control. Project facts that stay on chain: credentialed `msg.sender`, block time, weight at custody, holder and pending receiver, inspection pass/fail and grade, recall classification and public recall number, temperature min/max and time out of range. Off-chain documents (inspection report, recall notice, temperature log) are anchored as ciphertext SHA-256 plus CID. Filename, employee and certifier identity, truck and device records, scan images, sales, prices, and remaining quantity stay off chain, in line with ADR 0001.
- **Verification:** Checked against `docs/PROPOSAL.md` on-chain table, ADR 0001, and `BeefSupplyChain` fields. Skeleton already stores report and notice hashes and does not yet store CID, grade, or temperature summaries.
- **What it got wrong:** Nothing found

### 2026-10-25 — Anchoring lab activity 05 (role-based contract)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 05 — write `contracts/AnchorRegistry.sol`, with the lab roles mapped to this project's stakeholders
- **Outcome:** Added `AnchorRegistry`. `PROCESSOR` may `anchor` a ciphertext SHA-256 and CID. `INSPECTOR` may `verify`. Deployer receives `ADMIN` only. `SelfVerification` stays, so the address that anchored a batch cannot verify it. Role strings match `BeefSupplyChain` (`PROCESSOR`, `INSPECTOR`) but this contract has its own role mapping and does not read `CredentialRegistry`. Custody stays on `BeefSupplyChain`.
- **Verification:** `npx hardhat compile` succeeded
- **What it got wrong:** Nothing found

### 2026-10-25 — Anchoring lab activity 06 (role-boundary tests)

- **Tool:** Cursor agent
- **Request:** Fill `bafyTESTCIDPLACEHOLDER` with this project's stored object; do not commit private keys
- **Outcome:** Added `test/AnchorRegistry.test.js`. `DIGEST` stays the lab value `"0x" + "11".repeat(32)` (a non-zero 32-byte stand-in for the role tests). CID is the activity 01 portal value `QmYE3zK8Kov7vHQpSaETDqXyjUHnHHt9WBvTWKL5MVP1mG`. Record id is `keccak256("BB-2026-014")`. Roles are `PROCESSOR` and `INSPECTOR`. Tests use Hardhat's local signers, so no key is read from `.env` or written to the repo. `.env` stays gitignored.
- **Verification:** `npx hardhat test test/AnchorRegistry.test.js` — 10 passing
- **What it got wrong:** First pass set `DIGEST` to the activity 01 ciphertext SHA-256. The lab line is `const DIGEST = "0x" + "11".repeat(32)`, a non-zero 32-byte stand-in the role tests can compare to the word they stored. Replaced `DIGEST` with that stand-in. The portal CID stayed `QmYE3zK8Kov7vHQpSaETDqXyjUHnHHt9WBvTWKL5MVP1mG`.

### 2026-10-25 — Anchoring lab activity 07 (deploy and grant two wallets)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 07 — deploy `AnchorRegistry` and grant the two roles to two different wallets
- **Outcome:** Added `scripts/deploy-registry.js` and `scripts/grant.js`, plus `npm run deploy:anchor` and `npm run grant:anchor`. Lab `SUBMITTER` / `VERIFIER` are this contract's `PROCESSOR` / `INSPECTOR`. Addresses come from the shell (`ANCHOR_REGISTRY_ADDRESS`, `DEMO_PROCESSOR`, `DEMO_INSPECTOR`). The grant script refuses a missing address, the zero address, and the same address for both roles. Deploy checks that the deployer holds `ADMIN` only. Deployed to DIDLab: `0x5dcEde6EFeBE6592874b263456232fD2328f89B2`, tx `0x83ff0dd18efe2967456451b652909304d76a59e106a2406cf6acb32398a24c14`. Granted `PROCESSOR` to wallet A `0xc2Ad3207fD426313CB6DeE60A8e00A1aA577351E` (`0x55b45bc648f256a58596b5d8fe706493062e01cc7076e6fdcc0d4ea0dd91433c`) and `INSPECTOR` to wallet B `0x2710C588137CC6b0BAa46e5a504ECfF246b93b5b` (`0xf7feb3f4320b4788c689507b9e5fbe5a686c435bfd67b9443162fa6eb788c07d`), recorded in `docs/references/notes.md`.
- **Verification:** Deploy script printed deployer `ADMIN` only. Grant script printed two `RoleGranted` logs and `hasRole PROCESSOR: true` / `hasRole INSPECTOR: true`.
- **What it got wrong:** Grant steps were written into the README next to the Oct 15 line "Record addresses in `docs/references/notes.md`" before `deploy:anchor` had printed an address. Looking that name up in notes would have used `CredentialRegistry` (`0x3eC133afE2455Ac690ECd92358DE555C267338B2`). Activity 07's address is the `AnchorRegistry:` line from the deploy script. Also called the npm script `scripts/anchor`; the file is `scripts/deploy-registry.js`.

### 2026-10-25 — Anchoring lab activity 08 (anchor the stored lot)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 08 — append `anchorRecord` and anchor the activity 01 artifact from wallet A
- **Outcome:** Added `frontend/public/anchor-abi.js` from the `AnchorRegistry` artifact and appended `recordIdFor` / `anchorRecord` / `anchorStoredLot` to `frontend/public/app.js`. Lab `SUBMITTER` is `PROCESSOR`. Registry is `0x5dcEde6EFeBE6592874b263456232fD2328f89B2`. Wallet A anchored lot `BB-2026-014`, ciphertext SHA-256 `afe5eb481bbcd5e4329aa884ab05e5d2d319cc5567dee386867751503cdfe66e`, and CID `QmYE3zK8Kov7vHQpSaETDqXyjUHnHHt9WBvTWKL5MVP1mG`. Tx `0x67a0cf3fd313bdcb1ab23059b8646ef8b2b21271a7f9151222c2b4e2f1904a61`, block `6669839`, recorded in `docs/references/notes.md`. The BeefSupplyChain page is unchanged.
- **Verification:** Receipt status 1, `RecordAnchored`, `get` digest and CID match activity 01, submitter is wallet A.
- **What it got wrong:** The anchor helper was added in the same session as deploy, before `grant:anchor`. The first log said nothing was sent because the deployer holds `ADMIN` only. Activity 09 was then opened as if 08 were done, while `get(keccak256("BB-2026-014"))` was still empty (`submittedAt` 0). User flagged hardcoding `STORED_LOT`, `STORED_DIGEST`, and `STORED_CID`; they stayed as the activity 01 one-shot, and `anchorRecord(businessKey, sha256Hex, cid)` is the general call. User also pushed back that a page served from localhost must not write localhost to chain. `anchor` stores the lot id, the ciphertext digest, and the CID. The page origin is not an argument.

### 2026-10-25 — Anchoring lab activity 09 (verify from wallet B)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 09 — verify the anchored lot from wallet B; record SelfVerification from wallet A and NotAuthorized from a wallet with no role
- **Outcome:** Appended `getStoredLot` / `verifyRecord` / `verifyStoredLot` to `frontend/public/app.js`. Lab `VERIFIER` is this contract's `INSPECTOR`. Wallet B verified lot `BB-2026-014`: tx `0x50d8386b8216df4b40bf4d2daef9768a6e1880a8e5bf98d83b6e483594a02308`, block `6670059`. Wallet A `verify` simulated `NotAuthorized` (A has no `INSPECTOR`, so `SelfVerification` is not reached). A no-role wallet: `anchorStoredLot` stopped on the PROCESSOR check; `verifyStoredLot` simulated `NotAuthorized`. Recorded in `docs/references/notes.md`.
- **Verification:** Receipt status 1, `RecordVerified`, `get.verifier` is wallet B. Both refusals reported `nothing was sent`.
- **What it got wrong:** First plan said wallet A should also hold `INSPECTOR` and call `verify` before B, to produce `SelfVerification`. The grant script refuses both roles on one address. On this deploy `onlyRole(INSPECTOR)` runs first, so wallet A's result was `NotAuthorized`. Also expected `NotAuthorized` from the no-role wallet on both calls. `anchorStoredLot` returns in the page (`this wallet does not hold PROCESSOR`) and never simulates. `verifyStoredLot` is the call that reached the contract.

### 2026-10-25 — Anchoring lab activity 10 (role-aware interface)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 10 — append the lab `refreshRole` example; show each wallet only what it can do; render the record from chain
- **Outcome:** Lab `SUBMITTER` / `VERIFIER` and `abi` are this contract's `PROCESSOR` / `INSPECTOR` and `anchorAbi`. Added `#role`, `#anchor-panel`, `#verify-panel`, and `#anchor-record` to `frontend/public/index.html` and root `index.html`. `refreshRole` runs after Connect. Record render is digest, CID as a DIDLab gateway link, submitter, and verifier. Buttons call the activity 08/09 helpers.
- **Verification:** `http://localhost:3000` with no wallet: both panels `hidden` / `display:none`, role `not connected`, chain 252501. Record matches notes: digest `afe5eb48…`, CID link, submitter wallet A, verified by wallet B. Wallet A / B panel split confirmed in UX.
- **What it got wrong:** Nothing found

### 2026-10-25 — Anchoring lab activity 11 (UI is not the security boundary)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 11 — with a no-role wallet and both panels hidden, call `anchor` from the browser console
- **Outcome:** Lab snippet uses `abi` / `publicClient` / `recordIdFor` as module locals. First pass only put them on `dapp`; a bare `publicClient` in the console threw `ReferenceError`. Hang those names on `globalThis` so the lab paste runs. Console `abi` is `anchorAbi`; BeefSupplyChain stays at `dapp.abi`. Probe args stay the lab values: `console-probe`, digest `0x22`.repeat(32), CID `bafyPROBE`. Simulate from `0x24117a294a5167573C5D79cEb62845Db4a33D9d2` reverted `NotAuthorized(PROCESSOR)`; RPC was `eth_call`. Recorded in `docs/references/notes.md`.
- **Verification:** Viem `ContractFunctionExecutionError` chain, inner `NotAuthorized` with role id matching notes `PROCESSOR`. Request body `eth_call`, not `eth_sendRawTransaction`.
- **What it got wrong:** First console instructions used `dapp.publicClient` and `dapp.anchorAbi`. The lab paste uses bare `publicClient`, and that paste threw `ReferenceError: publicClient is not defined` because `app.js` is an ES module. After those names were hung on `globalThis`, the console printed a long viem stack (`ContractFunctionExecutionError`, `ContractFunctionRevertedError`, `CallExecutionError`). The contract line inside it is `NotAuthorized` for `PROCESSOR`. The call was `eth_call`. Nothing was sent.

### 2026-10-25 — Anchoring lab activity 12 (privacy audit)

- **Tool:** Cursor agent
- **Request:** Guided Lab 2 activity 12 — enumerate every field `AnchorRegistry` writes to state, calldata, or an event, and give each a verdict
- **Outcome:** Decision only; no contract change. `recordId` is `keccak256` of the lot code `BB-2026-014`, not of the filename. Calldata of the deploy, both grants, the anchor, and the verify transaction contains no lot-code plaintext, filename, employee id, or gateway URL. Submitter, verifier, and admin addresses stay organization role keys. `cid` is the bare CIDv0 of the ciphertext. Recorded in `docs/references/notes.md`.
- **Verification:** Decoded the five DIDLab transactions. Stored `submittedAt` `1792975193` matches anchor block `6669839`. Stored `verifiedAt` `1792975633` matches verify block `6670059`. `keccak256` of the filename differs from the on-chain `recordId`.
- **What it got wrong:** Nothing found

### 2026-11-01 — Adversarial audit activity 07 (Activity 6 findings and role boundaries)

- **Tool:** Cursor agent
- **Request:** Guided Lab 3 activity 07 — from `docs/references/SecurityAuditActivity6.xlsx`, add tests for `revokeRole` leaving zero admins, `anchor` accepting an empty cid and a zero `recordId`, and `verify` rejecting self-verification. Also cover the access-control column: a non-ADMIN `grantRole` reverts, a non-ADMIN `revokeRole` reverts, a non-PROCESSOR `anchor` reverts, a non-INSPECTOR `verify` reverts, a `PROCESSOR` without `INSPECTOR` calling `verify` reverts, and a non-ADMIN granting themselves `ADMIN` reverts. Then the input rows: empty digest reverts `EmptyDigest`, a second anchor of the same `recordId` reverts `AlreadyAnchored`, an empty cid succeeds, a zero `recordId` succeeds, a very long cid succeeds, `verify` of an unknown record reverts `UnknownRecord`, self-verification reverts `SelfVerification`, `grantRole` to `address(0)` succeeds, a repeat `grantRole` leaves state unchanged and emits another `RoleGranted`, and `revokeRole` of a role the account does not hold leaves state unchanged and still emits `RoleRevoked`. Then: a second `verify` reverts `AlreadyVerified`, `verify` before `anchor` reverts `UnknownRecord`, the last `ADMIN` revoking itself makes every later `grantRole` revert, and a second processor anchoring the same `recordId` with a different digest reverts `AlreadyAnchored` while the first record stands.
- **Outcome:** Appended tests to `test/AnchorRegistry.test.js`. `AnchorRegistry.sol` is unchanged. Self-verification was already `rejects self-verification`: the processor is also granted `INSPECTOR`, so `onlyRole` passes and the revert is `SelfVerification`. The medium findings are recorded as the contract behaves today. `anchor` stores cid `""` and `get` returns it. `anchor` stores `recordId` `bytes32(0)`, and a second anchor of that id reverts `AlreadyAnchored`. `anchor` stores a 1024-character cid (a portal CIDv0 is 46) and `get` returns it. `grantRole(PROCESSOR, address(0))` emits `RoleGranted` and `hasRole` is true. A second `grantRole` of `PROCESSOR` to the processor emits another `RoleGranted` while `hasRole` stays true. `revokeRole(PROCESSOR, outsider)` emits `RoleRevoked` while `hasRole` stays false. On the role boundaries, a processor's `grantRole` and `revokeRole` revert `NotAuthorized(ADMIN)` and leave the mapping unchanged. That same processor, after anchoring, gets `NotAuthorized(INSPECTOR)` from `verify`. An outsider's `grantRole(ADMIN, outsider)` reverts the same way, and `hasRole` stays false. A second `verify` by the same inspector reverts `AlreadyVerified`, and `get` still shows that inspector. `verify` before any `anchor` was already `rejects verification of an unknown record`. After the last `ADMIN` revokes itself, `grantRole` from the former admin, the processor, the inspector, and the outsider each revert `NotAuthorized(ADMIN)`, and the processor can still anchor. The first version of that test only sent `grantRole` from the former admin. Processor B, a fifth Hardhat signer granted `PROCESSOR`, anchors the same `recordId` with digest `0x22` repeated and reverts `AlreadyAnchored`. `get` still returns processor A's digest, cid, and submitter. That is the first-write-wins rule. The test does not order two pending transactions. Already present: empty digest (`rejects an empty digest`), duplicate anchor (`rejects anchoring the same record twice`), non-PROCESSOR `anchor`, and non-INSPECTOR `verify`.
- **Verification:** `npx hardhat test test/AnchorRegistry.test.js` — 23 passing (was 10)
- **What it got wrong:** The first tests were written with no entry here, and the user had to ask for the log. The role-boundary tests were then a second Activity 07 entry, and the user had to ask for the two to be combined. The combined line said nothing was wrong. The first draft named the findings file `Book1.xlsx`; it is `docs/references/SecurityAuditActivity6.xlsx`. The outcome also said Activity 10 would make the long cid, the zero-address grant, and the duplicate role events revert. Those rows were asked for as demonstrations that the calls succeed. A repeat `grantRole` or a `revokeRole` of a role not held is an extra event, and reverting it was not the finding. Comments explaining the findings were added in `test/AnchorRegistry.test.js`; the Activity 6 comments were taken back out of the suite. The lockout test originally called `grantRole` only from the former admin. The "anyone" row needs the processor, the inspector, and the outsider as well, which this pass adds.

### 2026-11-01 — AnchorRegistry security audit (unedited)

- **Tool:** Cursor agent
- **Request:** Audit `contracts/AnchorRegistry.sol` for security vulnerabilities. For each finding, state the function, the vulnerability class (access control, input validation, reentrancy, unchecked external calls, or state-ordering), the exact exploit scenario, and the severity. Also state where you looked and found nothing. Then paste the complete, unedited output into this record, every finding included, including the ones that will be disproved.
- **Outcome:** No contract change. The reply below is pasted complete and unedited.

`AnchorRegistry` has no critical or high findings. Eight issues are real, and they all sit behind a role the admin has already granted. The contract holds no ether and never calls another contract, so the reentrancy and unchecked-call classes are empty.

`★ Insight ─────────────────────────────────────`
A record counts as present only when `submittedAt != 0`, and as verified only when `verifiedAt != 0`. The `recordId` key is never the sentinel, which is why `bytes32(0)` is a normal, permanent slot. `onlyRole` runs before the function body, so a processor who lacks `INSPECTOR` reverts with `NotAuthorized` and never reaches `SelfVerification`.
`─────────────────────────────────────────────────`

## Findings

### 1. `revokeRole` — access control — Medium

The sole admin can remove itself. Nothing in `revokeRole` counts remaining admins or requires a successor.

```68:71:contracts/AnchorRegistry.sol
    function revokeRole(bytes32 role, address account) external onlyRole(ADMIN) {
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }
```

**Exploit.** The deployer calls `revokeRole(ADMIN, deployer)` and has not granted `ADMIN` to anyone else. Every later `grantRole` and `revokeRole` reverts `NotAuthorized(ADMIN)`, from the old admin and from every other account. `PROCESSOR` and `INSPECTOR` grants already stored keep working, so a processor key that should have been rotated can still call `anchor`, and nobody can revoke it.

### 2. `anchor` — access control — Medium

`PROCESSOR` is global. Any holder may anchor any `recordId`. There is no link between a lot and the plant allowed to write it, and no function clears a record after the processor is revoked.

**Exploit.** The admin has granted `PROCESSOR` to plant A and plant B. Plant B calls `anchor(keccak256("BB-2026-014"), B's digest, B's cid)` for a lot that belongs to plant A. The call succeeds. Plant A's later `anchor` of that same id reverts `AlreadyAnchored`. The admin then `revokeRole(PROCESSOR, plant B)`. `get` still returns B's digest, cid, and submitter. `verify` will attest that stored record.

### 3. `anchor` — state-ordering — Medium

Two valid anchors of the same id are settled by inclusion order. The first one to be mined sets `submittedAt`, and the second reverts. There is no commit-reveal, no expected-digest argument, and no admin rewrite.

```77:78:contracts/AnchorRegistry.sol
        if (digest == bytes32(0)) revert EmptyDigest();
        if (_records[recordId].submittedAt != 0) revert AlreadyAnchored();
```

**Exploit.** Plant A broadcasts `anchor(lotId, honestDigest, honestCid)`. Plant B, also `PROCESSOR`, sees that pending transaction and submits `anchor(lotId, otherDigest, otherCid)` with a higher gas price. B's transaction is mined first. A's transaction reverts `AlreadyAnchored`. The digest stored for that lot is B's, for good. `verify` takes only `recordId`, so an inspector who attests the lot is attesting whichever digest won the race.

### 4. `anchor` — input validation — Medium

A non-zero digest is required. The cid is not. `verify` never looks at `cid` either.

**Exploit.** A processor calls `anchor(recordId, nonZeroDigest, "")`. `submittedAt` is set and `RecordAnchored` is emitted with an empty cid. A different address that holds `INSPECTOR` calls `verify(recordId)`. `SelfVerification` passes, and `verifiedAt` is set. `get` returns a verified record whose location string is empty. A repair anchor reverts `AlreadyAnchored`, so the lot id is burned and the verified record points nowhere.

### 5. `anchor` — input validation — Low

`recordId` is not checked. `bytes32(0)` is stored like any other key.

**Exploit.** A processor calls `anchor(bytes32(0), digest, cid)`. That slot is occupied. A client that leaves the id unset sends `bytes32(0)`: `get` returns this record, and a later `anchor` of the zero id reverts `AlreadyAnchored`.

### 6. `anchor` — input validation — Low

`cid` has no maximum length and no character set. The processor pays to store it. Every later `get` of that id copies the whole string, and `RecordAnchored` logs it.

**Exploit.** A processor anchors a cid whose size is limited only by the block gas limit (a portal CIDv0 is 46 characters; the test suite already stores 1024). Readers and indexers of that one `recordId` pay for the full string. Other lot ids are unaffected. The same unconstrained string can carry a filename or a pre-signed URL into storage and into the event log, permanently.

### 7. `grantRole` — input validation — Low

`account` is not checked against `address(0)`.

**Exploit.** The admin calls `grantRole(PROCESSOR, address(0))`. The call emits `RoleGranted` and `hasRole` becomes true. No transaction can use the grant, because `msg.sender` cannot be the zero address. An operator counting role holders treats a dead entry as a live processor until someone revokes it.

### 8. `verify` — access control — Low

The self-check compares two addresses. The comment on the contract says a processor must not be the party that attests its own batch. The code enforces a narrower rule.

```92:96:contracts/AnchorRegistry.sol
    function verify(bytes32 recordId) external onlyRole(INSPECTOR) {
        Record storage r = _records[recordId];
        if (r.submittedAt == 0) revert UnknownRecord();
        if (r.verifiedAt != 0) revert AlreadyVerified();
        if (r.submitter == msg.sender) revert SelfVerification();
```

**Exploit.** One organization controls keys A and B. The admin grants `PROCESSOR` to A and `INSPECTOR` to B. A calls `anchor`. B calls `verify`. `r.submitter == msg.sender` is false, so `RecordVerified` is emitted. The same organization both wrote the digest and attested it.

## Where I looked and found nothing

**Reentrancy.** `constructor`, `grantRole`, `revokeRole`, `anchor`, `verify`, and `get` never transfer ether and never make an external call. No `.call`, `.delegatecall`, `.staticcall`, `.transfer`, or `.send`. Control never leaves the contract, so there is no callback to re-enter on. `verify` writes `verifier` and `verifiedAt` before it emits, and an event is not an external call.

**Unchecked external calls.** Same six functions. There is no external call whose success could be ignored.

**Access control that holds.** `onlyRole` gates every state change. The constructor grants `ADMIN` to `msg.sender` and does not grant `PROCESSOR` or `INSPECTOR`. `grantRole(ADMIN, self)` from an account without `ADMIN` reverts `NotAuthorized`. A processor without `INSPECTOR` who calls `verify` reverts `NotAuthorized(INSPECTOR)`. The same address anchoring and then verifying reverts `SelfVerification`. `hasRole` and `get` are views.

**Input checks that hold.** `anchor` reverts `EmptyDigest` on `bytes32(0)`. A second `anchor` of an existing id reverts `AlreadyAnchored`, including a second processor using a different digest. `verify` reverts `UnknownRecord` when `submittedAt` is still 0, including a `verify` mined before the matching `anchor`. A second `verify` reverts `AlreadyVerified`, and the first verifier stays in storage.

**State-ordering that holds.** The digest cannot change after `anchor`, so an inspector who has already read `get` cannot have the digest swapped out before `verify`. A `verify` ordered ahead of its `anchor` hits `UnknownRecord`. Revoking `PROCESSOR` or `INSPECTOR` blocks later calls from that account; it does not rewrite records already stored.

**Also examined, and not a vulnerability.** A second `grantRole` of a role the account already holds emits another `RoleGranted` and leaves the mapping true. `revokeRole` of a role the account does not hold emits `RoleRevoked` and leaves the mapping false. Both are noisy for an indexer. Neither changes who can call `anchor` or `verify`. `grantRole` will also store a role id that is not `ADMIN`, `PROCESSOR`, or `INSPECTOR`; no function checks those ids. Solidity 0.8.24 reverts on overflow. The `uint64` timestamp cast is the existence flag, and a real block timestamp is not zero and does not approach `2^64`.

`★ Insight ─────────────────────────────────────`
This file is a different shape from `SafeVault` and `VulnerableVault` in the same repo. Those contracts send ether, so they have to order the balance update against the external call and check the call's success. `AnchorRegistry` never hands control to another account. Its failures are permanent storage: a bad `recordId`, digest, or cid cannot be overwritten, and role admin can be deleted with no successor.
`─────────────────────────────────────────────────`

- **Verification:** Compared this entry to the prior reply and to `contracts/AnchorRegistry.sol` lines 68–71, 77–78, and 92–96. No tests run. The contract is unchanged.
- **What it got wrong:** Not judged here. All eight findings are kept, including any that a later pass disproves. The empty reentrancy and unchecked-call sections are kept too.

### 2026-11-01 — AnchorRegistry tests for Activity 9 rows 2, 3, 4, and 10

- **Tool:** Cursor agent
- **Request:** Add the Activity 9 tests in `test/AnchorRegistry.test.js`. Extend the empty-cid case so an inspector verifies `""`, `get` returns that verified record, and a repair anchor reverts `AlreadyAnchored`. Add the squat: processor B anchors first, A's anchor reverts, admin revokes B's `PROCESSOR`, `get` still returns B's digest and submitter, and the inspector can still verify (row 14(a) as well). Add the Hardhat mempool race with `evm_setAutomine` false, A's anchor then B's at a higher fee, one mined block, B stored and A reverted, without claiming DIDLab orders by fee. Add the optional misspelled role: `grantRole(keccak256("PROCESOR"), p)` succeeds and `anchor` from p reverts `NotAuthorized(PROCESSOR)`.
- **Outcome:** `AnchorRegistry.sol` is unchanged. `accepts an empty cid` now verifies from the inspector and expects the repair anchor to revert. New tests: `keeps a squatter's record after PROCESSOR is revoked and an inspector verifies it`, `mines the higher-fee anchor and reverts the earlier one in the Hardhat mempool`, and `accepts a misspelled role id that does not let the account anchor`. The race sends plant A first with a 1 wei tip and plant B second with a 2 gwei tip, mines one block, and turns automine back on in a `finally`. The account `p` is the outsider, who does not already hold `PROCESSOR`. The comment on the race test says this is Hardhat's mempool only.
- **Verification:** `npx hardhat test test/AnchorRegistry.test.js` — 26 passing (was 23). The race assertion `receiptB.index < receiptA.index` passed, so B was ordered ahead of A in that block.
- **What it got wrong:** Nothing found. The first run passed.

### 2026-11-01 — AnchorRegistry activity 10 fixes, no redeploy

- **Tool:** Cursor agent
- **Request:** Activity 10 of the adversarial audit: fix the real findings in `AnchorRegistry`. Do not redeploy.
- **Outcome:** `contracts/AnchorRegistry.sol` now reverts the five findings that are checks on the existing functions. The last `ADMIN` revoke reverts `LastAdmin`; a second admin can still step down. `grantRole` to `address(0)` reverts `ZeroAddress`. `anchor` reverts `EmptyRecordId` for `bytes32(0)`, `EmptyCid` for `""`, `CidTooLong` above 128 characters, and `InvalidCid` for a gateway URL or a filename. A failed anchor leaves `submittedAt` at 0, so the lot id can still be anchored with the real CID. Not redeployed. DIDLab still serves `0x5dcEde6EFeBE6592874b263456232fD2328f89B2`. The frontend ABI and address were left on that deployment.

  Left as they are, for the residual-risk section: any `PROCESSOR` can still anchor any `recordId`, and revoking the role leaves the record; two processors can still race, and the first mined anchor wins; `verify` still compares addresses, so two keys in one organization can anchor and attest. A misspelled role id still grants only that id. A repeat `grantRole` and a `revokeRole` of a role not held still emit.
- **Verification:** The seven regression tests were run against `HEAD`'s `AnchorRegistry.sol`, then against the fixed source. On the old source, 0 passing and 7 failing, each because the call succeeded: zero-address grant stored, the last admin revoked itself, the remaining admin revoked itself, empty cid stored, `bytes32(0)` stored, 1024-character cid stored, gateway URL stored. On the fixed source, `npx hardhat test test/AnchorRegistry.test.js` — 28 passing. `npx hardhat test` — 61 passing, 1 failing. The failure is `VulnerableVault` reentrancy: Solidity 0.8 reverts the balance subtraction with panic `0x11` on the way out of the reentrant calls, so the drain transaction reverts. Those files were not part of this change.
- **What it got wrong:** The first regression asserts used `revertedWithCustomError`. That matcher looks the error name up on the contract before sending, so the old-source run failed with "doesn't have a custom error named …" and never showed that the call succeeded. The tests now send first and fail when the transaction is mined. The activity 9 tests that expected the holes (`accepts an empty cid`, and the same shape for zero id, long cid, zero address, and last-admin revoke) were replaced. Those pass on the old contract, so they are not the guards.

### 2026-11-01 — Security review document (activity 11)

- **Tool:** Cursor agent
- **Request:** Write `docs/SECURITY_REVIEW.md` in the activity 11 structure, using the audit, the regression tests, the notes, and the redeploy.
- **Outcome:** Added `docs/SECURITY_REVIEW.md` with scope, method, findings, the AI verification table, fixes, residual risk, and key management. The reviewed address is `0xF732E7E09fa34f451ef04AbB51891E98265E7eeF`. Findings 1, 4, 5, 6, and 7 are fixed. Findings 2, 3, and 8 are accepted. Reentrancy and unchecked calls are not applicable. The frontend still points at `0x5dcEde6EFeBE6592874b263456232fD2328f89B2`.
- **Verification:** Compared the document to `contracts/AnchorRegistry.sol`, `docs/references/notes.md`, the unedited audit in this file, and `frontend/public/app.js` line 260. No tests run.
- **What it got wrong:** Nothing found in the draft. The fee-race row is limited to Hardhat, matching the test comment.

