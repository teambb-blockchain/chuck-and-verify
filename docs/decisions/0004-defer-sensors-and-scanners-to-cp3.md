# 0004 — Defer real sensors and scanners to Checkpoint 3

- Status: Deferred
- Date: 2026-10-18
- Deciders: Britt Huffman, Bhavana Sriharika Kondapalli

## Context

The Checkpoint 1 plan (§14, item 5) committed us to two things before Checkpoint 2:

- order the hardware
- run an ESP32 signing feasibility test, with this pass criterion: *a signed reading verifies on chain*

The design (§4, Devices) has temperature sensors sign readings with keys registered by the calibration lab. Custodians relay the readings but cannot alter them. Receivers confirm custody by scanning the batch's QR code.

At Checkpoint 2, the two commitments stand as follows:

- The hardware is ordered and in hand.
- No stage of the signing test ran, including the software-only stages that need no hardware.

The test did not run because we spent the Checkpoint 2 time on other work. The Checkpoint 2 rubric weights "deployed with a real transaction" at 25 points and "contract matches §4" at 15. Both depend on the credential registry and the supply-chain contract, which did not exist when the checkpoint opened. We put the available time into those two contracts and the DIDLab deployment, and none of it into the signing test.

PROPOSAL.md lists a simulated QR scan as the base design and a physical scanner as a stretch goal. This record follows PROPOSAL.md.

## Decision

Real temperature sensors, the microcomputer, and the physical QR scanner are deferred to Checkpoint 3.

At Checkpoint 2:

- **Custody** is confirmed by the receiver calling `confirmReceipt` from its own credentialed address. This is the simulated scan. The handoff completes only when the receiver acts, which is the property the scan exists to provide.
- **Temperature** has no on-chain input. 0002 records that temperature support is added to the contract at Checkpoint 3.

This record covers how readings reach the chain. What the chain verifies about temperature is decided in 0002.

## Alternatives considered

1. **Cut hardware from the project entirely and use simulated readings permanently.** Rejected for now. Without a device signature, a custodian can submit any summary it likes, and the temperature claim reduces to the custodian's word. That is the trust problem the project targets. We keep this option as the cut fallback (see Follow-up).

2. **Deliver a partial hardware demo at Checkpoint 2.** Rejected. A device reading that the chain cannot verify demonstrates nothing the simulation does not. The Checkpoint 2 schedule went to the two contracts and the deployment, which the checkpoint grades.

3. **Use a software signer as a stand-in sensor.** A laptop script holds a registered sensor key and signs readings in the same byte layout the device would use. Not adopted now, because the ESP32 is in hand and untested. We keep this option as the fallback if the software path passes but the device does not (see Follow-up). It is stronger than alternative 1: the chain still rejects tampered readings and readings from unregistered keys, so the contract's verification path works as designed. It is weaker than the device because the custodian holds the signing key. A custodian can sign any reading it likes, so a signature proves which key signed, not that a sensor was with the beef.

## Consequences

**Positive**
- Checkpoint 2 effort went to the registry, the supply-chain contract, and the DIDLab deployment.
- Custody confirmation works without the scanner. The physical scanner, if added, changes how the receiver triggers `confirmReceipt`, not what the chain records.

**Negative**
- The temperature claim has no working path at Checkpoint 2, and the "simulated inputs" fallback promised in §13 does not exist yet either.
- Even when it is built, a simulated input proves only that the contract accepts a summary. It cannot prove that a reading came from a registered sensor.
- All hardware work, the temperature contract write, and the sensor credential (0003) now fall in the three weeks before Checkpoint 3 on November 8. A slip in any one blocks the temperature claim for the Functional checkpoint.

**Follow-up**
- **Revisit condition:** hardware is in for Checkpoint 3 if a reading signed on the ESP32 is recovered on chain to the registered sensor address, and the three negative cases fail to verify:
  - a tampered message
  - a wrong signing key
  - an unregistered key
- **Cut conditions:**
  - If the software-only signing path (Python sign, on-chain verify, negative cases) does not pass by 2026-10-25, hardware is cut, alternative 1 is adopted, and this record is superseded.
  - If the software path passes but the ESP32 path does not pass by 2026-11-01, the ESP32 is cut for Checkpoint 3, alternative 3 is adopted, and this record is superseded.
- **Research questions to resolve before writing device or contract code:**
  - Does the ESP32 signing library support secp256k1 with keccak256, which Ethereum's `ecrecover` expects?
  - What is the exact byte layout of a signed reading? Fix it in one shared place so the device and the contract encode identically.
