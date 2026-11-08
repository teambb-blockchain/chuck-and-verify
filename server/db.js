"use strict";

// Portal role storage. The role/permission catalog below lives in git and is
// re-synced into SQLite on every boot. The database stores only who holds
// which role, plus login nonces and sessions.
//
// This is a portal layer: it decides what each wallet sees and which server
// routes it may call. It does not replace CredentialRegistry, which still
// decides who may write on chain (ADR 0003).

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

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

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

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
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_roles (
  address    TEXT NOT NULL REFERENCES users(address) ON DELETE CASCADE,
  role       TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (address, role)
);
CREATE TABLE IF NOT EXISTS login_challenges (
  nonce      TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  message    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
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

function openDatabase(dataDir = resolveDataDir()) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "portal.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  syncCatalog(db);
  return { db, dbPath, dataDir };
}

function syncCatalog(db) {
  db.exec("BEGIN");
  try {
    const upsertRole = db.prepare(
      "INSERT INTO roles (name, description) VALUES (?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET description = excluded.description"
    );
    const upsertPerm = db.prepare(
      "INSERT INTO permissions (name, description) VALUES (?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET description = excluded.description"
    );
    for (const [name, description] of Object.entries(ROLES)) {
      upsertRole.run(name, description);
    }
    for (const [name, { description }] of Object.entries(PERMISSIONS)) {
      upsertPerm.run(name, description);
    }
    // Drop catalog entries that were removed from code.
    const roleNames = Object.keys(ROLES);
    const permNames = Object.keys(PERMISSIONS);
    db.prepare(
      `DELETE FROM roles WHERE name NOT IN (${roleNames.map(() => "?").join(",")})`
    ).run(...roleNames);
    db.prepare(
      `DELETE FROM permissions WHERE name NOT IN (${permNames.map(() => "?").join(",")})`
    ).run(...permNames);

    db.exec("DELETE FROM role_permissions");
    const link = db.prepare(
      "INSERT INTO role_permissions (role, permission) VALUES (?, ?)"
    );
    for (const [perm, { roles }] of Object.entries(PERMISSIONS)) {
      for (const role of roles) link.run(role, perm);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Apply seed.json once into this database file. A later run, and every boot,
// leave the rows alone, so removing a role in the portal stays removed.
//   { "users": [ { "address": "0x...", "label": "Britt", "roles": ["ADMIN"] } ] }
function seedOnce(db, seedPath) {
  const existing = db.prepare(
    "SELECT value FROM app_state WHERE key = 'seeded'"
  ).get();
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
    upsertUser(db, {
      address: user.address,
      label: user.label,
      roles: user.roles || [],
      grantedBy: "seed",
      replaceRoles: false,
    });
  }
  db.prepare("INSERT INTO app_state (key, value) VALUES ('seeded', ?)").run(
    new Date().toISOString()
  );
  return { applied: true, count: users.length };
}

function upsertUser(db, { address, label, roles, grantedBy, replaceRoles }) {
  const addr = normalizeAddress(address);
  const unknown = roles.filter((role) => !(role in ROLES));
  if (unknown.length) throw new Error("Unknown role(s): " + unknown.join(", "));
  const now = Date.now();

  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO users (address, label, created_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(address) DO UPDATE SET label = " +
        "CASE WHEN excluded.label = '' THEN users.label ELSE excluded.label END"
    ).run(addr, String(label || "").slice(0, 80), now);
    if (replaceRoles) {
      db.prepare("DELETE FROM user_roles WHERE address = ?").run(addr);
    }
    const grant = db.prepare(
      "INSERT OR IGNORE INTO user_roles (address, role, granted_by, granted_at) " +
        "VALUES (?, ?, ?, ?)"
    );
    for (const role of roles) grant.run(addr, role, grantedBy, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return addr;
}

function deleteUser(db, address) {
  return db.prepare("DELETE FROM users WHERE address = ?").run(normalizeAddress(address))
    .changes;
}

function accessFor(db, address) {
  const roles = db
    .prepare("SELECT role FROM user_roles WHERE address = ? ORDER BY role")
    .all(address)
    .map((row) => row.role);
  const permissions = db
    .prepare(
      "SELECT DISTINCT rp.permission FROM user_roles ur " +
        "JOIN role_permissions rp ON rp.role = ur.role " +
        "WHERE ur.address = ? ORDER BY rp.permission"
    )
    .all(address)
    .map((row) => row.permission);
  return { roles, permissions };
}

function listUsers(db) {
  const users = db
    .prepare("SELECT address, label, created_at FROM users ORDER BY created_at")
    .all();
  const rolesStmt = db.prepare(
    "SELECT role FROM user_roles WHERE address = ? ORDER BY role"
  );
  return users.map((user) => ({
    address: user.address,
    label: user.label,
    createdAt: user.created_at,
    roles: rolesStmt.all(user.address).map((row) => row.role),
  }));
}

module.exports = {
  ROLES,
  PERMISSIONS,
  normalizeAddress,
  openDatabase,
  seedOnce,
  upsertUser,
  deleteUser,
  accessFor,
  listUsers,
};
