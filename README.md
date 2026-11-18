# Chuck and Verify

Team BB's blockchain project for tracking beef batches through the supply chain. Live at [teambb.didlab.org](https://teambb.didlab.org) on DIDLab (chain 252501).

## Overview

The `BeefSupplyChain` contract records batch registration, USDA inspection, custody handoffs, lot splits, and recalls. A custodian can split a batch it holds into 2–20 lots (`BEEF-01-L1`, `BEEF-01-L2`, …) that ship to new custodians independently. Whoever holds a lot can split it again into smaller lots (`BEEF-01-L2-L1`, …), so product can be divided at each custodian down the chain, such as a distributor and then a grocery store. Each lot carries the inspection of the original batch and the most serious recall of any batch or lot it came from. Processors, USDA inspectors, logistics partners, and retailers write to it, each with a credential from `CredentialRegistry`. Consumers can read a batch's inspection status, custody history, and recall status.

**v5 (in this repo, not deployed yet)** adds a use-by date and a final status. `registerBatch(batchId, weightLbs, useBy)` sets a use-by date (unix seconds, after now and within two years) and emits `UseBySet`. The two-argument `registerBatch` still works and sets none. Lots keep their parent's date. The holder of a batch or lot that hasn't been split can call `recordDisposition(batchId, kind)`, where kind is 1 sold to shoppers, 2 served or eaten, or 3 disposed of. That emits `DispositionRecorded` and ends custody: the batch can't be shipped or split after that, but it can still be recalled. No sale details are recorded ([ADR 0001](./docs/decisions/0001-keep-retail-sales-off-chain.md)). `getStatus(batchId)` returns both. `getBatch` is unchanged, so existing readers keep working. The batch page shows the use-by date, warns once it has passed (unless the batch already has a final status), and ends the timeline at the final status. In the portal, Register asks for a use-by date, and Move a batch has a "Close it out" step. Carriers don't get it, since they always hand a load on. The React dashboard in `frontend/dashboard/` was not updated for v5.

Confidential business information stays off chain: pricing, sales data, employee information, shipping details, and complete inspection documents. A batch's lot form (a PDF) is encrypted in the browser and published to IPFS when the batch is registered. Only the batch facts go on chain.

## Repository layout

| Path | Purpose |
|------|---------|
| `contracts/` | `BeefSupplyChain` and `CredentialRegistry` (Solidity) |
| `test/` | Hardhat contract tests |
| `scripts/` | Deploy, credential setup, sample batch, and portal seed scripts |
| `frontend/public/` | Page modules and styles (`app.js`, generated `abi.js`, portal session and admin) |
| `index.js` | Node server: static page, wallet sign-in, portal roles, IPFS upload proxy |
| `server/` | Sign-in (`auth.js`), role storage (`db.js`), signature recovery (`ethsig.js`) |
| `index.html` | The page nginx and Node serve at `/`. Its scripts and styles load from `frontend/public/` |
| `docs/` | Proposal, team charter, checkpoint report |
| `docs/architecture/` | Architecture and trust-boundary diagrams |
| `docs/decisions/` | Architecture Decision Records, one file per decision |
| `docs/examples/forms/` | Sample PDFs for testing form upload (not served by the app) |

## Setup

1. Install dependencies: `npm install`
2. Compile: `npm run compile`
3. Test: `npm test`

Compiling and testing need no `.env`. To deploy, copy `.env.example` to `.env` and fill in `DEPLOYER_KEY` (see [Environment](#environment)).

## Run locally

```bash
npm start
```

Open `http://localhost:3000`. The server serves `frontend/public/` and the `/api/` routes, and keeps portal roles in a SQLite database at `./data/portal.db` (the npm `sqlite3` package, so run `npm install` first).

## Deploy contracts to DIDLab

Current deployment on chain 252501:

| Contract | Address |
|----------|---------|
| `BeefSupplyChain` v4 (repeated lot splitting) | [`0x7b9D401F1D62193b59e7b3d1C6dC6A5b7c7A4a49`](https://explorer.didlab.org/address/0x7b9D401F1D62193b59e7b3d1C6dC6A5b7c7A4a49), deployed in block 7649714 |
| `CredentialRegistry` | [`0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E`](https://explorer.didlab.org/address/0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E) |

Earlier deployments are listed in [docs/CHECKPOINT_REPORT.md](docs/CHECKPOINT_REPORT.md) §6.

Deploying costs TRUST for gas on chain 252501. Use a disposable DIDLab lab wallet. `DEPLOYER_KEY` is a private key (64 hex characters after `0x`), not a wallet address, and it lives only in your local `.env`.

```bash
npm run compile

# 1) Deploy CredentialRegistry, then BeefSupplyChain pointing at it.
#    The script refuses any chain other than 252501 and checks admin()
#    and registry() after each deployment.
npm run deploy:didlab

# 2) Make the deployer the issuer for every credential type and grant the
#    demo credentials. Point it at the new registry from step 1.
export CREDENTIAL_REGISTRY_ADDRESS=0x...   # "CredentialRegistry:" line above
npm run setup:credentials

# 3) Register the sample batch BEEF-001.
npm run register:batch
```

Each script prints the addresses and transaction hashes it produced. Confirm them in the [DIDLab explorer](https://explorer.didlab.org).

By default every demo credential goes to the deployer wallet. To show role separation on chain, set a different wallet for each role before step 2:

```bash
export DEMO_PROCESSOR=0x...
export DEMO_INSPECTOR=0x...
export DEMO_CUSTODIAN=0x...
```

The processor also receives the CUSTODIAN credential so it can ship a batch after registering it. Credentials expire after 30 days unless `CREDENTIAL_TTL_SECONDS` is set. Re-running step 2 is safe: it skips issuers and credentials that are already in place.

After a redeploy, add the new BeefSupplyChain (version, address, deployment block) at the top of `BEEF_SUPPLY_CHAINS` in `frontend/public/chain.js`, keeping the older entries, and update the address in `scripts/registerBatch.js`, and the address and deployment block in the `DEFAULTS` of `server/chainIndex.js` (or set `BSC_ADDRESS` and `BSC_FROM_BLOCK`). If the contract interface changes, regenerate `frontend/public/abi.js` from the BeefSupplyChain artifact. Then run `npm run stamp` and update the table above. Batches do not move to a new contract. The batch page still finds batches on every contract listed in `BEEF_SUPPLY_CHAINS`, checking the newest first, and labels a batch from an older contract "Earlier record". The portal dashboards and actions use only the newest contract.

## Temperature

`contracts/TemperatureLog.sol` is the temperature contract from [ADR 0005](./docs/decisions/0005-temperature-in-separate-contract.md). It stores one sensor-signed summary per custody leg of a batch: low, high, time out of range, reading count, the counter range (so missing readings show), and the Merkle root of the full log, which stays off chain. Each summary is checked by the deployed `SensorSignatureVerifier`, and every fact the check needs comes from chain state: the leg is `BeefSupplyChain.custodyLeg`, the custodian is the batch's current holder, the sensor is the one that custodian registered with `registerSensor`, and the range is fixed at deployment (default -2.2 to 4.44 °C, which is 28–40 °F). So a summary is recorded for the current leg, before the next receiver confirms receipt. Anyone can send it; the sensor's signature is what counts. The sensor must hold a valid SENSOR credential. The format and signing code are in `contracts/SensorSummary.sol` and `scripts/lib/sensor-summary.js`.

```bash
DEPLOY_CONTRACTS=BeefSupplyChain,TemperatureLog npm run deploy:supply-chain   # v5 and its TemperatureLog, using the deployed verifier
```

After deploying, add `temperatureLog: "0x…"` to that deployment's entry in `frontend/public/chain.js`. The batch page then shows a row per leg in the Temperature panel (who held it, how long the sensor logged, low and high, any time out of range, and a bar against the safe band), and the cold-chain check warns when any leg went out of range. A lot also shows the legs of the batches it was split from. Summaries from DIDLab sensors are accepted only once the registry admin sets the SENSOR issuer (`docs/references/notes.md`).

## Demo data

`scripts/seed-demo.js` fills a BeefSupplyChain v5 deployment with a demo supply chain: 13 fictional Texas businesses (`scripts/demo/businesses.js`) and 15 batches with stories (`scripts/demo/batches.js`). Every step is a real transaction. The batches cover splits and repeated splits, three processors on one batch, beef in transit, sold, served and disposed batches, a failed inspection, Class I and Class III recalls, a batch still in cold storage, one waiting for inspection, and one that passes its use-by date about 20 minutes after seeding. Business wallets are derived from `DEPLOYER_KEY` (or `DEMO_SEED`), so reruns find the same wallets, and no key is printed or saved.

```bash
npx hardhat run scripts/seed-demo.js                 # local dry run: deploys its own contracts, checks every batch
npm run seed:demo                                    # DIDLab: prints the plan and the TRUST it needs, sends nothing
DEMO_GO=1 npm run seed:demo                          # DIDLab: seed it
```

On DIDLab the deployer must be the PROCESSOR, INSPECTOR and CUSTODIAN issuer (`npm run setup:credentials`). With `TEMPERATURE_LOG_ADDRESS` set and the deployer as SENSOR issuer, it also gives each business that holds beef a demo sensor, registers it, and records a signed summary of simulated readings for every custody leg (71 in all). Two batches have problems to show: a truck's 30-minute warm spell (BEEF-TX-103) and a storage freezer failure (BEEF-TX-115). Without those settings, batches are seeded with no temperature data. The script grants each business its credentials, funds each wallet for its own transactions, publishes the slide photos and generated mock PDFs (`scripts/lib/mini-pdf.js`) to IPFS, records the batches, and then checks every batch and lot on chain against the plan. Progress is saved after each transaction (`cache/demo-progress-*.json`), so running the same command again resumes a run that stopped. It writes:

- `frontend/public/demo/stories.json`: the story, photo and paperwork the batch page shows. It is used only when its `contract` matches the contract the page reads, and lots show their original batch's story.
- `scripts/demo/directory.json`: the businesses' roles and public profiles. Load it with **Import businesses** in the Portal users card, or `npm run seed:directory` for a `portal.db` you can reach. Both can be run again safely.

## Portal roles

Login is a wallet signature. The server issues a one-time message, the wallet signs it (no gas, no transaction), and the server sets an HttpOnly session cookie. Each wallet's portal roles decide which sections of the page it sees and which server routes it may call.

| Role | Permissions |
|------|-------------|
| `ADMIN` | `users.manage` (Portal users card, `/api/admin/users`) |
| `PROCESSOR` | `batch.register`, `batch.recall` (own batches only), `form.upload` |
| `INSPECTOR` | `batch.inspect`, `form.upload` |
| `CUSTODIAN` | `custody.transfer` (ship, confirm receipt, split into lots) |

The role and permission catalog lives in `server/db.js`. In the page, an element with `data-requires="<permission>"` is shown only to wallets holding that permission. Roles are re-read on every request, so a change made in the Portal users card applies to open sessions right away.

### What each person sees after signing in

- **No role yet.** A card explains that the wallet can verify batches but nothing more. It shows the full address with a copy button, so the person can send it to an admin, and lets them request a role with an optional note. Admins see open requests at the top of the Portal users card ("Fill in form" prefills the user form). A request clears once that wallet has a role. While the card is open, the page rechecks every 30 seconds, so a new role appears without a reload.
- **With roles.** A dashboard opens first, with one tab per role. Each tab shows its counts, a "What you can do" list that jumps to the right form, and a table of the batches that role touches. Processors and custodians see a recall alert when a batch they registered or hold is recalled. If a portal role has no valid on-chain credential, the dashboard says so before a submission fails.
- **Inspector:** inspections recorded and batches waiting (excluding your own). The table shows inspection results and your reports.
- **Processor:** batches registered, how many are still in your custody, and how many are recalled. The table shows inspection, custody and your lot forms and recall notices.
- **Custodian:** batches in your custody and shipments on the way to you. The table offers Ship, Split or Confirm receipt on each row. A split batch shows "Split into N lots" and its lots appear as their own rows ("Lot of BEEF-01"), with lots split from lots indented under them. Distributors and retailers (grocery stores) can split; carriers, storage facilities and restaurants don't see Split. That is a portal choice: on chain, any CUSTODIAN holder can split. Counts include the lots, not the batch they came from.

The dashboard counts come from `server/chainIndex.js`. It copies `BeefSupplyChain` events into `portal.db`, reading from the deployment block in 5,000-block chunks (DIDLab's RPC limit), and catches up when a dashboard loads. It is a cache of the chain and never takes input from users.

**Opening filed forms.** After a lot form, inspection report or recall notice is confirmed, the page sends the server that upload's receipt (CID, IV and the timestamp of the encryption message) through `/api/documents`. The key is never sent. The table's form links fetch the ciphertext from the gateway and ask the uploader's wallet to sign the same message again, which rebuilds the key, then decrypt it in the browser. Only the wallet that uploaded a form can open it. An inspection report or recall notice is listed only if its fingerprint matches the one on chain.

**Business directory.** In the Portal users card, an admin can give a wallet a public profile: business name, city, and optional latitude and longitude. `GET /api/directory` is public and lists the profile of every wallet that has a name and at least one role. Labels and access-request notes are not included. The batch page uses it to say "From Prairie Packers, Amarillo, TX to Lone Star Cold Storage" instead of showing wallet addresses. A wallet with no profile is just left unnamed. The names come from the portal, not the chain, and the page's Technical details say so. A seed file can set a profile per user: `"profile": { "name": "...", "city": "...", "lat": 35.22, "lng": -101.83 }`. When at least one stop on a batch's route has coordinates, the batch page also shows an "On the map" panel (`frontend/public/routemap.js`): numbered pins for the processor and each business that received the batch, joined in order, with a leg still in transit dashed. Leaflet 1.9.4 (cdnjs, pinned by SRI hash) and OpenStreetMap tiles load only when the map scrolls into view. A numbered list under the map gives the same stops in text and names any stop with no location on file.

This layer controls the portal only. It does not replace `CredentialRegistry` ([ADR 0003](./docs/decisions/0003-simulated-administrative-chain.md)): the contracts still check on-chain credentials on every write.

### The roles database

`portal.db` is a SQLite file holding who has which role, plus sessions. Sign-in challenges stay in memory. The server finds the file in this order: `DATA_DIR` if set, `/srv/data` if that folder exists (DIDLab), otherwise `./data` (gitignored). It uses the npm `sqlite3` package because the DIDLab container runs Node 20, which has no built-in `node:sqlite`. `server/sqlite.js` wraps it in promises and runs statements one at a time, so a transaction can't interleave with another request's writes.

To give the first users their roles, use this shape:

```json
{ "users": [ { "address": "0x...", "label": "role label", "roles": ["ADMIN"] } ] }
```

- **Locally:** put it in `data/seed.json` and run `npm run seed:portal`. That builds `data/portal.db` once; later runs leave existing roles alone.
- **On DIDLab:** in the Files tab, create `/srv/data/portal.db` and paste the JSON. The file is text. The first boot turns it into the SQLite database and does not read that text again, so a role removed in the Portal users card stays removed. Pasting the seed again would replace the database with only those seed users.

Keep real addresses and labels out of this repository.

## Hosting on DIDLab

In the container, nginx answers the public site. It serves the page as static files and forwards `/api/` to Node on port 3000, which runs from `/srv/app`. The nginx config can't be changed from the repo, so the server works around two of its behaviors:

- **Stripped prefix.** `proxy_pass http://127.0.0.1:3000/;` removes `/api`, so `/api/me` arrives as `/me`. `index.js` adds `/api` back for its own routes (`/me`, `/auth/*`, `/admin/users`, `/admin/requests`, `/dashboard`, `/documents`, `/access-request`, `/ipfs/add`).
- **No forwarded `Host`.** Node sees `Host: 127.0.0.1:3000`. For the domain in the sign-in message and the cookie's `Secure` flag, the server uses the browser's `Origin` instead, but only if it is listed in `PORTAL_ORIGINS`. An unlisted origin falls back to `127.0.0.1`, so a look-alike site can't get a message carrying its own domain.

nginx also keeps its default 1 MB request limit, so a form upload larger than that is rejected before it reaches Node.

- **Cached scripts.** nginx sends no `Cache-Control`, so Cloudflare caches `.js` and `.css` for 4 hours (in the browser and at its edge) while `index.html` is always fresh. A deploy could then run new HTML against old modules, and a hard refresh doesn't clear Cloudflare's copy. `npm run stamp` gives `styles.css`, `app.js` and every module in the import map a `?v=<content hash>` URL, so any changed file gets a URL no cache has seen.

**Updating the server.** `/srv/app` is a deployed copy, not a git checkout. Run `npm run stamp` after any change in `frontend/public/` and commit the stamped `index.html`. After pushing, redeploy so it gets the new files, install the server's one package (`sqlite3`; a redeploy can arrive without `node_modules`, and Hardhat is a dev dependency the server doesn't need), then restart Node:

```bash
cd /srv/app && npm install --omit=dev
ss -ltnp | grep :3000    # note the pid
kill <pid>               # the supervisor starts it again on the new code
```

Then confirm that `https://teambb.didlab.org/api/me` returns JSON.

## Environment

**Hardhat** reads these from `.env` (see `.env.example`):

- `DIDLAB_RPC`: RPC endpoint (default `https://eth.didlab.org`)
- `DEPLOYER_KEY`: deployer private key. Never commit the real value.

Optional, read only by `scripts/setupCredentials.js`:

- `CREDENTIAL_REGISTRY_ADDRESS`: registry to configure (defaults to the CP2 deployment)
- `DEMO_PROCESSOR`, `DEMO_INSPECTOR`, `DEMO_CUSTODIAN`: credential holders (default to the deployer)
- `CREDENTIAL_TTL_SECONDS`: credential lifetime (default 30 days)

**The Node server** reads these from the process environment. It does not load `.env`.

- `PORT`: listen port (default `3000`)
- `DATA_DIR`: folder holding `portal.db` (default `/srv/data` if it exists, otherwise `./data`)
- `PORTAL_ORIGINS`: comma-separated public URLs trusted for the sign-in domain (default `https://teambb.didlab.org`)
- `CHAIN_RPC`: RPC the dashboard index reads events from (default `https://eth.didlab.org`)
- `BSC_ADDRESS`, `BSC_FROM_BLOCK`: the `BeefSupplyChain` contract to index and its deployment block (defaults: the current deployment, block 7649714). Changing the address rebuilds the index. Update both after a redeploy.

## Team docs

- [docs/TEAM_CHARTER.md](./docs/TEAM_CHARTER.md): roles, norms, and process
- [docs/PROPOSAL.md](./docs/PROPOSAL.md): project proposal
- [docs/CHECKPOINT_REPORT.md](./docs/CHECKPOINT_REPORT.md): checkpoint report
- [docs/decisions/](./docs/decisions/): Architecture Decision Records
- [AI_RECORD.md](./AI_RECORD.md): record of AI-assisted work
