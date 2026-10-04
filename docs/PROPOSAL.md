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

## On-chain / Off-chain Data Decisions

| Element | On chain | Off chain | Justification |
| --- | --- | --- | --- |
| Production and batch records (processors) | Stakeholder, Batch #, lbs, processing date, date left facility | Business operations details - employee IDs, processes used, pricing | Recording the batch information on-chain creates the starting point for tracking the beef throughout the supply chain. The batch number identifies the product, while the weight helps track the quantity as the batch moves between parties or is divided into smaller lots. The processing and departure dates provide timestamped information for the batch's history. Employee IDs, processing methods, and pricing remain off-chain because they are internal business information and are not necessary to verify the batch's lineage. |
| Inspection records (USDA) | Certification of inspection, grade, date of inspection, hash of the inspection report | Full inspection report, detailed inspection information, certifier details | Recording the inspection result, grade, and date on-chain gives supply-chain participants a reliable way to check the batch's recorded inspection history. These fields show whether an inspection was completed, the quality grade assigned to the batch, and when the inspection took place. The complete inspection report and supporting details remain off-chain because they are not necessary for tracing the batch and would add unnecessary data to the blockchain. Instead, a hash of the report is stored on-chain, allowing the original document to be checked later to determine whether it has been changed. |
| Supply chain records/transport records (logistic partners) | Activity records - stakeholder, date received, date delivered to next partner, lbs | Truck numbers, employee IDs, detailed shipment information, internal logistics records | The transport records provide a timestamped history of the beef batch as it moves through the supply chain. Recording the stakeholder, transfer dates, and weight helps trace when the batch changes custody and how much beef is transferred or separated into smaller lots at each stage. This creates a clear record of the batch's movement and quantity throughout its journey. Detailed information such as truck numbers, employee IDs, and shipment records remains off-chain because it is supporting operational information and is not necessary for verifying the batch's transportation and custody history. |
| Custody scans (receiving party) | Batch #, scanning party, time of scan | Scan images, device logs, station details | The custody scan records that the receiving party confirmed possession of the batch at a specific time. The receiver scans the batch's QR code to confirm the handoff, preventing the sender from recording a completed delivery without confirmation from the other party. This creates a traceable custody transition as the beef moves through the supply chain. Scan images, device logs, and station details remain off-chain because they are operational information and are not necessary for verifying the recorded handoff. |
| Temperature monitoring (sensors) | Batch #, temperature summary, minimum/maximum temperature, time out of range, timestamp, hash of temperature log | Complete sensor readings, detailed temperature logs, device records | Temperature sensors continuously monitor the beef as it moves through processing, storage, transportation, and later stages of the supply chain. Real-time readings help identify when a batch moves outside the required temperature range and allow that condition to be associated with the batch and time it occurred. Because continuous sensor monitoring can produce a large amount of data, the complete temperature readings remain off-chain. Important temperature summaries, exceptions, timestamps, and a hash of the detailed temperature record are stored on-chain. This provides a traceable record of the batch's handling conditions while allowing the detailed sensor data to be verified later to determine whether the sensor records have been modified. |
| Retail records (retailers) | Activity records - stakeholder, date received, lbs received | Individual sales, daily sales volumes, pricing/dates, business operation details - employee IDs, registers, pricing | Recording the retailer, date received, and quantity on-chain continues the traceable history of the beef batch when it reaches the retail stage. These records show when the retailer received the batch and how much was transferred into its custody. Individual purchases, sales volumes, pricing, employee information, and register data remain off-chain because they contain internal business information and are not necessary for verifying the batch's inspection, custody, or supply-chain history. |
| Recall records (USDA) | Recall #, classification, recall date, hash of the recall notice | Recall reason, source of recall, documents created or referenced in the issue of the recall | Recording the recall number, classification, and date on-chain creates a permanent update to the batch's status when a recall occurs. This allows participants and consumers to identify that the affected batch has been recalled and understand the recorded severity of the recall. Detailed reasons and supporting documents remain off-chain because they contain additional information that does not need to be stored directly on the blockchain. A hash of the recall notice is recorded on-chain so the original notice can later be checked to determine whether it has been modified. |


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
