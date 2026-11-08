"use strict";

// Portal role storage. The role/permission catalog below lives in git. The
// JSON file portal.db stores only who holds which role, plus sessions.
//
// This is a portal layer: it decides what each wallet sees and which server
// routes it may call. It does not replace CredentialRegistry, which still
// decides who may write on chain (ADR 0003).

const fs = require("fs");
const path = require("path");

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

// portal.db is plain JSON, written whole on every change:
//   { "seeded": "<ISO time>",
//     "users": [ { "address": "0x...", "label": "...", "createdAt": 0, "roles": ["ADMIN"] } ],
//     "sessions": [ { "tokenHash": "...", "address": "0x...", "expiresAt": 0 } ] }
// A pasted seed is the same shape without "seeded". Sign-in challenges stay in
// memory because they last five minutes.

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

function readState(dbPath) {
  if (!fs.existsSync(dbPath)) return { users: [], sessions: [] };
  if (isSqliteFile(dbPath)) {
    throw new Error(
      "portal.db is an old SQLite file. Replace it with the portal JSON, then start again."
    );
  }
  const text = fs.readFileSync(dbPath, "utf8").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "portal.db is not valid JSON. Paste the portal JSON into that file, then start again."
    );
  }
  return {
    seeded: parsed.seeded,
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

function createStore(dbPath) {
  const state = readState(dbPath);
  const challenges = new Map();

  function save() {
    const tmp = dbPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    fs.renameSync(tmp, dbPath);
  }

  function findUser(address) {
    return state.users.find((user) => user.address === address);
  }

  function pruneSessions(now) {
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((s) => s.expiresAt > now);
    return state.sessions.length !== before;
  }

  return {
    state,
    save,
    findUser,

    sessionAddress(tokenHash, now) {
      const session = state.sessions.find(
        (s) => s.tokenHash === tokenHash && s.expiresAt > now
      );
      return session ? session.address : null;
    },
    addSession(tokenHash, address, expiresAt, now) {
      pruneSessions(now);
      state.sessions.push({ tokenHash, address, expiresAt });
      save();
    },
    deleteSession(tokenHash) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((s) => s.tokenHash !== tokenHash);
      if (state.sessions.length !== before) save();
    },

    liveChallenges(now) {
      for (const [nonce, c] of challenges) {
        if (c.expiresAt <= now) challenges.delete(nonce);
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

// Normalize what was read from disk: lower-case addresses, drop roles that
// were removed from the catalog in code, and apply a pasted seed once.
function prepareState(db) {
  const { state } = db;
  let changed = false;
  for (const user of state.users) {
    const address = normalizeAddress(user.address);
    const roles = [...new Set((user.roles || []).filter((role) => role in ROLES))].sort();
    const label = String(user.label || "").slice(0, 80);
    const createdAt = Number(user.createdAt) || Date.now();
    if (
      address !== user.address ||
      label !== user.label ||
      createdAt !== user.createdAt ||
      JSON.stringify(roles) !== JSON.stringify(user.roles)
    ) {
      Object.assign(user, { address, label, createdAt, roles });
      changed = true;
    }
  }
  if (!state.seeded && state.users.length > 0) {
    state.seeded = new Date().toISOString();
    changed = true;
  }
  if (changed) db.save();
}

function openDatabase(dataDir = resolveDataDir()) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "portal.db");
  const db = createStore(dbPath);
  prepareState(db);
  return { db, dbPath, dataDir };
}

// Apply seed.json once into this database file. A later run, and every boot,
// leave the users alone, so removing a role in the portal stays removed.
//   { "users": [ { "address": "0x...", "label": "Contract deployer", "roles": ["ADMIN"] } ] }
function seedOnce(db, seedPath) {
  if (db.state.seeded) return { applied: false };

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
      replaceRoles: false,
      deferSave: true,
    });
  }
  db.state.seeded = new Date().toISOString();
  db.save();
  return { applied: true, count: users.length };
}

function upsertUser(db, { address, label, roles, replaceRoles, deferSave }) {
  const addr = normalizeAddress(address);
  const unknown = roles.filter((role) => !(role in ROLES));
  if (unknown.length) throw new Error("Unknown role(s): " + unknown.join(", "));

  const cleanLabel = String(label || "").slice(0, 80);
  let user = db.findUser(addr);
  if (!user) {
    user = { address: addr, label: cleanLabel, createdAt: Date.now(), roles: [] };
    db.state.users.push(user);
  } else if (cleanLabel) {
    user.label = cleanLabel;
  }
  const kept = replaceRoles ? [] : user.roles;
  user.roles = [...new Set([...kept, ...roles])].sort();
  if (!deferSave) db.save();
  return addr;
}

function deleteUser(db, address) {
  const addr = normalizeAddress(address);
  const before = db.state.users.length;
  db.state.users = db.state.users.filter((user) => user.address !== addr);
  const changes = before - db.state.users.length;
  if (changes) db.save();
  return changes;
}

function accessFor(db, address) {
  const user = db.findUser(address);
  const roles = user ? [...user.roles] : [];
  const permissions = Object.keys(PERMISSIONS)
    .filter((perm) => PERMISSIONS[perm].roles.some((role) => roles.includes(role)))
    .sort();
  return { roles, permissions };
}

function listUsers(db) {
  return [...db.state.users]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((user) => ({
      address: user.address,
      label: user.label,
      createdAt: user.createdAt,
      roles: [...user.roles],
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
