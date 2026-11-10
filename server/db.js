"use strict";

// Portal role storage. The role/permission catalog below lives in git and is
// re-synced into SQLite on every boot. The database stores only who holds
// which role, plus sessions. Sign-in challenges stay in memory because they
// last five minutes.
//
// This is a portal layer: it decides what each wallet sees and which server
// routes it may call. It does not replace CredentialRegistry, which still
// decides who may write on chain (ADR 0003).

const fs = require("fs");
const os = require("os");
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

function connectDatabase(dbPath) {
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  sqlite.exec(SCHEMA);
  syncCatalog(sqlite);
  return sqlite;
}

function syncCatalog(sqlite) {
  sqlite.exec("BEGIN");
  try {
    const upsertRole = sqlite.prepare(
      "INSERT INTO roles (name, description) VALUES (?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET description = excluded.description"
    );
    const upsertPerm = sqlite.prepare(
      "INSERT INTO permissions (name, description) VALUES (?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET description = excluded.description"
    );
    for (const [name, description] of Object.entries(ROLES)) {
      upsertRole.run(name, description);
    }
    for (const [name, { description }] of Object.entries(PERMISSIONS)) {
      upsertPerm.run(name, description);
    }
    // Drop catalog entries that were removed from code. user_roles rows for
    // a removed role go with it (ON DELETE CASCADE).
    const roleNames = Object.keys(ROLES);
    const permNames = Object.keys(PERMISSIONS);
    sqlite
      .prepare(`DELETE FROM roles WHERE name NOT IN (${roleNames.map(() => "?").join(",")})`)
      .run(...roleNames);
    sqlite
      .prepare(
        `DELETE FROM permissions WHERE name NOT IN (${permNames.map(() => "?").join(",")})`
      )
      .run(...permNames);

    sqlite.exec("DELETE FROM role_permissions");
    const link = sqlite.prepare("INSERT INTO role_permissions (role, permission) VALUES (?, ?)");
    for (const [perm, { roles }] of Object.entries(PERMISSIONS)) {
      for (const role of roles) link.run(role, perm);
    }
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

// The DIDLab Files tab stores text. A pasted portal.db is JSON, not a
// database. The first boot builds the real database from that text and
// replaces the file. A later boot sees SQLite and does not read it again,
// so a role removed in the portal stays removed.
function adoptPastedSeed(dbPath) {
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
    const db = createStore(connectDatabase(builtPath));
    try {
      const result = seedOnce(db, seedPath);
      if (!result.applied) throw new Error("Pasted portal JSON was not applied.");
      importSessions(db, parsed.sessions);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    fs.copyFileSync(builtPath, dbPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Keep unexpired sessions from a JSON portal.db so open logins survive the
// first boot on SQLite. A bad row is skipped; users were already imported.
function importSessions(db, sessions) {
  if (!Array.isArray(sessions)) return;
  const now = Date.now();
  const insert = db.sqlite.prepare(
    "INSERT OR IGNORE INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)"
  );
  for (const session of sessions) {
    if (!session || Number(session.expiresAt) <= now || !session.tokenHash) continue;
    try {
      insert.run(String(session.tokenHash), normalizeAddress(session.address), Number(session.expiresAt));
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
      sqlite.close();
    },
    exec(sql) {
      sqlite.exec(sql);
    },

    sessionAddress(tokenHash, now) {
      const row = sqlite
        .prepare("SELECT address FROM sessions WHERE token_hash = ? AND expires_at > ?")
        .get(tokenHash, now);
      return row ? row.address : null;
    },
    addSession(tokenHash, address, expiresAt, now) {
      sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
      sqlite
        .prepare("INSERT INTO sessions (token_hash, address, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash, address, expiresAt);
    },
    deleteSession(tokenHash) {
      sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
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

function openDatabase(dataDir = resolveDataDir()) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "portal.db");
  adoptPastedSeed(dbPath);
  const db = createStore(connectDatabase(dbPath));
  return { db, dbPath, dataDir };
}

// Apply seed.json once into this database file. A later run, and every boot,
// leave the rows alone, so removing a role in the portal stays removed.
//   { "users": [ { "address": "0x...", "label": "Contract deployer", "roles": ["ADMIN"] } ] }
function seedOnce(db, seedPath) {
  const existing = db.sqlite.prepare("SELECT value FROM app_state WHERE key = 'seeded'").get();
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
      createdAt: user.createdAt,
    });
  }
  db.sqlite
    .prepare("INSERT INTO app_state (key, value) VALUES ('seeded', ?)")
    .run(new Date().toISOString());
  return { applied: true, count: users.length };
}

function upsertUser(db, { address, label, roles, grantedBy, replaceRoles, createdAt }) {
  const addr = normalizeAddress(address);
  const unknown = roles.filter((role) => !(role in ROLES));
  if (unknown.length) throw new Error("Unknown role(s): " + unknown.join(", "));
  const now = Date.now();
  const sqlite = db.sqlite;

  sqlite.exec("BEGIN");
  try {
    sqlite
      .prepare(
        "INSERT INTO users (address, label, created_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(address) DO UPDATE SET label = " +
          "CASE WHEN excluded.label = '' THEN users.label ELSE excluded.label END"
      )
      .run(addr, String(label || "").slice(0, 80), Number(createdAt) || now);
    if (replaceRoles) {
      sqlite.prepare("DELETE FROM user_roles WHERE address = ?").run(addr);
    }
    const grant = sqlite.prepare(
      "INSERT OR IGNORE INTO user_roles (address, role, granted_by, granted_at) VALUES (?, ?, ?, ?)"
    );
    for (const role of roles) grant.run(addr, role, grantedBy || "portal", now);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
  return addr;
}

function deleteUser(db, address) {
  return db.sqlite.prepare("DELETE FROM users WHERE address = ?").run(normalizeAddress(address))
    .changes;
}

function accessFor(db, address) {
  const roles = db.sqlite
    .prepare("SELECT role FROM user_roles WHERE address = ? ORDER BY role")
    .all(address)
    .map((row) => row.role);
  const permissions = db.sqlite
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
  const users = db.sqlite
    .prepare("SELECT address, label, created_at FROM users ORDER BY created_at")
    .all();
  const rolesStmt = db.sqlite.prepare(
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
