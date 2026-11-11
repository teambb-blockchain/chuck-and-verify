# 0005 — Record temperature in a separate contract

- Status: Accepted
- Date: 2026-11-11
- Deciders: Britt Huffman, Bhavana Sriharika Kondapalli

## Context

0002 put temperature in scope and planned a per-leg summary write in
`BeefSupplyChain`: minimum and maximum temperature, time out of range, a
timestamp, and a hash of the full log. Row 7 of the Checkpoint 3 plan says the
same.

Two things have changed since then:

- `BeefSupplyChain` now supports lot splits, and that change needs a redeploy
  on chain 252501.
- None of the temperature work has started. The sensor credential, the signed
  byte layout, the on-chain signature check, and the choice between the ESP32
  and the software signer (0004) are all still open.

A redeploy has a cost. The contract gets a new address, the portal's index of
chain events starts over, the frontend and scripts need the new address, and
the demo batches have to be registered again. If temperature lives in
`BeefSupplyChain`, either the lots redeploy waits for the signing work, or we
redeploy twice.

## Decision

Temperature summaries and dock readings are recorded in their own contract,
not in `BeefSupplyChain`.

- The temperature contract reads batch state from `BeefSupplyChain` (whether
  the batch exists, who holds it, whether it is recalled or split) and checks
  credentials against the existing `CredentialRegistry`.
- `BeefSupplyChain` never reads from the temperature contract. A temperature
  reading does not block a shipment, a receipt, or a recall.
- Before the lots redeploy, `BeefSupplyChain` gains one hook: `custodyLeg`,
  which counts confirmed receipts for each batch. Leg 0 is the first holder,
  and each confirmed receipt starts the next leg. The temperature contract keys
  each summary to one leg of one batch, so a leg gets one summary and a
  reading cannot be filed against a different leg.
- The SENSOR credential is a new type in the existing registry, set with
  `setIssuer`. The registry is not redeployed.

## Alternatives considered

1. **Add the temperature write to `BeefSupplyChain` (the 0002 plan).**
   Rejected. It ties the lots redeploy to the signing work, which has not
   started, or forces a second redeploy later. It also puts signature checks
   into the contract the security review covers, so a mistake there could
   affect custody and recall.

2. **A separate contract with no hook in `BeefSupplyChain`.** Rejected. A
   contract cannot read another contract's past events, so it has no way to
   tell which custody leg a batch is in. Summaries could only be keyed by
   holder address, which breaks when the same custodian holds a batch twice.

3. **Put the leg number in the `ReceiptConfirmed` event as well.** Not
   adopted. Changing an event changes how the portal's index and the frontend
   recognize it. The `custodyLeg` view gives the temperature contract what it
   needs without that change.

## Consequences

**Positive**
- The lots redeploy can go ahead now, and the temperature contract can be
  built and deployed later without touching `BeefSupplyChain` again.
- The custody and recall rules keep the shape the security review covered.
  The signature check sits in a contract that can be reviewed and tested on
  its own.

**Negative**
- There are two contract addresses to track. The portal's index reads events
  from one address today and needs to read from both.
- The temperature contract stores the `BeefSupplyChain` address when it is
  deployed. Each future `BeefSupplyChain` redeploy also means redeploying the
  temperature contract.
- If we later decide a temperature fact should block a custody step (for
  example, no receipt without a dock reading), that check cannot live in the
  temperature contract. It would need another `BeefSupplyChain` change and
  redeploy.

**Follow-up**
- Redeploy `BeefSupplyChain` with lots and `custodyLeg`, then update the
  contract address and start block used by the portal's index, the frontend,
  and the scripts.
- Build the temperature contract once rows 4–6 of the Checkpoint 3 plan (sensor
  credential, signing path, device or software signer) are done.
- Extend the portal's index to read events from the temperature contract.
