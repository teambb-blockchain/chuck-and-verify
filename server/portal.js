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

const { ROLES, ORGANIZATIONS, checkOrganization, normalizeAddress } = require("./db");
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

async function createPortal(db, auth, chainIndex) {
  const sqlite = db.sqlite;
  await sqlite.exec(SCHEMA);
  const columns = await sqlite.all("PRAGMA table_info(access_requests)");
  if (!columns.some((c) => c.name === "organization")) {
    await sqlite.exec("ALTER TABLE access_requests ADD COLUMN organization TEXT NOT NULL DEFAULT ''");
  }
  const { readJson, sendJson } = auth;

  const docsFor = (address) =>
    sqlite.all(
      "SELECT batch_id, kind, cid, sha256, iv, enc_ts, original_name, created_at " +
        "FROM documents WHERE address = ? ORDER BY created_at DESC",
      address
    );
  const getRequest = (address) =>
    sqlite.get("SELECT * FROM access_requests WHERE address = ?", address);

  function requestShape(row) {
    if (!row) return null;
    return {
      address: row.address,
      roles: JSON.parse(row.roles),
      organization: row.organization || null,
      note: row.note,
      createdAt: row.created_at,
    };
  }

  async function saveDocument(user, body) {
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
    await sqlite.run(
      "INSERT OR IGNORE INTO documents (batch_id, kind, address, cid, sha256, iv, enc_ts, original_name, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      batchId, kind, user.address, b.cid, sha, b.iv, encTs, String(b.originalName || "").slice(0, 200), Date.now()
    );
  }

  async function saveRequest(user, body) {
    if (user.roles.length) throw badRequest("This wallet already has a role.");
    // An organization type implies its role, so a newcomer only has to say
    // what kind of business they are.
    const organization = String(body.organization || "");
    if (organization && !Object.hasOwn(ORGANIZATIONS, organization)) {
      throw badRequest("Unknown organization type.");
    }
    const asked = Array.isArray(body.roles) ? body.roles.map(String) : [];
    const roles = [...new Set([...(organization ? [ORGANIZATIONS[organization].role] : []), ...asked])];
    if (!roles.length) throw badRequest("Choose what kind of organization you are.");
    if (roles.some((r) => !REQUESTABLE.includes(r))) throw badRequest("That role can't be requested.");
    checkOrganization(organization, roles);
    const note = String(body.note || "").trim().slice(0, 280);
    // One transaction, so two new wallets can't both pass the cap check.
    await sqlite.transaction(async (tx) => {
      const open = (await tx.get("SELECT COUNT(*) AS n FROM access_requests")).n;
      const existing = await tx.get("SELECT 1 FROM access_requests WHERE address = ?", user.address);
      if (!existing && open >= MAX_OPEN_REQUESTS) {
        throw Object.assign(new Error("Too many open requests. Contact an admin directly."), { status: 503 });
      }
      await tx.run(
        "INSERT INTO access_requests (address, roles, organization, note, created_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(address) DO UPDATE SET roles = excluded.roles, organization = excluded.organization, " +
          "note = excluded.note, created_at = excluded.created_at",
        user.address, JSON.stringify(roles), organization, note, Date.now()
      );
    });
  }

  function clearRequest(address) {
    return sqlite.run("DELETE FROM access_requests WHERE address = ?", address);
  }

  // Attach this wallet's documents to a batch row. A lot form counts only if
  // this wallet registered the batch; an inspection report only if its
  // fingerprint is the one recorded on chain. A form published for an attempt
  // that never landed is left out. A lot shares the documents of the batch it
  // was split from, since it carries that batch's form, inspection and recall.
  function documentsFor(batch, docs, me) {
    const out = [];
    const ids = [batch.batchId, batch.parentId];
    const pick = (kind, ok) => {
      const d = docs.find((x) => ids.includes(x.batch_id) && x.kind === kind && ok(x));
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
      parentId: batch.parentId,
      lotCount: batch.lotIds.length,
      documents: documentsFor(batch, docs, me),
    };
  }

  async function dashboard(user) {
    const me = user.address;
    const chain = await chainIndex.fresh();
    const batches = batchesFrom(await chainIndex.events());
    const docs = await docsFor(me);
    const has = (role) => user.roles.includes(role);
    const out = {
      address: me,
      roles: user.roles,
      organization: user.organization || null,
      chain,
      request: user.roles.length ? null : requestShape(await getRequest(me)),
      views: {},
    };
    const newestFirst = (a, b) => (b.lastMovedAt || 0) - (a.lastMovedAt || 0);
    // A split batch lives on as its lots. Counts of product in hand skip it,
    // so a split never counts the same beef twice.
    const notSplit = (b) => b.lotIds.length === 0;

    if (has("INSPECTOR")) {
      // Lots are inspected through their parent batch, so they are never
      // waiting and never count as an inspection of their own.
      const mine = batches.filter((b) => b.inspector === me && !b.parentId);
      const waiting = batches.filter(
        (b) => !b.inspected && !b.recalled && b.processor !== me && !b.parentId
      );
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
        registered: mine.filter((b) => !b.parentId).length,
        inCustody: mine.filter((b) => b.holder === me && notSplit(b)).length,
        recalled: mine.filter((b) => b.recalled && notSplit(b)).length,
        rows: mine.map((b) => row(b, me, docs)).sort(newestFirst),
      };
    }
    if (has("CUSTODIAN")) {
      const held = batches.filter((b) => b.holder === me && notSplit(b));
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
        users: (await sqlite.get("SELECT COUNT(*) AS n FROM users")).n,
        requests: (await sqlite.get("SELECT COUNT(*) AS n FROM access_requests")).n,
      };
    }
    return out;
  }

  async function handle(req, res, urlPath) {
    const routes = ["/api/dashboard", "/api/documents", "/api/access-request"];
    const adminRoute = urlPath === "/api/admin/requests" || urlPath.startsWith("/api/admin/requests/");
    if (!routes.includes(urlPath) && !adminRoute) return false;

    try {
      const user = await auth.currentUser(req);
      if (!user.address) return sendJson(res, 401, { error: "Sign in first." }), true;

      if (adminRoute) {
        if (!auth.can(user, "users.manage")) {
          return sendJson(res, 403, { error: "Requires the ADMIN role." }), true;
        }
        if (urlPath === "/api/admin/requests" && req.method === "GET") {
          // A wallet that has since been given a role no longer needs its request.
          await sqlite.exec(
            "DELETE FROM access_requests WHERE address IN (SELECT address FROM user_roles)"
          );
          const rows = await sqlite.all("SELECT * FROM access_requests ORDER BY created_at");
          return sendJson(res, 200, { requests: rows.map(requestShape) }), true;
        }
        const target = urlPath.slice("/api/admin/requests/".length);
        if (target && req.method === "DELETE") {
          await clearRequest(normalizeAddress(target));
          return sendJson(res, 200, { ok: true }), true;
        }
        return sendJson(res, 405, { error: "Method not allowed." }), true;
      }

      if (urlPath === "/api/dashboard" && req.method === "GET") {
        return sendJson(res, 200, await dashboard(user)), true;
      }
      if (urlPath === "/api/documents" && req.method === "POST") {
        await saveDocument(user, await readJson(req));
        return sendJson(res, 200, { ok: true }), true;
      }
      if (urlPath === "/api/access-request" && req.method === "POST") {
        await saveRequest(user, await readJson(req));
        return sendJson(res, 200, { request: requestShape(await getRequest(user.address)) }), true;
      }
      if (urlPath === "/api/access-request" && req.method === "DELETE") {
        await clearRequest(user.address);
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
