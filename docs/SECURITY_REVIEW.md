# Security and Privacy Review — CredentialRegistry and BeefSupplyChain

Guided Lab 3 (Adversarial Security Audit), Activities 6–11. This document becomes §9 of the Checkpoint 4 report.

- Date: 2026-11-08
- Repository commit: `0dbc924` plus the working-tree changes listed in §5 (portal fixes, not yet deployed to the host; `BeefSupplyChain` v2, deployed on chain but not committed)
- Reviewers: Britt Huffman, Bhavana Sriharika Kondapalli (team); Claude Code (AI-assisted audit, see §4)

## 1. Scope

| Component | Source | Live on chain 252501 | Live code matches source? |
| :--- | :--- | :--- | :--- |
| `CredentialRegistry` | `contracts/CredentialRegistry.sol` | [`0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E`](https://explorer.didlab.org/address/0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E) | **Yes.** Runtime bytecode equals the HEAD build once the immutable `admin` and the metadata hash are masked. |
| `BeefSupplyChain` v2 (current) | `contracts/BeefSupplyChain.sol` | [`0x903359014d55A25ED1d4a8DCA6740dd30A90448a`](https://explorer.didlab.org/address/0x903359014d55A25ED1d4a8DCA6740dd30A90448a) | **Yes.** Runtime bytecode equals the v2 build, metadata hash included, once the immutable `registry` is masked. Deployed 2026-11-08 (§5). |
| `BeefSupplyChain` v1 (superseded) | commit `83d7418` | [`0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e`](https://explorer.didlab.org/address/0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e) | **No.** Live bytecode equals commit `83d7418`, built before `ccee520` made `recordRecall` processor-only. A copy of that source is kept at `contracts/test/DeployedBeefSupplyChainV1.sol` (test only). See BSC-0. The frontend no longer uses v1, but its records stay on chain. |
| Portal server | `index.js`, `server/auth.js`, `server/db.js`, `server/ethsig.js` | <https://teambb.didlab.org> | Not checked byte for byte. The P-1 probe on 2026-11-08 behaved like `0dbc924`. |
| Frontend | `frontend/public/*.js` | same | Covered for privacy (encryption, storage, third-party code) only. |

Live state read on 2026-11-08: `admin()` = `0xb323821F0dFCf3b2E8727A7FBae2E34F0D4f393F` (an EOA, not a contract). `issuerOf(PROCESSOR)` and `issuerOf(INSPECTOR)` are the admin. `issuerOf(CUSTODIAN)` is unset. The admin holds a valid PROCESSOR credential. On v1, `BEEF-001` is registered by the admin (500 lbs), inspected and passed, and not recalled. v2 has no batches yet: `getBatch(BEEF-001)` reverts `BatchNotFound`, because batches do not migrate.

`docs/references/notes.md` lists a different deployment (`0x3eC1…38B2` / `0x981a…83D8`, deployer `0x8799…b5a8`). The frontend, the scripts and CHECKPOINT §6 all use the addresses above. Treat notes.md as stale.

Out of scope: the DIDLab IPFS portal and gateway (external), the DIDLab RPC and its transaction ordering, the wallet extension, and Cloudflare and nginx configuration (it cannot be changed from this repo).

## 2. Method

1. **Manual audit (Activity 6).** Every state-changing function was checked against the five classes: access control, input validation, reentrancy, unchecked external calls and state-ordering (table in §3.1).
2. **Adversarial tests (Activity 7).** Three new suites probe every role boundary from an account that lacks the role, feed hostile values (zero, max, duplicate, out of range), and call functions out of order:
   - `test/CredentialRegistry.adversarial.test.js`
   - `test/BeefSupplyChain.adversarial.test.js`, which includes the deployed-v1 recall rule
   - `test/portal.adversarial.test.js`, which starts the real server on a throwaway `DATA_DIR` and signs in with real ethers wallets

   A test named `FINDING …` **passes because the defect is present**, the same convention as `attack.test.js` in Activities 2–3. When a fix lands, that test is flipped to assert the revert.
3. **AI-assisted audit (Activities 8–9).** Claude Code read the full contract, server and frontend source and made claims. Each claim was then confirmed with a test, an on-chain read or a line-by-line reason, or refuted (§4).
4. **Live verification.** Read-only `eth_getCode` and `eth_call` against `https://eth.didlab.org`, plus one `POST /api/auth/challenge` to the live portal for P-1.

`npm test`: **104 passing**. That is 92 when the review was written (35 existing + 57 new) plus 12 added to `test/BeefSupplyChain.test.js` with the v2 fixes. In the adversarial suite, each fixed `FINDING` test is now a `FIXED …` test that asserts the new custom error.

Severity scale: **High** breaks the system's core claim (inspection, custody or recall status can be falsified, or a recall blocked). **Medium** needs a trusted role or a phishing step, or harms one party. **Low** is misconfiguration or griefing by a trusted role. **Info** means no exploit, but worth recording.

## 3. Findings

### 3.1 Activity 6 — five-class matrix

**CredentialRegistry**

| Function | Access control | Input validation | Reentrancy | Unchecked calls | State-ordering |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `setIssuer` | `onlyAdmin`; admin is `immutable`. No finding. | `issuer != 0` checked. `credentialType` can be any bytes32 (CR-5). Replacing an issuer leaves its grants valid (CR-1). | No external call. No finding. | N/A. | Takes effect at once: the old issuer reverts `NotIssuer` on its next call (tested). No finding. |
| `grant` | `msg.sender == issuerOf[type]`. The admin is **not** implicitly an issuer (tested). No finding. | `holder` may be `address(0)` (CR-3). `expiresAt` has no upper bound (CR-4). | None. | N/A. | Overwrites a revoked credential, so revocation is not final (CR-2). |
| `revoke` | Current issuer only. No finding. | Rejects a credential that was never granted. Re-revoking emits a duplicate event (Info). | None. | N/A. | No finding. |
| `isValid` (view) | Public by design. | `timestamp <= expiresAt` is inclusive (tested at the boundary second). No finding. | None. | N/A. | N/A. |

**BeefSupplyChain** (`0dbc924` source, before v2; the v2 changes are in §5)

| Function | Access control | Input validation | Reentrancy | Unchecked calls | State-ordering |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `registerBatch` | `isValid(sender, PROCESSOR)`. Any processor can claim any lot code (BSC-3). | `batchId != 0` and no duplicate are checked. `weightLbs` can be 0 or 2^256−1 (BSC-6). | One call, `registry.isValid`: a `view` call compiled to STATICCALL against an immutable, trusted registry, made before any write. No finding. | Its result drives an `if` → `revert`. A registry with no code makes the call revert (tested). No finding. | First write wins (BSC-3). |
| `recordInspection` | `isValid(sender, INSPECTOR)`. **No check that the inspector is not the batch's processor** (BSC-2). | `reportHash` can be zero (BSC-6). | Same as above. No finding. | Same. No finding. | **Repeatable and last-write-wins.** A FAIL can be replaced by a PASS, also after a recall (BSC-1). |
| `recordShipment` | CUSTODIAN and `currentHolder == sender`. No finding. | `to != 0` checked. `to` may be the sender (BSC-7). `to` need not hold CUSTODIAN; the shipment then stays pending, and the holder can re-point it. | Same. No finding. | Same. No finding. | Re-calling it re-points a pending shipment. The sender is still the holder, so this is accepted (tested). |
| `confirmReceipt` | CUSTODIAN and `pendingReceiver == sender`. No finding. | No arguments besides `batchId`. No finding. | Same. No finding. | Same. No finding. | Rejects confirming twice or before a shipment (tested). If the holder's credential lapses, the batch is stranded (BSC-9). |
| `recordRecall` | PROCESSOR and `batch.processor == sender` at HEAD. **Live v1: any INSPECTOR, and the processor cannot recall** (BSC-0). | `classification` accepts 0–255. `noticeHash` can be 0 (BSC-5). | Same. No finding. | Same. No finding. | Repeatable: the classification can be downgraded afterwards (BSC-5). If the processor's credential lapses, no one can recall the batch (BSC-4). |

### 3.2 Findings register

Status values: **fixed** (in code, with a regression test), **open** (a fix is proposed and awaits a team decision and redeploy), **accepted** (residual risk, see §6), and **N/A**.

#### Contracts

| ID | Function | Class | Scenario | Severity | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BSC-0** | `recordRecall` (**v1 contract**) | Access control | The v1 contract (live until 2026-11-08) gates recall on `CRED_INSPECTOR` and nothing else. Any credentialed inspector can permanently mark any plant's batch as recalled (Class I, any notice hash), and nothing can clear the flag. The processor that registered the batch gets `Unauthorized` if it tries to recall. The source fix (`ccee520`) was never deployed. CHECKPOINT §7 still describes the old rule. | **High** | **Fixed (v2 deployed); v1 still live but no longer used** | `BeefSupplyChain as deployed … (v1)`: all three `BSC-0` tests. Bytecode comparison in §1. |
| **BSC-1** | `recordInspection` | State-ordering / access control | Inspector 1 records FAIL. Inspector 2 (or inspector 1 again) records PASS with a different report hash. `getBatch` now shows `inspectionPassed = true`, and only the event log still holds the FAIL. The same works after a recall. Any one INSPECTOR key, or a pressured inspector, can launder a failed batch, and the verify page reads `getBatch`. | **High** | **Fixed (v2 deployed)** (`AlreadyInspected`, `BatchRecalled`) | `FIXED BSC-1` ×2 |
| **BSC-2** | `recordInspection` | Access control | One address holding PROCESSOR and INSPECTOR inspects and passes its own batch. On chain 252501 the admin holds PROCESSOR and is the INSPECTOR issuer, so it can grant itself INSPECTOR and do this today. Lab 2's `AnchorRegistry.verify` had a `SelfVerification` check; this contract dropped it. | Medium | **Fixed (v2 deployed)** (`SelfInspection`) | `FIXED BSC-2` |
| **BSC-3** | `registerBatch` | State-ordering / access control | Lot codes are readable bytes (`stringToHex(name, {size:32})`) and predictable (`BB-2026-014` → `-015`). Plant B registers Plant A's next lot first. Plant A gets `BatchAlreadyExists`, and Plant B becomes the processor of record and the only party able to recall it. No mempool race is needed. This is the same root cause as Lab 2 finding #2. | Medium | Accepted (see §6) | `FINDING BSC-3` |
| **BSC-4** | `recordRecall` | Access control (availability) | Recall requires the original processor *and* a currently valid PROCESSOR credential. `setupCredentials.js` grants 30-day credentials by default. Once a plant's credential expires or is revoked (for example, the plant is offboarded or its key is compromised), its batches can never be recalled, by anyone. Recall is the public-safety action the system exists for. | **High** | **Fixed (v2 deployed)** (the processor of record may recall without a valid credential; trade-off in §6) | `FIXED BSC-4` ×2; `BSC-0 still holds after the BSC-4 fix` |
| **BSC-5** | `recordRecall` | Input validation / state-ordering | `classification` accepts 0 and 4–255; USDA uses Class I–III. `noticeHash` may be zero. Re-calling `recordRecall` overwrites both, so a processor can downgrade a Class I recall to Class III and swap the notice afterwards. The event log keeps the history, but `getBatch` does not. | Low | **Fixed (v2 deployed)** (`InvalidClassification`, `EmptyNoticeHash`, `RecallNotEscalated`) | `FIXED BSC-5` ×3 |
| **BSC-6** | `registerBatch`, `recordInspection` | Input validation | `weightLbs = 0` and `2^256−1` are accepted; the frontend checks `> 0`, the contract does not. `reportHash = 0` records an inspection that points at no report. Trusted roles only; the record is misleading but nothing is stolen. | Low | **Fixed (v2 deployed)** (`ZeroWeight`, `EmptyReportHash`); no upper bound on weight (accepted) | `FIXED BSC-6` ×2; `FINDING BSC-6 (residual)` |
| BSC-7 | `recordShipment` | Input validation | The holder ships to itself and confirms: an empty custody leg in the history. | Info | Accepted | `FINDING BSC-7` |
| BSC-8 | `recordShipment` / `confirmReceipt` | State-ordering | A recalled or failed batch can still change custody. This is correct: recalled product must still be tracked while it is retrieved. | Info | N/A (intended) | `FINDING BSC-8` |
| BSC-9 | `recordShipment` | Access control (availability) | When the current holder's CUSTODIAN credential lapses, nobody can move the batch, and there is no admin override. Live: `issuerOf(CUSTODIAN)` is unset, so no one can be granted CUSTODIAN and no live batch can ship at all. | Low | Accepted; set the CUSTODIAN issuer | `FINDING BSC-9`; on-chain read in §1 |
| CR-1 | `setIssuer` | Access control (recovery) | A compromised PROCESSOR issuer grants an attacker a 1-year credential. The admin replaces the issuer, but the grant stays valid. The new issuer must find each grant from `CredentialGranted` events and revoke it by hand; there is no on-chain enumeration and no per-issuer invalidation. | Medium | Accepted (runbook in §7) | `FINDING CR-1` |
| CR-2 | `grant` | State-ordering | `grant` after `revoke` silently clears `revoked`. A revocation for cause is indistinguishable from a lapse, and any issuer can quietly reinstate a revoked holder. Documented as "grant or renew". | Low | Accepted | `FINDING CR-2` |
| CR-3 | `grant` | Input validation | `grant(address(0), …)` succeeds, and `isValid(0, …)` returns true. No one can sign as the zero address, so the harm is a misleading event or count. | Low | Deferred (needs a registry redeploy) | `FINDING CR-3` |
| CR-4 | `grant` | Input validation | `expiresAt = type(uint256).max` creates a credential that never expires, which defeats the expiry design. | Low | Deferred (needs a registry redeploy) | `FINDING CR-4` |
| CR-5 | `setIssuer` / `grant` | Input validation | A typo such as `keccak256("PROCESOR")` succeeds and emits events, but grants nothing `BeefSupplyChain` checks. Admin misconfiguration only. | Info | Accepted (the portal hard-codes the three types) | `FINDING CR-5` |
| CR-6 | `admin` (immutable) | Access control / key management | One EOA key is the permanent admin, the PROCESSOR and INSPECTOR issuer, and a PROCESSOR holder. It can never be rotated. If it leaks: `setIssuer(*, attacker)`, then grant itself every credential, then register, inspect, pass and ship anything. If it is lost: issuers can never be changed again. | **High** (residual) | Accepted for the course; see §6–7 | Live reads in §1; `has no function that changes admin` |

#### Portal and privacy

| ID | Area | Class | Scenario | Severity | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **P-1** | `server/auth.js` `requestSite` | Input validation (sign-in phishing) | `X-Forwarded-Host` is client-controlled, and the DIDLab proxy chain passes it through. A look-alike site relays sign-in with `X-Forwarded-Host: <its domain>`. The challenge names the look-alike domain, so the wallet shows no domain-mismatch warning. The victim signs, and the relay receives a real session. If the victim is a portal ADMIN, the relay can change every portal role. Reproduced against **teambb.didlab.org** on 2026-11-08. Portal sessions carry no on-chain authority. | Medium | **Fixed in code; host not redeployed** | `P-1` ×3 in `portal.adversarial.test.js` (they fail on `0dbc924`, pass now) |
| P-2 | `frontend/public/ipfs.js` key derivation | Privacy | The AES key is `keccak256(signature("Authorize DIDLab IPFS upload\nAddress:<addr>\nTimestamp:<t>"))`. Wallet signatures are deterministic, and `t` is stored in localStorage and in the recovery file. Any page that gets the user to sign that same harmless-looking text learns the key, and the ciphertext is pinned on a public gateway for good. The protocol is mandated by the DIDLab portal. | Medium | Accepted (external protocol); user guidance in §6 | Code read: `importAesKey`, `publishEncryptedForm` |
| P-3 | `app.js` form store and recovery file | Privacy | `localStorage["chuck-and-verify.formBundles"]` and the downloaded recovery JSON hold CID, IV, timestamp and **`originalName`**, which is everything except the signature. A filename like `LP-126_Smith_Ranch.pdf` leaks a name. Losing the file loses the means to decrypt. | Low | Open (drop `originalName`, or store only a hash of it) | Code read: `saveFormBundle`, `bindRecovery` |
| P-4 | On-chain data | Privacy | Public forever: lot codes in plaintext, weight per lot (a plant's production volume), every holder address (a supplier graph), pass/fail and recall class. ADR 0001 accepts custody exposure. The report hash is the SHA-256 of the **ciphertext**, so a templated USDA form cannot be recovered by guessing likely contents and hashing them (clean). | Info | Accepted (ADR 0001) | Code read; `getBatch` on `BEEF-001` |
| P-5 | `chain.js`, `ipfs.js`, `admin.js` imports | Supply chain | `https://esm.sh/viem@2` is a floating major version with no integrity pin. This code builds every transaction and receives the encryption signature (P-2). A bad viem 2.x release or an esm.sh compromise could exfiltrate keys to every form, or swap a transaction's target. | Medium | Open (pin exact version and vendor it, or use an import-map `integrity`) | Code read |
| P-6 | `index.js` static responses | Clickjacking | No `X-Frame-Options`/`frame-ancestors`, `nosniff` or referrer policy. The admin card (set issuer, roles) could be framed. | Low | **Fixed in code; host not redeployed** | `P-6` test |
| P-7 | `/api/auth/challenge` | Availability | Unauthenticated callers can create 10,000 challenges in 5 minutes. Every sign-in then returns 503 for everyone until they expire. | Low | Accepted (course scale) | Code read: `MAX_LIVE_CHALLENGES` |
| P-8 | Portal roles vs. chain | Access control (design) | `portal.db` roles only hide UI and gate `/api/ipfs/add`. `ipfs.js` falls back to the DIDLab portal URL directly, so the `form.upload` gate is not a boundary. Chain writes are still gated by `CredentialRegistry`. | Info | Accepted (documented in `session.js`) | Code read |
| P-9 | `portal.db` | Privacy | Maps wallet addresses to human labels, and also holds session hashes. It is the one file that de-anonymises on-chain addresses. It lives in `/srv/data` (private) and is gitignored locally. | Info | Accepted | `.gitignore`; `server/db.js` |

**Checked and clean** (each one has a test or a stated reason):

- Contract reentrancy and unchecked calls. The only external call is `registry.isValid`, a view called via STATICCALL and checked.
- Nonce replay. Single use.
- Wrong-wallet signatures.
- High-s malleated signatures (EIP-2 check in `ethsig.js`).
- Session cookie flags: `HttpOnly`, `SameSite=Strict`, `Secure` on https.
- The session token is stored only as a SHA-256 hash.
- Cross-site `text/plain` posts are refused with 415.
- Admin routes return 401/403 to a PROCESSOR or an anonymous caller.
- Path traversal: four probes.
- No `innerHTML` or `eval` sinks in the frontend.
- No private keys anywhere in git history.

## 4. AI-assisted audit (Activities 8–9)

**Tool:** Claude Code (Opus 5.5), 2026-11-08. It read every file under `contracts/`, `server/`, `scripts/` and `frontend/public/`, plus `index.js`. It was asked for findings across the five classes, by name, plus privacy. Its claims and the verdict on each:

| # | AI claim | Class | Verdict | How decided |
| :--- | :--- | :--- | :--- | :--- |
| 1 | The deployed `BeefSupplyChain` is not the reviewed source; live recall is inspector-gated | Access control | **Real** | Bytecode comparison (§1) and the v1 tests. A source-only audit would have missed this. |
| 2 | `recordInspection` can overwrite FAIL with PASS | State-ordering | **Real** | `FINDING BSC-1` |
| 3 | No self-inspection guard | Access control | **Real** | `FINDING BSC-2`, plus the live reads showing the admin holds PROCESSOR and controls INSPECTOR |
| 4 | Lot-code squat | State-ordering | **Real** | `FINDING BSC-3`. The gas-price front-run variant is **unverified** on DIDLab, as in Lab 2 #3; the squat needs no race. |
| 5 | Recall becomes impossible after a credential lapses | Access control | **Real** | `FINDING BSC-4` |
| 6 | Classification range and downgrade; zero hashes; weight bounds | Input validation | **Real, Low** | `FINDING BSC-5`, `BSC-6` |
| 7 | CR-1 to CR-5 | Mixed | **Real, Low/Info** | `FINDING CR-*` |
| 8 | Reentrancy through `registry.isValid` | Reentrancy | **False positive** | `ICredentialRegistry.isValid` is `view`, so Solidity emits STATICCALL. The callee cannot change state, and the registry is immutable and set by the deployer. |
| 9 | Unchecked return from the registry call | Unchecked calls | **False positive** | The return value is the `if` condition, and a revert bubbles up. A registry with no code reverts (tested). |
| 10 | A holder re-pointing a pending shipment "steals" it | State-ordering | **False positive** | The sender is still `currentHolder`, and the first receiver never took custody (tested). |
| 11 | Recalled batches should not ship | State-ordering | **False positive** | Retrieval after a recall needs custody tracking (BSC-8). |
| 12 | SIWE domain taken from a spoofable header | Input validation | **Real** | Reproduced locally and **on the live host**; fixed (P-1) |
| 13 | Hand-written ECDSA recovery in `ethsig.js` may accept forged signatures | Crypto | **Not shown** | Real ethers signatures recover correctly; wrong-signer and high-s forms are rejected; r and s are range-checked and the point is on the curve. There is no randomized differential test against ethers yet, so this is "no defect found", not "proven". |
| 14 | Signature-derived encryption key; filename leak; unpinned CDN; no frame headers | Privacy / supply chain | **Real** | P-2, P-3, P-5, P-6 |

**Where the AI was weak:**

- It first rated BSC-8 (custody after a recall) as a defect. It reversed that when the retrieval use case was considered.
- Its first P-1 test overrode `Host` through `fetch`. `fetch` silently ignores that header, so the test passed for the wrong reason until it was rewritten with `http.request`.
- It cannot judge P-2's real exposure, which depends on how DIDLab's decrypt tooling phrases the same message.

**What the AI cannot fill: the team's own Activity 6.** `docs/references/SecurityAuditActivity6.xlsx` covers Lab 2's `AnchorRegistry`, not these contracts. §3.1 above is the AI's matrix. **Before submission, a team member must work the five classes against both contracts independently, compare the result with §3.1, and record any miss here.** That comparison is the Activity 9 "what it missed" row, and only the team can write it.

## 5. Fixes

| Finding | What changed | Regression test | Deployed |
| :--- | :--- | :--- | :--- |
| P-1 | `requestSite` uses a non-local `Host`/`X-Forwarded-Host` only if it is on `PORTAL_ORIGINS`; anything else falls back to the first public origin. | `P-1: ignores a client-sent X-Forwarded-Host…`, `…non-local Host header…`, `…keeps the listed public host…` (3 fail on `0dbc924`) | **No.** Copy `index.js` and `server/auth.js` to `/srv/app` and restart Node. |
| P-6 | Static responses send `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`, `nosniff` and `Referrer-Policy`. | `P-6: refuses framing and MIME sniffing…` | No (same step) |
| BSC-0 | `recordRecall` is restricted to the processor of record (`ccee520`, kept in v2) | `test/BeefSupplyChain.test.js` › `recordRecall`; `BSC-0 still holds after the BSC-4 fix` | **Yes (v2)** |
| BSC-1 | `recordInspection` reverts `AlreadyInspected` once a batch is inspected, and `BatchRecalled` after a recall. The first inspection is final; no re-inspection record exists yet. | `FIXED BSC-1` ×2; D1 test `AlreadyInspected` | Yes (v2) |
| BSC-2 | `recordInspection` reverts `SelfInspection` when `msg.sender == batch.processor` | `FIXED BSC-2`; D1 test `SelfInspection` | Yes (v2) |
| BSC-4 | `recordRecall` no longer calls the registry. Only the processor of record may recall (`NotBatchProcessor` for everyone else, outsiders included), whether or not its credential is still valid. | `FIXED BSC-4` ×2 | Yes (v2) |
| BSC-5 | `classification` must be 1–3 (`InvalidClassification`); `noticeHash != 0` (`EmptyNoticeHash`). A later recall must use a strictly lower class number (`RecallNotEscalated`), so the notice cannot be swapped at the same class. | `FIXED BSC-5` ×3; D1 tests | Yes (v2) |
| BSC-6 | `weightLbs > 0` (`ZeroWeight`); `reportHash != 0` (`EmptyReportHash`). No upper bound on weight. | `FIXED BSC-6` ×2; `FINDING BSC-6 (residual)` | Yes (v2) |

**Not fixed:** BSC-3 is accepted (§6). CR-3 and CR-4 are deferred, because only `BeefSupplyChain` is redeployed; v2 points at the live `CredentialRegistry` `0x9ef5…AB2E`.

**Redeploy evidence (Activity 10).** Deployed with `npm run deploy:supply-chain`, which deploys `BeefSupplyChain` only and reuses the live registry. `frontend/public/chain.js`, `scripts/registerBatch.js` and CHECKPOINT §6 now use the v2 address. The frontend still needs to be deployed to the host. Before anyone can ship on v2, the admin must call `setIssuer(CUSTODIAN, …)` and grant CUSTODIAN credentials (§1: no CUSTODIAN issuer is set). `BEEF-001` and other v1 records do not migrate.

```
finding          BSC-0, BSC-1, BSC-2, BSC-4, BSC-5, BSC-6 (see above)
fix              BeefSupplyChain v2 (contracts/BeefSupplyChain.sol)
regression_test  FIXED BSC-* in test/BeefSupplyChain.adversarial.test.js; D1 tests in test/BeefSupplyChain.test.js
old_contract     0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e
new_contract     0x903359014d55A25ED1d4a8DCA6740dd30A90448a
deploy_tx        0xe97d465f82f1d64e266373674545e30cf50732a49d3938339cf780d10ad6b3f1
block            7269167 (2026-11-08 21:39:16 UTC), status success, gas 841,913
deployer         0x87996A1051e98DD5586643c9a19B7C000A7eb5a8 (not the registry admin; BeefSupplyChain has no owner, all authority comes from registry())
registry()       0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E (reused)
bytecode         full match with the v2 build, metadata included (registry immutable masked)
```

## 6. Residual risk

- **Single admin key (CR-6).** This is accepted for a course deployment with no real users or product. A production system would make `admin` a multisig (for example, a Safe owned by the regulators) and add two-step admin transfer, which needs a registry redeploy. We do not claim this is mitigated today.
- **Organisation-level self-inspection (beyond BSC-2).** The contract sees addresses, not companies. One firm holding two keys can still inspect its own product. Only onboarding by the INSPECTOR issuer (who gets INSPECTOR) prevents this.
- **Recall without a valid credential (BSC-4 fix).** A revoked or compromised processor key can still recall, and escalate, its own batches. We accept this because a false recall fails safe (product is held, not released), it is limited to that processor's own batches, and every recall is in the event log under the sender's address. The opposite risk, a recall nobody can issue, is worse.
- **Inspection is final (BSC-1 fix).** A wrong inspection, or one later overturned, cannot be corrected on chain. A correction would need a separate, appended re-inspection record, which is not built.
- **Lot-code squatting (BSC-3), accepted.** Every write names its sender, so a squatter is identifiable, and the INSPECTOR and CUSTODIAN steps still need honest parties. This is acceptable at course scale; not acceptable with competing real plants.
- **Revocation is not retroactive (CR-1).** Records written by a since-revoked key stay. Readers must check the writer's credential status at the time of the write, using the events.
- **P-2 encryption scheme.** It is mandated by DIDLab. Mitigation is user guidance only: never sign an "Authorize DIDLab IPFS upload" message on any other site.
- **Public chain data (P-4).** Lot codes, weights and the supplier graph are public by design (ADR 0001). Do not put personal names in lot codes or portal-visible filenames.
- **Gas-price front-running on DIDLab.** Unverified. It does not change the severity of BSC-3, because the squat needs no race.

## 7. Key management

| Key | Where it lives | Who can reach it | Powers | If it leaks |
| :--- | :--- | :--- | :--- | :--- |
| Deployer / registry admin `0xb323…393F` | Team member's wallet. It is loaded into `.env` `DEPLOYER_KEY` only for scripts; that entry is currently empty, and `.env` is gitignored, with no key found in git history. | Whoever holds that wallet | Permanent `admin`; PROCESSOR and INSPECTOR issuer; holds PROCESSOR | **Total compromise of both contracts' meaning**, with no rotation possible (CR-6). Response: announce the compromise; redeploy `CredentialRegistry` with a new admin (ideally a multisig) and `BeefSupplyChain` against it; update `chain.js`; treat every record written after the leak as untrusted. |
| Issuer keys (today the same as the admin) | Same | Same | Grant and revoke one credential type | Admin calls `setIssuer(type, newKey)`. The new issuer revokes every grant the old key made, found from `CredentialGranted(…, by = oldKey)` events (CR-1). |
| Holder keys (processor, inspector, custodian wallets) | Each party's wallet | That party | Writes for its credential type | The issuer calls `revoke`. Past writes stay (§6). On v1 and at `0dbc924`, revoking a processor also removed recall for its batches (BSC-4). v2 keeps recall available to the processor of record, so a leaked processor key can still recall its own batches (§6). |
| Portal ADMIN wallets | Listed in `/srv/data/portal.db` | Those wallets | Portal roles only, no chain authority | Another portal ADMIN removes the wallet in Portal users. This takes effect on the next request, because roles are re-read from `portal.db` each time; the session itself lasts at most 8 hours. |
| DIDLab host (`/srv/app`, `/srv/data`) | Course container | Team members with host access | Serves the frontend, which builds every transaction | A modified `app.js` could make wallets sign anything, and users approve it in the wallet. Pinning and vendoring dependencies (P-5) narrows the external part of this risk. |
