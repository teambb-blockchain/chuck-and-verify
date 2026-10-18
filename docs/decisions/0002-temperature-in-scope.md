# 0002 — Keep temperature monitoring in scope

- Status: Accepted
- Date: 2026-10-04 
- Deciders: Britt Huffman, Bhavana Sriharika Kondapalli

## Context

Our first milestone excluded temperature. The system verified three claims about a beef batch: it passed USDA inspection, it moved through known custody, and it has or has not been recalled.

Before Checkpoint 1 we brought temperature back into scope. Custody alone does not show that a batch was handled safely. A batch can pass inspection, change hands correctly, and still spoil in a warm trailer. Cold-chain control is the condition that downstream parties and consumers can least verify today. They rely on the carrier's or cold-storage operator's own report. Reinstating temperature changed the stakeholder table, the trust boundaries, and the §5 on-chain/off-chain split.

This record covers what the system verifies about temperature. How readings reach the chain (sensors, signing, scanners) is a separate decision, recorded in 0004.

## Decision

Temperature monitoring is part of the system's verification claim. For each custody leg, the chain records:

- the batch number
- the minimum and maximum temperature
- the time spent out of the required range
- a timestamp
- a hash of the full temperature log

The full readings, detailed logs, and device records stay off chain with the custodian. Anyone holding the log can check it against the on-chain hash.

The Checkpoint 2 deployment of `BeefSupplyChain` has no temperature write. Temperature support is added to the contract at Checkpoint 3.

## Alternatives considered

1. **Leave temperature out of scope (the milestone 1 design).** Rejected. The system would certify inspection and custody while saying nothing about the handling condition most likely to make beef unsafe after inspection. A consumer reading a clean record could reasonably take it as a safety claim the system cannot support.

2. **Record every reading on chain.** Rejected. Continuous monitoring produces a write every few minutes per batch per leg. That costs gas on every write and publishes each custodian's operating detail on a public chain. A per-leg summary plus a log hash supports the same verification with one write per leg.

3. **Record only a pass/fail out-of-range flag.** Rejected. A flag hides how far and how long a batch left the range, and those are the facts a recall decision depends on. Without a log hash, nobody can later check the flag against the readings behind it.

## Consequences

**Positive**
- The verification claim covers the post-inspection handling condition that custody records alone miss.
- One summary write per leg keeps cost and data exposure low while staying checkable against the full log.

**Negative**
- At Checkpoint 2 the claim is unsupported on chain. The deployed contract records no temperature, so any statement that a third party can check temperature conditions is a design commitment, not a working feature.
- A summary is only as honest as the log behind it. The hash proves the log was not changed after the summary was written. It does not prove the log is complete or that the sensor was with the beef (see §4, Devices).
- Scope grew late. Temperature adds a contract write, a credential path for whoever submits summaries, and the hardware question in 0004, all landing before Checkpoint 3.

**Follow-up**
- Add a per-leg temperature summary write to `BeefSupplyChain` at Checkpoint 3, gated by the registry like the other writes.
- Decide which credential type may submit summaries (custodian, or a separate sensor type registered by the calibration lab) before writing that function.
