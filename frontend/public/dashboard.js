// Role dashboards and first-sign-in onboarding.
//
// Signed in with roles -> #dashboard: one panel per role (tabs when there is
// more than one), each with its counts, what this role can do, and a table
// of the batches it touches. Signed in with no role -> #onboarding: what the
// wallet can and can't do, its address to share, and a request form.
//
// Counts come from /api/dashboard, which reads the server's copy of the
// contract's events. Forms open in this browser: the uploader signs once
// (no fee) to rebuild the key, so only they can read what they filed.

import { createWalletClient, custom, keccak256, stringToHex } from "https://esm.sh/viem@2";
import { api } from "./session.js";
import { openEncryptedForm } from "./ipfs.js";
import { chain, publicClient, credentialRegistryAddress, isUserRejection } from "./chain.js";
import { registryAbi } from "./registryAbi.js";

const ROLE_ORDER = ["PROCESSOR", "INSPECTOR", "CUSTODIAN", "ADMIN"];
const ROLE_NAME = {
  PROCESSOR: "Processor",
  INSPECTOR: "Inspector",
  CUSTODIAN: "Custodian",
  ADMIN: "Admin"
};
// What each role adds, phrased to finish "Your roles don't include …".
const ROLE_ABILITY = {
  PROCESSOR: "registering batches",
  INSPECTOR: "recording inspections",
  CUSTODIAN: "moving batches",
  ADMIN: "managing portal users"
};
// Organization types (server/db.js ORGANIZATIONS), the stakeholders of the
// checkpoint report that write on chain. The chain sees only the credential
// behind each one; the portal uses the type to show each business the work
// it actually does. A custodian with no type sees the generic custodian view.
const ORGS = {
  processor: { role: "PROCESSOR", name: "Beef processor", desc: "You slaughter and pack beef. Register each batch and recall your own." },
  fsis: { role: "INSPECTOR", name: "USDA FSIS inspector", tab: "USDA inspection", desc: "You inspect batches for USDA and file the report." },
  storage: { role: "CUSTODIAN", name: "Storage facility", desc: "You keep beef cold between handoffs. Confirm deliveries and ship batches on." },
  distributor: { role: "CUSTODIAN", name: "Distributor", desc: "You receive batches, split them into lots, and send lots to buyers." },
  carrier: { role: "CUSTODIAN", name: "Carrier", desc: "You haul beef. Confirm each pickup and hand it to the receiver." },
  retailer: { role: "CUSTODIAN", name: "Retailer", desc: "You sell beef in your store. Confirm each delivery that arrives." },
  restaurant: { role: "CUSTODIAN", name: "Restaurant", desc: "You prepare beef for diners. Confirm each delivery that arrives." }
};
const ORG_ORDER = Object.keys(ORGS);

// How the custodian panel reads for each kind of custodian. `actions` is the
// "What you can do" list; `ship` and `split` say whether a row offers them.
const HOLD_UNTIL = " until the processor tells you how to return or dispose of ";
const CUSTODY_PROFILE = {
  default: {
    actions: ["ship", "split", "receive"],
    ship: true,
    split: true,
    here: "With you",
    inCustody: "in your custody",
    incoming: "on the way to you",
    incomingTag: "On its way to you",
    passedOn: "Passed on",
    hold: ["It's in your custody. Don't ship it. Hold it", "They're in your custody. Don't ship them. Hold them"],
    empty: "Nothing is in your custody. A batch shows up here once it's shipped to your wallet."
  },
  storage: {
    actions: ["receive", "ship"],
    here: "In storage",
    inCustody: "in storage",
    hold: ["It's in your storage. Don't ship it. Hold it", "They're in your storage. Don't ship them. Hold them"],
    empty: "Nothing is in storage. A batch shows up here once it's shipped to your facility."
  },
  distributor: {
    actions: ["receive", "split", "ship"],
    here: "In your warehouse",
    inCustody: "in your warehouse",
    hold: ["It's in your warehouse. Don't split or ship it. Hold it", "They're in your warehouse. Don't split or ship them. Hold them"],
    empty: "Nothing is in your warehouse. A batch shows up here once a supplier ships it to you."
  },
  carrier: {
    actions: ["receive", "ship"],
    split: false,
    here: "On your truck",
    inCustody: "on your trucks",
    incoming: "waiting for pickup",
    incomingTag: "Ready for pickup",
    passedOn: "Delivered",
    labels: {
      receive: ["Confirm a pickup", "Take custody of a batch when you load it.", "Confirm pickup"],
      ship: ["Hand off a delivery", "Ship a batch you're hauling to the wallet receiving it.", "Hand off"]
    },
    hold: ["It's on your truck. Don't deliver it. Hold it", "They're on your trucks. Don't deliver them. Hold them"],
    empty: "Nothing is on your trucks. A batch shows up here once a shipper names your wallet."
  },
  retailer: {
    actions: ["receive", "ship"],
    ship: false,
    split: false,
    here: "In your store",
    inCustody: "in your store",
    passedOn: "Sent back",
    labels: { ship: ["Return a batch", "Send a batch back to a supplier, such as after a recall.", "Return"] },
    hold: ["Take it off the shelf and don't sell it. Hold it", "Take them off the shelf and don't sell them. Hold them"],
    empty: "Nothing has been delivered to your store yet. A batch shows up here once a supplier ships it to you."
  },
  restaurant: {
    actions: ["receive", "ship"],
    ship: false,
    split: false,
    here: "In your kitchen",
    inCustody: "in your kitchen",
    passedOn: "Sent back",
    labels: { ship: ["Return a batch", "Send a batch back to a supplier, such as after a recall.", "Return"] },
    hold: ["Don't prepare or serve it. Hold it", "Don't prepare or serve them. Hold them"],
    empty: "Nothing has been delivered to your kitchen yet. A batch shows up here once a supplier ships it to you."
  }
};

function orgOf(role) {
  const key = session?.organization;
  return key && ORGS[key]?.role === role ? key : null;
}

// The custodian words for this wallet. Other roles' tables keep the
// generic words: a processor's own custody is just "With you".
function custodyProfile(role = "CUSTODIAN") {
  const key = role === "CUSTODIAN" ? orgOf("CUSTODIAN") : null;
  const base = CUSTODY_PROFILE.default;
  const own = (key && CUSTODY_PROFILE[key]) || {};
  return { ...base, ...own, labels: { ...own.labels } };
}

const CLASS_NAME = { 1: "Class I", 2: "Class II", 3: "Class III" };
const DOC_LABEL = { lot: "Lot form", inspection: "Report", recall: "Notice" };
const FORM_STORE = "chuck-and-verify.formBundles";
const TAB_KEY = "chuck-and-verify.dashTab";

const $ = (id) => document.getElementById(id);
const dashboard = $("dashboard");
const panel = $("dashPanel");
const tabs = $("dashTabs");
const synced = $("dashSynced");
const credential = $("dashCredential");
const dashStatus = $("dashStatus");
const onboarding = $("onboarding");

let session = null;
let data = null;
let active = null;
let backfilled = false;
let loadRun = 0;

function el(tag, { dataset, ...props } = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  if (dataset) Object.assign(node.dataset, dataset);
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const day = (ms) => (ms ? dateFmt.format(new Date(ms)) : "");

function storage(get, key, value) {
  try {
    if (get) return sessionStorage.getItem(key);
    sessionStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the default tab is fine.
  }
  return null;
}

// --- Navigation into the existing action cards ------------------------------

function goTo(sectionId, fill = {}, focusId) {
  const section = $(sectionId);
  if (!section || section.hidden) return;
  for (const [id, value] of Object.entries(fill)) {
    const input = $(id);
    if (input) input.value = value;
  }
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  section.classList.remove("is-arrived");
  void section.offsetWidth;
  section.classList.add("is-arrived");
  const target = $(focusId) || section.querySelector("input, select, button");
  target?.focus({ preventScroll: true });
}

const ACTIONS = {
  register: {
    label: "Register a batch",
    hint: "Add a new batch with its weight and form.",
    run: () => goTo("registerSection", {}, "newBatchId")
  },
  recall: {
    label: "Recall a batch",
    hint: "Pull one of your batches and file the notice.",
    run: (id) => goTo("recallSection", id ? { recallBatchId: id } : {}, id ? "recallClass" : "recallBatchId")
  },
  inspect: {
    label: "Record an inspection",
    hint: "File a report and mark a batch passed or failed.",
    run: (id) => goTo("inspectSection", id ? { inspectBatchId: id } : {}, id ? "inspectResult" : "inspectBatchId")
  },
  ship: {
    label: "Ship a batch",
    hint: "Hand a batch in your custody to the next wallet.",
    run: (id) => goTo("custodySection", id ? { custodyBatchId: id } : {}, id ? "custodyTo" : "custodyBatchId")
  },
  split: {
    label: "Split a batch into lots",
    hint: "Divide a batch in your custody into lots you can ship separately.",
    run: (id) => goTo("splitSection", id ? { splitBatchId: id } : {}, id ? "splitCount" : "splitBatchId")
  },
  receive: {
    label: "Confirm a delivery",
    hint: "Take custody of a batch shipped to you.",
    run: (id) => goTo("custodySection", id ? { custodyBatchId: id } : {}, id ? "confirmReceipt" : "custodyBatchId")
  },
  users: {
    label: "Manage portal users",
    hint: "Add people, change roles, and review requests.",
    run: () => goTo("adminSection", {}, "adminAddress")
  },
  verify: {
    label: "Verify a batch",
    hint: "Look up any batch on the blockchain.",
    run: () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      $("batchId").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      $("batchId").focus({ preventScroll: true });
    }
  }
};

function canDo(keys, labels = {}) {
  return el(
    "div",
    { className: "can-do" },
    el("h2", { className: "dash-sub" }, "What you can do"),
    el(
      "ul",
      { className: "can-do-list" },
      ...keys.map((key) => {
        const action = ACTIONS[key];
        const [label, hint] = labels[key] || [action.label, action.hint];
        const button = el("button", { type: "button", className: "can-do-btn" },
          el("span", { className: "can-do-label" }, label),
          el("span", { className: "can-do-hint" }, hint)
        );
        button.onclick = () => action.run();
        return el("li", {}, button);
      })
    )
  );
}

// --- Counts ------------------------------------------------------------------

// Each figure can carry the action it calls for, so a count is a way in.
function tally(items) {
  return el(
    "dl",
    { className: "tally" },
    ...items.map(({ n, label, tone, action }) =>
      el(
        "div",
        { className: "tally-item" + (tone ? " is-" + tone : "") },
        el("dt", {}, label),
        el("dd", {}, el("span", { className: "tally-n" }, String(n)),
          action ? (() => {
            const b = el("button", { type: "button", className: "tally-go" }, action.label);
            b.onclick = action.run;
            return b;
          })() : null
        )
      )
    )
  );
}

function recallAlert(rows, text) {
  const recalled = rows.filter((r) => r.recalled);
  if (!recalled.length) return null;
  return el(
    "div",
    { className: "recall-alert", role: "alert" },
    el("p", { className: "recall-alert-title" },
      recalled.length === 1 ? "1 batch is recalled" : recalled.length + " batches are recalled"),
    el("p", {}, typeof text === "function" ? text(recalled.length) : text),
    el(
      "ul",
      { className: "recall-alert-list" },
      ...recalled.map((r) =>
        el("li", {}, el("strong", {}, r.batchId), " ", CLASS_NAME[r.recallClass] || "", r.recalledAt ? ", " + day(r.recalledAt) : "")
      )
    )
  );
}

// --- Table -------------------------------------------------------------------

// The dot and its words wrap as two boxes, so a narrow column never leaves
// the dot alone on a line.
function stateTag(tone, ...text) {
  return el("span", { className: "state" + (tone ? " is-" + tone : "") }, el("span", { className: "state-text" }, ...text));
}

function inspectionCell(r) {
  if (!r.inspected) return stateTag("wait", "Waiting");
  return stateTag(
    r.passed ? "pass" : "fail",
    r.passed ? "Passed" : "Failed",
    r.inspectedAt ? el("span", { className: "state-date" }, day(r.inspectedAt)) : null
  );
}

// In your hands and free to act on: not in transit, and not split (a split
// batch lives on as its lots).
const withYou = (r) => r.holderIsYou && !r.inTransit && !r.lotCount;

function custodyCell(r, role) {
  const words = custodyProfile(role);
  // A split batch lives on as its lots; it has no custody of its own.
  if (r.lotCount) return stateTag(null, "Split into " + r.lotCount + " lots");
  if (r.incomingToYou) return stateTag("wait", words.incomingTag);
  if (r.holderIsYou && r.inTransit) return stateTag(null, "Shipped, not yet received");
  if (r.holderIsYou) return stateTag("yours", words.here);
  return stateTag("away", r.inTransit ? "In transit" : "With another custodian");
}

function docButtons(r) {
  if (!r.documents.length) {
    // A waiting batch has no report yet; that isn't missing paperwork.
    return el("span", { className: "none" }, r.inspected || r.processorIsYou ? "None saved" : "");
  }
  return el(
    "span",
    { className: "doc-links" },
    ...r.documents.map((doc) => {
      const b = el("button", { type: "button", className: "doc-link" }, DOC_LABEL[doc.kind]);
      b.setAttribute("aria-label", "Open " + DOC_LABEL[doc.kind].toLowerCase() + " for " + r.batchId);
      b.onclick = () => openDoc(doc, b);
      return b;
    })
  );
}

function rowAction(r, role) {
  const perms = new Set(session.permissions);
  let keys = [];
  if (role === "INSPECTOR" && !r.inspected && !r.recalled) keys = ["inspect"];
  if (role === "CUSTODIAN" && r.incomingToYou) keys = ["receive"];
  // A recall is serious and rare, so it lives in "What you can do", not on
  // every row. Shipping is the everyday next step for a batch you hold, and
  // a batch that isn't a lot can be split first. A split batch has no
  // actions: its lots carry on.
  // Each kind of custodian gets only the steps its business takes: a
  // retailer doesn't ship on, a carrier doesn't split.
  const profile = custodyProfile(role);
  if ((role === "CUSTODIAN" || role === "PROCESSOR") && withYou(r)) {
    keys = [
      ...(r.recalled || !profile.ship ? [] : ["ship"]),
      ...(r.parentId || !profile.split ? [] : ["split"])
    ];
  }
  keys = keys.filter((key) => perms.has(key === "inspect" ? "batch.inspect" : "custody.transfer"));
  if (!keys.length) return null;
  const labels = { inspect: "Inspect", receive: "Confirm receipt", ship: "Ship", split: "Split" };
  for (const [key, words] of Object.entries(profile.labels)) labels[key] = words[2];
  const buttons = keys.map((key) => {
    const b = el("button", { type: "button", className: "btn btn-ghost btn-small" }, labels[key]);
    b.setAttribute("aria-label", labels[key] + " " + r.batchId);
    b.onclick = () => ACTIONS[key].run(r.batchId);
    return b;
  });
  return buttons.length === 1 ? buttons[0] : el("span", { className: "row-actions" }, ...buttons);
}

// Columns each role needs. Custodians file no forms; inspectors don't
// track custody.
const COLUMNS = {
  INSPECTOR: ["Inspection", "Report"],
  PROCESSOR: ["Inspection", "Custody", "Forms"],
  CUSTODIAN: ["Inspection", "Custody"]
};

// Filters each role reaches for most. A chip with nothing in it is hidden,
// unless it is the one selected.
const FILTERS = {
  INSPECTOR: [
    ["waiting", "Waiting", (r) => !r.inspected && !r.recalled],
    ["passed", "Passed", (r) => r.inspected && r.passed],
    ["failed", "Failed", (r) => r.inspected && !r.passed],
    ["recalled", "Recalled", (r) => r.recalled]
  ],
  PROCESSOR: [
    ["withYou", "With you", withYou],
    ["shipped", "Shipped", (r) => !r.holderIsYou || r.inTransit],
    ["waiting", "Waiting for inspection", (r) => !r.inspected && !r.recalled],
    ["recalled", "Recalled", (r) => r.recalled]
  ],
  CUSTODIAN: () => {
    const words = custodyProfile();
    return [
      ["incoming", words.incomingTag, (r) => r.incomingToYou],
      ["withYou", words.here, withYou],
      ["passedOn", words.passedOn, (r) => !r.holderIsYou && !r.incomingToYou],
      ["recalled", "Recalled", (r) => r.recalled]
    ];
  }
};

// Status order for sorting: what needs someone comes first.
const inspectionRank = (r) => (!r.inspected ? 0 : r.passed ? 2 : 1);
const custodyRank = (r) =>
  r.lotCount ? 5 : r.incomingToYou ? 0 : r.holderIsYou && !r.inTransit ? 1 : r.holderIsYou ? 2 : r.inTransit ? 3 : 4;
const byId = (a, b) => a.batchId.localeCompare(b.batchId, undefined, { numeric: true });
const SORTS = {
  updated: { label: "Latest activity", dir: "desc", cmp: (a, b) => (a.lastMovedAt || 0) - (b.lastMovedAt || 0) },
  batch: { label: "Batch ID", dir: "asc", cmp: byId },
  inspection: {
    label: "Inspection",
    dir: "asc",
    cmp: (a, b) => inspectionRank(a) - inspectionRank(b) || (b.inspectedAt || 0) - (a.inspectedAt || 0)
  },
  custody: { label: "Custody", dir: "asc", cmp: (a, b) => custodyRank(a) - custodyRank(b) }
};
const DEFAULT_SORT = { INSPECTOR: "inspection", PROCESSOR: "updated", CUSTODIAN: "custody" };
const COLUMN_SORT = { Batch: "batch", Inspection: "inspection", Custody: "custody" };

// Per-role table state survives refreshes (a new shipment shouldn't reset
// what someone was looking at) but not a sign-out.
const tableState = new Map();
function stateFor(role) {
  if (!tableState.has(role)) {
    const sort = DEFAULT_SORT[role];
    // `open`: batch id -> whether its lots are showing, once someone has
    // pressed its toggle. Without an entry, a batch opens only when a filter
    // or search matches its lots and not the batch itself. Changing the
    // filter or search clears these choices.
    tableState.set(role, { filter: "all", query: "", sort, dir: SORTS[sort].dir, open: new Map() });
  }
  return tableState.get(role);
}

function sortRows(rows, state) {
  const { cmp } = SORTS[state.sort];
  const sign = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * cmp(a, b) || byId(a, b));
}

// The table lists batches. A split batch's lots sit under it and show on
// request. A lot whose batch isn't in this list (a carrier who received only
// one lot) is listed on its own.
function groupRows(rows) {
  const ids = new Set(rows.map((r) => r.batchId));
  const lotsOf = new Map();
  const tops = [];
  for (const r of rows) {
    if (r.parentId && ids.has(r.parentId)) {
      if (!lotsOf.has(r.parentId)) lotsOf.set(r.parentId, []);
      lotsOf.get(r.parentId).push(r);
    } else {
      tops.push(r);
    }
  }
  return tops.map((top) => ({ top, lots: (lotsOf.get(top.batchId) || []).sort(byId) }));
}

function lotTable(rows, role, empty) {
  if (!rows.length) return el("p", { className: "dash-empty" }, empty);
  const state = stateFor(role);
  const cols = COLUMNS[role];
  const filters = typeof FILTERS[role] === "function" ? FILTERS[role]() : FILTERS[role];
  const cell = {
    Inspection: inspectionCell,
    Custody: (r) => custodyCell(r, role),
    Forms: docButtons,
    Report: docButtons
  };

  const count = el("p", { className: "lots-count", role: "status" });
  const chips = el("div", { className: "chips", role: "group" });
  chips.setAttribute("aria-label", "Show");
  const search = el("input", {
    type: "search",
    className: "lots-search",
    placeholder: "Find a batch ID",
    value: state.query,
    autocomplete: "off",
    spellcheck: false
  });
  search.setAttribute("aria-label", "Find a batch ID");
  // Column headers sort on wide screens; phones get this menu instead.
  const sortSelect = el(
    "select",
    { className: "lots-sort" },
    ...Object.entries(SORTS).map(([key, s]) => el("option", { value: key, textContent: s.label }))
  );
  sortSelect.setAttribute("aria-label", "Sort by");
  const body = el("div", { className: "lots-body" });

  function chip(key, label, n) {
    const b = el("button", { type: "button", className: "chip" }, label, el("span", { className: "chip-n" }, String(n)));
    b.setAttribute("aria-pressed", String(state.filter === key));
    b.onclick = () => {
      state.filter = state.filter === key && key !== "all" ? "all" : key;
      // A new filter starts from its own default: batches open only to show
      // matching lots.
      state.open.clear();
      render();
    };
    return b;
  }

  function sortHeader(label) {
    const key = COLUMN_SORT[label];
    const th = el("th", { scope: "col" });
    if (!key) {
      th.append(label);
      return th;
    }
    const active = state.sort === key;
    th.setAttribute("aria-sort", active ? (state.dir === "asc" ? "ascending" : "descending") : "none");
    const b = el("button", { type: "button", className: "sort-btn" }, label, el("span", { className: "sort-mark" }));
    b.onclick = () => {
      if (state.sort === key) state.dir = state.dir === "asc" ? "desc" : "asc";
      else Object.assign(state, { sort: key, dir: SORTS[key].dir });
      render();
      body.querySelector("th[aria-sort]:not([aria-sort=none]) .sort-btn")?.focus();
    };
    th.append(b);
    return th;
  }

  const groups = groupRows(rows);
  const lotTotal = rows.length - groups.length;
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  function batchRow(r, { lot = false, group = null, matches = null, open = false } = {}) {
    const meta = lot
      ? r.weightLbs + " lbs, split " + day(r.registeredAt)
      : r.parentId
        ? "Lot of " + r.parentId + ", " + r.weightLbs + " lbs, split " + day(r.registeredAt)
        : r.weightLbs + " lbs, registered " + day(r.registeredAt);
    let toggle = null;
    if (group && group.lots.length) {
      const n = group.lots.length;
      const shownLots = matches ? matches.length : n;
      const label = open
        ? "Hide lots"
        : "Show " + (shownLots === n ? plural(n, "lot", "lots") : shownLots + " of " + n + " lots");
      toggle = el("button", { type: "button", className: "lots-toggle" }, el("span", { className: "lots-caret" }), label);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", label + " in " + r.batchId);
      toggle.onclick = () => {
        state.open.set(r.batchId, !open);
        render();
        body.querySelector('[data-toggle="' + CSS.escape(r.batchId) + '"]')?.focus();
      };
      toggle.dataset.toggle = r.batchId;
    }
    return el(
      "tr",
      { className: [r.recalled ? "is-recalled" : "", lot ? "is-lot" : "", open ? "is-open" : ""].filter(Boolean).join(" ") },
      el("th", { scope: "row" },
        el("span", { className: "lot-id" }, r.batchId),
        r.recalled ? el("span", { className: "lot-flag" }, "Recalled, " + (CLASS_NAME[r.recallClass] || "")) : null,
        el("span", { className: "lot-meta" }, meta),
        toggle
      ),
      ...cols.map((c) => el("td", { dataset: { label: c } }, cell[c](r))),
      el("td", { className: "lot-action" }, rowAction(r, role))
    );
  }

  function render() {
    const tests = Object.fromEntries(filters.map(([key, , test]) => [key, test]));
    const q = state.query.trim().toLowerCase();
    const narrowed = state.filter !== "all" || q !== "";
    const match = (r) => (state.filter === "all" || tests[state.filter](r)) && r.batchId.toLowerCase().includes(q);
    const sign = state.dir === "asc" ? 1 : -1;
    const { cmp } = SORTS[state.sort];

    // A batch shows when it or any of its lots matches. It sorts by its most
    // relevant member (the newest activity, the most urgent custody state).
    const shown = groups
      .map((g) => {
        const topMatches = match(g.top);
        const lotMatches = g.lots.filter(match);
        if (!topMatches && !lotMatches.length) return null;
        const rep = sortRows([g.top, ...g.lots], state)[0];
        const open = state.open.has(g.top.batchId)
          ? state.open.get(g.top.batchId)
          : narrowed && !topMatches && lotMatches.length > 0;
        // Under a filter, an opened batch lists only its matching lots, unless
        // it matched on its own and none of its lots do.
        const listed = narrowed && lotMatches.length ? lotMatches : g.lots;
        return { ...g, rep, open, lotMatches: listed };
      })
      .filter(Boolean)
      .sort((a, b) => sign * cmp(a.rep, b.rep) || byId(a.top, b.top));

    chips.replaceChildren(
      chip("all", "All", rows.length),
      ...filters
        .map(([key, label, test]) => [key, label, rows.filter(test).length])
        .filter(([key, , n]) => n > 0 || state.filter === key)
        .map(([key, label, n]) => chip(key, label, n))
    );
    sortSelect.value = state.sort;
    const total = plural(groups.length, "batch", "batches") + (lotTotal ? ", " + plural(lotTotal, "lot", "lots") : "");
    count.textContent = narrowed ? "Showing " + shown.length + " of " + plural(groups.length, "batch", "batches") : total;

    if (!shown.length) {
      const reset = el("button", { type: "button", className: "doc-link" }, "Show all batches");
      reset.onclick = () => {
        Object.assign(state, { filter: "all", query: "" });
        state.open.clear();
        search.value = "";
        render();
      };
      body.replaceChildren(el("p", { className: "dash-empty" }, "No batches match. ", reset));
      return;
    }

    const caption = SORTS[state.sort].label + ", " + (state.dir === "asc" ? "ascending" : "descending");
    body.replaceChildren(
      el(
        "table",
        { className: "lots" },
        el("caption", { className: "visually-hidden" }, "Batches, sorted by " + caption + ". Lots are listed under the batch they were split from."),
        el("thead", {}, el("tr", {},
          sortHeader("Batch"),
          ...cols.map(sortHeader),
          el("th", { scope: "col" }, el("span", { className: "visually-hidden" }, "Action"))
        )),
        el(
          "tbody",
          {},
          ...shown.flatMap((g) => [
            batchRow(g.top, { group: g, matches: g.lotMatches, open: g.open }),
            ...(g.open ? g.lotMatches.map((r) => batchRow(r, { lot: true })) : [])
          ])
        )
      )
    );
  }

  search.oninput = () => {
    state.query = search.value;
    state.open.clear();
    render();
  };
  sortSelect.onchange = () => {
    Object.assign(state, { sort: sortSelect.value, dir: SORTS[sortSelect.value].dir });
    render();
  };
  render();

  return el(
    "section",
    { className: "lots-wrap" },
    el("div", { className: "lots-head" }, el("h2", { className: "dash-sub" }, "Batches"), count),
    el("div", { className: "lots-controls" }, chips, el("div", { className: "lots-tools" }, search, sortSelect)),
    body
  );
}

// --- Panels ------------------------------------------------------------------

function firstRow(rows, test) {
  return rows.find(test)?.batchId;
}

const PANELS = {
  INSPECTOR(v) {
    const next = firstRow(v.rows, (r) => !r.inspected);
    return [
      orgIntro("INSPECTOR"),
      tally([
        {
          n: v.waiting,
          label: "waiting for inspection",
          tone: v.waiting ? "wait" : null,
          action: next ? { label: "Inspect " + next, run: () => ACTIONS.inspect.run(next) } : null
        },
        { n: v.inspected, label: v.inspected === 1 ? "inspection recorded" : "inspections recorded" }
      ]),
      canDo(["inspect", "verify"]),
      lotTable(v.rows, "INSPECTOR", "No batches are waiting. A batch shows up here as soon as a processor registers it.")
    ];
  },
  PROCESSOR(v) {
    const perms = new Set(session.permissions);
    return [
      orgIntro("PROCESSOR"),
      recallAlert(v.rows.filter((r) => !r.lotCount), (n) =>
        (n === 1 ? "Keep it" : "Keep them") + " out of shipments. Any custodian holding " +
        (n === 1 ? "it" : "them") + " sees the same alert."
      ),
      tally([
        { n: v.registered, label: v.registered === 1 ? "batch registered" : "batches registered" },
        { n: v.inCustody, label: "still in your custody" },
        { n: v.recalled, label: "recalled", tone: v.recalled ? "recall" : null }
      ]),
      canDo(["register", "recall", ...(perms.has("custody.transfer") ? ["ship", "split"] : [])]),
      lotTable(v.rows, "PROCESSOR", "You haven't registered a batch yet. Register one to see it here.")
    ];
  },
  CUSTODIAN(v) {
    const words = custodyProfile();
    const incoming = firstRow(v.rows, (r) => r.incomingToYou);
    const confirm = words.labels.receive ? words.labels.receive[2] : "Confirm";
    return [
      orgIntro("CUSTODIAN"),
      recallAlert(
        v.rows.filter((r) => r.holderIsYou && !r.lotCount),
        (n) => words.hold[n === 1 ? 0 : 1] + HOLD_UNTIL + (n === 1 ? "it." : "them.")
      ),
      tally([
        { n: v.inCustody, label: words.inCustody, tone: v.recalledInCustody ? "recall" : null },
        {
          n: v.incoming,
          label: words.incoming,
          tone: v.incoming ? "wait" : null,
          action: incoming ? { label: confirm + " " + incoming, run: () => ACTIONS.receive.run(incoming) } : null
        }
      ]),
      canDo(words.actions, words.labels),
      lotTable(v.rows, "CUSTODIAN", words.empty)
    ];
  },
  ADMIN(v) {
    return [
      tally([
        { n: v.users, label: v.users === 1 ? "portal user" : "portal users" },
        {
          n: v.requests,
          label: v.requests === 1 ? "access request waiting" : "access requests waiting",
          tone: v.requests ? "wait" : null,
          action: v.requests ? { label: "Review", run: () => goTo("adminSection") } : null
        }
      ]),
      canDo(["users", "verify"])
    ];
  }
};

// One line naming the business this panel is for, so a carrier can see the
// portal knows it is a carrier.
function orgIntro(role) {
  const key = orgOf(role);
  if (!key) return null;
  return el("p", { className: "dash-intro" }, el("strong", {}, ORGS[key].name + ". "), ORGS[key].desc);
}

const tabName = (role) => {
  const key = orgOf(role);
  return key ? ORGS[key].tab || ORGS[key].name : ROLE_NAME[role];
};

function missingAbilities() {
  const missing = ROLE_ORDER.filter((r) => !session.roles.includes(r)).map((r) => ROLE_ABILITY[r]);
  if (!missing.length) return null;
  const list =
    missing.length === 1 ? missing[0] : missing.slice(0, -1).join(", ") + " or " + missing.at(-1);
  const next = session.roles.includes("ADMIN")
    ? "You can add them to your own wallet in Portal users."
    : "Ask a portal admin if you need them.";
  return el("p", { className: "dash-missing" }, "Your roles don't include " + list + ". " + next);
}

function renderPanel() {
  const roles = ROLE_ORDER.filter((r) => data.views[r]);
  if (!roles.includes(active)) active = roles[0];
  tabs.hidden = roles.length < 2;
  tabs.replaceChildren(
    ...roles.map((role) => {
      const b = el("button", {
        type: "button",
        role: "tab",
        id: "dashTab-" + role,
        className: "dash-tab",
        textContent: tabName(role)
      });
      b.setAttribute("aria-selected", String(role === active));
      b.tabIndex = role === active ? 0 : -1;
      b.onclick = () => {
        active = role;
        storage(false, TAB_KEY, role);
        renderPanel();
        $("dashTab-" + role).focus();
      };
      return b;
    })
  );
  tabs.onkeydown = (event) => {
    const i = roles.indexOf(active);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    $("dashTab-" + roles[(i + step + roles.length) % roles.length]).click();
  };
  panel.setAttribute("aria-labelledby", roles.length > 1 ? "dashTab-" + active : "dash-heading");
  panel.replaceChildren(...PANELS[active](data.views[active]).filter(Boolean), missingAbilities() || "");
}

function renderSynced(chainState) {
  if (!chainState.syncedAt) {
    synced.textContent = "The blockchain didn't answer. Counts will appear once it does.";
    synced.classList.add("is-stale");
    return;
  }
  synced.classList.toggle("is-stale", chainState.stale);
  synced.textContent = chainState.stale
    ? "Showing counts from " + timeFmt.format(new Date(chainState.syncedAt)) + ". The blockchain didn't answer just now."
    : "Up to date as of " + timeFmt.format(new Date(chainState.syncedAt));
}

// --- On-chain permission check ----------------------------------------------

// Portal roles decide what the page shows; CredentialRegistry decides what
// the contract accepts. Say so when they disagree, before a write fails.
async function checkCredentials(run) {
  credential.hidden = true;
  const chainRoles = session.roles.filter((r) => r !== "ADMIN");
  if (!chainRoles.length) return;
  try {
    const results = await Promise.all(
      chainRoles.map((role) =>
        publicClient.readContract({
          address: credentialRegistryAddress,
          abi: registryAbi,
          functionName: "isValid",
          args: [session.address, keccak256(stringToHex(role))]
        })
      )
    );
    if (run !== loadRun) return;
    const lapsed = chainRoles.filter((_, i) => !results[i]).map((r) => ROLE_NAME[r].toLowerCase());
    if (!lapsed.length) return;
    credential.replaceChildren(
      el("strong", {}, "Your " + lapsed.join(" and ") + " access isn't active on the blockchain. "),
      "The portal shows your tools, but the blockchain will refuse what you submit until an admin renews it."
    );
    credential.hidden = false;
  } catch {
    // Can't reach the chain: the sync line already says so.
  }
}

// --- Documents ---------------------------------------------------------------

async function openDoc(doc, button) {
  // Open the tab now, while the click still counts as a user action; the
  // wallet prompt that follows would otherwise trip the popup blocker.
  const tab = window.open("", "_blank");
  if (tab) {
    tab.document.title = "Opening form";
    tab.document.body.textContent = "Approve the request in your wallet to open this form (no fee).";
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Opening…";
  dashStatus.textContent = "Approve in your wallet to open the form (no fee).";
  try {
    const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
    const blob = await openEncryptedForm({
      doc,
      account: session.address,
      signMessage: (message) => walletClient.signMessage({ account: session.address, message })
    });
    const url = URL.createObjectURL(blob);
    if (tab && !tab.closed) {
      tab.location.href = url;
    } else {
      el("a", { href: url, download: doc.name || "form.pdf" }).click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    dashStatus.textContent = "";
  } catch (error) {
    tab?.close();
    dashStatus.textContent = isUserRejection(error)
      ? "Cancelled. The form stays private."
      : error.message;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// Forms filed before the server kept records live only in this browser.
// Send their receipts once so they open from any device; the server keeps
// only those that match a batch this wallet registered or inspected.
async function backfillLocalForms() {
  if (backfilled) return false;
  backfilled = true;
  let store;
  try {
    store = JSON.parse(localStorage.getItem(FORM_STORE) || "{}");
  } catch {
    return false;
  }
  const have = new Set();
  for (const view of Object.values(data.views)) {
    for (const r of view.rows || []) for (const d of r.documents) have.add(d.kind + ":" + r.batchId);
  }
  const jobs = [];
  for (const [key, bundle] of Object.entries(store || {})) {
    if (!bundle || String(bundle.address || "").toLowerCase() !== session.address) continue;
    const kind = key.startsWith("inspection:") ? "inspection" : "lot";
    const batchId = kind === "inspection" ? key.slice("inspection:".length) : key;
    const perm = kind === "inspection" ? "batch.inspect" : "batch.register";
    if (have.has(kind + ":" + batchId) || !session.permissions.includes(perm)) continue;
    jobs.push(
      api("/api/documents", { method: "POST", body: JSON.stringify({ kind, batchId, bundle }) }).catch(() => null)
    );
  }
  if (!jobs.length) return false;
  await Promise.all(jobs);
  return true;
}

// --- Loading -----------------------------------------------------------------

async function loadDashboard() {
  const run = ++loadRun;
  try {
    data = await api("/api/dashboard");
  } catch (error) {
    if (run !== loadRun) return;
    panel.replaceChildren(el("p", { className: "dash-empty" }, "Your dashboard couldn't load. " + error.message));
    return;
  }
  if (run !== loadRun) return;
  if (await backfillLocalForms()) {
    data = await api("/api/dashboard").catch(() => data);
    if (run !== loadRun) return;
  }
  renderSynced(data.chain);
  renderPanel();
}

export function refreshDashboard() {
  if (session && session.roles.length) loadDashboard();
}

// Called by app.js whenever the signed-in state changes.
export function renderForSession(next) {
  const signedIn = Boolean(next && next.address);
  const changed =
    !session || !next || session.address !== next.address ||
    session.roles.join() !== next.roles.join() || session.organization !== next.organization;
  session = signedIn ? next : null;

  dashboard.hidden = !signedIn || !next.roles.length;
  onboarding.hidden = !signedIn || next.roles.length > 0;
  if (!signedIn) {
    loadRun++;
    backfilled = false;
    data = null;
    tableState.clear();
    return;
  }
  // A custodian whose business doesn't split lots doesn't need the card.
  // The contract would still accept a split; this only trims the page.
  if (!custodyProfile().split) $("splitSection").hidden = true;
  if (!changed) return;
  if (next.roles.length) {
    active = storage(true, TAB_KEY) || null;
    panel.replaceChildren(el("p", { className: "dash-empty" }, "Loading your batches…"));
    synced.textContent = "";
    loadDashboard();
    checkCredentials(loadRun);
  } else {
    renderOnboarding();
  }
}

// --- Onboarding --------------------------------------------------------------

const onboardStatus = $("onboardStatus");

function renderOnboarding() {
  $("onboardAddress").textContent = session.address;
  $("onboardRoles").replaceChildren(
    ...ORG_ORDER.map((key) =>
      el(
        "label",
        { className: "role-option" },
        el("input", { type: "radio", name: "requestOrg", value: key }),
        el("span", { className: "role-option-text" },
          el("span", { className: "role-option-name" }, ORGS[key].name),
          el("span", { className: "role-option-desc" }, ORGS[key].desc)
        )
      )
    )
  );
  onboardStatus.textContent = "";
  api("/api/dashboard")
    .then((d) => showRequest(d.request))
    .catch(() => showRequest(null));
}

function showRequest(request) {
  $("onboardRequestForm").hidden = Boolean(request);
  $("onboardPending").hidden = !request;
  if (!request) return;
  const names = request.roles.map((r) => ROLE_NAME[r] || r);
  const asked = ORGS[request.organization]
    ? "access as a " + ORGS[request.organization].name.toLowerCase().replace("usda fsis", "USDA FSIS")
    : names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0];
  $("onboardPendingText").replaceChildren(
    el("strong", {}, "Request sent " + day(request.createdAt) + "."),
    " You asked for " + asked + ". A portal admin will review it."
  );
}

$("copyAddress").onclick = async () => {
  const button = $("copyAddress");
  try {
    await navigator.clipboard.writeText(session.address);
    button.textContent = "Copied";
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("onboardAddress"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    button.textContent = "Selected, press Copy";
  }
  setTimeout(() => (button.textContent = "Copy address"), 2000);
};

$("requestAccess").onclick = async () => {
  const organization = document.querySelector("input[name=requestOrg]:checked")?.value;
  if (!organization) {
    onboardStatus.textContent = "Choose what kind of organization you are.";
    return;
  }
  const button = $("requestAccess");
  button.disabled = true;
  onboardStatus.textContent = "Sending…";
  try {
    const { request } = await api("/api/access-request", {
      method: "POST",
      body: JSON.stringify({ organization, note: $("onboardNote").value })
    });
    onboardStatus.textContent = "";
    showRequest(request);
  } catch (error) {
    onboardStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$("withdrawRequest").onclick = async () => {
  try {
    await api("/api/access-request", { method: "DELETE" });
    onboardStatus.textContent = "Request withdrawn.";
    showRequest(null);
  } catch (error) {
    onboardStatus.textContent = error.message;
  }
};
