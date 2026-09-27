# project-tbd

Team project for smart contracts, tests, scripts, and docs.

## Structure

| Path | Purpose |
|------|---------|
| `contracts/` | Solidity (or other) smart contracts |
| `test/` | Contract and integration tests |
| `scripts/` | Deploy and utility scripts |
| `docs/` | Proposal and team charter |
| `docs/architecture/` | High-level system design notes |
| `docs/decisions/` | Architecture Decision Records (one file per decision) |
| `frontend/` | Client UI (empty for now) |

## Setup

1. Copy `.env.example` to `.env` and fill in values.
2. Install dependencies once the toolchain is added (e.g. Hardhat / Foundry).

## Environment

See `.env.example` for required variables:

- `DIDLAB_RPC` — RPC endpoint
- `DEPLOYER_KEY` — deployer private key (never commit the real value)

## Team docs

- [docs/TEAM_CHARTER.md](./docs/TEAM_CHARTER.md) — roles, norms, and process
- [docs/PROPOSAL.md](./docs/PROPOSAL.md) — project proposal
- [AI_RECORD.md](./AI_RECORD.md) — record of AI-assisted work
