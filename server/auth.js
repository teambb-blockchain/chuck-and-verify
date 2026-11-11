"use strict";

// Wallet sign-in (Sign-In with Ethereum style) and portal API routes.
// The server writes the exact message to sign and stores it with a one-time
// nonce, so it never parses a message the client wrote.

const crypto = require("crypto");
const { recoverPersonalSignAddress } = require("./ethsig");
const {
  ROLES,
  PERMISSIONS,
  ORGANIZATIONS,
  normalizeAddress,
  upsertUser,
  deleteUser,
  accessFor,
  listUsers,
} = require("./db");

const CHAIN_ID = 252501;
const COOKIE = "cv_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_LIVE_CHALLENGES = 10000;
const MAX_JSON_BYTES = 16 * 1024;

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    // Requiring a JSON content type means a plain cross-site <form> cannot
    // reach these routes.
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
      reject(Object.assign(new Error("Expected application/json."), { status: 415 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(Object.assign(new Error("Body too large."), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON."), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Public sites the portal is served from. Override with a comma-separated
// PORTAL_ORIGINS, e.g. "https://teambb.didlab.org,https://other.example".
// Entries that are not a valid http(s) origin are dropped.
const PUBLIC_ORIGINS = (process.env.PORTAL_ORIGINS || "https://teambb.didlab.org")
  .split(",")
  .map((entry) => {
    try {
      const url = new URL(entry.trim());
      return /^https?:$/.test(url.protocol) ? url.origin : null;
    } catch {
      return null;
    }
  })
  .filter(Boolean);

function isLocalHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

// The site the browser is on, as { host, scheme }. Used for the domain in the
// sign-in message and for the cookie's Secure flag.
//
// The DIDLab container's nginx proxies without forwarding Host, so requests
// arrive as Host: 127.0.0.1:3000. In that case the browser's Origin header
// names the real site, but it is only trusted when it is on PUBLIC_ORIGINS.
// Otherwise a look-alike site relaying requests here could get a message
// carrying its own domain, which the wallet would then not warn about.
//
// Host and X-Forwarded-Host are client-controlled too: the DIDLab proxy chain
// passes a client's X-Forwarded-Host through unchanged. A non-local host is
// therefore only used when it is on PUBLIC_ORIGINS; anything else gets the
// first public origin, so a relaying site's domain never reaches the message
// (SECURITY_REVIEW P-1).
function siteFromOrigin(origin) {
  const url = new URL(origin); // safe: equal to a parsed entry above
  return { host: url.host, scheme: url.protocol.slice(0, -1) };
}

function requestSite(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost")
    .split(",")[0]
    .trim();
  if (!isLocalHost(host)) {
    const listed = PUBLIC_ORIGINS.find((origin) => new URL(origin).host === host);
    if (listed) return siteFromOrigin(listed);
    if (PUBLIC_ORIGINS.length) return siteFromOrigin(PUBLIC_ORIGINS[0]);
    return { host: "localhost", scheme: "https" };
  }
  const origin = String(req.headers.origin || "");
  if (PUBLIC_ORIGINS.includes(origin)) return siteFromOrigin(origin);
  return { host, scheme: "http" };
}

function sessionCookie(req, token, maxAgeSeconds) {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (requestSite(req).scheme === "https") parts.push("Secure");
  return parts.join("; ");
}

function createAuth(db) {
  // Returns { address, roles, permissions } for the request, or a signed-out
  // shape. Roles are read from the database on every request, so a change
  // made by an admin applies immediately to sessions that are already open.
  async function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const address = await db.sessionAddress(sha256(token), Date.now());
      if (address) return { address, ...(await accessFor(db, address)) };
    }
    return { address: null, roles: [], permissions: [], organization: null };
  }

  function can(user, permission) {
    return user.permissions.includes(permission);
  }

  function challenge(req, body) {
    const address = normalizeAddress(body.address);
    const now = Date.now();
    if (db.liveChallenges(now) >= MAX_LIVE_CHALLENGES) {
      throw Object.assign(new Error("Too many sign-in attempts. Try again shortly."), {
        status: 503,
      });
    }
    const { host, scheme } = requestSite(req);
    const nonce = crypto.randomBytes(16).toString("hex");
    // EIP-4361 layout, so wallets that understand SIWE can check the domain.
    const message = [
      `${host} wants you to sign in with your Ethereum account:`,
      address,
      "",
      "Sign in to Chuck and Verify. This does not send a transaction or cost gas.",
      "",
      `URI: ${scheme}://${host}`,
      "Version: 1",
      `Chain ID: ${CHAIN_ID}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expiration Time: ${new Date(now + CHALLENGE_TTL_MS).toISOString()}`,
    ].join("\n");
    db.addChallenge(nonce, { address, message, expiresAt: now + CHALLENGE_TTL_MS });
    return { nonce, message };
  }

  async function verify(body) {
    const nonce = String(body.nonce || "");
    // Single use: removed before checking anything else.
    const row = db.takeChallenge(nonce);
    if (!row || row.expiresAt <= Date.now()) {
      throw Object.assign(new Error("Sign-in request expired. Try again."), { status: 401 });
    }
    let signer;
    try {
      signer = recoverPersonalSignAddress(row.message, body.signature);
    } catch {
      throw Object.assign(new Error("Signature could not be verified."), { status: 401 });
    }
    if (signer !== row.address) {
      throw Object.assign(new Error("Signature is from a different wallet."), {
        status: 401,
      });
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const now = Date.now();
    await db.addSession(sha256(token), signer, now + SESSION_TTL_MS, now);
    return { token, user: { address: signer, ...(await accessFor(db, signer)) } };
  }

  async function logout(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await db.deleteSession(sha256(token));
  }

  // Handles /api/auth/*, /api/me and /api/admin/*. Returns false when the
  // path is not one of these, so the caller can keep routing.
  async function handle(req, res, urlPath) {
    try {
      if (urlPath === "/api/me" && req.method === "GET") {
        sendJson(res, 200, await currentUser(req));
        return true;
      }
      if (urlPath === "/api/auth/challenge" && req.method === "POST") {
        sendJson(res, 200, challenge(req, await readJson(req)));
        return true;
      }
      if (urlPath === "/api/auth/verify" && req.method === "POST") {
        const { token, user } = await verify(await readJson(req));
        sendJson(res, 200, user, {
          "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000),
        });
        return true;
      }
      if (urlPath === "/api/auth/logout" && req.method === "POST") {
        await logout(req);
        sendJson(res, 200, { address: null, roles: [], permissions: [] }, {
          "Set-Cookie": sessionCookie(req, "", 0),
        });
        return true;
      }

      if (urlPath === "/api/admin/users" || urlPath.startsWith("/api/admin/users/")) {
        const user = await currentUser(req);
        if (!user.address) return sendJson(res, 401, { error: "Sign in first." }), true;
        if (!can(user, "users.manage")) {
          return sendJson(res, 403, { error: "Requires the ADMIN role." }), true;
        }
        const target = urlPath.slice("/api/admin/users/".length);

        if (urlPath === "/api/admin/users" && req.method === "GET") {
          sendJson(res, 200, {
            users: await listUsers(db),
            roles: Object.entries(ROLES).map(([name, description]) => ({
              name,
              description,
              permissions: Object.keys(PERMISSIONS).filter((p) =>
                PERMISSIONS[p].roles.includes(name)
              ),
            })),
            organizations: Object.entries(ORGANIZATIONS).map(([key, o]) => ({ key, ...o })),
          });
          return true;
        }
        if (target && req.method === "PUT") {
          const body = await readJson(req);
          const address = normalizeAddress(target);
          const roles = Array.isArray(body.roles) ? body.roles.map(String) : [];
          if (address === user.address && !roles.includes("ADMIN")) {
            return sendJson(res, 400, { error: "You cannot remove your own ADMIN role." }), true;
          }
          await upsertUser(db, {
            address,
            label: body.label,
            roles,
            organization: body.organization === undefined ? undefined : String(body.organization || ""),
            grantedBy: user.address,
            replaceRoles: true,
          });
          sendJson(res, 200, { users: await listUsers(db) });
          return true;
        }
        if (target && req.method === "DELETE") {
          const address = normalizeAddress(target);
          if (address === user.address) {
            return sendJson(res, 400, { error: "You cannot delete yourself." }), true;
          }
          await deleteUser(db, address);
          sendJson(res, 200, { users: await listUsers(db) });
          return true;
        }
        sendJson(res, 405, { error: "Method not allowed." });
        return true;
      }
    } catch (error) {
      const status = error.status || (/valid 0x address|Unknown role/.test(error.message) ? 400 : 500);
      if (status === 500) console.error(error);
      sendJson(res, status, { error: status === 500 ? "Server error." : error.message });
      return true;
    }
    return false;
  }

  return { handle, currentUser, can, sendJson, readJson };
}

module.exports = { createAuth };
