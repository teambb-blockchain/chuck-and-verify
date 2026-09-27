# Team Charter

**Team name:** teambb

## Purpose

Define how this team collaborates on project-tbd: goals, roles, communication, and quality expectations.

## Goals

- Deliver a working on-chain application with clear documentation
- Keep the repo reproducible (env via `.env.example`, secrets never committed)
- Record major technical choices in `docs/decisions/`

## Roles

| Role | Member |
|------|--------|
| Repository owner | Britt Huffman (@brittshanklin) |
| DIDLab operator | Bhavana Sriharika Kondapalli (@bhavana-sriharika-kondapalli) |
| Evidence keeper | Britt Huffman (@brittshanklin) |

## Working agreements

- Prefer small, reviewable pull requests
- Discuss architecture changes before large refactors; log the outcome as an ADR in `docs/decisions/`
- Do not commit `.env`, private keys, or other secrets
- Update `AI_RECORD.md` (repo root) when AI tools materially assist design or implementation
- Every member commits to the repository every week

## Communication

- **Channel and response time:** LinkedIn or email using UMKC; respond within 12 hours, except on weekends
- **Meeting time outside class:** after class on Tuesdays and Thursdays

## Accountability

- Two missed commitments result in warnings
- A third missed commitment means owing the other team members one 20oz soda of their choice

## Definition of done

- Code builds and relevant tests pass
- Docs or ADRs updated when behavior or architecture changes
- Env requirements reflected in `.env.example` when new secrets are introduced
