# Security review — AnchorRegistry

Checkpoint 4 review of the anchor registry. The evidence behind the fixes is in `docs/references/notes.md`. The unedited AI audit is in `AI_RECORD.md`.

## Scope

| | |
|---|---|
| Contract | `contracts/AnchorRegistry.sol` |
| Compiler | Solidity 0.8.24, optimizer on, 200 runs |
| Chain | DIDLab, chain id `252501` |
| Reviewed deployment | `0xF732E7E09fa34f451ef04AbB51891E98265E7eeF` |
| Deploy transaction | [`0x93fb8ccf9a161541a755eb9fa6d4d548a3ca302d657338e73bb08cc259f271e0`](https://explorer.didlab.org/tx/0x93fb8ccf9a161541a755eb9fa6d4d548a3ca302d657338e73bb08cc259f271e0) |
| Previous deployment | `0x5dcEde6EFeBE6592874b263456232fD2328f89B2` |
| Previous deploy transaction | [`0x83ff0dd18efe2967456451b652909304d76a59e106a2406cf6acb32398a24c14`](https://explorer.didlab.org/tx/0x83ff0dd18efe2967456451b652909304d76a59e106a2406cf6acb32398a24c14) |

The reviewed source is the contract after the activity 10 fixes. The new address holds `ADMIN` for the deployer and no other roles. The activity 08 lot `BB-2026-014` is still on the previous contract. `frontend/public/app.js` still sets `REGISTRY` to that previous address.

`VulnerableVault`, `SafeVault`, `BeefSupplyChain`, and `CredentialRegistry` are out of this review.

## Method

Five classes, applied to every state-changing function: access control, input validation, reentrancy, unchecked external calls, and state-ordering.

1. Manual pass. Each function was checked against the five classes. The results were written up as findings with a function, a class, a scenario, and a severity. Behavior that held was written down as well.
2. Adversarial tests in `test/AnchorRegistry.test.js`. Role boundaries were called from accounts that lack the role. Inputs were empty, zero, overlong, duplicated, and out of order.
3. AI-assisted pass. The full source was audited against the same five classes. The unedited reply is in `AI_RECORD.md`. Each claim was then confirmed or narrowed with a test or a line-by-line reason.
4. Fixes. Five findings changed the contract. Each has a regression test that fails on the pre-fix source, because the bad call is mined, and passes on this source, because the call reverts. Those tests were run in Hardhat. They were not sent to either DIDLab address. One redeploy published the fixed bytecode.

## Findings

Status is fixed, accepted, or not applicable.

| # | Function | Class | Scenario | Severity | Status |
|---|----------|-------|----------|----------|--------|
| 1 | `revokeRole` | Access control | The sole admin revokes itself. Later grants and revokes revert, and a processor key that should have been rotated can still anchor. | Medium | Fixed |
| 2 | `anchor` | Access control | Any `PROCESSOR` may anchor any `recordId`. Revoking that role leaves the record, and `verify` can still attest it. | Medium | Accepted |
| 3 | `anchor` | State-ordering | Two processors anchor the same id. The first transaction mined sets the record. The second reverts `AlreadyAnchored`. | Medium | Accepted |
| 4 | `anchor` | Input validation | An empty cid is stored and can be verified. A repair anchor reverts, so the lot id is burned. | Medium | Fixed |
| 5 | `anchor` | Input validation | `recordId` `bytes32(0)` is stored like any other key. | Low | Fixed |
| 6 | `anchor` | Input validation | `cid` had no length cap and no character set, so a long string, a filename, or a gateway URL could be stored and logged. | Low | Fixed |
| 7 | `grantRole` | Input validation | `address(0)` can be granted a role. Nothing can send from that address. An operator can count it as a live holder. | Low | Fixed |
| 8 | `verify` | Access control | The self-check compares two addresses. Two keys in one organization can anchor and attest the same batch. | Low | Accepted |
| 9 | `grantRole` / `revokeRole` | Input validation | A second grant emits another `RoleGranted`. A revoke of a role the account does not hold emits `RoleRevoked`. A misspelled role id is stored and does not satisfy `onlyRole(PROCESSOR)`. | Low | Accepted |

Checked, and not a vulnerability:

- Reentrancy and unchecked external calls do not apply. No function transfers ether or calls another contract.
- `onlyRole` gates every state change. The constructor grants `ADMIN` only. A non-admin `grantRole` or `revokeRole` reverts `NotAuthorized(ADMIN)`. An account without `PROCESSOR` cannot anchor. An account without `INSPECTOR` cannot verify. The same address cannot anchor and then verify.
- `anchor` reverts `EmptyDigest` on a zero digest and `AlreadyAnchored` on a second write, including a second processor with a different digest.
- `verify` reverts `UnknownRecord` before a record exists and `AlreadyVerified` on a second attest. The first verifier stays in storage. The digest cannot be replaced after `anchor`.

## The AI audit

The tool reported eight findings and empty reentrancy and unchecked-call classes. The verdicts below were decided with tests, except where the table says the decision is a reading of the code. The unedited reply is the activity 08 entry in `AI_RECORD.md` dated 2026-11-01, headed "AnchorRegistry security audit (unedited)".

| # | AI claim | Class | Verdict | How we decided |
|---|----------|-------|---------|----------------|
| 1 | The sole admin can revoke itself and freeze role changes. | Access control | Real. Fixed. | On the pre-fix source, `revokeRole(ADMIN, admin)` is mined. On this source, `rejects the last admin revoking itself` reverts `LastAdmin`, and a second admin can still step down. |
| 2 | Any `PROCESSOR` can anchor any lot, and revoking the role leaves the record. | Access control | Real. Accepted. | `keeps a squatter's record after PROCESSOR is revoked and an inspector verifies it` still passes. `get` returns the squatter's digest and submitter, and the inspector's `verify` succeeds. |
| 3 | A higher fee lets a second processor's anchor land first. | State-ordering | Real on Hardhat. Accepted. The DIDLab ordering claim is not shown. | `mines the higher-fee anchor and reverts the earlier one in the Hardhat mempool` stores plant B and reverts plant A. The test comment limits that result to Hardhat's mempool. |
| 4 | An empty cid can be anchored and then verified, and the lot id cannot be repaired. | Input validation | Real. Fixed. | On the pre-fix source the empty cid was stored and verified. `rejects an empty cid` now reverts `EmptyCid`, then anchors the portal CID on the same id. |
| 5 | `bytes32(0)` is a normal record id. | Input validation | Real. Fixed. | `rejects a zero recordId` reverts `EmptyRecordId`. `get` of the zero id stays empty. |
| 6 | `cid` is unbounded and can carry a filename or a URL. | Input validation | Real. Fixed. | `rejects a cid longer than the maximum` reverts `CidTooLong` for 1024 characters. `rejects a cid that is not a bare identifier` reverts `InvalidCid` for the gateway URL and for `mock-boxed-beef-lot-BB-2026-014.pdf`. |
| 7 | `grantRole` accepts `address(0)`. | Input validation | Real. Fixed. | `rejects grantRole to the zero address` reverts `ZeroAddress`. `hasRole` stays false. |
| 8 | Two keys in one organization can write a digest and attest it. | Access control | Real. Accepted. | `rejects self-verification` still reverts when one address holds both roles. The code compares `r.submitter` with `msg.sender` and has no organization id. |
| — | Reentrancy on the registry. | Reentrancy | Does not apply. | None of `constructor`, `grantRole`, `revokeRole`, `anchor`, `verify`, or `get` makes an external call. |
| — | An ignored external call. | Unchecked external calls | Does not apply. | Same six functions. There is no call whose success could be ignored. |
| — | A repeat `RoleGranted`, a `RoleRevoked` for a role not held, and a misspelled role id. | Input validation | Real behavior. Not an authorization bypass. Accepted. | `emits a second RoleGranted when the role is already held` and `emits RoleRevoked when the account does not hold the role` still pass. `accepts a misspelled role id that does not let the account anchor` stores `keccak256("PROCESOR")` and `anchor` still reverts `NotAuthorized(PROCESSOR)`. |

What it missed: no ninth defect in `AnchorRegistry`. The role boundaries the manual tests already checked were reported as holding, and they do hold. The miss is in finding 3's wording. The reply states a fee race as the exploit on the network. The test shows that ordering only in Hardhat.

## Fixes

All five fixes are in the reviewed deployment. Records on the old contract were not copied.

| | |
|---|---|
| old_contract | `0x5dcEde6EFeBE6592874b263456232fD2328f89B2` |
| new_contract | `0xF732E7E09fa34f451ef04AbB51891E98265E7eeF` |
| deploy_tx | `0x93fb8ccf9a161541a755eb9fa6d4d548a3ca302d657338e73bb08cc259f271e0` |

| Finding | Fix | Regression test |
|---------|-----|-----------------|
| Last `ADMIN` can revoke itself. Access control. | `revokeRole` of a held `ADMIN` reverts `LastAdmin` when one admin remains. A repeat grant of `ADMIN` to the same account does not increase the count. | `rejects the last admin revoking itself`. `lets an admin step down when another admin remains`. |
| `grantRole` accepts `address(0)`. Input validation. | `grantRole` reverts `ZeroAddress` before the role is stored. | `rejects grantRole to the zero address` |
| `anchor` accepts an empty cid, and `verify` will attest it. Input validation. | `anchor` reverts `EmptyCid` before `submittedAt` is set. The same `recordId` can still be anchored. | `rejects an empty cid` |
| `anchor` accepts `recordId` `bytes32(0)`. Input validation. | `anchor` reverts `EmptyRecordId` before the record is written. | `rejects a zero recordId` |
| `cid` is an unconstrained string. Input validation. | At most 128 letters and digits. Longer input reverts `CidTooLong`. Any other character reverts `InvalidCid`. | `rejects a cid longer than the maximum`. `rejects a cid that is not a bare identifier`. |

`npx hardhat test test/AnchorRegistry.test.js` on this source: 28 passing. The same seven regression tests against the pre-fix source: 0 passing, 7 failing, each because the bad call was mined.

## Residual risk

Three findings stay open. Each is acceptable for a registry whose job is to keep the first commitment to a lot, not to decide which plant owns that lot.

**Any granted processor can anchor any lot.** `PROCESSOR` is one role, not a list of plants per `recordId`. After a revoke, the stored digest, cid, and submitter remain, and an inspector can still verify them. That permanence is the registry. Erasing a record when a key is revoked would destroy the audit trail this contract exists to keep. The admin's control is who receives `PROCESSOR` before a lot is anchored. On the reviewed deployment that role has not been granted. On the previous deployment it was granted to one address, wallet A.

**The first mined anchor wins.** Two holders of `PROCESSOR` can submit different digests for one id. Inclusion order chooses the record, and `verify` attests whatever won. A commit-reveal protocol would be a different contract. The Hardhat test shows a higher tip ordered first in Hardhat's mempool. This review does not claim that DIDLab orders transactions by fee. The practical bound is the same as the previous risk: do not grant `PROCESSOR` to a second key that is allowed to race the first.

**Two addresses can share an organization.** `verify` reverts when `r.submitter == msg.sender`. It cannot tell that wallet A and wallet B belong to one party. The same address anchoring and verifying still reverts `SelfVerification`. The deployment rule is to grant `PROCESSOR` and `INSPECTOR` to different parties. Wallet A and wallet B are different addresses. The contract will not notice if one person holds both keys.

Also accepted, and not an authorization bypass: a repeated `grantRole` and a `revokeRole` of a role that is not held still emit events. A grant of `keccak256("PROCESOR")` succeeds and does not let that account anchor. An operator checks `hasRole` for `PROCESSOR`, not for a role id they typed by hand.

A leaked `ADMIN` key can appoint and remove processors and inspectors, and can appoint a successor admin. It cannot rewrite a record that is already stored, and it cannot remove the last admin without that successor. There is no multisig. For this course deployment, one operator key is the admin. The damage of a leak is role reassignment, not a changed digest.

## Key management

The private key is not in the repository. Deploy and grant scripts read `DIDLAB_PRIVATE_KEY` from the shell. The team charter assigns DIDLab operation to the DIDLab operator. The charter forbids committing `.env`, private keys, or other secrets.

| Key | Address | Where it lives | What it can do |
|-----|---------|----------------|----------------|
| `ADMIN` | `0x87996A1051e98DD5586643c9a19B7C000A7eb5a8` | Shell export for the deployer. Not a file in this repo. | Grant and revoke roles. On the reviewed contract this is the only role held. `revokeRole` of this last admin reverts `LastAdmin`. |
| `PROCESSOR` (wallet A) | `0xc2Ad3207fD426313CB6DeE60A8e00A1aA577351E` | A separate lab wallet. Granted on the previous contract only. | `anchor` on `0x5dcEde6E…`. No role on the reviewed contract until `grant:anchor` is run against the new address. |
| `INSPECTOR` (wallet B) | `0x2710C588137CC6b0BAa46e5a504ECfF246b93b5b` | A separate lab wallet. Granted on the previous contract only. | `verify` on `0x5dcEde6E…`. No role on the reviewed contract yet. |
| Probe wallet | `0x24117a294a5167573C5D79cEb62845Db4a33D9d2` | Used for the activity 11 console simulation. | No role. `anchor` on the previous contract simulated `NotAuthorized(PROCESSOR)`. Nothing was sent. |

If the `ADMIN` key leaks, the holder can grant `PROCESSOR` and `INSPECTOR` to themselves, grant `ADMIN` to a second address, and then revoke the original admin. They still cannot change `BB-2026-014` on the previous contract, and they cannot anchor or verify until they grant those roles. The page at `frontend/public/app.js` still talks to the previous contract, so a leak of the admin key does not by itself move the frontend onto the new address.
