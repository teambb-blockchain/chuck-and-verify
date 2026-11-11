// Consumer verify flow: the lookup page, the result page, the network pill
// and the illustration carousel. Everything here is read-only and works
// without a wallet; it reads DIDLab through chain.js's public client.
//
// Routes: `/` is the lookup page, `/?batch=<id>` is a batch result, so a
// batch result can be linked to directly. (A query string rather than a
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
  BEEF_SUPPLY_CHAIN_DEPLOY_BLOCK,
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
  cToF
} from "./verify-core.js";

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
    ["BeefSupplyChain", "Batches and custody events", beefSupplyChainAddress],
    ["CredentialRegistry", "Handler identities and licenses", credentialRegistryAddress]
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

function bindLookup(form, input, status) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = input.value.trim();
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

// Every BeefSupplyChain event naming this batch: its own events (batch id is
// the first indexed topic) and the LotCreated that made it, if it is a lot
// (lot id is the second topic).
async function batchLogs(idHex, latest) {
  const ranges = [];
  for (let from = BigInt(BEEF_SUPPLY_CHAIN_DEPLOY_BLOCK); from <= latest; from += BigInt(LOG_CHUNK)) {
    const to = from + BigInt(LOG_CHUNK - 1) < latest ? from + BigInt(LOG_CHUNK - 1) : latest;
    ranges.push([toHex(from), toHex(to)]);
  }
  const query = (topics, [fromBlock, toBlock]) => () =>
    publicClient.request({
      method: "eth_getLogs",
      params: [{ address: beefSupplyChainAddress, fromBlock, toBlock, topics }]
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

// TODO(temperature): readings come from the temperature contract planned in
// docs/decisions/0005, which is not deployed. Until then no batch has any.
async function fetchReadings() {
  return [];
}

async function fetchRecord(name) {
  const idHex = stringToHex(name, { size: 32 });
  const read = (functionName, args, address = beefSupplyChainAddress, contractAbi = abi) =>
    publicClient.readContract({ address, abi: contractAbi, functionName, args });

  let raw;
  try {
    raw = await read("getBatch", [idHex]);
  } catch (error) {
    if (isBatchNotFound(error)) throw new NotFound(name);
    throw error;
  }
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

  const [lotInfo, latest, readingsC] = await Promise.all([
    read("getLotInfo", [idHex]).catch(() => null),
    publicClient.getBlockNumber(),
    fetchReadings(name)
  ]);
  const parentHex = lotInfo && lotInfo[0] !== ZERO32 ? lotInfo[0] : null;
  const lot = {
    parentName: parentHex ? decodeName(parentHex) : null,
    lotNames: lotInfo ? lotInfo[1].map(decodeName) : []
  };

  let events = await batchLogs(idHex, latest);
  if (parentHex) {
    // A lot's story starts with its parent: everything up to the split, plus
    // the parent's inspection and recall, which the lot reads through.
    const own = events.find((e) => e.name === "LotCreated" && e.args.lotId === name);
    const splitBlock = own ? own.blockNumber : Infinity;
    const parentEvents = (await batchLogs(parentHex, latest))
      .filter((e) => e.name !== "LotCreated")
      .filter((e) => e.blockNumber < splitBlock || e.name === "InspectionRecorded" || e.name === "RecallRecorded")
      .map((e) => ({ ...e, fromParent: true }));
    events = events.concat(parentEvents);
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
    LotCreated: ["holder", "CUSTODIAN"]
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
        await read("isValid", [address, ROLE_HASH[role]], credentialRegistryAddress, registryAbi)
      ])
    )
  );

  return { name, batch, lot, events, readingsC, credentialOk: (a, role) => validity.get(a + ":" + role) !== false };
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
        ? h("span", { className: "cred-chip is-warn" }, icon("warn", 12, 2.4), "Credential no longer active")
        : h("span", { className: "cred-chip" }, icon("shield", 12, 2.4), step.roleLabel)
    );
  }
  if (step.signer) chips.push(h("code", { className: "addr-chip", title: step.signer }, shortHex(step.signer, 4)));

  const detail = [step.detail];
  if (step.event && step.event.fromParent) detail.push("on the parent batch");
  if (step.currentHolder) detail.push("Current holder");

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

function coldChainSection(record, steps, checklist) {
  const summary = checklist.summary;
  const readings = record.readingsC.map((c, i) => (typeof c === "number" ? { t: i, c } : c));
  const body = summary
    ? [
        h(
          "div",
          { className: "cold-stats" },
          h("div", {}, h("div", { className: "cold-n" }, summary.low.toFixed(1) + "°"), h("div", { className: "cold-k" }, "Low")),
          h("div", {}, h("div", { className: "cold-n" }, summary.high.toFixed(1) + "°"), h("div", { className: "cold-k" }, "High")),
          h("div", {}, h("div", { className: "cold-n" }, String(summary.excursions)), h("div", { className: "cold-k" }, "Excursions"))
        ),
        (() => {
          const svg = fromHtml(chartSvg(readings, steps.filter((s) => s.kind === "receive").map((s) => s.timestamp)));
          svg.setAttribute("aria-label", chartLabel(summary));
          return svg;
        })()
      ]
    : [
        h("p", { className: "empty-state" }, icon("dash", 20, 1.8), "No sensor readings recorded for this batch."),
        h("p", { className: "empty-note" }, "Safe range is " + SAFE_RANGE_F.low + "–" + SAFE_RANGE_F.high + " °F.")
      ];
  return h(
    "section",
    { className: "panel cold-panel", "aria-labelledby": "coldHeading" },
    h("div", { className: "panel-head" }, h("h2", { id: "coldHeading" }, "Cold chain"), h("span", { className: "panel-meta" }, "°F · on-chain readings")),
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

  return h(
    "section",
    { className: "proof-panel", id: "proof", "aria-labelledby": "proofHeading", tabindex: "-1" },
    h("h2", { id: "proofHeading" }, "Proof"),
    h(
      "dl",
      {},
      row("Latest tx", latest ? mono(shortHex(latest.txHash, 4), latest.txHash) : mono("—")),
      row("Block", latest ? mono(latest.event.blockNumber.toLocaleString()) : mono("—")),
      row("Supply chain", mono(shortHex(beefSupplyChainAddress, 5), beefSupplyChainAddress)),
      row("Credentials", mono(shortHex(credentialRegistryAddress, 5), credentialRegistryAddress)),
      row("Checked", checked)
    ),
    h(
      "div",
      { className: "proof-actions" },
      h(
        "a",
        {
          className: "proof-explorer",
          href: latest ? explorerTx(latest.txHash) : explorerAddress(beefSupplyChainAddress),
          target: "_blank",
          rel: "noopener noreferrer"
        },
        "View on explorer",
        icon("external", 16, 2)
      ),
      h("button", { type: "button", className: "proof-share", onClick: () => share(record.name, shareStatus) }, "Share")
    ),
    shareStatus
  );
}

async function share(name, status) {
  const url = location.origin + "/?batch=" + encodeURIComponent(name);
  if (navigator.share) {
    try {
      await navigator.share({ title: name + " — Chuck and Verify", text: "Batch " + name + " on the DIDLab ledger", url });
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
      h("h2", { id: "mColdHeading" }, "Cold chain"),
      summary ? h("span", {}, summary.low.toFixed(1) + "° – " + summary.high.toFixed(1) + "° F") : null
    ),
    summary
      ? (() => {
          const readings = record.readingsC.map((c, i) => (typeof c === "number" ? { t: i, c } : c));
          const svg = fromHtml(chartSvg(readings, [], { height: 70, compact: true }));
          svg.setAttribute("aria-label", chartLabel(summary));
          return svg;
        })()
      : h("p", { className: "empty-state" }, icon("dash", 18, 1.8), "No sensor readings recorded for this batch.")
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
      (() => {
        const chip = lotChip(record.lot);
        return chip ? h("p", { className: "m-lots" }, ...chip.childNodes) : null;
      })(),
      h(
        "div",
        { className: "m-tiles" },
        tile(total ? confirmed + "/" + total : "—", total ? "Signed" : "No handoffs yet"),
        tile(checklist.credentials.status === "pass" ? "Active" : "Lapsed", "Credentials"),
        tile(summary ? (summary.excursions ? summary.excursions + " out" : SAFE_RANGE_F.low + "–" + SAFE_RANGE_F.high + "°") : "No data", "Cold chain")
      )
    ),
    h(
      "section",
      { className: "m-card", "aria-labelledby": "mJourneyHeading" },
      h(
        "div",
        { className: "m-card-head" },
        h("h2", { id: "mJourneyHeading" }, "Journey"),
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
              h("div", { className: "m-sub" }, s.signer ? shortHex(s.signer, 4) : s.detail)
            ),
            s.timestamp ? h("time", { datetime: new Date(s.timestamp).toISOString() }, day.format(s.timestamp)) : h("span", { className: "m-time" }, "Pending")
          )
        )
      )
    ),
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
        "See full record & proof",
        icon("arrowRight", 18, 2)
      )
    )
  );
}

function productLine(record, steps) {
  const registered = steps.find((s) => s.kind === "register");
  const parts = [record.batch.weightLbs + " lb " + (record.lot.parentName ? "lot" : "batch")];
  if (registered && registered.timestamp) parts.push("Registered " + fullDate.format(registered.timestamp));
  return parts.join(" · ");
}

function renderRecord(record) {
  const steps = buildTimeline(record.events, {
    batchName: record.name,
    batch: record.batch,
    credentialOk: record.credentialOk
  });
  const checklist = deriveChecklist({ steps, batch: record.batch, readingsC: record.readingsC.map((r) => (typeof r === "number" ? r : r.c)) });
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
      h(
        "div",
        { className: "meta-chips" },
        lotChip(record.lot),
        h("span", { className: "meta-chip" }, real.length + (real.length === 1 ? " custody event" : " custody events")),
        last && last.timestamp ? h("span", { className: "meta-chip" }, "Last update " + relativeTime(last.timestamp).toLowerCase()) : null
      )
    ),
    h("ul", { className: "checklist", "aria-label": "Verification checks" }, checkItem(checklist.signed), checkItem(checklist.credentials), checkItem(checklist.coldChain))
  );

  const journey = h(
    "section",
    { className: "panel journey-panel", "aria-labelledby": "journeyHeading" },
    h("div", { className: "panel-head" }, h("h2", { id: "journeyHeading" }, "Chain of custody"), h("span", { className: "panel-meta" }, rangeLabel(steps))),
    h("ol", { className: "timeline" }, steps.map((s, i) => timelineItem(s, i === steps.length - 1)))
  );

  $("resultBody").replaceChildren(
    compactView(record, steps, checklist, verdict),
    verdictCard,
    h(
      "div",
      { className: "result-columns full-record", id: "fullRecord" },
      journey,
      h("div", { className: "result-side" }, coldChainSection(record, steps, checklist), proofSection(record, steps))
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
    h("p", { className: "visually-hidden", role: "status" }, "Reading the DIDLab ledger…")
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
      h("h1", {}, "Couldn't read the ledger"),
      h("p", {}, "The DIDLab network didn't answer. Your batch may be fine; try again in a moment.")
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

// Info pages: /?page=about and /?page=team.
const PAGES = {
  about: { view: "aboutView", title: "About — Chuck and Verify" },
  team: { view: "teamView", title: "Team — Chuck and Verify" }
};
const VIEWS = ["lookupView", "resultView", "aboutView", "teamView"];

function showView(id) {
  for (const v of VIEWS) $(v).hidden = v !== id;
}

async function route() {
  const params = new URLSearchParams(location.search);
  const name = params.get("batch");
  const page = !name && Object.hasOwn(PAGES, params.get("page") || "") ? params.get("page") : null;
  const result = $("resultView");
  document.body.dataset.view = name ? "result" : page || "lookup";
  for (const link of document.querySelectorAll(".site-nav a")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
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
for (const link of document.querySelectorAll(".site-nav a")) {
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
