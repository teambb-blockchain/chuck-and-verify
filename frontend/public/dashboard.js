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
const ROLE_PLAIN = {
  PROCESSOR: "Register new batches and recall your own.",
  INSPECTOR: "Record USDA inspections with a report.",
  CUSTODIAN: "Ship batches and confirm deliveries."
};
// What each role adds, phrased to finish "Your roles don't include …".
const ROLE_ABILITY = {
  PROCESSOR: "registering batches",
  INSPECTOR: "recording inspections",
  CUSTODIAN: "moving batches",
  ADMIN: "managing portal users"
};
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
    hint: "Add a new lot with its weight and lot form.",
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

function canDo(keys) {
  return el(
    "div",
    { className: "can-do" },
    el("h2", { className: "dash-sub" }, "What you can do"),
    el(
      "ul",
      { className: "can-do-list" },
      ...keys.map((key) => {
        const action = ACTIONS[key];
        const button = el("button", { type: "button", className: "can-do-btn" },
          el("span", { className: "can-do-label" }, action.label),
          el("span", { className: "can-do-hint" }, action.hint)
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

function custodyCell(r) {
  if (r.incomingToYou) return stateTag("wait", "On its way to you");
  if (r.holderIsYou && r.inTransit) return stateTag(null, "Shipped, not yet received");
  if (r.holderIsYou) return stateTag("yours", "With you");
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
  let key = null;
  if (role === "INSPECTOR" && !r.inspected && !r.recalled) key = "inspect";
  if (role === "CUSTODIAN" && r.incomingToYou) key = "receive";
  // A recall is serious and rare, so it lives in "What you can do", not on
  // every row. Shipping is the everyday next step for a batch you hold.
  if ((role === "CUSTODIAN" || role === "PROCESSOR") && r.holderIsYou && !r.inTransit && !r.recalled) {
    key = "ship";
  }
  if (!key || !perms.has(key === "inspect" ? "batch.inspect" : "custody.transfer")) return null;
  const labels = { inspect: "Inspect", receive: "Confirm receipt", ship: "Ship" };
  const b = el("button", { type: "button", className: "btn btn-ghost btn-small" }, labels[key]);
  b.setAttribute("aria-label", labels[key] + " " + r.batchId);
  b.onclick = () => ACTIONS[key].run(r.batchId);
  return b;
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
    ["withYou", "With you", (r) => r.holderIsYou && !r.inTransit],
    ["shipped", "Shipped", (r) => !r.holderIsYou || r.inTransit],
    ["waiting", "Waiting for inspection", (r) => !r.inspected && !r.recalled],
    ["recalled", "Recalled", (r) => r.recalled]
  ],
  CUSTODIAN: [
    ["incoming", "On its way to you", (r) => r.incomingToYou],
    ["withYou", "With you", (r) => r.holderIsYou && !r.inTransit],
    ["passedOn", "Passed on", (r) => !r.holderIsYou && !r.incomingToYou],
    ["recalled", "Recalled", (r) => r.recalled]
  ]
};

// Status order for sorting: what needs someone comes first.
const inspectionRank = (r) => (!r.inspected ? 0 : r.passed ? 2 : 1);
const custodyRank = (r) =>
  r.incomingToYou ? 0 : r.holderIsYou && !r.inTransit ? 1 : r.holderIsYou ? 2 : r.inTransit ? 3 : 4;
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
    tableState.set(role, { filter: "all", query: "", sort, dir: SORTS[sort].dir });
  }
  return tableState.get(role);
}

function sortRows(rows, state) {
  const { cmp } = SORTS[state.sort];
  const sign = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * cmp(a, b) || byId(a, b));
}

function lotTable(rows, role, empty) {
  if (!rows.length) return el("p", { className: "dash-empty" }, empty);
  const state = stateFor(role);
  const cols = COLUMNS[role];
  const filters = FILTERS[role];
  const cell = {
    Inspection: inspectionCell,
    Custody: custodyCell,
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

  function render() {
    const tests = Object.fromEntries(filters.map(([key, , test]) => [key, test]));
    const q = state.query.trim().toLowerCase();
    const shown = sortRows(
      rows.filter((r) => (state.filter === "all" || tests[state.filter](r)) && r.batchId.toLowerCase().includes(q)),
      state
    );

    chips.replaceChildren(
      chip("all", "All", rows.length),
      ...filters
        .map(([key, label, test]) => [key, label, rows.filter(test).length])
        .filter(([key, , n]) => n > 0 || state.filter === key)
        .map(([key, label, n]) => chip(key, label, n))
    );
    sortSelect.value = state.sort;
    count.textContent =
      shown.length === rows.length ? rows.length + (rows.length === 1 ? " batch" : " batches")
        : "Showing " + shown.length + " of " + rows.length;

    if (!shown.length) {
      const reset = el("button", { type: "button", className: "doc-link" }, "Show all batches");
      reset.onclick = () => {
        Object.assign(state, { filter: "all", query: "" });
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
        el("caption", { className: "visually-hidden" }, "Batches, sorted by " + caption),
        el("thead", {}, el("tr", {},
          sortHeader("Batch"),
          ...cols.map(sortHeader),
          el("th", { scope: "col" }, el("span", { className: "visually-hidden" }, "Action"))
        )),
        el(
          "tbody",
          {},
          ...shown.map((r) =>
            el(
              "tr",
              { className: r.recalled ? "is-recalled" : "" },
              el("th", { scope: "row" },
                el("span", { className: "lot-id" }, r.batchId),
                r.recalled ? el("span", { className: "lot-flag" }, "Recalled, " + (CLASS_NAME[r.recallClass] || "")) : null,
                el("span", { className: "lot-meta" }, r.weightLbs + " lbs, registered " + day(r.registeredAt))
              ),
              ...cols.map((c) => el("td", { dataset: { label: c } }, cell[c](r))),
              el("td", { className: "lot-action" }, rowAction(r, role))
            )
          )
        )
      )
    );
  }

  search.oninput = () => {
    state.query = search.value;
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
      recallAlert(v.rows, (n) =>
        (n === 1 ? "Keep it" : "Keep them") + " out of shipments. Any custodian holding " +
        (n === 1 ? "it" : "them") + " sees the same alert."
      ),
      tally([
        { n: v.registered, label: v.registered === 1 ? "batch registered" : "batches registered" },
        { n: v.inCustody, label: "still in your custody" },
        { n: v.recalled, label: "recalled", tone: v.recalled ? "recall" : null }
      ]),
      canDo(["register", "recall", ...(perms.has("custody.transfer") ? ["ship"] : [])]),
      lotTable(v.rows, "PROCESSOR", "You haven't registered a batch yet. Register one to see it here.")
    ];
  },
  CUSTODIAN(v) {
    const incoming = firstRow(v.rows, (r) => r.incomingToYou);
    return [
      recallAlert(
        v.rows.filter((r) => r.holderIsYou),
(n) =>
          (n === 1 ? "It's in your custody. Don't ship it. Hold it" : "They're in your custody. Don't ship them. Hold them") +
          " until the processor tells you how to return or dispose of " + (n === 1 ? "it." : "them.")
      ),
      tally([
        { n: v.inCustody, label: "in your custody", tone: v.recalledInCustody ? "recall" : null },
        {
          n: v.incoming,
          label: "on the way to you",
          tone: v.incoming ? "wait" : null,
          action: incoming ? { label: "Confirm " + incoming, run: () => ACTIONS.receive.run(incoming) } : null
        }
      ]),
      canDo(["ship", "receive"]),
      lotTable(v.rows, "CUSTODIAN", "Nothing is in your custody. A batch shows up here once it's shipped to your wallet.")
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
        textContent: ROLE_NAME[role]
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
  const changed = !session || !next || session.address !== next.address || session.roles.join() !== next.roles.join();
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
    ...Object.entries(ROLE_PLAIN).map(([role, text]) =>
      el(
        "label",
        { className: "role-option" },
        el("input", { type: "checkbox", name: "requestRoles", value: role }),
        el("span", { className: "role-option-text" },
          el("span", { className: "role-option-name" }, ROLE_NAME[role]),
          el("span", { className: "role-option-desc" }, text)
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
  $("onboardPendingText").replaceChildren(
    el("strong", {}, "Request sent " + day(request.createdAt) + "."),
    " You asked for " + (names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]) +
      ". A portal admin will review it."
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
  const roles = [...document.querySelectorAll("input[name=requestRoles]:checked")].map((b) => b.value);
  if (!roles.length) {
    onboardStatus.textContent = "Choose at least one role.";
    return;
  }
  const button = $("requestAccess");
  button.disabled = true;
  onboardStatus.textContent = "Sending…";
  try {
    const { request } = await api("/api/access-request", {
      method: "POST",
      body: JSON.stringify({ roles, note: $("onboardNote").value })
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
