# chuck-and-verify

Team project for smart contracts, tests, scripts, and docs.
## Project Overview

This project focuses on tracking beef batches through the supply chain. The Beef Supply Chain Contract records important information about batch registration, USDA inspection, custody handoffs, and recalls.

Authorized participants include processors, USDA inspectors, logistics partners, and retailers. Consumers can view the recorded information to verify a beef batch's inspection status, custody history, and recall status.

Confidential business information such as pricing, sales data, employee information, shipping details, and complete inspection documents is kept off-chain.

## Structure

| Path | Purpose |
|------|---------|
| `contracts/` | Solidity (or other) smart contracts 
| `test/` | Contract and integration tests |
| `scripts/` | Deploy and utility scripts |
| `docs/` | Proposal and team charter |
| `docs/architecture/` | High-level system design notes |
| `docs/decisions/` | Architecture Decision Records (one file per decision) |
| `frontend/public/` | DApp page (`index.html`, `app.js`, generated `abi.js`) |
| `index.html` | nginx redirect from `/` to `/frontend/public/index.html` |

## Setup

1. Copy `.env.example` to `.env` and fill in `DEPLOYER_KEY` when you need to deploy. Leave it empty for local compile and test.
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Test: `npm test`

## Deploy to DIDLab

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

After a redeploy, update the addresses in `frontend/public/app.js` and `scripts/registerBatch.js`. Regenerate `frontend/public/abi.js` from the BeefSupplyChain artifact if the contract interface changes.

## Run the project page locally

Run `npm start` and open `http://localhost:3000`. That serves `frontend/public/`.

On the DIDLab host, nginx serves the repo checkout. `/` redirects to `/frontend/public/index.html`. Dependencies stay in the root `package.json`.

## Portal roles (SQLite)

`index.js` keeps portal roles in SQLite using Node's built-in `node:sqlite` (Node 22.5 or newer, no npm package). Login is a wallet signature: the server issues a one-time message, the wallet signs it (no gas), and the server sets an HttpOnly session cookie. Each wallet's roles decide which sections it sees and which server routes it may call.

| Role | Permissions |
|------|-------------|
| `ADMIN` | `users.manage` (Portal users card, `/api/admin/users`) |
| `PROCESSOR` | `batch.register`, `batch.recall` (own batches only), `form.upload` |
| `INSPECTOR` | `batch.inspect`, `form.upload` |
| `CUSTODIAN` | `custody.transfer` |

The catalog lives in `server/db.js`. The database stores only who holds which role. Hide or show UI with `data-requires="<permission>"`. This layer does not replace `CredentialRegistry`: the contracts still check on-chain credentials for every write.

**DIDLab.** In the Files tab, create `/srv/data/portal.db` and paste the portal JSON. `portal.db` is a plain JSON file, so no SQLite or Node version requirement applies. The first boot marks it as seeded, and the server then keeps users, roles and sessions in it, so a role removed in the Portal users card stays removed. Do not paste the seed a second time, since that would overwrite the current roles. Keep the real addresses and labels out of this repository.

```json
{ "users": [ { "address": "0x...", "label": "role label", "roles": ["ADMIN"] } ] }
```

Locally, `npm start` uses `./data/portal.db`. Set `DATA_DIR` to override. `npm run seed:portal` builds that file from `data/seed.json` once.

## Environment

See `.env.example` for required variables:

- `DIDLAB_RPC` — RPC endpoint
- `DEPLOYER_KEY` — deployer private key (never commit the real value)

Optional, read by `scripts/setupCredentials.js` only:

- `CREDENTIAL_REGISTRY_ADDRESS` — registry to configure (defaults to the CP2 deployment)
- `DEMO_PROCESSOR`, `DEMO_INSPECTOR`, `DEMO_CUSTODIAN` — credential holders (default to the deployer)
- `CREDENTIAL_TTL_SECONDS` — credential lifetime (default 30 days)

## Team docs

- [docs/TEAM_CHARTER.md](./docs/TEAM_CHARTER.md) — roles, norms, and process
- [docs/PROPOSAL.md](./docs/PROPOSAL.md) — project proposal
- [AI_RECORD.md](./AI_RECORD.md) — record of AI-assisted work
