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

    it("passes a fully confirmed journey and marks the holder", function () {
      const b = batch();
      const steps = core.buildTimeline(journey(), { batchName: "BEEF-001", batch: b });
      const list = core.deriveChecklist({ steps, batch: b });
      expect(list.signed.status).to.equal("pass");
      expect(list.signed.detail).to.equal("2 of 2 handoffs confirmed by both sides");
      expect(list.credentials.status).to.equal("pass");
      expect(list.coldChain.status).to.equal("none");
      expect(steps.filter((s) => s.currentHolder).map((s) => s.signer)).to.deep.equal([STORE]);
      expect(core.deriveVerdict({ batch: b, checklist: list })).to.deep.equal({ tone: "pass", label: "Verified on-chain" });
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
      expect(list.credentials.detail).to.equal("1 of 4 signers no longer holds an active credential");
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
