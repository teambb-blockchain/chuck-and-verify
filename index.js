const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const publicDir = path.join(root, "frontend", "public");
const port = Number(process.env.PORT) || 3000;

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

function serve(req, res) {
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
});
