const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { openDatabase } = require("./server/db");
const { createAuth } = require("./server/auth");

const root = __dirname;
const publicDir = path.join(root, "frontend", "public");
const port = Number(process.env.PORT) || 3000;

// The portal does not send Access-Control-Allow-Origin, so the browser
// cannot POST ciphertext to it from this page. This process forwards one
// path and nothing else.
const IPFS_ADD_URL = "https://blockchain.didlab.org/api/ipfs/add";
const MAX_UPLOAD_BYTES = 26 * 1024 * 1024;

// Portal roles live in portal.db. Seed that file once before deploy
// (npm run seed:portal). Boot does not read a seed file.
const { db, dbPath } = openDatabase();
const auth = createAuth(db);

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
  if (rel === "/frontend/public" || rel === "/frontend/public/") {
    rel = "/index.html";
  } else if (rel.startsWith("/frontend/public/")) {
    rel = rel.slice("/frontend/public".length) || "/index.html";
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

async function serve(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (urlPath.startsWith("/api/") && (await auth.handle(req, res, urlPath))) {
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
    const user = auth.currentUser(req);
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
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(serve);

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving project page on port ${port}`);
  console.log(`Portal database: ${dbPath}`);
});
