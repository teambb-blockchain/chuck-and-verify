// QR labels for batches and lots. A label is the batch's lookup link
// (verify-core.js batchLink) drawn as a QR code, made in the browser when
// it's needed. Nothing here is stored on chain or on the server: a lot split
// creates new lot IDs, and each new lot's label is drawn from its ID.
//
// A phone camera opens the link directly. A handheld scanner types the link
// into the lookup box, which reads the ID back out (batchFromScan).

import qrcode from "https://esm.sh/qrcode-generator@1.4.4";
import { batchLink } from "./verify-core.js";

const QUIET = 4; // modules of white border scanners need around the code
const CAPTION = 6; // room under the code for the batch ID, in modules

const escapeXml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// A standalone SVG: the code with the batch ID under it. Always black on
// white, whatever the page theme, so it prints and scans the same.
export function labelSvg(name, origin = location.origin) {
  const qr = qrcode(0, "M"); // smallest version that fits; M recovers ~15% damage
  qr.addData(batchLink(name, origin), "Byte");
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) path += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
  }
  const width = n + QUIET * 2;
  const height = width + CAPTION;
  // Monospace glyphs are ~0.6em wide; shrink long IDs to fit the label.
  const id = String(name).trim();
  const size = Math.min(3, (width * 0.9) / (0.6 * Math.max(id.length, 1)));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${escapeXml(id)}">` +
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>` +
    `<path d="${path}" fill="#000000"/>` +
    `<text x="${width / 2}" y="${width + CAPTION / 2}" font-family="'JetBrains Mono', ui-monospace, Menlo, monospace" font-size="${size.toFixed(2)}" font-weight="500" text-anchor="middle" dominant-baseline="middle" fill="#000000">${escapeXml(id)}</text>` +
    `</svg>`
  );
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "onClick") node.addEventListener("click", value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function svgNode(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup;
  return t.content.firstElementChild;
}

// A page with only the labels, opened from a click so it isn't blocked.
function printLabels(names, origin) {
  const win = window.open("", "_blank");
  if (!win) return false;
  const doc = win.document;
  doc.title = names.length === 1 ? names[0] + " label" : names.length + " labels";
  const style = doc.createElement("style");
  style.textContent =
    "body{margin:0;padding:12mm;font-family:system-ui,sans-serif;background:#fff}" +
    ".sheet{display:grid;grid-template-columns:repeat(auto-fill,50mm);gap:8mm}" +
    ".sheet svg{width:50mm;height:auto;break-inside:avoid}";
  doc.head.append(style);
  const sheet = doc.createElement("div");
  sheet.className = "sheet";
  sheet.innerHTML = names.map((n) => labelSvg(n, origin)).join("");
  doc.body.append(sheet);
  win.focus();
  win.print();
  return true;
}

// The labels for one batch or a set of new lots, each with a download, and
// a print button for all of them.
export function labelSheet(names, { origin = location.origin, note = "" } = {}) {
  const status = el("p", { className: "qr-status", role: "status", "aria-live": "polite" });
  const items = names.map((name) => {
    const markup = labelSvg(name, origin);
    const href = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    return el(
      "figure",
      { className: "qr-label" },
      svgNode(markup),
      el("a", { className: "link-btn", href, download: name + "-label.svg", text: "Download" })
    );
  });
  const many = names.length > 1;
  return el(
    "div",
    { className: "qr-sheet" },
    note ? el("p", { className: "qr-note", text: note }) : "",
    el("div", { className: "qr-grid" }, ...items),
    el("button", {
      type: "button",
      className: "btn qr-print",
      text: many ? "Print all " + names.length + " labels" : "Print label",
      onClick: () => {
        status.textContent = printLabels(names, origin) ? "" : "Allow pop-ups for this site to print labels.";
      }
    }),
    status
  );
}
