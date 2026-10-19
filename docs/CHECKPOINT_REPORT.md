# Chuck and Verify — Checkpoint Report

Cumulative report, maintained across the semester. Sections appear as they become relevant and are then maintained for the rest of the semester. A PDF snapshot of this file is submitted at each checkpoint.

| Checkpoint | Deadline | Question |
| :--- | :--- | :--- |
| 1 — Foundation | Sunday, October 4, 2026 | Is this project real, and can this team ship? |
| **2 — On Chain** | Sunday, October 18, 2026 | Does it actually touch the blockchain? |
| 3 — Functional | Sunday, November 8, 2026 | Can someone who is not on your team actually use it? |
| 4 — Release Candidate | Sunday, November 29, 2026 | Is it finished? |

---

## 1. Project identity — name, team, roles, domain, repository

|                  |                                                                                                                                                                                    |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project Name** | Chuck and Verify                                                                                                                                                                   |
| **Project Team** | Team BB                                                                                                                                                                            |
| **Team Members** | Britt Huffman ([@brittshanklin](https://github.com/brittshanklin)) Bhavana Sriharika Kondapalli ([@bhavana-sriharika-kondapalli](https://github.com/bhavana-sriharika-kondapalli)) |
| **Domain**       | <https://teambb.didlab.org/frontend/index.html>                                                                                                                                    |
| **Repository**   | <https://github.com/teambb-blockchain/chuck-and-verify>                                                                                                                            |

## 2. Problem, stakeholders, and trust boundaries

### Problem

Beef passes through several stages and organizations before it reaches the consumer. During this process, distributors, retailers, restaurants, and consumers depend on inspection records to confirm that the meat has been properly inspected and is safe for consumption. A major concern is that inspection records can be altered, forged, or falsely claimed, making it difficult to confirm whether the information is genuine. In September 2026, FSIS issued a Class I recall due to the false mark of USDA inspection on over 167,000 pounds of meat products (U.S. Department of Agriculture, Food Safety and Inspection Service, 2026). Because of this false mark, retailers and restaurants unknowingly purchased meat with unreliable inspection information to sell to consumers. Another important component of beef safety is temperature during storage and transport. The FSIS issues standards for the safe temperature for beef storage and transport, but adherence to these standards is not independently verifiable by other custodians outside of the time of handoff. When a custodian has possession of the beef, they are both liable and self-reporting on the supply chain status and safety, giving them incentive for falsifying the claims they create and control without options for other parties to verify these claims. These factors can lead to health and safety concerns, financial losses, disruption from product recalls, and overall loss of trust in the beef supply chain by consumers. A method that is tamper-evident and independently verifiable for inspections, custody, and temperature is needed.

> U.S. Department of Agriculture, Food Safety and Inspection Service. (2026, September 22). *Star Meat Delivery Inc. recalls raw pork, beef, and goat products produced without the benefit of inspection*. <https://www.fsis.usda.gov/recalls-alerts/star-meat-delivery-inc--recalls-raw-pork-beef-and-goat-products-produced-without>

### Stakeholders

| Element                  | Prompt                                                                                                 | Our Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :----------------------- | :----------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stakeholders**         | Who acts? Name every distinct party — "the hospital" and "the insurer" and "the patient", not "users". | USDA Food Safety and Inspection Service, USDOT Federal Motor Carrier Safety Administration, US FDA, State/Local Health Departments, Beef Processor, Storage Facilities, Distributors, Carriers, Retailers, Restaurants, Consumer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Assets**               | What is owned, transferred, claimed, or attested?                                                      | **Owned:** The beef batch is owned by the purchaser, and ownership changes with each sale. The temperature report during custody is owned by the custodian. **Transferred:** The beef batch is transferred from sending to receiving custodians. **Claimed:** The beef is claimed to be inspected and safe for consumption. The temperature during custody is claimed to be safe to the other parties by the custodian. **Attested:** The processor is attested by the USDA FSIS by inspection. The carrier's vehicle and driver safety are attested by the USDOT FMCSA. The restaurant is attested by a health inspection report by the State/Local Health Inspectors.                                                                                                                                                                                                                                                                                                   |
| **Transactions**         | What are the state-changing actions? Who initiates each?                                               | *USDA FSIS* — grant of inspection + revocation of inspection + classification of recalls + recall notifications *USDOT FMCSA* — USDOT numbers + operating authority *US FDA* — audit reports *State/Local Health Departments* — health inspections *Beef Processors* — beef batch registration + mark of inspection + recalls *Storage Facilities* — beef storage + shipping + receipt of shipment *Distributors* — receipt of shipment + splitting batch into smaller lots + distribution *Carriers* — transport of beef to recipient *Retailers* — selling of beef lots + receipt of shipment *Restaurants* — receipt of shipment + preparing for consumption                                                                                                                                                                                                                                                                                                           |
| **Records**              | What is written down today, by whom, and where does it live?                                           | *USDA FSIS* — grant of inspection records + revocations + pass/fail + recall classifications + notifications (federal government database) *USDOT FMCSA* — USDOT numbers + licenses to operate (federal government database) *US FDA* — audit records + pass/fail (federal government database) *State/Local Health Inspectors* — inspection records + pass/fail (state/local government database, health notices) *Beef Processors* — production and batch records (business database, paper records) *Storage Facilities* — inventory, temperature, orders and deliveries (business database, paper records) *Distributors* — orders, shipping and receiving status, temperature (business database, paper records) *Carriers* — travel logs, arrival times, temperature (business database, paper records) *Retailers* — sales (business database, paper records) *Restaurants* — inventory, menu (business database, paper records) *Consumer* — receipts of purchase |
| **Current Intermediary** | Who sits in the middle today? A company, a registry, a regulator, a spreadsheet someone emails.        | USDA FSIS is the intermediary for beef inspection but currently not intermediary across the supply chain for custody and temperature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **What goes wrong**      | The concrete failure. Fraud, delay, cost, dispute, loss, capture.                                      | **Fraud:** altered, forged or falsely claimed inspection records; falsified temperature readings **Delay:** access to beef due to recall disruptions **Cost:** financial losses due to misattributed liability or overly broad recalls **Dispute:** liability for beef product loss during recall **Loss:** health and wellbeing of consumers who ingest bad beef; trust in the beef supply chain by consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Trust boundaries

![Trust boundaries in today's beef supply chain](architecture/trust-boundaries.png)

## 3. Suitability verdict and justification

**Verdict: PROCEED WITH REDESIGN**

A centralized database managed by the USDA is not suitable because it creates a single point of failure both by USDA employees non-maliciously modifying or entering incorrectly or by those who maliciously access the system. It also requires multiple parties across the supply chain to trust the USDA as the authoritative party, in addition to the other parties who provide records. A blockchain solution record cannot be altered once written, either by the USDA or other parties. The transparent lineage the blockchain solution offers also acts as both attribution and deterrence for fraud. Whether to avoid liability, meet quotas, make sales, or avoid reputational damage, the party with the biggest incentive for fraud is the self-reporting party. The operational chain captures the lineage which makes repeated offenses easier to investigate due to the same party showing repeatedly in recalls. The blockchain does not fix the incentive for inaccurate reporting or fraud but adds the administrative chain verifying parties which adds certification to their reporting in the supply chain and a mechanism for their removal for fraud, and the operational chain adds transparency of the certification, lineage, and temperatures. Both in conjunction aims to decrease the ease of malicious fraud and increase the visibility when it occurs repeatedly.

The suitability analysis completed led to three changes to our original design:

- Retail sales data was removed from the chain, so confidential business data is never public (M1-D1). See [decision record 0001](decisions/0001-keep-retail-sales-off-chain.md).
- Inspection and temperature reports stay off chain and are represented on chain only by their hash (M1-Q5).
- A custody handoff is recorded only when the receiving party scans the batch's QR code, instead of the sender reporting it alone (M1-D4).

A third party with no access to any participant's private systems can verify that a beef batch passed USDA inspection, which parties held it and in what quantities, whether safe temperatures have been maintained to FSIS standards during storage and transport, whether temperature readings are consistent across comparisons between the dock and carriers, and whether it has been recalled. This is done by confirming each entry was submitted by an address certified from the administrative chain that is not expired or revoked, by reading temperature and lineage records against the event history and checking inspection and temperature reports against the on-chain hashes on the public chain.

## 4. Architecture — diagram and component description

![Chuck and Verify architecture: administrative chain, operational chain, devices, on-chain contracts, and off-chain storage](architecture/architecture.png)

### Administrative Chain

- **Responsibility:** Certifies who or what can write on the operational chain.
- **Inputs and outputs:** Inputs are requests for credentials, while outputs are issuance, expiry, and revocation of credentials.
- **On-chain or off-chain:** Credential Registry Contract is on-chain, but issuing bodies are off-chain.
- **Who controls it:** USDA FSIS, USDOT FMCSA, State/Local Health Departments and Accredited Calibration Lab (for our simulation we will be acting as the administrative chain and hold the keys to write to the registry).
- **What it guarantees, and what it doesn't:** It guarantees only those with permission at the moment of the write can write on the operational chain, but does not guarantee that the holder has written accurately. It also does not guarantee the issuer is not compromised or hasn't made a mistake, nor that temperature sensors were located as reported.
- **Trust boundary:** This addresses the trust boundary between regulators and credentialing bodies and the supply chain operators.

### Operational Chain

- **Responsibility:** Records what happened to each beef batch from processing to final receipt: batch registration, inspection, custody handoffs, lot splits, temperature summaries, and recalls.
- **Inputs and outputs:** Inputs are writes from credentialed parties: the processor (batch registration, recall initiation), the FSIS inspector (inspection result and report hash, recall classification), each receiving custodian (receipt confirmation and dock reading), the distributor (lot splits by weight), and cold storage and carriers (relayed signed temperature summaries). The output is a timestamped, attributable lineage for each batch that anyone can read.
- **On-chain or off-chain:** The records are on-chain; the parties and their business records are off-chain.
- **Who controls it:** Each credentialed party controls only its own writes and cannot alter another party's records. The consumer reads but cannot write.
- **What it guarantees, and what it doesn't:** It guarantees that each record was written by a party credentialed at the time, cannot be altered afterward, and that custody changes are confirmed by the receiver rather than reported by the sender alone. It does not guarantee the records are accurate. The chain establishes accountability, not accuracy.
- **Trust boundary:** The handoffs between custodians, where custody and temperature claims pass from one party to the next.

### Devices

- **Responsibility:** Capture physical facts such as temperature during storage and transport, and custody confirmation at each handoff.
- **Inputs and outputs:** Inputs are temperature readings from the temperature sensors, QR codes for the QR scanner. Outputs are signed temperature readings, summarized per leg as min/max, time out of range, and a log hash and dock reading for the temperature scanner and receipt confirmation for the QR scanner.
- **On-chain or off-chain:** The devices are off-chain but their outputs are written on-chain by the custodian or receiver.
- **Who controls it:** Custodians operate the devices. Sensor keys are registered by the accredited calibration lab, so a custodian can relay readings but cannot alter them without breaking the signature.
- **What it guarantees, and what it doesn't:** It guarantees that a reading came from a registered sensor and was not changed after signing, and that the receiver, not the sender, confirmed custody. However, it does not guarantee the sensor was physically with the beef, that the custodian relayed every reading rather than withholding readings, or that the QR scanner was used correctly.
- **Trust boundary:** Where physical conditions become digital records controlled by the custodian.

## 5. On-chain / off-chain data decisions

| Element | On chain | Off chain | Justification |
| :--- | :--- | :--- | :--- |
| Production and batch records (processors) | Stakeholder, Batch #, lbs, processing date, date left facility | Business operations details — employee IDs, processes used, pricing | Recording the batch information on-chain creates the starting point for tracking the beef throughout the supply chain. The batch number identifies the product, while the weight helps track the quantity as the batch moves between parties or is divided into smaller lots. The processing and departure dates provide timestamped information for the batch's history. Employee IDs, processing methods, and pricing remain off-chain because they are internal business information and are not necessary to verify the batch's lineage. |
| Inspection records (USDA) | Certification of inspection, grade, date of inspection, hash of the inspection report | Full inspection report, detailed inspection information, certifier details | Recording the inspection result, grade, and date on-chain gives supply-chain participants a reliable way to check the batch's recorded inspection history. These fields show whether an inspection was completed, the quality grade assigned to the batch, and when the inspection took place. The complete inspection report and supporting details remain off-chain because they are not necessary for tracing the batch and would add unnecessary data to the blockchain. Instead, a hash of the report is stored on-chain, allowing the original document to be checked later to determine whether it has been changed. |
| Supply chain records / transport records (logistic partners) | Activity records — stakeholder, date received, date delivered to next partner, lbs | Truck numbers, employee IDs, detailed shipment information, internal logistics records | The transport records provide a timestamped history of the beef batch as it moves through the supply chain. Recording the stakeholder, transfer dates, and weight helps trace when the batch changes custody and how much beef is transferred or separated into smaller lots at each stage. This creates a clear record of the batch's movement and quantity throughout its journey. Detailed information such as truck numbers, employee IDs, and shipment records remains off-chain because it is supporting operational information and is not necessary for verifying the batch's transportation and custody history. |
| Custody scans (receiving party) | Batch #, scanning party, time of scan | Scan images, device logs, station details | The custody scan records that the receiving party confirmed possession of the batch at a specific time. The receiver scans the batch's QR code to confirm the handoff, preventing the sender from recording a completed delivery without confirmation from the other party. This creates a traceable custody transition as the beef moves through the supply chain. Scan images, device logs, and station details remain off-chain because they are operational information and are not necessary for verifying the recorded handoff. |
| Temperature monitoring (sensors) | Batch #, temperature summary, minimum/maximum temperature, time out of range, timestamp, hash of temperature log | Complete sensor readings, detailed temperature logs, device records | Temperature sensors continuously monitor the beef as it moves through processing, storage, transportation, and later stages of the supply chain. Real-time readings help identify when a batch moves outside the required temperature range and allow that condition to be associated with the batch and time it occurred. Because continuous sensor monitoring can produce a large amount of data, the complete temperature readings remain off-chain. Important temperature summaries, exceptions, timestamps, and a hash of the detailed temperature record are stored on-chain. This provides a traceable record of the batch's handling conditions while allowing the detailed sensor data to be verified later to determine whether the sensor records have been modified. |
| Retail records (retailers) | Activity records — stakeholder, date received, lbs received | Individual sales, daily sales volumes, pricing/dates, business operation details — employee IDs, registers, pricing | Recording the retailer, date received, and quantity on-chain continues the traceable history of the beef batch when it reaches the retail stage. These records show when the retailer received the batch and how much was transferred into its custody. Individual purchases, sales volumes, pricing, employee information, and register data remain off-chain because they contain internal business information and are not necessary for verifying the batch's inspection, custody, or supply-chain history. |
| Recall records (USDA) | Recall #, classification, recall date, hash of the recall notice | Recall reason, source of recall, documents created or referenced in the issue of the recall | Recording the recall number, classification, and date on-chain creates a permanent update to the batch's status when a recall occurs. This allows participants and consumers to identify that the affected batch has been recalled and understand the recorded severity of the recall. Detailed reasons and supporting documents remain off-chain because they contain additional information that does not need to be stored directly on the blockchain. A hash of the recall notice is recorded on-chain so the original notice can later be checked to determine whether it has been modified. |

## 6. Deployment record — contract addresses, deployment transactions, chain 252501

Both contracts are live on DIDLab chain **252501**. Deploy script: `scripts/deploy.js` (refuses any chain other than 252501). Commit: [`83d7418`](https://github.com/teambb-blockchain/chuck-and-verify/commit/83d7418). Live page: <https://teambb.didlab.org/frontend/index.html> (Deployed contracts section).

| Contract | Address | Deployment transaction |
| :--- | :--- | :--- |
| **BeefSupplyChain** | [`0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e`](https://explorer.didlab.org/address/0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e) | [`0xe7c3f5bd803f2a26cae4293658c17a9eef8d58966084901f9291036756072d89`](https://explorer.didlab.org/tx/0xe7c3f5bd803f2a26cae4293658c17a9eef8d58966084901f9291036756072d89) |
| **CredentialRegistry** | [`0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E`](https://explorer.didlab.org/address/0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E) | [`0x0666fbae85959f573ce04400a072ffce7506f05db951a09b22a63dcc959056da`](https://explorer.didlab.org/tx/0x0666fbae85959f573ce04400a072ffce7506f05db951a09b22a63dcc959056da) |

Deployer (creator) address: `0xb323821F0dFCf3b2E8727A7FBae2E34F0D4f393F`. 

**Sample Batch Registration and Verification**
We used `scripts/registerBatch.js` to register the sample batch `BEEF-001` on DIDLab chain 252501. The transaction was recorded in block 6223773.
Transaction hash: [`0x8f33623a90575c56720bf36ad627ed668784ac5113ea82a7eeee3f6b935dc712`](https://explorer.didlab.org/tx/0x8f33623a90575c56720bf36ad627ed668784ac5113ea82a7eeee3f6b935dc712)

We also checked the registered batch through the live website and confirmed that its information could be retrieved from the blockchain.

## 7. Features completed, with evidence

| Feature | What it does | Evidence |
| :--- | :--- | :--- |
| CredentialRegistry (simulated administrative chain) | Admin assigns one issuer per credential type (PROCESSOR, INSPECTOR, CUSTODIAN). That issuer alone may grant or revoke credentials of that type. `isValid` returns false when a credential is missing, revoked, or past `expiresAt`. | Contract: `contracts/CredentialRegistry.sol`, `contracts/ICredentialRegistry.sol`. Tests: `test/CredentialRegistry.test.js` — issuer-per-type isolation, revoke, and expiry. Commit: [`00680e9`](https://github.com/teambb-blockchain/chuck-and-verify/commit/00680e9) |
| BeefSupplyChain write path | Credential-gated writes for the operational chain: `registerBatch` (processor), `recordInspection` (inspector; stores report hash + pass/fail), `recordShipment` / `confirmReceipt` (custodian; custody completes only when the pending receiver confirms), `recordRecall` (inspector; stores notice hash + classification). Unauthorized callers revert with `Unauthorized`. | Contract: `contracts/BeefSupplyChain.sol`. Tests: `test/BeefSupplyChain.test.js` — authorized and unauthorized cases for each write, plus an end-to-end register → inspect → ship → confirm → recall path and custom-error failure paths. Commits: [`00680e9`](https://github.com/teambb-blockchain/chuck-and-verify/commit/00680e9), [`845007e`](https://github.com/teambb-blockchain/chuck-and-verify/commit/845007e) |
| Receiver-confirmed custody handoff | A shipment sets `pendingReceiver`; `currentHolder` updates only when that receiver calls `confirmReceipt`. Sender-only delivery claims are rejected (`NotCurrentHolder`, `NotPendingReceiver`, `NoPendingShipment`). | Same contract and tests as above (`recordShipment` / `confirmReceipt` describe blocks). |
| Deployed on DIDLab (chain 252501) | Both contracts are live on the course chain and referenced by the public page. | Live page: <https://teambb.didlab.org/frontend/index.html> (Deployed contracts section). Addresses and deployment TXs in §6. Deploy script: `scripts/deploy.js`. Commit: [`83d7418`](https://github.com/teambb-blockchain/chuck-and-verify/commit/83d7418) |
| Demo credential setup and sample batch | Scripts grant demo credentials and register batch `BEEF-001` against the deployed addresses so the verify UI has an on-chain record to read. | `scripts/setupCredentials.js`, `scripts/registerBatch.js` (hard-coded deployed addresses matching the frontend). Commit: [`83d7418`](https://github.com/teambb-blockchain/chuck-and-verify/commit/83d7418) |
| Live beef batch verification (read path) | Anyone can look up a batch on DIDLab via the project page: wallet/network status for chain 252501, optional Switch to DIDLab, and `getBatch` over the DIDLab RPC showing processor, weight, current holder, inspection flags, and recall status. | Live: <https://teambb.didlab.org/> — section Live Beef Batch Verification; default batch id `BEEF-001`. Source: `frontend/index.html`. Commits: [`83d7418`](https://github.com/teambb-blockchain/chuck-and-verify/commit/83d7418), [`de66ed3`](https://github.com/teambb-blockchain/chuck-and-verify/commit/de66ed3) |

## 8. Testing evidence

| Suite | What it covers | Result |
| :--- | :--- | :--- |
| `test/CredentialRegistry.test.js` | Admin/`setIssuer`, issuer-per-type grant/revoke isolation, expiry and revocation making `isValid` false, zero-address and unauthorized issuer rejections | Passing under `npm test` |
| `test/BeefSupplyChain.test.js` | Authorized and unauthorized writes for register, inspect, ship, confirm, recall; end-to-end path; custom-error failure paths (`EmptyBatchId`, `BatchAlreadyExists`, `BatchNotFound`, `ZeroAddress`, `NotCurrentHolder`, `NoPendingShipment`, `NotPendingReceiver`) | Passing under `npm test` |

`npm test` currently reports **32 passing** (CredentialRegistry + BeefSupplyChain) after the course scaffold contracts and `ProjectAnchor` tests were removed [`008233c`]. Earlier in the checkpoint the same suites passed at 21, then 28, then 36 (including scaffold) as contracts and failure-path tests landed.

On-chain smoke check: sample batch `BEEF-001` is readable via Live Beef Batch Verification on <https://teambb.didlab.org/> against chain 252501 and the §6 addresses.

We ran npm test after updating the repository and confirmed that all 32 tests passed without errors.

## 9. Security and privacy review

_Due at Checkpoint 3._

## 10. Performance measurements

_Due at Checkpoint 3._

## 11. AI development record

See also [AI_RECORD.md](../AI_RECORD.md) for the running log.

| Field                  | Entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools used (or "none") | Cursor, Claude, ChatGPT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| What you asked for     | **Cursor agent:** implement the CP1 plan's contract deliverables: the supply-chain contract with a minimal credential registry (item 3), then issuer-per-type grant and revoke (item 2); add failure-path tests for every custom error in BeefSupplyChain; add the deployed-contract addresses and a live network status line to the site. **Claude:** audit the repository against our CP1 commitments; order the CP2 rubric by implementation cost and build a day-by-day schedule; critique the CP1 plans for decision records 0002–0004; give a staged test plan, as pseudocode, for the ESP32 signing feasibility test; draft decision records 0002–0004, the CP3 plan (§14), and this change log (§15) from our decisions. **ChatGPT:** We asked for clarification on DIDLab deployment steps, MetaMask configuration, blockchain connectivity, and GitHub commands when needed. |
| What it produced       | **Cursor agent:** drafts of the code: ICredentialRegistry, CredentialRegistry, and BeefSupplyChain with their Hardhat tests; eight failure-path tests; the site's Deployed contracts section and network status logic. **Claude:** a status table comparing the repo to CP1 §14; a prioritized schedule; review questions on each decision record; the four-stage signing test outline; drafts of 0002–0004, §14, §15, and this section. Claude wrote these from our answers to its questions and from summaries of our earlier conversations, and left placeholders wherever it lacked facts. **ChatGPT:** Explanations, example commands, and suggestions for resolving technical issues                                                                                                                                                                                             |
| How you verified it    | We ran `npm test` after each contract and test change (21, then 28, then 36 passing, before the scaffold ProjectAnchor tests were removed). We read the site locally at desktop width and checked each network state. We checked every factual claim in Claude's drafts against the code and git history; that check confirmed the deployed contract has no temperature write and that the DIDLab setup uses one wallet for every role. We filled in the facts Claude left as placeholders (hardware status, cut dates, the reasons for the deferral and the item 3 reassignment) and checked every cited commit hash against `git log`. Scope, ownership, and cut dates were decided by the team. **ChatGPT:** We reviewed the suggestions against our project code, ran commands in VS Code, checked blockchain transactions, and tested the live application ourselves.             |
| What it got wrong      | **Cursor agent:** the first registry gave a single admin the power to grant every credential type, which did not meet CP1 item 2 until we asked for issuer-per-type; the site's no-wallet message used different wording from what we specified. **Claude:** its first draft of 0004 claimed the hardware "proved more involved than we planned," although no stage of the signing test had run; we replaced it with the actual reason (prioritization). Its §15 draft added a rationale for the item 3 reassignment beyond the one we gave, and assumed 0004 was merged before we had confirmed it. **ChatGPT:** Some suggestions did not match our existing setup. We identified the differences, reviewed the repository, and made the necessary corrections.                                                                                                                       |

## 12. Individual contributions

| Member Name | Number of commits | What they contributed |
| :--- | :--- | :--- |
| Britt Huffman | 5 | Both contracts and their tests, CredentialRegistry, ICredentialRegistry and BeefSupplyChain [`00680e9`]. Eight failure-path tests [`845007e`]. The site’s deployed-contracts section and live network status [`de66ed3`]. Decision records 0002–0004 [`8cca1b1`]. Removal of the scaffold contracts and their test [`008233c`]. |
| Bhavana Sriharika Kondapalli | 2 | The deploy, credential-setup and batch-registration scripts, plus live batch verification on the site [`83d7418`]. A page-title encoding fix [`cd17603`]. |

Commit counts are Checkpoint 2 commits on `main` as of the graded commit (since Checkpoint 1).

## 13. Risks, blockers, and what went wrong

### Risks

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| Hardware lead time and cost | Late integration | Hardware was acquired early; begin incorporating in first week of CP3 |
| QR scanner reliability | Handoffs fail during the demo | QR scanners tested, using cell phone cameras remain as backup |
| DIDLab platform constraints | Deployment surprises | Deployment with cushion from deadlines, run all tests on the local Hardhat network; document platform constraints in the README. |

### Blockers

- Decisions on architecture for temperature sensors and device authority to write on-chain.

### What went wrong

- Was unable to complete the signing feasibility test; this becomes a priority for the first week of the next checkpoint.

## 14. Plan for the next checkpoint

| # | Deliverable | Owner | Done when |
| :--- | :--- | :--- | :--- |
| 1 | Sensor credential type in CredentialRegistry, with its own issuer standing in for the calibration lab (0003 follow-up) | Britt Huffman | Tests pass for grant, revoke, and expiry of a sensor credential; a wrong-type issuer cannot grant it |
| 2 | Software signing path: a Python script signs a reading in the fixed byte layout, and a contract view function recovers the signer (0004, stages 1–3) | Britt Huffman | The recovered address matches the registered sensor key, and a tampered message, a wrong key, and an unregistered key each fail to verify; byte layout committed in one shared file. If not met, hardware is cut (0004) |
| 3 | ESP32 signing path: the device signs the same reading layout (0004, stage 4) | Britt Huffman | Row 2's checks pass with a device-produced signature. If not met, the software signer becomes the stand-in sensor and 0004 is superseded |
| 4 | Per-leg temperature summary write in BeefSupplyChain: min/max, time out of range, timestamp, log hash, with a sensor signature checked on chain (0002) | Bhavana Sriharika Kondapalli | Tests pass for an authorized write, an unauthorized caller, an invalid signature, and a replayed reading |
| 5 | Redeploy to DIDLab and rerun setup with separate wallets for admin, each issuer, and each holder (0003 follow-up) | Bhavana Sriharika Kondapalli | §6 lists one transaction hash per step (register, inspect, ship, confirm, temperature, recall), each sent from the address that holds that role |
| 6 | Site shows a batch's full history: inspection, custody chain, temperature summaries, and recall status | Bhavana Sriharika Kondapalli | Entering a batch ID on teambb.didlab.org/frontend renders every record from row 5 read from chain 252501 |
| 7 | Update PROPOSAL.md, README, and the A2 stakeholder table to the current scope (carried from CP2) | Bhavana Sriharika Kondapalli | PROPOSAL.md scope and stretch goals match 0002–0004; README lists the deployed addresses and the commands to run the tests and the deploy |
| 8 | Security and privacy review (§9) | Britt Huffman | §9 names each known limitation and where it is handled or accepted: single admin key, custodian-held signing key, replay, one-wallet CP2 deployment |
| 9 | Performance measurements (§10) | Britt Huffman | §10 reports gas used for each write type, taken from the row 5 DIDLab receipts |

## 15. Change log — what changed since the previous checkpoint and why

### Design and scope changes

- The administrative chain has two levels (0003). The admin assigns one issuer per credential type, and only that issuer can grant or revoke credentials of that type. Checkpoint 1 described the team as the administrative chain without specifying this structure.
- Temperature stays in scope but is not on chain yet (0002). The deployed `BeefSupplyChain` has no temperature write. Any temperature claim at this checkpoint is a design commitment, not a working feature. The write is planned for CP3.
- Real sensors and the physical QR scanner are deferred (0004). Custody is confirmed by the receiver calling `confirmReceipt` from its own credentialed address, which stands in for the scan.
- Custody handoff became two-step. The holder records a shipment to a named receiver, and the handoff completes only when that receiver confirms. Checkpoint 1 stated the property (receiver confirmation); this is how the contract enforces it.
- The DIDLab deployment uses one wallet for every role. `setupCredentials.js` makes the same address the admin, the processor issuer, and the processor holder. Role separation is therefore shown in the Hardhat tests, not on chain. CP3 fixes this (§14, row 5).

### Other changes

- Removed the course scaffold contracts `ProjectAnchor.sol` and `SimpleStorage.sol`, with the `ProjectAnchor` test file [`008233c`, Britt Huffman]. Neither was part of the §4 architecture, so `contracts/` now holds only the registry, its interface, and the supply-chain contract.
- The site now shows the deployed contracts and live network status [`de66ed3`, Britt Huffman], and the page title encoding is fixed [`cd17603`, Bhavana Sriharika Kondapalli].
- `AI_RECORD.md` was updated with each contract, test, and frontend commit [`00680e9`, `845007e`, `de66ed3`].
- §14 now holds the Checkpoint 3 plan, with due dates and the 0004 cut dates as milestones.
