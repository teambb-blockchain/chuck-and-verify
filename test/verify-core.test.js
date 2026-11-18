const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

// verify-core.js is a browser ES module with no imports; package.json is
// CommonJS, so load it from its source as a data: URL module.
async function loadCore() {
  const file = path.join(__dirname, "..", "frontend", "public", "verify-core.js");
  const source = fs.readFileSync(file, "utf8");
  return import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}

const ZERO = "0x" + "0".repeat(40);
const PROC = "0x" + "a".repeat(40);
const INSP = "0x" + "b".repeat(40);
const CARRIER = "0x" + "c".repeat(40);
const STORE = "0x" + "d".repeat(40);

let n = 0;
const ev = (name, args) => ({ name, args, blockNumber: ++n, logIndex: 0, txHash: "0x" + n, timestamp: n * 1000 });

describe("verify-core", function () {
  let core;
  before(async function () {
    core = await loadCore();
  });

  describe("batch links", function () {
    it("builds the link a label carries, one per lot", function () {
      expect(core.batchLink("BEEF-A1-001", "https://teambb.didlab.org"))
        .to.equal("https://teambb.didlab.org/?batch=BEEF-A1-001");
      expect(core.batchLink("BEEF-A1-001-L2-L1", "https://teambb.didlab.org/"))
        .to.equal("https://teambb.didlab.org/?batch=BEEF-A1-001-L2-L1");
      expect(core.batchLink("LOT 7&x", "http://localhost:3000")).to.equal("http://localhost:3000/?batch=LOT%207%26x");
    });

    it("reads a batch ID back out of a scanned or pasted link", function () {
      const link = core.batchLink("BEEF-A1-001-L3", "https://teambb.didlab.org");
      expect(core.batchFromScan(link)).to.equal("BEEF-A1-001-L3");
      expect(core.batchFromScan("  " + link + "\n")).to.equal("BEEF-A1-001-L3");
      expect(core.batchFromScan(core.batchLink("LOT 7&x", "http://localhost:3000"))).to.equal("LOT 7&x");
    });

    it("takes a typed ID as typed and a link with no batch as empty", function () {
      expect(core.batchFromScan(" BEEF-A1-001 ")).to.equal("BEEF-A1-001");
      expect(core.batchFromScan("https://teambb.didlab.org/?page=about")).to.equal("");
      expect(core.batchFromScan("")).to.equal("");
    });
  });

  describe("which deployment holds a batch", function () {
    const v4 = { version: 4 };
    const v3 = { version: 3 };
    const v1 = { version: 1 };

    it("uses the current deployment when it has the batch", function () {
      const hit = core.pickDeployment([{ deployment: v4, value: "now" }, { deployment: v3, value: "old" }]);
      expect(hit).to.deep.equal({ deployment: v4, value: "now" });
    });

    it("falls back to an earlier deployment, newest first", function () {
      // BEEF-A1-001 was registered on both v1 and v3: v3 wins.
      const hit = core.pickDeployment([
        { deployment: v4, notFound: true },
        { deployment: v3, value: "v3 record" },
        { deployment: v1, value: "v1 record" }
      ]);
      expect(hit.deployment).to.equal(v3);
      expect(hit.value).to.equal("v3 record");
    });

    it("returns null when no deployment has it", function () {
      expect(core.pickDeployment([{ deployment: v4, notFound: true }, { deployment: v1, notFound: true }])).to.equal(null);
    });

    it("throws when a newer deployment couldn't be read, rather than show an older record", function () {
      const down = new Error("RPC timed out");
      expect(() =>
        core.pickDeployment([{ deployment: v4, error: down }, { deployment: v3, value: "old" }])
      ).to.throw("RPC timed out");
    });

    it("ignores a failure on an older deployment once a newer one has the batch", function () {
      const hit = core.pickDeployment([{ deployment: v4, value: "now" }, { deployment: v1, error: new Error("down") }]);
      expect(hit.deployment).to.equal(v4);
    });
  });

  describe("°C to °F", function () {
    it("converts with F = C × 9/5 + 32", function () {
      expect(core.cToF(0)).to.equal(32);
      expect(core.cToF(100)).to.equal(212);
      expect(core.cToF(-40)).to.equal(-40);
    });

    it("formats to one decimal place", function () {
      expect(core.formatF(1.8)).to.equal("35.2");
      expect(core.formatF(3.6)).to.equal("38.5");
      expect(core.formatF(0)).to.equal("32.0");
    });

    it("counts a run of out-of-range readings as one excursion", function () {
      // 2 °C = 35.6 °F (in), 5 °C = 41 °F (out), -1 °C = 30.2 °F (out)
      const s = core.summarizeReadings([2, 5, 5, 5, 2, -1, 2]);
      expect(s).to.deep.equal({ low: 30.2, high: 41, excursions: 2 });
      expect(core.summarizeReadings([])).to.equal(null);
    });
  });

  describe("checklist", function () {
    const batch = (over = {}) => ({
      currentHolder: STORE,
      pendingReceiver: ZERO,
      inspected: true,
      inspectionPassed: true,
      recalled: false,
      recallClassification: 0,
      ...over
    });
    const journey = () => [
      ev("BatchRegistered", { processor: PROC, weightLbs: "500" }),
      ev("InspectionRecorded", { inspector: INSP, passed: true }),
      ev("ShipmentRecorded", { from: PROC, to: CARRIER }),
      ev("ReceiptConfirmed", { receiver: CARRIER }),
      ev("ShipmentRecorded", { from: CARRIER, to: STORE }),
      ev("ReceiptConfirmed", { receiver: STORE })
    ];

    it("shows each split on the way to a lot split from a lot", function () {
      const up = (e) => ({ ...e, fromParent: true });
      const events = [
        up(ev("BatchRegistered", { processor: PROC, weightLbs: "1000" })),
        up(ev("LotCreated", { parentId: "BEEF-001", lotId: "BEEF-001-L1", holder: CARRIER, weightLbs: "600" })),
        up(ev("ShipmentRecorded", { from: CARRIER, to: STORE })),
        up(ev("ReceiptConfirmed", { receiver: STORE })),
        ev("LotCreated", { parentId: "BEEF-001-L1", lotId: "BEEF-001-L1-L2", holder: STORE, weightLbs: "250" })
      ];
      const steps = core.buildTimeline(events, { batchName: "BEEF-001-L1-L2", batch: batch() });
      const splits = steps.filter((s) => s.kind === "split").map((s) => [s.title, s.detail]);
      expect(splits).to.deep.equal([
        ["Split from BEEF-001", "600 lb lot BEEF-001-L1"],
        ["Split from BEEF-001-L1", "250 lb lot"]
      ]);
    });

    it("passes a fully confirmed journey and marks the holder", function () {
      const b = batch();
      const steps = core.buildTimeline(journey(), { batchName: "BEEF-001", batch: b });
      const list = core.deriveChecklist({ steps, batch: b });
      expect(list.signed.status).to.equal("pass");
      expect(list.signed.detail).to.equal("2 of 2 handoffs confirmed by both sides");
      expect(list.credentials.status).to.equal("pass");
      expect(list.coldChain.status).to.equal("none");
      expect(steps.filter((s) => s.currentHolder).map((s) => s.signer)).to.deep.equal([STORE]);
      expect(core.deriveVerdict({ batch: b, checklist: list })).to.deep.equal({ tone: "pass", label: "Verified" });
    });

    it("names businesses from the directory and leaves unknown wallets unnamed", function () {
      const directory = {
        [PROC]: { name: "Prairie Packers", city: "Amarillo, TX" },
        [STORE]: { name: "Corner Market", city: "" }
      };
      const who = (a) => directory[a] || null;
      const b = batch({ currentHolder: CARRIER, pendingReceiver: STORE });
      const steps = core.buildTimeline(journey().slice(0, 5), { batchName: "BEEF-001", batch: b, who });
      expect(steps.map((s) => s.detail)).to.deep.equal([
        "Prairie Packers, Amarillo, TX · 500 lb batch",
        "Inspection report on file",
        "From Prairie Packers, Amarillo, TX",
        "Arrived and signed for",
        "To Corner Market",
        "Waiting for Corner Market to confirm it arrived"
      ]);
      expect(steps[0].place).to.equal(directory[PROC]);
      expect(core.placeName(null)).to.equal(null);
      expect(core.placeName({ name: "" })).to.equal(null);
    });

    it("turns a journey into map stops, one per place, with the transit leg pending", function () {
      const directory = {
        [PROC]: { name: "Prairie Packers", city: "Amarillo, TX", lat: 35.2, lng: -101.8 },
        [INSP]: { name: "USDA", city: "Dallas, TX", lat: 32.8, lng: -96.8 },
        [CARRIER]: { name: "Lone Star Freight", city: "Dallas, TX", lat: null, lng: null }
      };
      const who = (a) => directory[a] || null;
      const events = [
        ...journey().slice(0, 4),
        ev("LotCreated", { parentId: "BEEF-001", lotId: "BEEF-001-L1", holder: CARRIER, weightLbs: "250" }),
        ev("ShipmentRecorded", { from: CARRIER, to: STORE })
      ];
      const b = batch({ currentHolder: CARRIER, pendingReceiver: STORE });
      const stops = core.routeStops(core.buildTimeline(events, { batchName: "BEEF-001", batch: b, who }));
      expect(stops.map((s) => [s.name, s.located, s.pending, s.current, s.titles.length])).to.deep.equal([
        ["Prairie Packers", true, false, false, 1],
        ["Lone Star Freight", false, false, true, 2],
        [null, false, true, false, 1]
      ]);
      expect(stops[0]).to.include({ lat: 35.2, lng: -101.8, address: PROC });
    });

    it("ends the journey at a final status and stops marking a current holder", function () {
      const events = [
        ...journey(),
        ev("UseBySet", { useBy: "1800000000" }),
        ev("DispositionRecorded", { holder: STORE, disposition: 1 })
      ];
      const b = batch({ disposition: 1 });
      const steps = core.buildTimeline(events, {
        batchName: "BEEF-001",
        batch: b,
        who: (a) => (a === STORE ? { name: "Corner Market", city: "Austin, TX" } : null)
      });
      expect(steps.map((s) => s.kind)).to.not.include("other");
      const last = steps[steps.length - 1];
      expect(last).to.include({ kind: "final", title: "Sold to shoppers", detail: "At Corner Market, Austin, TX", role: "CUSTODIAN" });
      expect(steps.some((s) => s.currentHolder)).to.equal(false);
      const list = core.deriveChecklist({ steps, batch: b });
      expect(core.deriveVerdict({ batch: b, checklist: list }).label).to.equal("Verified · Sold");
    });

    it("warns past the use-by date only while the batch is still in the chain", function () {
      const now = Date.UTC(2026, 10, 18);
      const steps = core.buildTimeline(journey(), { batchName: "BEEF-001", batch: batch() });
      const list = core.deriveChecklist({ steps, batch: batch() });
      const past = batch({ useBy: now - 1000 });
      expect(core.isPastUseBy(past, now)).to.equal(true);
      expect(core.deriveVerdict({ batch: past, checklist: list, nowMs: now })).to.deep.equal({ tone: "warn", label: "Past use-by date" });
      expect(core.deriveVerdict({ batch: batch({ useBy: now + 1000 }), checklist: list, nowMs: now }).label).to.equal("Verified");
      expect(core.deriveVerdict({ batch: batch({ useBy: now - 1000, disposition: 2 }), checklist: list, nowMs: now }).label).to.equal("Verified · Served");
      expect(core.isPastUseBy(batch({ useBy: null }), now)).to.equal(false);
      // A recall still outranks everything.
      expect(core.deriveVerdict({ batch: batch({ useBy: now - 1000, recalled: true, recallClassification: 2 }), checklist: list, nowMs: now }).tone).to.equal("fail");
    });

    it("judges the cold chain from per-leg sensor summaries", function () {
      const steps = core.buildTimeline(journey(), { batchName: "BEEF-001", batch: batch() });
      const rangeC = { low: -2.2, high: 4.44 };
      const cold = { rangeC, legs: [{ minC: 1.2, maxC: 3.1, secondsOut: 0 }, { minC: 0.4, maxC: 2.8, secondsOut: 0 }] };
      const list = core.deriveChecklist({ steps, batch: batch(), temperature: cold });
      expect(list.coldChain).to.deep.equal({ status: "pass", title: "Kept cold", detail: "Every sensor reading stayed within 28–40 °F" });
      expect(list.legSummary).to.include({ low: 32.7, high: 37.6, legs: 2, legsOut: 0 });
      const warm = { rangeC, legs: [...cold.legs, { minC: 1.0, maxC: 6.1, secondsOut: 2700, missing: 1 }] };
      const warned = core.deriveChecklist({ steps, batch: batch(), temperature: warm });
      expect(warned.coldChain).to.deep.equal({ status: "warn", title: "Got too warm or cold", detail: "45 min outside 28–40 °F, on 1 of 3 legs" });
      expect(core.deriveVerdict({ batch: batch(), checklist: warned }).label).to.equal("Verified with warnings");
      expect(core.summarizeLegs({ rangeC, legs: [] })).to.equal(null);
      expect([30, 2700, 5400, 7200].map(core.durationText)).to.deep.equal(["under 1 min", "45 min", "1 h 30 min", "2 h"]);
    });

    it("warns while a shipment awaits receipt", function () {
      const events = journey().slice(0, 5);
      const b = batch({ currentHolder: CARRIER, pendingReceiver: STORE });
      const steps = core.buildTimeline(events, { batchName: "BEEF-001", batch: b });
      const list = core.deriveChecklist({ steps, batch: b });
      expect(list.signed.status).to.equal("warn");
      expect(steps[steps.length - 1].kind).to.equal("pending");
      expect(core.deriveVerdict({ batch: b, checklist: list }).tone).to.equal("warn");
    });

    it("flags a signer whose credential has since lapsed", function () {
      const b = batch();
      const steps = core.buildTimeline(journey(), {
        batchName: "BEEF-001",
        batch: b,
        credentialOk: (addr) => addr !== CARRIER
      });
      const list = core.deriveChecklist({ steps, batch: b });
      expect(list.credentials.status).to.equal("warn");
      expect(list.credentials.detail).to.equal("1 of 4 businesses has since lost its certification");
      expect(steps.filter((s) => s.tone === "warn").length).to.equal(2);
    });

    it("fails a recalled or failed-inspection batch", function () {
      const steps = core.buildTimeline(journey(), { batchName: "BEEF-001", batch: batch() });
      const list = core.deriveChecklist({ steps, batch: batch() });
      expect(core.deriveVerdict({ batch: batch({ recalled: true, recallClassification: 1 }), checklist: list }))
        .to.deep.equal({ tone: "fail", label: "Recalled · Class I" });
      expect(core.deriveVerdict({ batch: batch({ inspectionPassed: false }), checklist: list }).label)
        .to.equal("Failed inspection");
    });

    it("reports a cold-chain excursion when readings leave the range", function () {
      const b = batch();
      const steps = core.buildTimeline(journey(), { batchName: "BEEF-001", batch: b });
      const list = core.deriveChecklist({ steps, batch: b, readingsC: [2, 6, 2] });
      expect(list.coldChain.status).to.equal("warn");
      expect(core.deriveVerdict({ batch: b, checklist: list }).label).to.equal("Verified with warnings");
    });
  });
});
