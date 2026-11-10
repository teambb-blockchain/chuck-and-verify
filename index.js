const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { openDatabase } = require("./server/db");
const { createAuth } = require("./server/auth");
const { createChainIndex } = require("./server/chainIndex");
const { createPortal } = require("./server/portal");

const root = __dirname;
const publicDir = path.join(root, "frontend", "public");
const port = Number(process.env.PORT) || 3000;

// The portal does not send Access-Control-Allow-Origin, so the browser
// cannot POST ciphertext to it from this page. This process forwards one
// path and nothing else.
const IPFS_ADD_URL = "https://blockchain.didlab.org/api/ipfs/add";
const MAX_UPLOAD_BYTES = 26 * 1024 * 1024;

// Portal roles live in a SQLite portal.db. Seed that file once before deploy
// (npm run seed:portal). A pasted JSON portal.db is converted on first boot.
// Boot does not read a seed file.
// Opening the database is async (npm sqlite3), so these are set in start()
// before the server listens.
let auth;
let chainIndex;
let portal;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

function isInside(dir, filePath) {
  const resolved = path.resolve(filePath);
  return resolved === dir || resolved.startsWith(dir + path.sep);
}

function fileInPublic(requestPath) {
  let rel = requestPath;
  if (rel.startsWith("/frontend/public/")) {
    rel = rel.slice("/frontend/public".length) || "/";
  }
  if (rel.endsWith("/")) {
    rel += "index.html";
  }
  const filePath = path.resolve(publicDir, "." + rel);
  if (!isInside(publicDir, filePath)) {
    return null;
  }
  return filePath;
}

function resolveFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  // nginx serves this file for `/`. Node does the same, and keeps the
  // scripts and styles in frontend/public, which is where `./x.js` imports
  // are rewritten to.
  if (decoded === "/" || decoded === "/index.html") {
    return path.join(root, "index.html");
  }
  const candidate = fileInPublic(decoded);
  if (!candidate) {
    return null;
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return null;
  }
  return candidate;
}

function proxyIpfsAdd(req, res) {
  const chunks = [];
  let received = 0;
  let rejected = false;

  req.on("data", (chunk) => {
    if (rejected) return;
    received += chunk.length;
    if (received > MAX_UPLOAD_BYTES) {
      rejected = true;
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload is larger than 25 MB." }));
      req.destroy();
    } else {
      chunks.push(chunk);
    }
  });

  req.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload failed." }));
    }
  });

  req.on("end", () => {
    if (rejected || res.headersSent) return;

    const contentType = req.headers["content-type"];
    if (!contentType) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Upload is missing a body." }));
      return;
    }

    const body = Buffer.concat(chunks);
    const target = new URL(IPFS_ADD_URL);
    const upstream = https.request(
      {
        method: "POST",
        hostname: target.hostname,
        path: target.pathname,
        headers: {
          "content-type": contentType,
          "content-length": body.length,
        },
      },
      (upstreamResponse) => {
        const responseChunks = [];
        upstreamResponse.on("data", (chunk) => responseChunks.push(chunk));
        upstreamResponse.on("end", () => {
          if (res.headersSent) return;
          res.writeHead(upstreamResponse.statusCode || 502, {
            "Content-Type":
              upstreamResponse.headers["content-type"] || "application/json",
          });
          res.end(Buffer.concat(responseChunks));
        });
      }
    );

    upstream.on("error", () => {
      if (res.headersSent) return;
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "IPFS portal is unreachable." }));
    });
    upstream.end(body);
  });
}

// The DIDLab container's nginx forwards /api/ with `proxy_pass .../;`, which
// strips the prefix: /api/me arrives here as /me. Put it back for the API
// routes only. None of these collide with a file in frontend/public.
const STRIPPED_API_ROUTE =
  /^\/(me|auth\/[a-z]+|admin\/(users|requests)(\/.*)?|ipfs\/add|dashboard|documents|access-request)$/;

function withApiPrefix(urlPath) {
  return STRIPPED_API_ROUTE.test(urlPath) ? "/api" + urlPath : urlPath;
}

async function serve(req, res) {
  let urlPath;
  try {
    urlPath = withApiPrefix(decodeURIComponent((req.url || "/").split("?")[0]));
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (urlPath.startsWith("/api/") && (await auth.handle(req, res, urlPath))) {
    return;
  }
  if (urlPath.startsWith("/api/") && (await portal.handle(req, res, urlPath))) {
    return;
  }

  if (urlPath === "/api/ipfs/add") {
    if (req.method !== "POST") {
      res.writeHead(405, {
        Allow: "POST",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Method not allowed");
      return;
    }
    const user = await auth.currentUser(req);
    if (!auth.can(user, "form.upload")) {
      auth.sendJson(res, user.address ? 403 : 401, {
        error: user.address
          ? "Publishing forms requires the PROCESSOR or INSPECTOR role."
          : "Sign in before publishing a form.",
      });
      req.resume();
      return;
    }
    proxyIpfsAdd(req, res);
    return;
  }

  let filePath;
  try {
    filePath = resolveFile(req.url || "/");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const type = types[path.extname(filePath)] || "application/octet-stream";
    // No page here is meant to be framed (the admin card sends transactions),
    // and every file has an explicit type (SECURITY_REVIEW P-6).
    res.writeHead(200, {
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(data);
  });
}

async function start() {
  const { db, dbPath } = await openDatabase(undefined, {
    onBroken(error) {
      console.error(error, error.cause);
      process.exit(1); // the supervisor restarts Node on a fresh connection
    },
  });
  auth = createAuth(db);
  // Copies BeefSupplyChain events into portal.db for the role dashboards.
  chainIndex = await createChainIndex(db);
  portal = await createPortal(db, auth, chainIndex);

  // A failed query must answer 500, not reject unhandled: Node exits on that.
  const server = http.createServer((req, res) =>
    serve(req, res).catch((error) => {
      console.error(error);
      if (res.writableEnded) return;
      if (res.headersSent) {
        // Part of a reply is out; appending text would corrupt it.
        res.destroy();
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
    })
  );
  server.listen(port, "0.0.0.0", () => {
    console.log(`Serving project page on port ${port}`);
    console.log(`Portal database: ${dbPath}`);
    chainIndex.sync();
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
