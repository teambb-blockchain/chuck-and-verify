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
