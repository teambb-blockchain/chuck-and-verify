# chuck-and-verify

Team project for smart contracts, tests, scripts, and docs.
## Project Overview

This project focuses on tracking beef batches through the supply chain. The Beef Supply Chain Contract records important information about batch registration, USDA inspection, custody handoffs, and recalls.

Authorized participants include processors, USDA inspectors, logistics partners, and retailers. Consumers can view the recorded information to verify a beef batch's inspection status, custody history, and recall status.

Confidential business information such as pricing, sales data, employee information, shipping details, and complete inspection documents is kept off-chain.

## Structure

| Path | Purpose |
|------|---------|
| `contracts/` | Solidity (or other) smart contracts - Example contracts: `SimpleStorage.sol`, `ProjectAnchor.sol` |
| `test/` | Contract and integration tests |
| `scripts/` | Deploy and utility scripts |
| `docs/` | Proposal and team charter |
| `docs/architecture/` | High-level system design notes |
| `docs/decisions/` | Architecture Decision Records (one file per decision) |
| `frontend/` | Public project page (`/frontend/` on the DIDLab host) |
| `index.html` | Tiny redirect from `/` to `/frontend/index.html` (nginx web root is the repo root) |

## Setup

1. Install dependencies: `npm install`
2. Compile: `npm run compile`
3. Test: `npm test`

## Deploy to DIDLab

Credentials come from the shell only. Never write a private key to `.env`, the repo, or any other file. Use a disposable DIDLab lab wallet with enough TRUST for gas.

```bash
npx hardhat compile
export DIDLAB_RPC_URL=https://eth.didlab.org
export DIDLAB_PRIVATE_KEY='0x…'   # 64 hex chars after 0x — not your wallet address

# 1) CredentialRegistry
npm run deploy:registry
export CREDENTIAL_REGISTRY_ADDRESS='0x…'   # printed Contract: line

# 2) BeefSupplyChain (points at that registry)
npm run deploy:supply-chain

# 3) Issuers + demo credentials (admin key; defaults holders to the deployer)
npm run setup:registry
# Optional role wallets:
# export DEMO_PROCESSOR='0x…'
# export DEMO_INSPECTOR='0x…'
# export DEMO_CUSTODIAN='0x…'
```

Each deploy script prints the deployer address, contract address, and deployment transaction hash. Confirm them in the [DIDLab explorer](https://explorer.didlab.org). Record addresses in `docs/references/notes.md`.

## Run the project page locally

Open `frontend/index.html` in a browser.

On the DIDLab host, nginx serves the repo checkout. Today `/frontend/index.html` works; `/` is still 403 until the root `index.html` redirect is deployed.

## Team docs

- [docs/TEAM_CHARTER.md](./docs/TEAM_CHARTER.md) — roles, norms, and process
- [docs/PROPOSAL.md](./docs/PROPOSAL.md) — project proposal
- [AI_RECORD.md](./AI_RECORD.md) — record of AI-assisted work
