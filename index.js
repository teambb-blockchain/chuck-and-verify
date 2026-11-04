const http = require("http");
const fs = require("fs");
const path = require("path");

// Repo root is the nginx docroot on DIDLab. Only the public page paths are
// exposed here so `npm start` does not serve .env, contracts, or node_modules.
const root = __dirname;
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

const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/frontend", path.join("frontend", "index.html")],
  ["/frontend/", path.join("frontend", "index.html")],
  ["/frontend/index.html", path.join("frontend", "index.html")],
]);

function resolveFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const relative = PUBLIC_FILES.get(decoded);
  if (!relative) {
    return null;
  }
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    return null;
  }
  return filePath;
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
