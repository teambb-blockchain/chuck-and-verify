"use strict";

// Role dashboards, document records and access requests.
//
//   GET    /api/dashboard           what this wallet can do, plus its role views
//   POST   /api/documents           remember a form this wallet published
//   POST   /api/access-request      a wallet with no role asks for one
//   DELETE /api/access-request      withdraw it
//   GET    /api/admin/requests      ADMIN: open requests
//   DELETE /api/admin/requests/:a   ADMIN: dismiss one
//
// A document row holds what the uploader needs to reopen their own encrypted
// form (CID, IV, the timestamp in the message they signed). It never holds
// the key: that is derived from a fresh wallet signature in the browser.

const { ROLES, normalizeAddress } = require("./db");
const { batchesFrom } = require("./chainIndex");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY,
  batch_id      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('lot', 'inspection', 'recall')),
  address       TEXT NOT NULL,
  cid           TEXT NOT NULL,
  sha256        TEXT NOT NULL,
  iv            TEXT NOT NULL,
  enc_ts        INTEGER NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  UNIQUE (batch_id, kind, address, cid)
);
CREATE TABLE IF NOT EXISTS access_requests (
  address    TEXT PRIMARY KEY,
  roles      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

const KIND_PERMISSION = {
  lot: "batch.register",
  inspection: "batch.inspect",
  recall: "batch.recall",
};
const REQUESTABLE = ["PROCESSOR", "INSPECTOR", "CUSTODIAN"];
const MAX_OPEN_REQUESTS = 500;

const CID_RE = /^[A-Za-z0-9]{1,128}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const IV_RE = /^[A-Za-z0-9+/]{16}$/; // 12 bytes, base64

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function createPortal(db, auth, chainIndex) {
  const sqlite = db.sqlite;
  sqlite.exec(SCHEMA);
  const { readJson, sendJson } = auth;

  const docsFor = sqlite.prepare(
    "SELECT batch_id, kind, cid, sha256, iv, enc_ts, original_name, created_at " +
      "FROM documents WHERE address = ? ORDER BY created_at DESC"
  );
  const getRequest = sqlite.prepare("SELECT * FROM access_requests WHERE address = ?");

  function requestShape(row) {
    if (!row) return null;
    return {
      address: row.address,
      roles: JSON.parse(row.roles),
      note: row.note,
      createdAt: row.created_at,
    };
  }

  function saveDocument(user, body) {
    const kind = String(body.kind || "");
    if (!(kind in KIND_PERMISSION)) throw badRequest("Unknown document kind.");
    if (!auth.can(user, KIND_PERMISSION[kind])) {
      throw Object.assign(new Error("Your role can't file this kind of form."), { status: 403 });
    }
    const batchId = String(body.batchId || "").trim();
    if (!batchId || Buffer.byteLength(batchId) > 31) throw badRequest("Batch ID is missing.");
    const b = body.bundle || {};
    if (String(b.address || "").toLowerCase() !== user.address) {
      throw Object.assign(new Error("This form was published by a different wallet."), { status: 403 });
    }
    const sha = String(b.ciphertextSha256 || "").toLowerCase();
    if (!CID_RE.test(b.cid || "") || !SHA_RE.test(sha) || !IV_RE.test(b.iv || "")) {
      throw badRequest("The form receipt is incomplete.");
    }
    const encTs = Number(b.timestamp);
    if (!Number.isSafeInteger(encTs) || encTs <= 0) throw badRequest("The form receipt is incomplete.");
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO documents (batch_id, kind, address, cid, sha256, iv, enc_ts, original_name, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(batchId, kind, user.address, b.cid, sha, b.iv, encTs, String(b.originalName || "").slice(0, 200), Date.now());
  }

  function saveRequest(user, body) {
    if (user.roles.length) throw badRequest("This wallet already has a role.");
    const roles = Array.isArray(body.roles) ? [...new Set(body.roles.map(String))] : [];
    if (!roles.length) throw badRequest("Choose at least one role.");
    if (roles.some((r) => !REQUESTABLE.includes(r))) throw badRequest("That role can't be requested.");
    const note = String(body.note || "").trim().slice(0, 280);
    const open = sqlite.prepare("SELECT COUNT(*) AS n FROM access_requests").get().n;
    if (!getRequest.get(user.address) && open >= MAX_OPEN_REQUESTS) {
      throw Object.assign(new Error("Too many open requests. Contact an admin directly."), { status: 503 });
    }
    sqlite
      .prepare(
        "INSERT INTO access_requests (address, roles, note, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(address) DO UPDATE SET roles = excluded.roles, note = excluded.note, created_at = excluded.created_at"
      )
      .run(user.address, JSON.stringify(roles), note, Date.now());
  }

  function clearRequest(address) {
    sqlite.prepare("DELETE FROM access_requests WHERE address = ?").run(address);
  }

  // Attach this wallet's documents to a batch row. A lot form counts only if
  // this wallet registered the batch; an inspection report only if its
  // fingerprint is the one recorded on chain. A form published for an attempt
  // that never landed is left out.
  function documentsFor(batch, docs, me) {
    const out = [];
    const pick = (kind, ok) => {
      const d = docs.find((x) => x.batch_id === batch.batchId && x.kind === kind && ok(x));
      if (d) {
        out.push({
          kind,
          cid: d.cid,
          iv: d.iv,
          timestamp: d.enc_ts,
          name: d.original_name,
        });
      }
    };
    if (batch.processor === me) pick("lot", () => true);
    if (batch.inspector === me) pick("inspection", (d) => d.sha256 === batch.reportHash);
    if (batch.recalled && batch.processor === me) pick("recall", (d) => d.sha256 === batch.recallHash);
    return out;
  }

  function row(batch, me, docs) {
    return {
      batchId: batch.batchId,
      weightLbs: batch.weightLbs,
      registeredAt: batch.registeredAt,
      processorIsYou: batch.processor === me,
      holderIsYou: batch.holder === me,
      incomingToYou: batch.pendingReceiver === me,
      inTransit: Boolean(batch.pendingReceiver),
      inspected: batch.inspected,
      passed: batch.passed,
      inspectedAt: batch.inspectedAt,
      inspectedByYou: batch.inspector === me,
      recalled: batch.recalled,
      recallClass: batch.recallClass,
      recalledAt: batch.recalledAt,
      lastMovedAt: batch.receivedAt || batch.shippedAt || batch.registeredAt,
      documents: documentsFor(batch, docs, me),
    };
  }

  async function dashboard(user) {
    const me = user.address;
    const chain = await chainIndex.fresh();
    const batches = batchesFrom(chainIndex.events());
    const docs = docsFor.all(me);
    const has = (role) => user.roles.includes(role);
    const out = {
      address: me,
      roles: user.roles,
      chain,
      request: user.roles.length ? null : requestShape(getRequest.get(me)),
      views: {},
    };
    const newestFirst = (a, b) => (b.lastMovedAt || 0) - (a.lastMovedAt || 0);

    if (has("INSPECTOR")) {
      const mine = batches.filter((b) => b.inspector === me);
      const waiting = batches.filter((b) => !b.inspected && !b.recalled && b.processor !== me);
      out.views.INSPECTOR = {
        inspected: mine.length,
        waiting: waiting.length,
        rows: [...waiting, ...mine].map((b) => row(b, me, docs)).sort((a, b) =>
          a.inspected === b.inspected ? newestFirst(a, b) : a.inspected ? 1 : -1
        ),
      };
    }
    if (has("PROCESSOR")) {
      const mine = batches.filter((b) => b.processor === me);
      out.views.PROCESSOR = {
        registered: mine.length,
        inCustody: mine.filter((b) => b.holder === me).length,
        recalled: mine.filter((b) => b.recalled).length,
        rows: mine.map((b) => row(b, me, docs)).sort(newestFirst),
      };
    }
    if (has("CUSTODIAN")) {
      const held = batches.filter((b) => b.holder === me);
      const incoming = batches.filter((b) => b.pendingReceiver === me);
      const touched = batches.filter(
        (b) => b.holder === me || b.pendingReceiver === me || b.handlers.has(me)
      );
      out.views.CUSTODIAN = {
        inCustody: held.length,
        incoming: incoming.length,
        recalledInCustody: held.filter((b) => b.recalled).length,
        rows: touched.map((b) => row(b, me, docs)).sort(newestFirst),
      };
    }
    if (has("ADMIN")) {
      out.views.ADMIN = {
        users: sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n,
        requests: sqlite.prepare("SELECT COUNT(*) AS n FROM access_requests").get().n,
      };
    }
    return out;
  }

  async function handle(req, res, urlPath) {
    const routes = ["/api/dashboard", "/api/documents", "/api/access-request"];
    const adminRoute = urlPath === "/api/admin/requests" || urlPath.startsWith("/api/admin/requests/");
    if (!routes.includes(urlPath) && !adminRoute) return false;

    try {
      const user = auth.currentUser(req);
      if (!user.address) return sendJson(res, 401, { error: "Sign in first." }), true;

      if (adminRoute) {
        if (!auth.can(user, "users.manage")) {
          return sendJson(res, 403, { error: "Requires the ADMIN role." }), true;
        }
        if (urlPath === "/api/admin/requests" && req.method === "GET") {
          // A wallet that has since been given a role no longer needs its request.
          sqlite.exec(
            "DELETE FROM access_requests WHERE address IN (SELECT address FROM user_roles)"
          );
          const rows = sqlite.prepare("SELECT * FROM access_requests ORDER BY created_at").all();
          return sendJson(res, 200, { requests: rows.map(requestShape) }), true;
        }
        const target = urlPath.slice("/api/admin/requests/".length);
        if (target && req.method === "DELETE") {
          clearRequest(normalizeAddress(target));
          return sendJson(res, 200, { ok: true }), true;
        }
        return sendJson(res, 405, { error: "Method not allowed." }), true;
      }

      if (urlPath === "/api/dashboard" && req.method === "GET") {
        return sendJson(res, 200, await dashboard(user)), true;
      }
      if (urlPath === "/api/documents" && req.method === "POST") {
        saveDocument(user, await readJson(req));
        return sendJson(res, 200, { ok: true }), true;
      }
      if (urlPath === "/api/access-request" && req.method === "POST") {
        saveRequest(user, await readJson(req));
        return sendJson(res, 200, { request: requestShape(getRequest.get(user.address)) }), true;
      }
      if (urlPath === "/api/access-request" && req.method === "DELETE") {
        clearRequest(user.address);
        return sendJson(res, 200, { request: null }), true;
      }
      return sendJson(res, 405, { error: "Method not allowed." }), true;
    } catch (error) {
      const status = error.status || (/valid 0x address/.test(error.message) ? 400 : 500);
      if (status === 500) console.error(error);
      sendJson(res, status, { error: status === 500 ? "Server error." : error.message });
      return true;
    }
  }

  return { handle, clearRequest };
}

module.exports = { createPortal, REQUESTABLE, ROLES };
