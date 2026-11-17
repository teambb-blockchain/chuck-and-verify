const { expect } = require("chai");
const { batchesFrom } = require("../server/chainIndex");

// batchesFrom folds decoded events into one record per batch, the way
// getBatch reads on chain. These cover lots split from lots.
describe("chainIndex batchesFrom", function () {
  const PROC = "0xproc", DIST = "0xdist", STORE = "0xstore";
  let ts = 0;
  const ev = (name, batch_id, fields = {}) => ({ name, batch_id, ts: ++ts, tx: "0x" + ts, ...fields });
  const lot = (parent, id, holder, lbs) => ev("LotCreated", id, { other: parent, actor: holder, num: lbs });

  const events = () => [
    ev("BatchRegistered", "B", { actor: PROC, num: 1000 }),
    lot("B", "B-L1", DIST, 600),
    lot("B", "B-L2", DIST, 400),
    lot("B-L1", "B-L1-L1", STORE, 200),
    lot("B-L1", "B-L1-L2", STORE, 400),
    lot("B-L1-L2", "B-L1-L2-L1", STORE, 150),
    // Recorded after the splits: they must still reach every level.
    ev("InspectionRecorded", "B", { actor: "0xinsp", num: 1, hash: "0xreport" }),
    ev("RecallRecorded", "B", { actor: PROC, num: 3, hash: "0xclass3" }),
    ev("RecallRecorded", "B-L1-L2", { actor: PROC, num: 2, hash: "0xclass2" }),
  ];

  it("links each lot to the lot it came from, back to the original batch", function () {
    const byId = Object.fromEntries(batchesFrom(events()).map((b) => [b.batchId, b]));
    expect(byId["B-L1"].lotIds).to.deep.equal(["B-L1-L1", "B-L1-L2"]);
    expect(byId["B-L1-L2-L1"]).to.include({ parentId: "B-L1-L2", processor: PROC, holder: STORE, weightLbs: 150 });
    expect(byId["B-L1-L2-L1"].lineage).to.deep.equal(["B-L1-L2-L1", "B-L1-L2", "B-L1", "B"]);
    expect(byId["B"].lineage).to.deep.equal(["B"]);
  });

  it("gives every level the original inspection and the most serious recall above it", function () {
    const byId = Object.fromEntries(batchesFrom(events()).map((b) => [b.batchId, b]));
    for (const id of ["B-L1", "B-L1-L1", "B-L1-L2-L1"]) {
      expect(byId[id]).to.include({ inspected: true, passed: true, reportHash: "0xreport" });
    }
    expect(byId["B-L1-L1"]).to.include({ recalled: true, recallClass: 3 });
    expect(byId["B-L1-L2-L1"]).to.include({ recalled: true, recallClass: 2, recallHash: "0xclass2" });
  });
});
