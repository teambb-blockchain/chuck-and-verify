// Consumer verify flow: the lookup page, the result page, the network pill
// and the illustration carousel. Everything here is read-only and works
// without a wallet; it reads DIDLab through chain.js's public client.
//
// Routes: `/` is the lookup page, `/?batch=<id>` is a batch result, so a
// batch result can be linked to directly. `/?page=about` and `/?page=team`
// are the info pages. `/?page=work` is the signed-in workspace, and
// `/?page=work&task=` opens one handler task. (A query string rather than a
// /verify/<id> path because the DIDLab host's nginx serves `/` and the static
// files itself; a new path would need a proxy rule there.)

import {
  stringToHex,
  hexToString,
  decodeEventLog,
  encodeEventTopics,
  toHex,
  keccak256,
  BaseError,
  ContractFunctionRevertedError
} from "https://esm.sh/viem@2";
import { abi } from "./abi.js";
import { registryAbi } from "./registryAbi.js";
import {
  EXPLORER_BASE,
  REQUIRED_CHAIN_ID,
  BEEF_SUPPLY_CHAINS,
  beefSupplyChainAddress,
  credentialRegistryAddress,
  publicClient
} from "./chain.js";
import { slides as SLIDES } from "./slides.js";
import {
  SAFE_RANGE_F,
  shortHex,
  relativeTime,
  daysBetween,
  buildTimeline,
  deriveChecklist,
  deriveVerdict,
  summarizeReadings,
  cToF,
  batchFromScan,
  routeStops,
  isPastUseBy,
  pickDeployment,
  durationText
} from "./verify-core.js";
import { routeBody, routeMiles } from "./routemap.js";
import { gatewayUrlForCid } from "./ipfs.js";
import { temperatureAbi } from "./temperatureAbi.js";
import { labelSheet } from "./qr.js";
import { canScan, openScanner } from "./scan.js";

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// --- Small DOM helpers -------------------------------------------------------

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function fromHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Icons from the mockups (stroke icons use currentColor).
const STROKE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"></circle><path d="M20 20l-4.2-4.2"></path>',
  arrowRight: '<path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path>',
  arrowLeft: '<path d="M19 12H5"></path><path d="M11 6l-6 6 6 6"></path>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"></path>',
  external: '<path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"></path>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
  share: '<path d="M12 3v13"></path><path d="M7 8l5-5 5 5"></path><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"></path>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>',
  warn: '<path d="M12 4l9 16H3z"></path><path d="M12 10v4"></path><path d="M12 17.5v.01"></path>',
  fail: '<circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6"></path><path d="M15 9l-6 6"></path>',
  dash: '<circle cx="12" cy="12" r="9"></circle><path d="M8 12h8"></path>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"></path>',
  register: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"></path><path d="M3 8l9 5 9-5"></path><path d="M12 13v8"></path>',
  inspect: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"></path><path d="M9 12l2 2 4-4"></path>',
  ship: '<path d="M2 7h12v9H2z"></path><path d="M14 10h4l3 3v3h-7"></path><circle cx="6" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle>',
  receive: '<path d="M4 9l1.5-5h13L20 9"></path><path d="M4 9h16v11H4z"></path><path d="M10 20v-5h4v5"></path>',
  split: '<path d="M4 7l8-4 8 4-8 4-8-4z"></path><path d="M4 12l8 4 8-4"></path><path d="M4 17l8 4 8-4"></path>',
  recall: '<path d="M12 4l9 16H3z"></path><path d="M12 10v4"></path><path d="M12 17.5v.01"></path>',
  pending: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  final: '<path d="M5 21V4"></path><path d="M5 4h11l-2 4 2 4H5"></path>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"></rect><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"></path><path d="M10 13h4"></path>',
  pause: null,
  play: null
};

function icon(name, size = 18, width = 1.9) {
  if (name === "pause") {
    return fromHtml(`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>`);
  }
  if (name === "play") {
    return fromHtml(`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"></path></svg>`);
  }
  return fromHtml(
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="${width}" ${STROKE}>${ICON_PATHS[name]}</svg>`
  );
}

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const explorerAddress = (address) => EXPLORER_BASE + "/address/" + address;
const explorerTx = (hash) => EXPLORER_BASE + "/tx/" + hash;

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// --- Network pill ------------------------------------------------------------

let networkOk = null;

async function checkNetwork() {
  const pill = $("networkPill");
  const label = $("networkLabel");
  try {
    const id = await Promise.race([
      publicClient.getChainId(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000))
    ]);
    networkOk = id === REQUIRED_CHAIN_ID;
    label.textContent = networkOk
      ? "DIDLab · Chain " + REQUIRED_CHAIN_ID
      : "DIDLab RPC reports chain " + id;
  } catch {
    networkOk = false;
    label.textContent = "DIDLab unreachable";
  }
  pill.classList.toggle("is-warn", !networkOk);
  return networkOk;
}

function showRpcBanner(show) {
  $("rpcBanner").hidden = !show;
}

$("rpcRetry").addEventListener("click", async () => {
  showRpcBanner(false);
  await checkNetwork();
  route();
});

// --- Carousel ----------------------------------------------------------------

const SLIDE_MS = 5500;

function setupCarousel() {
  const figure = $("heroCarousel");
  if (!figure) return;
  // Only the first photo loads with the page; each later one loads when it
  // is next in line, so a visitor who never watches the slideshow doesn't
  // download all of it.
  const images = SLIDES.map((item, i) =>
    h("img", {
      alt: "",
      decoding: "async",
      fetchpriority: i === 0 ? "high" : "low",
      style: "object-position: " + item.focus,
      "data-src": item.src
    })
  );
  const load = (i) => {
    const img = images[(i + images.length) % images.length];
    if (!img.getAttribute("src")) img.src = img.dataset.src;
  };
  const slides = images.map((img, i) =>
    h("div", { className: "slide" + (i === 0 ? " is-active" : ""), "aria-hidden": "true" }, img)
  );
  load(0);
  figure.prepend(...slides);

  const title = $("carouselTitle");
  const sub = $("carouselSub");
  const dots = $("carouselDots");
  const toggle = $("carouselToggle");
  let index = 0;
  let paused = reducedMotion.matches;
  let timer = null;

  const dotButtons = slides.map((_, i) =>
    h(
      "button",
      {
        type: "button",
        className: "dot",
        "aria-label": "Show slide " + (i + 1),
        onClick: () => {
          go(i);
          restart();
        }
      },
      h("span", { className: "dot-mark" })
    )
  );
  dots.append(...dotButtons);

  function go(i) {
    index = (i + slides.length) % slides.length;
    load(index);
    load(index + 1);
    slides.forEach((s, k) => s.classList.toggle("is-active", k === index));
    dotButtons.forEach((b, k) => {
      b.classList.toggle("is-active", k === index);
      if (k === index) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    title.textContent = SLIDES[index].title;
    sub.textContent = SLIDES[index].sub;
  }

  function renderToggle() {
    toggle.replaceChildren(icon(paused ? "play" : "pause"));
    toggle.setAttribute("aria-label", paused ? "Play slideshow" : "Pause slideshow");
  }

  function restart() {
    clearInterval(timer);
    timer = null;
    if (!paused) timer = setInterval(() => go(index + 1), SLIDE_MS);
  }

  toggle.addEventListener("click", () => {
    paused = !paused;
    renderToggle();
    restart();
  });
  // Reduced motion: no autoplay and no zoom (the CSS drops the zoom); the
  // crossfade still runs when a dot is pressed.
  reducedMotion.addEventListener("change", () => {
    paused = reducedMotion.matches;
    renderToggle();
    restart();
  });

  go(0);
  renderToggle();
  restart();
}

// --- On-chain sources card -----------------------------------------------------

function setupSources() {
  const rows = [
    ["BeefSupplyChain", "Batches, inspections, handoffs and recalls", beefSupplyChainAddress],
    ["CredentialRegistry", "Which businesses are certified for each role", credentialRegistryAddress]
  ];
  $("chainIdValue").textContent = String(REQUIRED_CHAIN_ID);
  $("sourceRows").replaceChildren(
    ...rows.map(([name, purpose, address]) => {
      const status = h("span", { className: "visually-hidden", role: "status" });
      const copy = h(
        "button",
        {
          type: "button",
          className: "icon-btn",
          "aria-label": "Copy " + name + " address",
          title: "Copy address",
          onClick: async () => {
            const ok = await copyText(address);
            status.textContent = ok ? name + " address copied" : "Couldn't copy. Select the address instead.";
            copy.classList.toggle("is-done", ok);
            setTimeout(() => copy.classList.remove("is-done"), 1600);
          }
        },
        icon("copy", 18, 1.8)
      );
      return h(
        "div",
        { className: "source-row" },
        h("div", { className: "source-name" }, h("div", { className: "source-title" }, name), h("div", { className: "source-purpose" }, purpose)),
        h("code", { className: "source-addr", title: address }, shortHex(address, 5)),
        h(
          "div",
          { className: "source-actions" },
          copy,
          h(
            "a",
            {
              className: "icon-btn",
              href: explorerAddress(address),
              target: "_blank",
              rel: "noopener noreferrer",
              "aria-label": "Open " + name + " in block explorer"
            },
            icon("external", 18, 1.8)
          ),
          status
        )
      );
    })
  );
}

// --- Lookup form ---------------------------------------------------------------

function validId(name) {
  const bytes = new TextEncoder().encode(name).length;
  return bytes > 0 && bytes <= 31;
}

export function showBatch(name) {
  const id = String(name || "").trim();
  if (!id) return;
  const url = "/?batch=" + encodeURIComponent(id);
  if (location.pathname + location.search !== url) history.pushState(null, "", url);
  route();
}

// Stays on the task page until the handler chooses to open the result.
export function viewBatchControl(name) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-btn";
  button.textContent = "View batch";
  button.addEventListener("click", () => showBatch(name));
  return button;
}

function bindLookup(form, input, status) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // A scanner or paste may bring the whole label link; keep just the ID.
    const id = batchFromScan(input.value);
    if (id !== input.value.trim()) input.value = id;
    if (!validId(id)) {
      if (status) status.textContent = "Enter the batch ID printed on the package label (up to 31 characters).";
      input.focus();
      return;
    }
    if (status) status.textContent = "";
    showBatch(id);
  });
}

function setupLookup() {
  bindLookup($("lookupForm"), $("batchId"), $("lookupStatus"));
  bindLookup($("headerSearch"), $("headerBatchId"), null);
  // The sample ID is the chip's own text (index.html), so it lives in one place.
  $("sampleBatch").addEventListener("click", (event) => {
    const sample = event.currentTarget.textContent.trim();
    $("batchId").value = sample;
    showBatch(sample);
  });
  setupTip($("batchIdTipWrap"));

  // Camera scan of a package's QR label. Hidden where the browser can't
  // reach a camera; typing the ID always works.
  // The header button lets a shopper scan the next package straight from a
  // result page. The header has no status line, so a camera problem shows
  // in the search field's placeholder (full message on hover).
  if (canScan()) {
    bindScan($("scanBatch"), $("batchId"), (message) => ($("lookupStatus").textContent = message));
    bindScan($("headerScan"), $("headerBatchId"), (message) => {
      const input = $("headerBatchId");
      input.placeholder = message ? "Camera unavailable. Type the ID" : "Another batch ID";
      input.title = message;
    });
  }
}

function bindScan(button, input, report) {
  if (!button) return;
  button.hidden = false;
  button.addEventListener("click", () => {
    report("");
    openScanner({
      onResult: (id) => {
        input.value = id;
        showBatch(id);
      },
      onError: (message) => {
        report(message);
        button.focus();
      }
    });
  });
}

// Tooltip: shows on hover and keyboard focus (CSS), and a tap or click pins
// it open for touch screens. Esc hides it until the pointer or focus leaves,
// and the bubble itself can be hovered (WCAG 1.4.13).
function setupTip(wrap) {
  if (!wrap) return;
  const trigger = wrap.querySelector(".tip-trigger");
  const setOpen = (open) => {
    wrap.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };
  trigger.addEventListener("click", () => {
    wrap.classList.remove("is-dismissed");
    setOpen(!wrap.classList.contains("is-open"));
  });
  wrap.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setOpen(false);
    wrap.classList.add("is-dismissed");
  });
  wrap.addEventListener("mouseleave", () => wrap.classList.remove("is-dismissed"));
  wrap.addEventListener("focusout", (event) => {
    if (wrap.contains(event.relatedTarget)) return;
    wrap.classList.remove("is-dismissed");
    setOpen(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!wrap.contains(event.target)) setOpen(false);
  });
}

// --- Reading a batch from the chain --------------------------------------------

const ZERO32 = "0x" + "0".repeat(64);
const LOG_CHUNK = 5000; // DIDLab refuses eth_getLogs ranges wider than ~5,000 blocks
const [LOT_CREATED_TOPIC] = encodeEventTopics({ abi, eventName: "LotCreated" });
const ROLE_HASH = {
  PROCESSOR: keccak256(toHex("PROCESSOR")),
  INSPECTOR: keccak256(toHex("INSPECTOR")),
  CUSTODIAN: keccak256(toHex("CUSTODIAN"))
};

class NotFound extends Error {}

function decodeName(hex) {
  try {
    return hexToString(hex, { size: 32 });
  } catch {
    return hex;
  }
}

function plainArgs(args) {
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "bigint") out[key] = Number(value);
    else if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) out[key] = value.toLowerCase();
    else if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) out[key] = decodeName(value);
    else out[key] = value;
  }
  return out;
}

async function pooled(tasks, limit = 4) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    })
  );
  return results;
}

// Every event on `deployment` naming this batch: its own events (batch id is
// the first indexed topic) and the LotCreated that made it, if it is a lot
// (lot id is the second topic). A lot is always on the same deployment as
// the batch it was split from.
async function batchLogs(idHex, latest, deployment) {
  const ranges = [];
  for (let from = BigInt(deployment.deployBlock); from <= latest; from += BigInt(LOG_CHUNK)) {
    const to = from + BigInt(LOG_CHUNK - 1) < latest ? from + BigInt(LOG_CHUNK - 1) : latest;
    ranges.push([toHex(from), toHex(to)]);
  }
  const query = (topics, [fromBlock, toBlock]) => () =>
    publicClient.request({
      method: "eth_getLogs",
      params: [{ address: deployment.address, fromBlock, toBlock, topics }]
    });
  const tasks = ranges.flatMap((range) => [
    query([null, idHex], range),
    query([LOT_CREATED_TOPIC, null, idHex], range)
  ]);
  const logs = (await pooled(tasks)).flat();
  const seen = new Set();
  return logs
    .filter((log) => {
      const key = log.transactionHash + ":" + log.logIndex;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((log) => {
      const { eventName, args } = decodeEventLog({ abi, data: log.data, topics: log.topics });
      return {
        name: eventName,
        args: plainArgs(args),
        blockNumber: Number(log.blockNumber),
        logIndex: Number(log.logIndex),
        txHash: log.transactionHash
      };
    });
}

function isBatchNotFound(error) {
  if (!(error instanceof BaseError)) return false;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted?.data?.errorName === "BatchNotFound";
}

// Sensor summaries from TemperatureLog (ADR 0005), one per custody leg, for
// this batch and every batch or lot it was split from (their legs come
// first). Only a deployment that names a `temperatureLog` in chain.js has
// any; for the others this returns null. Reads getSummary for each leg up to
// custodyLeg instead of scanning event logs.
async function fetchTemperature(name, deployment) {
  if (!deployment.temperatureLog) return null;
  const at = deployment.temperatureLog;
  const readLog = (functionName, args = []) =>
    publicClient.readContract({ address: at, abi: temperatureAbi, functionName, args });
  const lineage = [];
  for (let n = name; ; ) {
    lineage.unshift(n);
    const up = n.replace(/-L\d+$/, "");
    if (up === n) break;
    n = up;
  }
  try {
    const [low, high] = await Promise.all([readLog("rangeLowCentiC"), readLog("rangeHighCentiC")]);
    const perBatch = await Promise.all(
      lineage.map(async (n) => {
        const id = stringToHex(n, { size: 32 });
        const legs = Number(
          await publicClient.readContract({ address: deployment.address, abi, functionName: "custodyLeg", args: [id] })
        );
        const records = await Promise.all(
          Array.from({ length: legs + 1 }, (_, leg) => readLog("getSummary", [id, leg]).then((r) => ({ leg, r })))
        );
        return records
          .filter(({ r }) => r.recordedAt > 0n)
          .map(({ leg, r }) => ({
            batch: n,
            leg,
            custodian: r.custodian.toLowerCase(),
            sensor: r.sensor.toLowerCase(),
            startTime: Number(r.startTime) * 1000,
            endTime: Number(r.endTime) * 1000,
            minC: Number(r.minCentiC) / 100,
            maxC: Number(r.maxCentiC) / 100,
            secondsOut: Number(r.secondsOutOfRange),
            readingCount: Number(r.readingCount),
            missing: Number(r.lastSeq) - Number(r.firstSeq) + 1 - Number(r.readingCount)
          }));
      })
    );
    return { rangeC: { low: Number(low) / 100, high: Number(high) / 100 }, legs: perBatch.flat() };
  } catch (error) {
    console.error(error);
    return null;
  }
}

// Business names and places by wallet (server/db.js listDirectory). Loaded
// once per page; if it fails, steps just don't name anyone, and the next
// lookup tries again.
let directoryLoad = null;
function loadDirectory() {
  if (!directoryLoad) {
    directoryLoad = fetch("/api/directory", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("directory " + r.status))))
      .then((data) => new Map((data.businesses || []).map((b) => [b.address.toLowerCase(), b])))
      .catch(() => {
        directoryLoad = null;
        return new Map();
      });
  }
  return directoryLoad;
}

// Demo stories (scripts/seed-demo.js writes frontend/public/demo/stories.json).
// Used only when the file was made for the contract this page reads, so a
// demo story never attaches to a real batch that happens to share a name.
let storiesLoad = null;
function loadStories() {
  if (!storiesLoad) {
    storiesLoad = fetch("/frontend/public/demo/stories.json", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) =>
        data && String(data.contract).toLowerCase() === beefSupplyChainAddress.toLowerCase() ? data.batches || {} : {}
      )
      .catch(() => ({}));
  }
  return storiesLoad;
}

async function fetchRecord(name) {
  const idHex = stringToHex(name, { size: 32 });
  const readAt = (address, functionName, args, contractAbi = abi) =>
    publicClient.readContract({ address, abi: contractAbi, functionName, args });

  // Ask every deployment at once; the newest one that has the batch wins.
  const probes = await Promise.all(
    BEEF_SUPPLY_CHAINS.map((deployment) =>
      readAt(deployment.address, "getBatch", [idHex]).then(
        (value) => ({ deployment, value }),
        (error) => (isBatchNotFound(error) ? { deployment, notFound: true } : { deployment, error })
      )
    )
  );
  const hit = pickDeployment(probes);
  if (!hit) throw new NotFound(name);
  const { deployment, value: raw } = hit;
  const read = (functionName, args) => readAt(deployment.address, functionName, args);
  const batch = {
    processor: raw[0].toLowerCase(),
    weightLbs: Number(raw[1]),
    currentHolder: raw[2].toLowerCase(),
    pendingReceiver: raw[3].toLowerCase(),
    inspected: raw[4],
    inspectionPassed: raw[5],
    recalled: raw[7],
    recallClassification: Number(raw[9])
  };

  const [lotInfo, latest, temperature, directory, status, stories] = await Promise.all([
    read("getLotInfo", [idHex]).catch(() => null),
    publicClient.getBlockNumber(),
    fetchTemperature(name, deployment),
    loadDirectory(),
    read("getStatus", [idHex]).catch(() => null),
    loadStories()
  ]);
  // Use-by date (unix seconds on chain, ms here) and final disposition.
  batch.useBy = status && status[0] ? Number(status[0]) * 1000 : null;
  batch.disposition = status ? Number(status[1]) : 0;
  const parentHex = lotInfo && lotInfo[0] !== ZERO32 ? lotInfo[0] : null;
  const lot = {
    parentName: parentHex ? decodeName(parentHex) : null,
    lotNames: lotInfo ? lotInfo[1].map(decodeName) : []
  };

  let events = await batchLogs(idHex, latest, deployment);
  // A lot's story starts with the batch or lot it came from: everything up to
  // the split, plus inspections and recalls, which the lot reads through. A
  // lot can be split from a lot, so walk up to the original batch. From each
  // one above, keep its own "split from" step but not the splits that made
  // its other lots.
  let childName = name;
  let childEvents = events;
  let aboveHex = parentHex;
  while (aboveHex) {
    const aboveName = decodeName(aboveHex);
    const split = childEvents.find((e) => e.name === "LotCreated" && e.args.lotId === childName);
    const splitBlock = split ? split.blockNumber : Infinity;
    const aboveEvents = await batchLogs(aboveHex, latest, deployment);
    events = events.concat(
      aboveEvents
        .filter((e) => e.name !== "LotCreated" || e.args.lotId === aboveName)
        .filter((e) => e.blockNumber < splitBlock || e.name === "InspectionRecorded" || e.name === "RecallRecorded")
        .map((e) => ({ ...e, fromParent: true }))
    );
    const made = aboveEvents.find((e) => e.name === "LotCreated" && e.args.lotId === aboveName);
    aboveHex = made ? stringToHex(made.args.parentId, { size: 32 }) : null;
    childName = aboveName;
    childEvents = aboveEvents;
  }

  const blocks = [...new Set(events.map((e) => e.blockNumber))];
  const times = new Map(
    await Promise.all(
      blocks.map(async (n) => [n, Number((await publicClient.getBlock({ blockNumber: BigInt(n) })).timestamp) * 1000])
    )
  );
  for (const e of events) e.timestamp = times.get(e.blockNumber);

  // Is each signer's credential still valid now? (At signing it was: the
  // contract refuses the write otherwise.)
  const SIGNER_ROLE = {
    BatchRegistered: ["processor", "PROCESSOR"],
    InspectionRecorded: ["inspector", "INSPECTOR"],
    ShipmentRecorded: ["from", "CUSTODIAN"],
    ReceiptConfirmed: ["receiver", "CUSTODIAN"],
    LotCreated: ["holder", "CUSTODIAN"],
    DispositionRecorded: ["holder", "CUSTODIAN"]
  };
  const pairs = new Map();
  for (const e of events) {
    const entry = SIGNER_ROLE[e.name];
    if (entry) pairs.set(e.args[entry[0]] + ":" + entry[1], [e.args[entry[0]], entry[1]]);
  }
  const validity = new Map(
    await Promise.all(
      [...pairs].map(async ([key, [address, role]]) => [
        key,
        await readAt(credentialRegistryAddress, "isValid", [address, ROLE_HASH[role]], registryAbi)
      ])
    )
  );

  return {
    name,
    batch,
    lot,
    // Which BeefSupplyChain holds this record, and whether it is an older
    // one the app no longer writes to.
    deployment,
    previous: deployment !== BEEF_SUPPLY_CHAINS[0],
    events,
    // Raw readings never go on chain (only per-leg summaries), so this stays
    // empty; the readings chart below is kept for a future log viewer.
    readingsC: [],
    temperature,
    credentialOk: (a, role) => validity.get(a + ":" + role) !== false,
    // A lot (or a lot of a lot) tells its original batch's story.
    story: stories[name.replace(/(-L\d+)+$/, "")] || null,
    who: (address) => (address && directory.get(String(address).toLowerCase())) || null
  };
}

// --- Result rendering ----------------------------------------------------------

const STATUS_ICON = { pass: "check", warn: "warn", fail: "fail", none: "dash" };
const STATUS_TEXT = { pass: "Passed", warn: "Warning", fail: "Failed", none: "No data" };

function badge(verdict) {
  const mark =
    verdict.tone === "pass"
      ? fromHtml('<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"></circle><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></path></svg>')
      : icon(verdict.tone === "warn" ? "warn" : "fail", 20, 2.2);
  return h("span", { className: "verdict-badge tone-" + verdict.tone }, mark, verdict.label);
}

function checkItem(item) {
  return h(
    "li",
    { className: "check-item status-" + item.status },
    h("span", { className: "check-icon" }, icon(STATUS_ICON[item.status], 22, 2.2)),
    h(
      "div",
      {},
      h("div", { className: "check-title" }, h("span", { className: "visually-hidden" }, STATUS_TEXT[item.status] + ": "), item.title),
      h("div", { className: "check-detail" }, item.detail)
    )
  );
}

function lotButton(name) {
  return h("button", { type: "button", className: "link-btn mono", onClick: () => showBatch(name) }, name);
}

function lotChip(lot) {
  if (lot.parentName) {
    return h("span", { className: "meta-chip" }, "Lot of ", lotButton(lot.parentName));
  }
  if (lot.lotNames.length) {
    return h(
      "span",
      { className: "meta-chip" },
      "Split into ",
      ...lot.lotNames.flatMap((n, i) => (i ? [", ", lotButton(n)] : [lotButton(n)]))
    );
  }
  return null;
}

function timeLabel(ms) {
  return day.format(ms) + " · " + clock.format(ms);
}

function rangeLabel(steps) {
  const times = steps.map((s) => s.timestamp).filter(Boolean);
  if (!times.length) return "";
  const first = Math.min(...times);
  const last = Math.max(...times);
  const days = daysBetween(first, last);
  const span = days === 0 ? "Same day" : days + (days === 1 ? " day" : " days");
  return (days === 0 ? day.format(first) : day.format(first) + " – " + day.format(last)) + " · " + span;
}

function timelineItem(step, isLast) {
  const tone = step.tone ? " tone-" + step.tone : "";
  const outlined = step.currentHolder || step.synthetic ? " is-outlined" : "";
  const chips = [];
  if (step.roleLabel) {
    chips.push(
      step.credentialActive === false
        ? h("span", { className: "cred-chip is-warn" }, icon("warn", 12, 2.4), "Certification since lapsed")
        : h("span", { className: "cred-chip" }, icon("shield", 12, 2.4), step.roleLabel)
    );
  }

  const detail = [step.detail];
  // Inherited steps: an inspection or recall applies through the original
  // batch; anything else happened before this lot was split off.
  if (step.event && step.event.fromParent) {
    detail.push(step.kind === "inspect" || step.kind === "recall" ? "on the original batch" : "before it was split off");
  }
  if (step.currentHolder) detail.push("Has it now");

  return h(
    "li",
    { className: "tl-item" + tone },
    h(
      "div",
      { className: "tl-rail" },
      h("span", { className: "tl-node" + outlined }, icon(step.kind === "inspect" && step.tone === "fail" ? "fail" : step.kind, 18, 1.9)),
      isLast ? null : h("span", { className: "tl-line" })
    ),
    h(
      "div",
      { className: "tl-body" + (isLast ? " is-last" : "") },
      h(
        "div",
        { className: "tl-head" },
        h("div", { className: "tl-title" }, step.tone === "fail" || step.tone === "warn" ? h("span", { className: "visually-hidden" }, step.tone === "fail" ? "Problem: " : "Warning: ") : null, step.title),
        step.timestamp ? h("time", { datetime: new Date(step.timestamp).toISOString() }, timeLabel(step.timestamp)) : h("span", { className: "tl-time" }, "Not yet")
      ),
      h("div", { className: "tl-detail" }, detail.filter(Boolean).join(" · ")),
      chips.length ? h("div", { className: "tl-chips" }, chips) : null
    )
  );
}

// Inline SVG line chart, as in the mockup: safe band shaded, a divider at
// each handoff. `readings` are { t, c } with t in ms; `dividers` are times.
function chartSvg(readings, dividers, { width = 320, height = 150, compact = false } = {}) {
  const fs = readings.map((r) => cToF(r.c));
  const top = compact ? 8 : 20;
  const bottom = compact ? height - 8 : 130;
  const lo = Math.min(SAFE_RANGE_F.low - 4, ...fs);
  const hi = Math.max(SAFE_RANGE_F.high + 4, ...fs);
  const y = (f) => bottom - ((f - lo) / (hi - lo)) * (bottom - top);
  const t0 = readings[0].t;
  const t1 = readings[readings.length - 1].t;
  const x = (t) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * width);
  const band = `<rect x="0" y="${y(SAFE_RANGE_F.high)}" width="${width}" height="${y(SAFE_RANGE_F.low) - y(SAFE_RANGE_F.high)}" ${compact ? 'rx="6"' : ""} fill="#E3F1E8"></rect>`;
  const points = readings.map((r, i) => x(r.t).toFixed(1) + "," + y(fs[i]).toFixed(1)).join(" ");
  const extras = compact
    ? ""
    : `<line x1="0" y1="${y(SAFE_RANGE_F.high)}" x2="${width}" y2="${y(SAFE_RANGE_F.high)}" stroke="#9CC7AE" stroke-dasharray="3 3"></line>
       <line x1="0" y1="${y(SAFE_RANGE_F.low)}" x2="${width}" y2="${y(SAFE_RANGE_F.low)}" stroke="#9CC7AE" stroke-dasharray="3 3"></line>
       <text x="${width - 4}" y="${y(SAFE_RANGE_F.high) - 4}" text-anchor="end" font-family="Inter" font-size="10" fill="#4E5A53">${SAFE_RANGE_F.high}°</text>
       <text x="${width - 4}" y="${y(SAFE_RANGE_F.low) + 12}" text-anchor="end" font-family="Inter" font-size="10" fill="#4E5A53">${SAFE_RANGE_F.low}°</text>
       ${dividers.filter((t) => t > t0 && t < t1).map((t) => `<line x1="${x(t)}" y1="20" x2="${x(t)}" y2="130" stroke="#CBD2CC"></line>`).join("")}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" style="display:block">${band}${extras}<polyline fill="none" stroke="#1F5C45" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${points}"></polyline></svg>`;
}

function chartLabel(summary) {
  const range = SAFE_RANGE_F.low + " to " + SAFE_RANGE_F.high + " degrees Fahrenheit";
  return (
    "Temperature ranged from " + summary.low + " to " + summary.high + " degrees Fahrenheit. " +
    (summary.excursions === 0
      ? "It stayed inside the " + range + " safe range for the whole journey."
      : summary.excursions + " stretch" + (summary.excursions === 1 ? " was" : "es were") + " outside the " + range + " safe range.")
  );
}

// One row per custody leg: who held it, how long the sensor logged, low and
// high, time out of range, and a bar of the leg's span against the safe band.
function legRows(record, checklist, { compact = false } = {}) {
  const sum = checklist.legSummary;
  const legs = record.temperature.legs;
  const lo = Math.min(sum.range.low, sum.low) - 3;
  const hi = Math.max(sum.range.high, sum.high) + 3;
  const pct = (f) => ((f - lo) / (hi - lo)) * 100 + "%";
  const width = (a, b) => ((b - a) / (hi - lo)) * 100 + "%";
  return h(
    "ol",
    { className: "leg-list" + (compact ? " is-compact" : "") },
    legs.map((l) => {
      const place = record.who(l.custodian);
      const minF = cToF(l.minC);
      const maxF = cToF(l.maxC);
      const notes = [durationText((l.endTime - l.startTime) / 1000) + " logged", minF.toFixed(1) + "–" + maxF.toFixed(1) + " °F"];
      notes.push(l.secondsOut ? durationText(l.secondsOut) + " out of range" : "in range");
      if (l.missing > 0) notes.push(l.missing + (l.missing === 1 ? " reading" : " readings") + " missing");
      return h(
        "li",
        { className: l.secondsOut ? "tone-warn" : "" },
        h(
          "div",
          { className: "leg-head" },
          h("span", { className: "leg-name" }, l.secondsOut ? h("span", { className: "visually-hidden" }, "Warning: ") : null, place ? place.name : "A business not in the directory"),
          l.batch !== record.name ? h("span", { className: "leg-tag" }, "before the split") : null
        ),
        h("div", { className: "leg-sub" }, notes.join(" · ")),
        h(
          "div",
          { className: "leg-bar", "aria-hidden": "true" },
          h("span", { className: "leg-band", style: "left:" + pct(sum.range.low) + ";width:" + width(sum.range.low, sum.range.high) }),
          h("span", { className: "leg-span", style: "left:" + pct(minF) + ";width:max(4px," + width(minF, maxF) + ")" })
        )
      );
    })
  );
}

function coldChainSection(record, steps, checklist) {
  const legSum = checklist.legSummary;
  if (legSum) {
    return h(
      "section",
      { className: "panel cold-panel", "aria-labelledby": "coldHeading" },
      h("div", { className: "panel-head" }, h("h2", { id: "coldHeading" }, "Temperature"), h("span", { className: "panel-meta" }, "°F · signed by each holder's sensor")),
      h(
        "div",
        { className: "cold-stats" },
        h("div", {}, h("div", { className: "cold-n" }, legSum.low.toFixed(1) + "°"), h("div", { className: "cold-k" }, "Low")),
        h("div", {}, h("div", { className: "cold-n" }, legSum.high.toFixed(1) + "°"), h("div", { className: "cold-k" }, "High")),
        h("div", {}, h("div", { className: "cold-n" + (legSum.secondsOut >= 3600 ? " is-long" : "") }, legSum.secondsOut ? durationText(legSum.secondsOut) : "0 min"), h("div", { className: "cold-k" }, "Out of range"))
      ),
      legRows(record, checklist),
      h("p", { className: "empty-note" }, "Safe range is " + legSum.range.low + "–" + legSum.range.high + " °F. Each leg is a summary signed by the holder's certified sensor and checked on the blockchain.")
    );
  }
  const summary = checklist.summary;
  const readings = record.readingsC.map((c, i) => (typeof c === "number" ? { t: i, c } : c));
  const body = summary
    ? [
        h(
          "div",
          { className: "cold-stats" },
          h("div", {}, h("div", { className: "cold-n" }, summary.low.toFixed(1) + "°"), h("div", { className: "cold-k" }, "Low")),
          h("div", {}, h("div", { className: "cold-n" }, summary.high.toFixed(1) + "°"), h("div", { className: "cold-k" }, "High")),
          h("div", {}, h("div", { className: "cold-n" }, String(summary.excursions)), h("div", { className: "cold-k" }, "Times out of range"))
        ),
        (() => {
          const svg = fromHtml(chartSvg(readings, steps.filter((s) => s.kind === "receive").map((s) => s.timestamp)));
          svg.setAttribute("aria-label", chartLabel(summary));
          return svg;
        })()
      ]
    : [
        h("p", { className: "empty-state" }, icon("dash", 20, 1.8), "No temperature readings for this batch yet."),
        h("p", { className: "empty-note" }, "Safe range is " + SAFE_RANGE_F.low + "–" + SAFE_RANGE_F.high + " °F.")
      ];
  return h(
    "section",
    { className: "panel cold-panel", "aria-labelledby": "coldHeading" },
    h("div", { className: "panel-head" }, h("h2", { id: "coldHeading" }, "Temperature"), h("span", { className: "panel-meta" }, "°F · from sensors")),
    body
  );
}

let checkedTimer = null;

function proofSection(record, steps) {
  const signed = steps.filter((s) => s.txHash);
  const latest = signed[signed.length - 1];
  const checkedAt = Date.now();
  const checked = h("dd", { className: "proof-plain" }, relativeTime(checkedAt));
  clearInterval(checkedTimer);
  checkedTimer = setInterval(() => {
    checked.textContent = relativeTime(checkedAt);
  }, 30000);

  const shareStatus = h("p", { className: "proof-status", role: "status", "aria-live": "polite" });
  const row = (k, v) => [h("dt", {}, k), v];
  const mono = (text, title) => h("dd", { title }, text);

  // QR labels, drawn on demand. A split batch lives on as its lots, so it
  // offers their labels; its own label still opens this page.
  const labelPanel = h("div", { className: "proof-labels", id: "proofLabels", hidden: true });
  const { lotNames } = record.lot;
  const labelButton = h(
    "button",
    {
      type: "button",
      className: "proof-share",
      "aria-expanded": "false",
      "aria-controls": "proofLabels",
      onClick: (event) => {
        const open = labelPanel.hidden;
        if (open && !labelPanel.firstChild) {
          labelPanel.append(
            lotNames.length
              ? labelSheet(lotNames, { note: "This batch was split into " + lotNames.length + " lots. Label each lot with its own code." })
              : labelSheet([record.name])
          );
        }
        labelPanel.hidden = !open;
        event.currentTarget.setAttribute("aria-expanded", String(open));
      }
    },
    lotNames.length ? "Lot labels" : "QR label"
  );

  // Shoppers get sharing and labels up front. The ledger details are for
  // anyone who wants to check the record themselves, so they start folded.
  const technical = h(
    "details",
    { className: "proof-tech" },
    h("summary", {}, "Technical details"),
    h(
      "p",
      { className: "proof-tech-note" },
      "This record is kept on DIDLab, a shared blockchain no single company controls. These details let anyone check it independently. Business names and places come from the Chuck and Verify business directory, not the blockchain."
    ),
    h(
      "dl",
      {},
      row("Latest transaction", latest ? mono(shortHex(latest.txHash, 4), latest.txHash) : mono("—")),
      row("Block", latest ? mono(latest.event.blockNumber.toLocaleString()) : mono("—")),
      row(
        record.previous ? "Supply chain contract (earlier version " + record.deployment.version + ")" : "Supply chain contract",
        mono(shortHex(record.deployment.address, 5), record.deployment.address)
      ),
      row("Credential contract", mono(shortHex(credentialRegistryAddress, 5), credentialRegistryAddress)),
      row("Checked", checked)
    ),
    h(
      "a",
      {
        className: "proof-explorer",
        href: latest ? explorerTx(latest.txHash) : explorerAddress(record.deployment.address),
        target: "_blank",
        rel: "noopener noreferrer"
      },
      "View on block explorer",
      icon("external", 16, 2)
    )
  );

  return h(
    "section",
    { className: "proof-panel", id: "proof", "aria-labelledby": "proofHeading", tabindex: "-1" },
    h("h2", { id: "proofHeading" }, "Share this batch"),
    h("p", { className: "proof-lede" }, "Send someone the link, or print QR labels for the package."),
    h(
      "div",
      { className: "proof-actions" },
      h("button", { type: "button", className: "proof-explorer", onClick: () => share(record.name, shareStatus) }, "Share link"),
      labelButton
    ),
    shareStatus,
    labelPanel,
    technical
  );
}

async function share(name, status) {
  const url = location.origin + "/?batch=" + encodeURIComponent(name);
  if (navigator.share) {
    try {
      await navigator.share({ title: name + " — Chuck and Verify", text: "See where beef batch " + name + " has been", url });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  const ok = await copyText(url);
  if (status) status.textContent = ok ? "Link copied." : "Couldn't copy. The link is " + url;
}

// Small-screen layout (Mobile.dc.html): solid verdict card, compact journey,
// sparkline, sticky CTA that opens the full record and proof.
function compactView(record, steps, checklist, verdict) {
  const { confirmed, total } = checklist.handoffs;
  const tile = (value, label) => h("div", { className: "m-tile" }, h("div", { className: "m-tile-n" }, value), h("div", { className: "m-tile-k" }, label));
  const times = steps.map((s) => s.timestamp).filter(Boolean);
  const days = times.length ? daysBetween(Math.min(...times), Math.max(...times)) : 0;
  const summary = checklist.summary;

  const cold = h(
    "section",
    { className: "m-card m-cold", "aria-labelledby": "mColdHeading" },
    h(
      "div",
      { className: "m-card-head" },
      h("h2", { id: "mColdHeading" }, "Temperature"),
      checklist.legSummary
        ? h("span", {}, checklist.legSummary.low.toFixed(1) + "° – " + checklist.legSummary.high.toFixed(1) + "° F")
        : summary ? h("span", {}, summary.low.toFixed(1) + "° – " + summary.high.toFixed(1) + "° F") : null
    ),
    checklist.legSummary
      ? legRows(record, checklist, { compact: true })
      : summary
      ? (() => {
          const readings = record.readingsC.map((c, i) => (typeof c === "number" ? { t: i, c } : c));
          const svg = fromHtml(chartSvg(readings, [], { height: 70, compact: true }));
          svg.setAttribute("aria-label", chartLabel(summary));
          return svg;
        })()
      : h("p", { className: "empty-state" }, icon("dash", 18, 1.8), "No temperature readings for this batch yet.")
  );

  return h(
    "div",
    { className: "compact-only" },
    h(
      "section",
      { className: "m-verdict tone-" + verdict.tone, "aria-labelledby": "mBatchHeading" },
      h(
        "span",
        { className: "m-badge" },
        verdict.tone === "pass"
          ? fromHtml('<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#FFFFFF"></circle><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>')
          : icon(verdict.tone === "warn" ? "warn" : "fail", 22, 2.2),
        verdict.label
      ),
      h("h1", { id: "mBatchHeading" }, record.name),
      h("p", {}, productLine(record, steps)),
      previousNote(record),
      (() => {
        const chip = lotChip(record.lot);
        return chip ? h("p", { className: "m-lots" }, ...chip.childNodes) : null;
      })(),
      h(
        "div",
        { className: "m-tiles" },
        tile(total ? confirmed + "/" + total : "—", total ? "Handoffs confirmed" : "No handoffs yet"),
        tile(checklist.credentials.status === "pass" ? "All" : "Lapsed", "Businesses certified"),
        tile(
          checklist.legSummary
            ? checklist.legSummary.secondsOut ? durationText(checklist.legSummary.secondsOut) + " out" : "In range"
            : summary ? (summary.excursions ? summary.excursions + " out" : SAFE_RANGE_F.low + "–" + SAFE_RANGE_F.high + "°") : "No data",
          "Temperature"
        )
      )
    ),
    h(
      "section",
      { className: "m-card", "aria-labelledby": "mJourneyHeading" },
      h(
        "div",
        { className: "m-card-head" },
        h("h2", { id: "mJourneyHeading" }, "Where it's been"),
        times.length ? h("span", {}, days === 0 ? "Same day" : days + (days === 1 ? " day" : " days")) : null
      ),
      h(
        "ol",
        { className: "m-journey" },
        steps.map((s, i) =>
          h(
            "li",
            { className: (s.tone ? "tone-" + s.tone : "") + (i === steps.length - 1 ? " is-last" : "") },
            h("div", { className: "m-rail" }, h("span", { className: "m-dot" + (i === steps.length - 1 ? " is-outlined" : "") }), i === steps.length - 1 ? null : h("span", { className: "m-line" })),
            h(
              "div",
              { className: "m-body" },
              h("div", { className: "m-title" }, s.tone ? h("span", { className: "visually-hidden" }, s.tone === "fail" ? "Problem: " : "Warning: ") : null, s.title),
              h("div", { className: "m-sub" }, s.detail)
            ),
            s.timestamp ? h("time", { datetime: new Date(s.timestamp).toISOString() }, day.format(s.timestamp)) : h("span", { className: "m-time" }, "Pending")
          )
        )
      )
    ),
    mapSection(steps, { compact: true }),
    cold,
    h(
      "div",
      { className: "m-cta-bar" },
      h(
        "button",
        {
          type: "button",
          className: "m-cta",
          "aria-controls": "fullRecord",
          "aria-expanded": "false",
          onClick: (event) => {
            const view = $("resultView");
            view.classList.add("is-expanded");
            event.currentTarget.setAttribute("aria-expanded", "true");
            const proof = $("proof");
            proof.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
            proof.focus({ preventScroll: true });
          }
        },
        "See full record",
        icon("arrowRight", 18, 2)
      )
    )
  );
}

// "Where it's been" on a map. Shown only when the directory places at least
// one stop; otherwise the timeline already says everything we know.
function mapSection(steps, { compact = false } = {}) {
  const stops = routeStops(steps);
  if (!stops.some((s) => s.located)) return null;
  const miles = Math.round(routeMiles(stops));
  const meta = stops.length + (stops.length === 1 ? " stop" : " stops") + (miles ? " · about " + miles.toLocaleString() + " mi" : "");
  const headingId = compact ? "mMapHeading" : "mapHeading";
  return h(
    "section",
    { className: compact ? "m-card map-card" : "panel map-panel", "aria-labelledby": headingId },
    h("div", { className: compact ? "m-card-head" : "panel-head" }, h("h2", { id: headingId }, "On the map"), h("span", { className: compact ? "" : "panel-meta" }, meta)),
    routeBody(stops)
  );
}

// A batch found on an older BeefSupplyChain. Its record is as real as any
// other, but the app no longer adds steps to that contract, so say so.
function previousNote(record) {
  if (!record.previous) return null;
  return h(
    "p",
    { className: "previous-note" },
    icon("archive", 16, 1.9),
    h("span", {}, h("strong", {}, "Earlier record. "), "This batch was recorded on an earlier version of Chuck and Verify. Its history is still on the blockchain, but new steps aren't added to it.")
  );
}

// The batch's story, from the demo data: where it came from and what
// happened to it, with a photo and the mock paperwork.
function storySection(record) {
  const story = record.story;
  if (!story) return null;
  const photo = story.photo || {};
  const img = h("img", {
    className: "story-photo",
    src: photo.cid ? gatewayUrlForCid(photo.cid) : photo.src,
    alt: photo.alt || "",
    loading: "lazy",
    decoding: "async"
  });
  // The local copy stands in if the IPFS gateway is slow or down.
  if (photo.cid && photo.src) img.addEventListener("error", () => (img.src = photo.src), { once: true });
  const docs = (story.documents || [])
    .map((d) => ({ ...d, href: gatewayUrlForCid(d.cid) }))
    .filter((d) => d.href);
  const isLot = record.name !== record.name.replace(/(-L\d+)+$/, "");
  return h(
    "section",
    { className: "panel story-panel", "aria-labelledby": "storyHeading" },
    photo.src || photo.cid ? img : null,
    h(
      "div",
      { className: "story-body" },
      h("p", { className: "story-eyebrow" }, story.cut + (story.ranch ? " · from " + story.ranch : "")),
      h("h2", { id: "storyHeading" }, isLot ? "The story of the batch it came from" : "The story"),
      ...(story.story || []).map((p) => h("p", {}, p)),
      docs.length
        ? h(
            "p",
            { className: "story-docs" },
            "Paperwork: ",
            ...docs.flatMap((d, i) => [
              i ? " · " : "",
              h("a", { href: d.href, target: "_blank", rel: "noopener noreferrer" }, d.label, h("span", { className: "visually-hidden" }, " (PDF, opens in a new tab)"))
            ])
          )
        : null,
      h("p", { className: "story-note" }, "Demo data: these businesses, ranches and documents are made up. The custody steps on this page are real records on the blockchain.")
    )
  );
}

function productLine(record, steps) {
  const registered = steps.find((s) => s.kind === "register");
  const parts = [record.batch.weightLbs + " lb " + (record.lot.parentName ? "lot" : "batch")];
  if (registered && registered.timestamp) parts.push("Registered " + fullDate.format(registered.timestamp));
  if (record.batch.useBy) {
    parts.push((isPastUseBy(record.batch) ? "Use-by date passed " : "Use by ") + fullDate.format(record.batch.useBy));
  }
  return parts.join(" · ");
}

function renderRecord(record) {
  const steps = buildTimeline(record.events, {
    batchName: record.name,
    batch: record.batch,
    credentialOk: record.credentialOk,
    who: record.who
  });
  const checklist = deriveChecklist({
    steps,
    batch: record.batch,
    readingsC: record.readingsC.map((r) => (typeof r === "number" ? r : r.c)),
    temperature: record.temperature
  });
  const verdict = deriveVerdict({ batch: record.batch, checklist });
  const real = steps.filter((s) => !s.synthetic);
  const last = real[real.length - 1];

  document.title = record.name + " — Chuck and Verify";
  $("mobileShare").onclick = () => share(record.name, $("mobileShareStatus"));

  const verdictCard = h(
    "section",
    { className: "verdict-card full-only", "aria-labelledby": "batchHeading" },
    h(
      "div",
      { className: "verdict-main" },
      badge(verdict),
      h("h1", { id: "batchHeading", className: "batch-id" }, record.name),
      h("p", { className: "product-line" }, productLine(record, steps)),
      previousNote(record),
      h(
        "div",
        { className: "meta-chips" },
        lotChip(record.lot),
        h("span", { className: "meta-chip" }, real.length + (real.length === 1 ? " step recorded" : " steps recorded")),
        last && last.timestamp ? h("span", { className: "meta-chip" }, "Last update " + relativeTime(last.timestamp).toLowerCase()) : null
      )
    ),
    h("ul", { className: "checklist", "aria-label": "Verification checks" }, checkItem(checklist.signed), checkItem(checklist.credentials), checkItem(checklist.coldChain))
  );

  const journey = h(
    "section",
    { className: "panel journey-panel", "aria-labelledby": "journeyHeading" },
    h("div", { className: "panel-head" }, h("h2", { id: "journeyHeading" }, "Where it's been"), h("span", { className: "panel-meta" }, rangeLabel(steps))),
    h("ol", { className: "timeline" }, steps.map((s, i) => timelineItem(s, i === steps.length - 1)))
  );

  $("resultBody").replaceChildren(
    compactView(record, steps, checklist, verdict),
    verdictCard,
    storySection(record),
    h(
      "div",
      { className: "result-columns full-record", id: "fullRecord" },
      journey,
      h("div", { className: "result-side" }, mapSection(steps), coldChainSection(record, steps, checklist), proofSection(record, steps))
    )
  );
}

function renderSkeleton() {
  const bar = (w, hgt = 14) => h("span", { className: "sk", style: `width:${w};height:${hgt}px` });
  $("resultBody").replaceChildren(
    h(
      "div",
      { className: "skeleton", "aria-hidden": "true" },
      h(
        "div",
        { className: "verdict-card sk-card" },
        h("div", { className: "verdict-main" }, bar("160px", 34), bar("60%", 56), bar("45%", 18), h("div", { className: "meta-chips" }, bar("110px", 30), bar("130px", 30))),
        h("div", { className: "checklist" }, bar("80%", 18), bar("70%", 18), bar("75%", 18))
      ),
      h(
        "div",
        { className: "panel sk-card" },
        [0, 1, 2].map(() => h("div", { className: "sk-row" }, h("span", { className: "sk sk-node" }), h("div", { className: "sk-lines" }, bar("50%", 16), bar("35%"), bar("25%", 22))))
      )
    ),
    h("p", { className: "visually-hidden", role: "status" }, "Looking up the batch…")
  );
}

function renderNotFound(name) {
  document.title = "Batch not found — Chuck and Verify";
  $("resultBody").replaceChildren(
    h(
      "section",
      { className: "notice-card", role: "status" },
      h("span", { className: "notice-icon" }, icon("search", 22, 2)),
      h("h1", {}, "No batch found for ", h("span", { className: "mono" }, name), "."),
      h("p", {}, "Check the ID on the package label."),
      h("a", { className: "btn-primary", href: "/", onClick: backToLookup }, "New lookup")
    )
  );
}

function renderError() {
  document.title = "Chuck and Verify";
  $("resultBody").replaceChildren(
    h(
      "section",
      { className: "notice-card", role: "status" },
      h("span", { className: "notice-icon tone-warn" }, icon("warn", 22, 2)),
      h("h1", {}, "Couldn't load the record"),
      h("p", {}, "The records network didn't answer. Your batch may be fine; try again in a moment.")
    )
  );
}

// --- Views ---------------------------------------------------------------------

function backToLookup(event) {
  if (event) event.preventDefault();
  history.pushState(null, "", "/");
  route();
}

let renderToken = 0;

// Info pages: /?page=about and /?page=team. Work is separate because a
// task query picks one handler section inside that view.
const PAGES = {
  about: { view: "aboutView", title: "About — Chuck and Verify" },
  team: { view: "teamView", title: "Team — Chuck and Verify" }
};
const VIEWS = ["lookupView", "resultView", "aboutView", "teamView", "workView"];

const WORK_TASKS = {
  register: {
    section: "registerSection",
    title: "Register a batch — Chuck and Verify",
    denied: "Registration needs a processor role."
  },
  inspect: {
    section: "inspectSection",
    title: "Record an inspection — Chuck and Verify",
    denied: "Recording an inspection needs an inspector role."
  },
  ship: {
    section: "custodySection",
    title: "Move a batch — Chuck and Verify",
    denied: "Shipping needs a custodian role."
  },
  split: {
    section: "splitSection",
    title: "Split a batch — Chuck and Verify",
    denied: "Splitting a batch needs a custodian who can split lots."
  },
  recall: {
    section: "recallSection",
    title: "Recall a batch — Chuck and Verify",
    denied: "A recall needs the processor who registered the batch."
  },
  users: {
    section: "adminSection",
    title: "Portal users — Chuck and Verify",
    denied: "Managing users needs an administrator."
  }
};
const WORK_SECTIONS = Object.values(WORK_TASKS).map((task) => task.section);

function showView(id) {
  for (const v of VIEWS) $(v).hidden = v !== id;
}

function markSiteNav(page) {
  for (const link of document.querySelectorAll(".site-nav a")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

// Overview cards keep data-live from the session render. `hidden` on a task
// section is only "this task is not open"; data-permitted is the role check.
function applyWorkTask(task) {
  const spec = WORK_TASKS[task];
  const signedIn =
    $("onboarding").dataset.live === "true" || $("dashboard").dataset.live === "true";
  const overview = !spec;
  for (const id of ["onboarding", "dashboard"]) {
    const el = $(id);
    el.hidden = !overview || el.dataset.live !== "true";
  }
  for (const id of WORK_SECTIONS) $(id).hidden = true;

  const denied = $("workDenied");
  const signedOut = $("workSignedOut");
  signedOut.hidden = !overview || signedIn;
  let title = $("onboarding").dataset.live === "true"
    ? "Request access — Chuck and Verify"
    : "Your work — Chuck and Verify";

  if (spec) {
    title = spec.title;
    const section = $(spec.section);
    const allowed = signedIn && section.dataset.permitted === "true";
    if (allowed) {
      section.hidden = false;
      denied.hidden = true;
      denied.textContent = "";
    } else {
      denied.hidden = false;
      denied.textContent = signedIn ? spec.denied : "Sign in to see your work.";
    }
  } else {
    denied.hidden = true;
    denied.textContent = "";
  }

  const current = spec ? task : "";
  for (const link of document.querySelectorAll(".work-nav a")) {
    if ((link.dataset.task || "") === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  return title;
}

// Re-apply the open task after a permission refresh. No-op off the work view,
// where every section stays inside a hidden parent.
export function syncWork() {
  if (document.body.dataset.view !== "work") return;
  const task = new URLSearchParams(location.search).get("task") || "";
  document.title = applyWorkTask(task);
}

export async function route() {
  const params = new URLSearchParams(location.search);
  const name = params.get("batch");
  const requested = !name ? params.get("page") : null;
  const page = requested && Object.hasOwn(PAGES, requested) ? requested : null;
  const result = $("resultView");
  document.body.dataset.view = name ? "result" : requested === "work" ? "work" : page || "lookup";
  markSiteNav(requested === "work" ? "work" : page);

  if (requested === "work") {
    showView("workView");
    syncWork();
    window.scrollTo(0, 0);
    return;
  }

  if (page) {
    showView(PAGES[page].view);
    document.title = PAGES[page].title;
    window.scrollTo(0, 0);
    return;
  }

  if (!name) {
    showView("lookupView");
    document.title = "Chuck and Verify";
    return;
  }

  showView("resultView");
  result.classList.remove("is-expanded");
  $("headerBatchId").value = "";
  window.scrollTo(0, 0);

  const token = ++renderToken;
  if (!validId(name)) {
    renderNotFound(name);
    return;
  }
  renderSkeleton();
  try {
    const record = await fetchRecord(name);
    if (token !== renderToken) return;
    showRpcBanner(false);
    renderRecord(record);
  } catch (error) {
    if (token !== renderToken) return;
    if (error instanceof NotFound) {
      renderNotFound(name);
      return;
    }
    console.error(error);
    renderError();
    showRpcBanner(true);
    $("networkPill").classList.add("is-warn");
    checkNetwork();
  }
}

for (const link of document.querySelectorAll("[data-home]")) {
  link.addEventListener("click", backToLookup);
}
for (const link of document.querySelectorAll("a[data-page]")) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    history.pushState(null, "", link.getAttribute("href"));
    route();
  });
}
window.addEventListener("popstate", route);

setupCarousel();
setupSources();
setupLookup();
checkNetwork().then((ok) => showRpcBanner(!ok));
route();
