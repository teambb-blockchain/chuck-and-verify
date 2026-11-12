// Give every frontend asset a content-hashed URL so a deploy can't be mixed
// with stale copies. teambb.didlab.org serves the repo root, so index.html is
// `/` and the modules live under /frontend/public/. Cloudflare caches .js/.css
// for 4 hours (browser and edge) while the HTML is fetched fresh; without
// this, a new index.html can run old modules.
//
// Rewrites index.html in place:
//   - <link rel="stylesheet" href="/frontend/public/styles.css?v=<hash>">
//   - <script type="module" src="/frontend/public/app.js?v=<hash>">
//   - an import map remapping "/frontend/public/x.js" to
//     "/frontend/public/x.js?v=<hash>", so imports between modules get the
//     versioned URL too (a ?v= on app.js alone would not).
//     The keys must be the full path. A module at /frontend/public/a.js
//     resolves `import "./x.js"` to /frontend/public/x.js before the map is
//     consulted, while a "./x.js" key resolves against the page (`/`) to
//     /x.js and never matches. With "./x.js" keys, every module but app.js
//     loaded unversioned, and a stale cached chain.js broke the deployed page.
// Each hash covers one file, so only changed files get a new URL.
//
// Run before each deploy: npm run stamp

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "frontend", "public");
const htmlPath = path.join(root, "index.html");
const assetRoot = "/frontend/public";
const START = "<!-- asset-versions:start -->";
const END = "<!-- asset-versions:end -->";

const hashOf = (file) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(publicDir, file)))
    .digest("hex")
    .slice(0, 10);

const modules = fs
  .readdirSync(publicDir)
  .filter((f) => f.endsWith(".js"))
  .sort();
const versions = Object.fromEntries(modules.map((f) => [f, hashOf(f)]));
const cssVersion = hashOf("styles.css");

const importMap = {
  imports: Object.fromEntries(
    modules.map((f) => [`${assetRoot}/${f}`, `${assetRoot}/${f}?v=${versions[f]}`])
  )
};
const block =
  `${START}\n  <script type="importmap">\n` +
  JSON.stringify(importMap, null, 2)
    .split("\n")
    .map((line) => "  " + line)
    .join("\n") +
  `\n  </script>\n  ${END}`;

let html = fs.readFileSync(htmlPath, "utf8");

const replaceOnce = (pattern, replacement, what) => {
  if (!pattern.test(html)) throw new Error(`index.html: ${what} not found`);
  html = html.replace(pattern, replacement);
};

replaceOnce(
  /href="(?:\.|\/frontend\/public)\/styles\.css(\?v=[0-9a-f]+)?"/,
  `href="${assetRoot}/styles.css?v=${cssVersion}"`,
  "styles.css link"
);
replaceOnce(
  /<script type="module" src="(?:\.|\/frontend\/public)\/app\.js(\?v=[0-9a-f]+)?"><\/script>/,
  `<script type="module" src="${assetRoot}/app.js?v=${versions["app.js"]}"></script>`,
  "app.js module script"
);

// The import map must come before the first module script, so it lives in
// <head> right after the stylesheet.
const existing = new RegExp(`${START}[\\s\\S]*?${END}`);
if (existing.test(html)) {
  html = html.replace(existing, block);
} else {
  replaceOnce(
    /(<link rel="stylesheet" href="\/frontend\/public\/styles\.css\?v=[0-9a-f]+">)/,
    `$1\n  ${block}`,
    "stylesheet link for import map"
  );
}

fs.writeFileSync(htmlPath, html);
console.log("Stamped index.html:");
for (const f of modules) console.log(`  ${f}?v=${versions[f]}`);
console.log(`  styles.css?v=${cssVersion}`);
