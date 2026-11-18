// Pure helpers behind the consumer verify page: no DOM, no network, no
// imports. consumer.js feeds them what it read from the chain; the Hardhat
// tests load this file directly (test/verify-core.test.js).

// --- Temperature -------------------------------------------------------------
// Sensors and contracts work in Celsius; the page shows Fahrenheit. Convert
// only for display.

export const SAFE_RANGE_F = Object.freeze({ low: 32, high: 39 });

export function cToF(celsius) {
  return (celsius * 9) / 5 + 32;
}

// One decimal place, e.g. 1.8 °C -> "35.2".
export function formatF(celsius) {
  return (Math.round(cToF(celsius) * 10) / 10).toFixed(1);
}

// Low / high in °F and the number of excursions: separate stretches of
// readings outside the safe range (three bad readings in a row are one
// excursion, not three).
export function summarizeReadings(readingsC, range = SAFE_RANGE_F) {
  if (!readingsC || readingsC.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  let excursions = 0;
  let outside = false;
  for (const c of readingsC) {
    const f = cToF(c);
    low = Math.min(low, f);
    high = Math.max(high, f);
    const out = f < range.low || f > range.high;
    if (out && !outside) excursions += 1;
    outside = out;
  }
  return {
    low: Math.round(low * 10) / 10,
    high: Math.round(high * 10) / 10,
    excursions
  };
}

// Per-leg sensor summaries (TemperatureLog, ADR 0005). `temperature` is
// { rangeC: { low, high }, legs: [{ minC, maxC, secondsOut, readingCount,
// missing, startTime, endTime, custodian, ... }] } with temperatures in °C.
// Returns the low and high in °F, total time out of range, how many legs
// had any, and the required range in whole °F.
export function summarizeLegs(temperature) {
  if (!temperature || !temperature.legs || temperature.legs.length === 0) return null;
  const legs = temperature.legs;
  const round1 = (f) => Math.round(f * 10) / 10;
  return {
    low: round1(Math.min(...legs.map((l) => cToF(l.minC)))),
    high: round1(Math.max(...legs.map((l) => cToF(l.maxC)))),
    secondsOut: legs.reduce((sum, l) => sum + l.secondsOut, 0),
    legsOut: legs.filter((l) => l.secondsOut > 0).length,
    legs: legs.length,
    missing: legs.reduce((sum, l) => sum + (l.missing || 0), 0),
    range: { low: Math.round(cToF(temperature.rangeC.low)), high: Math.round(cToF(temperature.rangeC.high)) }
  };
}

// 2700 -> "45 min", 5400 -> "1 h 30 min", 30 -> "under 1 min".
export function durationText(seconds) {
  if (seconds < 60) return "under 1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + " h" + (m ? " " + m + " min" : "");
}

// --- Formatting --------------------------------------------------------------

// 0x903359014d55A25ED1d4a8DCA6740dd30A90448a -> 0x9033…0448a
export function shortHex(value, tail = 5) {
  const text = String(value || "");
  if (text.length <= 6 + tail + 1) return text;
  return text.slice(0, 6) + "…" + text.slice(-tail);
}

// --- Batch links (QR labels) -------------------------------------------------

// The link a batch's QR label carries. A label is just this link drawn as a
// QR code: nothing about it is stored on chain, so a lot split needs no
// change to the contract. Each lot already has its own ID, so it gets its
// own link and label, and the parent's label keeps opening the parent.
export function batchLink(name, origin) {
  return String(origin).replace(/\/+$/, "") + "/?batch=" + encodeURIComponent(String(name).trim());
}

// What the lookup box received: a typed batch ID, or a whole label link from
// a handheld scanner (they type out what they read) or a paste. A link gives
// up its `batch` value; anything else is taken as typed.
export function batchFromScan(text) {
  const value = String(text || "").trim();
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    return (new URL(value).searchParams.get("batch") || "").trim();
  } catch {
    return value;
  }
}

// --- Which deployment holds a batch ------------------------------------------

// Each BeefSupplyChain redeploy starts empty, so a batch lives on whichever
// deployment it was registered on. `probes` is one entry per deployment,
// newest first: { deployment, value } when getBatch found it, { deployment,
// notFound: true } when it reverted BatchNotFound, or { deployment, error }
// for anything else. The newest deployment that has the batch wins (an ID
// can be reused after a redeploy). A failure on a newer deployment means we
// can't tell whether that one has it, so that failure is thrown rather than
// showing an older record. Returns null when no deployment has the batch.
export function pickDeployment(probes) {
  for (const probe of probes) {
    if (probe.error) throw probe.error;
    if (!probe.notFound) return { deployment: probe.deployment, value: probe.value };
  }
  return null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(thenMs, nowMs = Date.now()) {
  const diff = Math.max(0, nowMs - thenMs);
  if (diff < MINUTE) return "Just now";
  const unit = (n, word) => n + " " + word + (n === 1 ? "" : "s") + " ago";
  if (diff < HOUR) return unit(Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return unit(Math.floor(diff / HOUR), "hour");
  return unit(Math.floor(diff / DAY), "day");
}

// Whole calendar days between two times, in the viewer's time zone.
export function daysBetween(startMs, endMs) {
  const start = new Date(startMs);
  const end = new Date(endMs);
  const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((b - a) / DAY);
}

// --- Timeline ----------------------------------------------------------------
// Turns decoded BeefSupplyChain events into custody steps. Each event is
// { name, args, blockNumber, logIndex, txHash, timestamp } with addresses
// lower-cased and batch ids already decoded to names. Who signed each event,
// and which credential the contract checked when it was signed:
//   BatchRegistered    processor  PROCESSOR
//   InspectionRecorded inspector  INSPECTOR
//   ShipmentRecorded   from       CUSTODIAN
//   ReceiptConfirmed   receiver   CUSTODIAN
//   LotCreated         holder     CUSTODIAN
//   RecallRecorded     by         none (a recall needs no live credential)

const SIGNER = {
  BatchRegistered: ["processor", "PROCESSOR"],
  InspectionRecorded: ["inspector", "INSPECTOR"],
  ShipmentRecorded: ["from", "CUSTODIAN"],
  ReceiptConfirmed: ["receiver", "CUSTODIAN"],
  LotCreated: ["holder", "CUSTODIAN"],
  LotSplit: ["holder", "CUSTODIAN"],
  RecallRecorded: ["by", null]
};

export const ROLE_LABEL = {
  PROCESSOR: "Licensed processor",
  INSPECTOR: "Licensed inspector",
  CUSTODIAN: "Certified custodian"
};

const RECALL_CLASS = { 1: "Class I", 2: "Class II", 3: "Class III" };

export function sortEvents(events) {
  return [...events].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
  );
}

function describe(event, batchName) {
  const a = event.args;
  switch (event.name) {
    case "BatchRegistered":
      return { kind: "register", title: "Registered by processor", detail: a.weightLbs + " lb batch" };
    case "InspectionRecorded":
      return a.passed
        ? { kind: "inspect", title: "Inspection passed", detail: "Report fingerprint saved on-chain" }
        : { kind: "inspect", title: "Inspection failed", detail: "Report fingerprint saved on-chain", tone: "fail" };
    case "ShipmentRecorded":
      return { kind: "ship", title: "Shipped", detail: "To " + shortHex(a.to, 4) };
    case "ReceiptConfirmed":
      return { kind: "receive", title: "Received", detail: "Took custody" };
    case "LotCreated":
      // A lot split from a lot also shows the split that made its parent.
      return {
        kind: "split",
        title: "Split from " + a.parentId,
        detail: a.weightLbs + " lb lot" + (a.lotId === batchName ? "" : " " + a.lotId)
      };
    case "LotSplit":
      return { kind: "split", title: "Split into " + a.lots.length + " lots", detail: a.lots.join(", ") };
    case "RecallRecorded":
      return {
        kind: "recall",
        title: "Recalled · " + (RECALL_CLASS[a.classification] || "Class " + a.classification),
        detail: "Recall notice fingerprint saved on-chain",
        tone: "fail"
      };
    default:
      return { kind: "other", title: event.name, detail: "" };
  }
}

// `credentialOk(address, role)` answers whether that credential is valid now.
// `batch` is getBatch's result for the batch being shown (holder, pending).
export function buildTimeline(events, { batchName, batch, credentialOk = () => true }) {
  // A split emits one LotCreated per lot in the same transaction. On the
  // split batch's own timeline that is one step, not one per lot.
  const sorted = [];
  for (const event of sortEvents(events)) {
    const prev = sorted[sorted.length - 1];
    // Its own LotCreated, or one that made a lot above it, reads "Split from".
    const ownLot = event.name === "LotCreated" && (event.args.lotId === batchName || event.fromParent);
    if (event.name === "LotCreated" && !ownLot && prev && prev.name === "LotSplit" && prev.txHash === event.txHash) {
      prev.args.lots.push(event.args.lotId);
      continue;
    }
    sorted.push(
      event.name === "LotCreated" && !ownLot
        ? { ...event, name: "LotSplit", args: { holder: event.args.holder, lots: [event.args.lotId] } }
        : event
    );
  }
  const steps = sorted.map((event) => {
    const [field, role] = SIGNER[event.name] || [null, null];
    const signer = field ? event.args[field] : null;
    const credentialActive = role ? credentialOk(signer, role) : null;
    const step = {
      ...describe(event, batchName),
      event,
      signer,
      role,
      roleLabel: role ? ROLE_LABEL[role] : null,
      credentialActive,
      timestamp: event.timestamp,
      txHash: event.txHash,
      currentHolder: false
    };
    if (!step.tone && credentialActive === false) step.tone = "warn";
    return step;
  });

  // The current holder took custody at the latest receipt, split, or
  // registration they signed.
  const holder = batch && batch.currentHolder;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (["receive", "split", "register"].includes(s.kind) && s.signer === holder) {
      s.currentHolder = true;
      break;
    }
  }

  const pending = batch && batch.pendingReceiver;
  if (pending && !/^0x0{40}$/.test(pending)) {
    steps.push({
      kind: "pending",
      title: "In transit",
      detail: "Waiting for " + shortHex(pending, 4) + " to confirm receipt",
      signer: pending,
      role: null,
      roleLabel: null,
      credentialActive: null,
      timestamp: null,
      txHash: null,
      currentHolder: false,
      tone: "warn",
      synthetic: true
    });
  }
  return steps;
}

// --- Checklist and verdict ---------------------------------------------------
// Each item: { status: "pass" | "warn" | "fail" | "none", title, detail }.

export function deriveChecklist({ steps, batch, readingsC = [], temperature = null }) {
  const real = steps.filter((s) => !s.synthetic);

  // 1. Handoffs: every shipment must be confirmed by the wallet it named.
  const shipments = real.filter((s) => s.kind === "ship");
  const confirmed = shipments.filter((ship) => {
    const to = ship.event.args.to;
    const at = real.indexOf(ship);
    return real.slice(at + 1).some((s) => s.kind === "receive" && s.signer === to);
  }).length;
  const awaiting = shipments.length - confirmed;
  const signed =
    shipments.length === 0
      ? { status: "pass", title: "Every handoff signed", detail: "No handoffs yet. " + real.length + " signed " + (real.length === 1 ? "event" : "events") }
      : awaiting === 0
        ? { status: "pass", title: "Every handoff signed", detail: confirmed + " of " + shipments.length + " handoffs confirmed by both sides" }
        : { status: "warn", title: "Handoff in progress", detail: confirmed + " of " + shipments.length + " handoffs confirmed. " + awaiting + " awaiting receipt" };

  // 2. Credentials. The contract refuses a write from a wallet without a
  // valid credential, so every recorded event passed at signing. What can
  // change later is a revocation or expiry.
  const credentialed = real.filter((s) => s.role);
  const lapsed = credentialed.filter((s) => s.credentialActive === false);
  const signers = new Set(credentialed.map((s) => s.signer)).size;
  const lapsedSigners = new Set(lapsed.map((s) => s.signer)).size;
  const credentials =
    lapsed.length === 0
      ? { status: "pass", title: "Credentials active at signing", detail: "None revoked or expired since" }
      : {
          status: "warn",
          title: "Credentials active at signing",
          detail:
            lapsedSigners + " of " + signers + " signers " +
            (lapsedSigners === 1 ? "no longer holds" : "no longer hold") + " an active credential"
        };

  // 3. Cold chain: per-leg sensor summaries when the contract has them,
  // otherwise raw readings (none are recorded yet anywhere but TemperatureLog).
  const legSummary = summarizeLegs(temperature);
  const summary = legSummary ? null : summarizeReadings(readingsC);
  const range = SAFE_RANGE_F.low + "–" + SAFE_RANGE_F.high + " °F";
  const legRange = legSummary ? legSummary.range.low + "–" + legSummary.range.high + " °F" : "";
  const coldChain = legSummary
    ? legSummary.secondsOut === 0
      ? { status: "pass", title: "Kept cold", detail: "Every sensor reading stayed within " + legRange }
      : {
          status: "warn",
          title: "Got too warm or cold",
          detail:
            durationText(legSummary.secondsOut) + " outside " + legRange + ", on " +
            legSummary.legsOut + " of " + legSummary.legs + (legSummary.legs === 1 ? " leg" : " legs")
        }
    : !summary
    ? { status: "none", title: "Cold chain", detail: "No sensor readings recorded for this batch" }
    : summary.excursions === 0
      ? { status: "pass", title: "Cold chain held", detail: "All readings within " + range }
      : {
          status: "warn",
          title: "Cold chain excursion",
          detail: summary.excursions + (summary.excursions === 1 ? " stretch" : " stretches") + " outside " + range
        };

  return { signed, credentials, coldChain, handoffs: { confirmed, total: shipments.length }, lapsed: lapsed.length, summary, legSummary };
}

// The badge. Recall and failed inspection are failures; anything still open
// is a warning; otherwise the record checks out.
export function deriveVerdict({ batch, checklist }) {
  if (batch.recalled) {
    return { tone: "fail", label: "Recalled · " + (RECALL_CLASS[batch.recallClassification] || "Class " + batch.recallClassification) };
  }
  if (batch.inspected && !batch.inspectionPassed) {
    return { tone: "fail", label: "Failed inspection" };
  }
  const items = [checklist.signed, checklist.credentials, checklist.coldChain];
  if (items.some((i) => i.status === "fail")) return { tone: "fail", label: "Verification failed" };
  if (!batch.inspected) return { tone: "warn", label: "Awaiting inspection" };
  if (items.some((i) => i.status === "warn")) return { tone: "warn", label: "Verified with warnings" };
  return { tone: "pass", label: "Verified on-chain" };
}
