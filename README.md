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
| `frontend/` | Client UI (empty for now) |

## Setup

1. Copy `.env.example` to `.env` and fill in `DEPLOYER_KEY` when you need to deploy. Leave it empty for local compile and test.
2. Install dependencies: `npm install`
3. Compile: `npm run compile`
4. Test: `npm test`

## Environment

See `.env.example` for required variables:

- `DIDLAB_RPC` — RPC endpoint
- `DEPLOYER_KEY` — deployer private key (never commit the real value)

## Team docs

- [docs/TEAM_CHARTER.md](./docs/TEAM_CHARTER.md) — roles, norms, and process
- [docs/PROPOSAL.md](./docs/PROPOSAL.md) — project proposal
- [AI_RECORD.md](./AI_RECORD.md) — record of AI-assisted work
