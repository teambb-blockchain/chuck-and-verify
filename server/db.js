"use strict";

// Portal role storage. The role/permission catalog below lives in git and is
// re-synced into SQLite on every boot (npm sqlite3; DIDLab runs Node 20). The database stores only who holds
// which role, plus sessions. Sign-in challenges stay in memory because they
// last five minutes.
//
// This is a portal layer: it decides what each wallet sees and which server
// routes it may call. It does not replace CredentialRegistry, which still
// decides who may write on chain (ADR 0003).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { openSqlite } = require("./sqlite");

const ROLES = {
  ADMIN: "Manages portal users and their roles.",
  PROCESSOR: "Registers new beef batches and recalls its own batches.",
  INSPECTOR: "Files inspection forms and records inspections.",
  CUSTODIAN: "Records shipments and confirms receipt.",
};

// Permission -> roles that hold it. Names follow the contract functions.
const PERMISSIONS = {
  "batch.register": {
    description: "Register a batch (registerBatch).",
    roles: ["PROCESSOR"],
  },
  "batch.inspect": {
    description: "Record an inspection (recordInspection).",
    roles: ["INSPECTOR"],
  },
  "batch.recall": {
    description: "Recall a batch this processor registered (recordRecall).",
    roles: ["PROCESSOR"],
  },
  "custody.transfer": {
    description: "Ship a batch or confirm receipt (recordShipment, confirmReceipt).",
    roles: ["CUSTODIAN"],
  },
  "form.upload": {
    description: "Publish an encrypted form to IPFS through /api/ipfs/add.",
    roles: ["PROCESSOR", "INSPECTOR"],
  },
  "users.manage": {
    description: "View and change portal users and roles.",
    roles: ["ADMIN"],
  },
};

// The stakeholders of CHECKPOINT_REPORT §2 that write on the operational
// chain, each backed by the one credential type the contract checks. The
// portal uses the type to tailor a wallet's dashboard; the chain never sees
// it. Regulators other than FSIS (FMCSA, FDA, state and local health)
// attest parties off chain and have no portal type yet. Consumers verify
// without signing in.
const ORGANIZATIONS = {
  processor: { role: "PROCESSOR", name: "Beef processor" },
  fsis: { role: "INSPECTOR", name: "USDA FSIS inspector" },
  storage: { role: "CUSTODIAN", name: "Storage facility" },
  distributor: { role: "CUSTODIAN", name: "Distributor" },
  carrier: { role: "CUSTODIAN", name: "Carrier" },
  retailer: { role: "CUSTODIAN", name: "Retailer" },
  restaurant: { role: "CUSTODIAN", name: "Restaurant" },
};

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

// '' (none) or a known type whose credential is among `roles`.
function checkOrganization(organization, roles) {
  const org = String(organization || "");
  if (!org) return "";
  const bad = (message) => Object.assign(new Error(message), { status: 400 });
  if (!Object.hasOwn(ORGANIZATIONS, org)) throw bad("Unknown organization type: " + org);
  const { role, name } = ORGANIZATIONS[org];
  if (!roles.includes(role)) throw bad(name + " needs the " + role + " role.");
  return org;
}

function normalizeAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  if (!ADDRESS_RE.test(address)) {
    throw new Error("Not a valid 0x address: " + value);
  }
  return address;
}

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  // On the DIDLab container, /srv/data is private and survives redeploys.
  if (fs.existsSync("/srv/data")) return "/srv/data";
  return path.join(__dirname, "..", "data");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role       TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  permission TEXT NOT NULL REFERENCES permissions(name) ON DELETE CASCADE,
  PRIMARY KEY (role, permission)
);
CREATE TABLE IF NOT EXISTS users (
  address    TEXT PRIMARY KEY CHECK (length(address) = 42 AND address GLOB '0x*'),
  label      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  organization TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS user_roles (
  address    TEXT NOT NULL REFERENCES users(address) ON DELETE CASCADE,
  role       TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (address, role)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SQLITE_HEADER = Buffer.from("SQLite format 3\0");

function isSqliteFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(16);
    const n = fs.readSync(fd, header, 0, 16, 0);
    return n === 16 && header.equals(SQLITE_HEADER);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

async function connectDatabase(dbPath, options) {
  const sqlite = await openSqlite(dbPath, options);
  await sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  await sqlite.exec(SCHEMA);
  // Databases built before organization types existed lack the column.
  const columns = await sqlite.all("PRAGMA table_info(users)");
  if (!columns.some((c) => c.name === "organization")) {
    await sqlite.exec("ALTER TABLE users ADD COLUMN organization TEXT NOT NULL DEFAULT ''");
  }
  await syncCatalog(sqlite);
  return sqlite;
}

function syncCatalog(sqlite) {
  return sqlite.transaction(async (tx) => {
    const upsertRole =
      "INSERT INTO roles (name, description) VALUES (?, ?) " +
      "ON CONFLICT(name) DO UPDATE SET description = excluded.description";
    const upsertPerm =
      "INSERT INTO permissions (name, description) VALUES (?, ?) " +
      "ON CONFLICT(name) DO UPDATE SET description = excluded.description";
    for (const [name, description] of Object.entries(ROLES)) {
      await tx.run(upsertRole, name, description);
    }
    for (const [name, { description }] of Object.entries(PERMISSIONS)) {
      await tx.run(upsertPerm, name, description);
    }
    // Drop catalog entries that were removed from code. user_roles rows for
    // a removed role go with it (ON DELETE CASCADE).
    const roleNames = Object.keys(ROLES);
    const permNames = Object.keys(PERMISSIONS);
    await tx.run(
      `DELETE FROM roles WHERE name NOT IN (${roleNames.map(() => "?").join(",")})`,
      ...roleNames
    );
    await tx.run(
      `DELETE FROM permissions WHERE name NOT IN (${permNames.map(() => "?").join(",")})`,
      ...permNames
    );

    await tx.exec("DELETE FROM role_permissions");
    const link = "INSERT INTO role_permissions (role, permission) VALUES (?, ?)";
    for (const [perm, { roles }] of Object.entries(PERMISSIONS)) {
      for (const role of roles) await tx.run(link, role, perm);
    }
  });
}

// The DIDLab Files tab stores text. A pasted portal.db is JSON, not a
// database. The first boot builds the real database from that text and
// replaces the file. A later boot sees SQLite and does not read it again,
// so a role removed in the portal stays removed.
async function adoptPastedSeed(dbPath) {
  if (!fs.existsSync(dbPath) || isSqliteFile(dbPath)) return;

  const text = fs.readFileSync(dbPath, "utf8").trim();
  if (!text.startsWith("{")) {
    throw new Error(
      "portal.db is not a SQLite database or portal JSON. Replace that file, then start again."
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "portal.db is not a SQLite database or portal JSON. Replace that file, then start again."
    );
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-seed-"));
  try {
    const seedPath = path.join(dir, "seed.json");
    const builtPath = path.join(dir, "portal.db");
    fs.writeFileSync(seedPath, text);
    const db = createStore(await connectDatabase(builtPath));
    try {
      const result = await seedOnce(db, seedPath);
      if (!result.applied) throw new Error("Pasted portal JSON was not applied.");
      await importSessions(db, parsed.sessions);
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      await db.close();
    }
    fs.copyFileSync(builtPath, dbPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Keep unexpired sessions from a JSON portal.db so open logins survive the
// first boot on SQLite. A bad row is skipped; users were already imported.
async function importSessions(db, sessions) {
  if (!Array.isArray(sessions)) return;
  const now = Date.now();
  const insert =
    "INSERT OR IGNORE INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)";
  for (const session of sessions) {
    if (!session || Number(session.expiresAt) <= now || !session.tokenHash) continue;
    try {
      await db.sqlite.run(
        insert,
        String(session.tokenHash),
        normalizeAddress(session.address),
        Number(session.expiresAt)
      );
    } catch {
      // Drop a row that is not a real session. The users are already in.
    }
  }
}

function createStore(sqlite) {
  const challenges = new Map();

  return {
    sqlite,
    close() {
      return sqlite.close();
    },
    exec(sql) {
      return sqlite.exec(sql);
    },

    async sessionAddress(tokenHash, now) {
      const row = await sqlite.get(
        "SELECT address FROM sessions WHERE token_hash = ? AND expires_at > ?",
        tokenHash,
        now
      );
      return row ? row.address : null;
    },
    async addSession(tokenHash, address, expiresAt, now) {
      await sqlite.run("DELETE FROM sessions WHERE expires_at <= ?", now);
      await sqlite.run(
        "INSERT INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)",
        tokenHash,
        address,
        expiresAt
      );
    },
    async deleteSession(tokenHash) {
      await sqlite.run("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
    },

    liveChallenges(now) {
      for (const [nonce, challenge] of challenges) {
        if (challenge.expiresAt <= now) challenges.delete(nonce);
      }
      return challenges.size;
    },
    addChallenge(nonce, challenge) {
      challenges.set(nonce, challenge);
    },
    // Single use: removed as soon as it is read.
    takeChallenge(nonce) {
      const challenge = challenges.get(nonce);
      challenges.delete(nonce);
      return challenge || null;
    },
  };
}

// options.onBroken: see server/sqlite.js.
async function openDatabase(dataDir = resolveDataDir(), options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "portal.db");
  await adoptPastedSeed(dbPath);
  const db = createStore(await connectDatabase(dbPath, options));
  return { db, dbPath, dataDir };
}

// Apply seed.json once into this database file. A later run, and every boot,
// leave the rows alone, so removing a role in the portal stays removed.
//   { "users": [ { "address": "0x...", "label": "Contract deployer", "roles": ["ADMIN"] } ] }
async function seedOnce(db, seedPath) {
  const existing = await db.sqlite.get("SELECT value FROM app_state WHERE key = 'seeded'");
  if (existing) return { applied: false };

  if (!fs.existsSync(seedPath)) {
    throw new Error("Seed file not found: " + seedPath);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  } catch {
    throw new Error("Seed file is not valid JSON: " + seedPath);
  }
  const users = Array.isArray(parsed.users) ? parsed.users : [];
  if (users.length === 0) throw new Error("Seed file has no users.");

  for (const user of users) {
    await upsertUser(db, {
      address: user.address,
      label: user.label,
      roles: user.roles || [],
      organization: user.organization,
      grantedBy: "seed",
      replaceRoles: false,
      createdAt: user.createdAt,
    });
  }
  await db.sqlite.run(
    "INSERT INTO app_state (key, value) VALUES ('seeded', ?)",
    new Date().toISOString()
  );
  return { applied: true, count: users.length };
}

// organization: a key of ORGANIZATIONS, '' to clear, or undefined to keep
// the current one while the wallet still holds its role.
async function upsertUser(db, { address, label, roles, organization, grantedBy, replaceRoles, createdAt }) {
  const addr = normalizeAddress(address);
  const unknown = roles.filter((role) => !(role in ROLES));
  if (unknown.length) throw new Error("Unknown role(s): " + unknown.join(", "));
  const now = Date.now();
  const before = await db.sqlite.get("SELECT organization FROM users WHERE address = ?", addr);
  const heldBefore = replaceRoles ? [] : (await accessFor(db, addr)).roles;
  const held = [...new Set([...heldBefore, ...roles])];
  let org;
  if (organization === undefined) {
    const current = before ? before.organization : "";
    org = current && held.includes(ORGANIZATIONS[current]?.role) ? current : "";
  } else {
    org = checkOrganization(organization, held);
  }

  await db.sqlite.transaction(async (tx) => {
    await tx.run(
      "INSERT INTO users (address, label, created_at, organization) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(address) DO UPDATE SET organization = excluded.organization, label = " +
        "CASE WHEN excluded.label = '' THEN users.label ELSE excluded.label END",
      addr,
      String(label || "").slice(0, 80),
      Number(createdAt) || now,
      org
    );
    if (replaceRoles) {
      await tx.run("DELETE FROM user_roles WHERE address = ?", addr);
    }
    const grant =
      "INSERT OR IGNORE INTO user_roles (address, role, granted_by, granted_at) VALUES (?, ?, ?, ?)";
    for (const role of roles) await tx.run(grant, addr, role, grantedBy || "portal", now);
  });
  return addr;
}

async function deleteUser(db, address) {
  const result = await db.sqlite.run(
    "DELETE FROM users WHERE address = ?",
    normalizeAddress(address)
  );
  return result.changes;
}

async function accessFor(db, address) {
  const roles = (
    await db.sqlite.all("SELECT role FROM user_roles WHERE address = ? ORDER BY role", address)
  ).map((row) => row.role);
  const permissions = (
    await db.sqlite.all(
      "SELECT DISTINCT rp.permission FROM user_roles ur " +
        "JOIN role_permissions rp ON rp.role = ur.role " +
        "WHERE ur.address = ? ORDER BY rp.permission",
      address
    )
  ).map((row) => row.permission);
  const user = await db.sqlite.get("SELECT organization FROM users WHERE address = ?", address);
  return { roles, permissions, organization: (user && user.organization) || null };
}

async function listUsers(db) {
  const users = await db.sqlite.all(
    "SELECT address, label, created_at, organization FROM users ORDER BY created_at"
  );
  const rolesByAddress = new Map(users.map((user) => [user.address, []]));
  for (const grant of await db.sqlite.all("SELECT address, role FROM user_roles ORDER BY role")) {
    rolesByAddress.get(grant.address)?.push(grant.role);
  }
  return users.map((user) => ({
    address: user.address,
    label: user.label,
    createdAt: user.created_at,
    organization: user.organization || null,
    roles: rolesByAddress.get(user.address),
  }));
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ORGANIZATIONS,
  checkOrganization,
  normalizeAddress,
  openDatabase,
  seedOnce,
  upsertUser,
  deleteUser,
  accessFor,
  listUsers,
};
