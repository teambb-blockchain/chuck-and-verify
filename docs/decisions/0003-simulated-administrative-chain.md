# 0003 — Simulate the administrative chain

- Status: Accepted
- Date: 2026-10-04 
- Deciders: Britt Huffman, Bhavana Sriharika Kondapalli

## Context

Our architecture (§4) separates two layers:

- The **administrative chain** decides who may write.
- The **operational chain** records what happened to each batch.

In the real system, credentials come from bodies outside the supply chain: USDA FSIS for inspectors, USDOT FMCSA for carriers, state and local health departments, and an accredited calibration lab for sensors. Every operational write checks the `CredentialRegistry` contract, which records which credentials are valid, unexpired, and unrevoked.

We have no access to any of these bodies, and none of them holds keys on DIDLab. To build and test the operational chain, someone has to issue credentials in their place.

## Decision

The team acts as the administrative chain.

The deployer key is the registry's `admin`, which is fixed at deployment. The admin assigns one issuer per credential type with `setIssuer`. Only that issuer can `grant` or `revoke` credentials of that type, and `isValid` checks existence, revocation, and expiry.

Checkpoint 2 has three credential types: processor, inspector, and custodian.

The access rules are real; the identities are not.

**What behaves exactly as in the real design:**
- every operational write calls `isValid`
- an issuer cannot touch another type's credentials
- revoked and expired credentials fail

**What is simulated:**
- who the issuers are
- the decision to grant a credential, which in reality would follow an inspection, licence, or calibration

## Alternatives considered

1. **The deployer grants every credential directly, with no issuer layer.** Rejected. It is simpler, but it cannot show the property §4 depends on: an inspector-issuing body cannot hand out processor credentials. The per-type issuer is what the tests for wrong-type grant and revoke exercise.

2. **Hard-code role lists inside `BeefSupplyChain`.** Rejected. It would remove expiry and revocation, and it would merge the two layers that §4 keeps apart. Replacing simulated issuers with real ones would then mean redeploying the operational contract.

3. **Obtain credentials or keys from real agencies.** Rejected as infeasible for a course project. Nothing in the design requires it to show that the registry enforces its rules.

## Consequences

**Positive**
- The operational chain can be built and tested now, against the same registry interface real issuers would use.
- Swapping simulated issuers for real ones means calling `setIssuer`; neither contract changes.

**Negative**
- The demo reintroduces the central party the project exists to remove. The team holds the admin key, can appoint or replace any issuer, and through a replacement issuer can revoke anyone's credential. A reader of the demo is trusting us, not regulators.
- `admin` is immutable and controlled by a single key. There is no rotation, multisig, or recovery. A lost or leaked key means redeploying the registry. The design names this risk but does not solve it.
- The live DIDLab deployment uses one wallet as admin, processor issuer, and processor holder (`scripts/setupCredentials.js`). The deployed system therefore shows no separation of roles. Separation is shown only in the Hardhat tests.
- There is no credential type yet for the calibration lab or for sensors. The registry cannot express "this sensor key is registered," which the temperature path (0002, 0004) depends on.

**Follow-up**
- Before Checkpoint 3, run the DIDLab setup with distinct wallets for admin, each issuer, and each holder, so the live system shows the same separation the tests do.
- Add a sensor credential type, with its own issuer standing in for the calibration lab, when the temperature write is added.
- Admin governance (multisig or rotation) stays out of scope. Name it in the security review (§9) as a known limitation.
