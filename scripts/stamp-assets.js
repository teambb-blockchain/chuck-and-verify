// Give every frontend asset a content-hashed URL so a deploy can't be mixed
// with stale copies. teambb.didlab.org serves frontend/public through
// Cloudflare, which caches .js/.css for 4 hours (browser and edge) while the
// HTML is fetched fresh; without this, a new index.html can run old modules.
//
// Rewrites frontend/public/index.html in place:
//   - <link rel="stylesheet" href="./styles.css?v=<hash>">
//   - <script type="module" src="./app.js?v=<hash>">
//   - an import map remapping every "./x.js" to "./x.js?v=<hash>", which also
//     covers the imports between modules (a ?v= on app.js alone would not).
// Each hash covers one file, so only changed files get a new URL.
//
// Run before each deploy: npm run stamp

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const publicDir = path.join(__dirname, "..", "frontend", "public");
const htmlPath = path.join(publicDir, "index.html");
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
    modules.map((f) => [`./${f}`, `./${f}?v=${versions[f]}`])
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
  /href="\.\/styles\.css(\?v=[0-9a-f]+)?"/,
  `href="./styles.css?v=${cssVersion}"`,
  "styles.css link"
);
replaceOnce(
  /<script type="module" src="\.\/app\.js(\?v=[0-9a-f]+)?"><\/script>/,
  `<script type="module" src="./app.js?v=${versions["app.js"]}"></script>`,
  "app.js module script"
);

// The import map must come before the first module script, so it lives in
// <head> right after the stylesheet.
const existing = new RegExp(`${START}[\\s\\S]*?${END}`);
if (existing.test(html)) {
  html = html.replace(existing, block);
} else {
  replaceOnce(
    /(<link rel="stylesheet" href="\.\/styles\.css\?v=[0-9a-f]+">)/,
    `$1\n  ${block}`,
    "stylesheet link for import map"
  );
}

fs.writeFileSync(htmlPath, html);
console.log("Stamped index.html:");
for (const f of modules) console.log(`  ${f}?v=${versions[f]}`);
console.log(`  styles.css?v=${cssVersion}`);
