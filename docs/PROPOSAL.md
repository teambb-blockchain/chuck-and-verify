# Proposal

## Problem

Beef passes through several stages and organizations before it reaches the consumer. During this process, buyers, restaurants, retailers, and other businesses depend on inspection records to confirm that the meat has been properly inspected and is safe for sale. A major concern is that inspection documents can be altered, copied, or falsely created, making it difficult to confirm whether the information is genuine. As a result, businesses or consumers could unknowingly purchase beef with unreliable or missing inspection information. This may lead to health and safety concerns, financial losses, product recalls, and loss of trust in the beef supply chain. The current verification process can also be time-consuming because information may be maintained by different organizations. A dependable method of verifying inspection records and tracking the history of beef products is therefore needed.

## Solution

The Beef Supply Chain Contract records important information about beef batches, including batch registration, USDA inspection, custody handoffs, temperature monitoring, and recalls. Authorized processors, USDA inspectors, logistics partners, and retailers record information as the beef moves through the supply chain.

Important information needed for verification is recorded on-chain, while confidential or detailed information remains off-chain. Inspection reports remain off-chain, with only the report hash stored on-chain so the report can be checked for changes. Confidential business information such as pricing, sales data, employee information, shipping details, and detailed recall documents is also kept off-chain.

Custody handoffs are confirmed when the receiving party scans the batch's QR code. Consumers can use the recorded history to verify the inspection status, custody history, and recall status of a beef batch.

## Scope

### In scope
- Deploy a Beef Supply Chain Contract that records batch registration, USDA inspection, custody handoffs, temperature monitoring, and recalls.
- Allow only USDA to record inspections and recalls, and only the current holder of a batch to transfer it.
- Keep previous records unchanged and prevent batches that fail inspection or are recalled from being transferred.
- Confirm custody handoffs using a simulated QR code scan.
- Monitor beef temperature throughout the supply chain using sensors, storing detailed readings off-chain and key summaries, timestamps, and a record hash on-chain.
- Provide a consumer web page that shows a batch's inspection status, custody history, and recall status.
- Test the contract to make sure unauthorized and invalid actions are rejected.
- Allow batches to be divided into smaller lots while keeping each lot connected to its original batch.
- Automatically apply a recall to all lots created from a recalled batch.
- Use a physical QR scanner at a handoff point to record receipts automatically.
- Allow consumers to scan a package QR code and view its history back to the original batch and inspection.
- Flag suspicious activity such as duplicate scans or scans made after a recall.
- Verify an off-chain inspection report using its on-chain hash.
- Provide participant screens for recording shipments, receipts, and inspections.
- Provide repeatable deployment and demo scripts.

### Out of scope
- Food-safety conditions beyond the planned temperature monitoring, including expiration, cooking conditions, and other product-quality measurements.
- Confidential business information such as pricing, sales, employee, and shipping details.
- Proving that the physical beef product actually matches the QR code attached to it.
- Integration with real USDA systems or verification of participants' real-world identities.
- Payments and production/mainnet deployment.

## Tech stack (proposed)

- Network / RPC: DidLab (`DIDLAB_RPC`)
- Contracts: Beef Supply Chain Contract
- Tests / scripts: TBD
- Frontend: Consumer web page for viewing beef batch history and status

## Milestones

1. Scaffold and environment setup
2. Core contracts and tests
3. Deploy scripts against DidLab
4. Documentation and ADRs

## Risks

| Risk | Mitigation |
|------|------------|
| TBD | TBD |

## Success criteria
- The deployed contract records beef batch registration, USDA inspection, custody handoffs, and recalls.
- Only authorized participants can perform restricted actions.
- Failed or recalled batches cannot be transferred further.
- Custody handoffs can be confirmed through the simulated QR scan.
- Temperature monitoring records are linked to the appropriate beef batch, with detailed readings kept off-chain and key verification information recorded on-chain.
- Consumers can view a batch's inspection status, custody history, and recall status.
- Tests confirm that unauthorized and invalid actions are rejected.
