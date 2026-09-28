# 0001 — Keep retail sales data off chain

- Status: Accepted
- Date: 2026-09-27
- Deciders: Britt Huffman, Bhavana Sriharika Kondapalli

## Context

Our first draft of the on-chain/off-chain split (proposal C1) recorded retail
activity on chain: date received, lbs received, and a daily record of lbs sold
per batch. The intent was to trace the full volume of each batch from
processor to point of sale.

The suitability analysis (B2, D1) showed this conflicts with our own design
goal. DIDLab is a public chain, so every record is readable by anyone,
including competing retailers. A daily lbs-sold series would publish each
retailer's sales volume, demand pattern, and supplier relationships. None of
that helps a consumer or regulator verify the claim our system exists to
support: that a batch passed USDA inspection, moved through known custody,
and has or has not been recalled.

## Decision

Retail records on chain are limited to the custody facts: which retailer
received the batch, when, and how many lbs. Sales data — individual sales,
daily sales volumes, remaining quantity, and pricing — stays in each
retailer's own systems and is never written to the chain, in plain or
hashed form.

## Alternatives considered

1. **Record daily lbs sold on chain (original design).** Rejected. It makes
   confidential business data public (D1), adds a write every day for every
   retailer and batch, and does not strengthen verification of inspection,
   custody, or recall status.

2. **Record a hash of each day's sales report instead of the figures.**
   Rejected. A hash is only useful if someone later checks it against the
   original, and no party in our design needs to verify a retailer's sales.
   The underlying values are also small, predictable numbers (lbs sold per
   day), so the hash can be reversed by trying likely values, which leaks
   the data it was meant to hide. The daily posting pattern still reveals
   sales activity.

3. **Record only remaining quantity per batch.** Rejected. Remaining quantity
   equals lbs received minus lbs sold, so anyone can recover the sales figure
   by subtracting from the public receipt record.

## Consequences

**Positive**
- The design passes D1: no confidential business content is readable on chain.
- Retailers write once per batch (on receipt) rather than daily, which lowers
  transaction cost and the burden of participating.
- Retailers have less reason to refuse participation, which matters because
  the system depends on every party confirming custody.

**Negative**
- Weight tracking ends at the retailer. The chain cannot detect a retailer
  selling more beef under a batch number than it received.
- On a recall, the chain shows which retailers hold the batch but not how much
  has already been sold; that must be established off chain with each retailer.
- Lbs received still reveals each retailer's purchase volume from its
  supplier. We accept this remaining exposure because custody verification
  requires it.

**Follow-up**
- Revisit if batch splitting (target version) needs retail-level quantities
  to trace lots, and prefer a design that keeps quantities off chain.