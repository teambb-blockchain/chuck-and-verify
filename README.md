# Chuck and Verify

Team BB's blockchain project for tracking beef batches through the supply chain. Live at [teambb.didlab.org](https://teambb.didlab.org) on DIDLab (chain 252501).

## Overview

The `BeefSupplyChain` contract records batch registration, USDA inspection, custody handoffs, and recalls. Processors, USDA inspectors, logistics partners, and retailers write to it, each with a credential from `CredentialRegistry`. Consumers can read a batch's inspection status, custody history, and recall status.

Confidential business information stays off chain: pricing, sales data, employee information, shipping details, and complete inspection documents. A batch's lot form (a PDF) is encrypted in the browser and published to IPFS when the batch is registered. Only the batch facts go on chain.

## Repository layout

| Path | Purpose |
|------|---------|
| `contracts/` | `BeefSupplyChain` and `CredentialRegistry` (Solidity) |
| `test/` | Hardhat contract tests |
| `scripts/` | Deploy, credential setup, sample batch, and portal seed scripts |
| `frontend/public/` | DApp page (`index.html`, `app.js`, generated `abi.js`, portal session and admin modules) |
| `index.js` | Node server: static page, wallet sign-in, portal roles, IPFS upload proxy |
| `server/` | Sign-in (`auth.js`), role storage (`db.js`), signature recovery (`ethsig.js`) |
| `index.html` | Redirects `/` to `/frontend/public/index.html` |
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

Open `http://localhost:3000`. The server serves `frontend/public/` and the `/api/` routes, and keeps portal roles in `./data/portal.db`.

## Deploy contracts to DIDLab

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

After a redeploy, update the addresses in `frontend/public/app.js` and `scripts/registerBatch.js`. If the contract interface changes, regenerate `frontend/public/abi.js` from the BeefSupplyChain artifact.

## Portal roles

Login is a wallet signature. The server issues a one-time message, the wallet signs it (no gas, no transaction), and the server sets an HttpOnly session cookie. Each wallet's portal roles decide which sections of the page it sees and which server routes it may call.

| Role | Permissions |
|------|-------------|
| `ADMIN` | `users.manage` (Portal users card, `/api/admin/users`) |
| `PROCESSOR` | `batch.register`, `batch.recall` (own batches only), `form.upload` |
| `INSPECTOR` | `batch.inspect`, `form.upload` |
| `CUSTODIAN` | `custody.transfer` |

The role and permission catalog lives in `server/db.js`. In the page, an element with `data-requires="<permission>"` is shown only to wallets holding that permission. Roles are re-read on every request, so a change made in the Portal users card applies to open sessions right away.

This layer controls the portal only. It does not replace `CredentialRegistry` ([ADR 0003](./docs/decisions/0003-simulated-administrative-chain.md)): the contracts still check on-chain credentials on every write.

### The roles file

`portal.db` is a plain JSON file holding who has which role, plus sessions. The server finds it in this order: `DATA_DIR` if set, `/srv/data` if that folder exists (DIDLab), otherwise `./data` (gitignored).

To give the first users their roles, use this shape:

```json
{ "users": [ { "address": "0x...", "label": "role label", "roles": ["ADMIN"] } ] }
```

- **Locally:** put it in `data/seed.json` and run `npm run seed:portal`. That builds `data/portal.db` once; later runs leave existing roles alone.
- **On DIDLab:** in the Files tab, create `/srv/data/portal.db` and paste the JSON. The first boot marks the file as seeded. From then on, manage roles in the Portal users card. Pasting the seed again would overwrite the current roles.

Keep real addresses and labels out of this repository.

## Hosting on DIDLab

In the container, nginx answers the public site. It serves the page as static files and forwards `/api/` to Node on port 3000, which runs from `/srv/app`. The nginx config can't be changed from the repo, so the server works around two of its behaviors:

- **Stripped prefix.** `proxy_pass http://127.0.0.1:3000/;` removes `/api`, so `/api/me` arrives as `/me`. `index.js` adds `/api` back for its own routes (`/me`, `/auth/*`, `/admin/users`, `/ipfs/add`).
- **No forwarded `Host`.** Node sees `Host: 127.0.0.1:3000`. For the domain in the sign-in message and the cookie's `Secure` flag, the server uses the browser's `Origin` instead, but only if it is listed in `PORTAL_ORIGINS`. An unlisted origin falls back to `127.0.0.1`, so a look-alike site can't get a message carrying its own domain.

nginx also keeps its default 1 MB request limit, so a form upload larger than that is rejected before it reaches Node.

**Updating the server.** `/srv/app` is a deployed copy, not a git checkout. After pushing, redeploy so it gets the new files, then restart Node:

```bash
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

## Team docs

- [docs/TEAM_CHARTER.md](./docs/TEAM_CHARTER.md): roles, norms, and process
- [docs/PROPOSAL.md](./docs/PROPOSAL.md): project proposal
- [docs/CHECKPOINT_REPORT.md](./docs/CHECKPOINT_REPORT.md): checkpoint report
- [docs/decisions/](./docs/decisions/): Architecture Decision Records
- [AI_RECORD.md](./AI_RECORD.md): record of AI-assisted work
