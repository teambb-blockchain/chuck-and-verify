// Adversarial tests for BeefSupplyChain (Guided Lab 3, Activity 7).
//
// A test named "FINDING …" passes because the defect is present; see
// docs/SECURITY_REVIEW.md for the scenario and severity. When a fix lands,
// the test is flipped to "FIXED …" and asserts the revert, so it guards the fix.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BeefSupplyChain — adversarial", function () {
  let registry, supplyChain;
  let admin, plantA, plantB, inspector, inspector2, carrier, retailer, attacker;
  let CRED_PROCESSOR, CRED_INSPECTOR, CRED_CUSTODIAN;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  // Same encoding as frontend/public/app.js: stringToHex(name, { size: 32 }).
  const lot = (name) => ethers.encodeBytes32String(name);
  const LOT = lot("BB-2026-014");
  const report = ethers.id("inspection-report");
  const notice = ethers.id("recall-notice");

  async function grant(who, type, ttl = ONE_YEAR) {
    await registry.grant(who.address, type, (await time.latest()) + ttl);
  }

  beforeEach(async function () {
    [admin, plantA, plantB, inspector, inspector2, carrier, retailer, attacker] =
      await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CredentialRegistry");
    registry = await Registry.deploy();
    CRED_PROCESSOR = await registry.CRED_PROCESSOR();
    CRED_INSPECTOR = await registry.CRED_INSPECTOR();
    CRED_CUSTODIAN = await registry.CRED_CUSTODIAN();
    for (const t of [CRED_PROCESSOR, CRED_INSPECTOR, CRED_CUSTODIAN]) {
      await registry.setIssuer(t, admin.address);
    }
    for (const p of [plantA, plantB]) {
      await grant(p, CRED_PROCESSOR);
      await grant(p, CRED_CUSTODIAN);
    }
    await grant(inspector, CRED_INSPECTOR);
    await grant(inspector2, CRED_INSPECTOR);
    await grant(carrier, CRED_CUSTODIAN);
    await grant(retailer, CRED_CUSTODIAN);

    const Supply = await ethers.getContractFactory("BeefSupplyChain");
    supplyChain = await Supply.deploy(await registry.getAddress());
  });

  describe("role boundaries — every write from an account lacking the credential", function () {
    beforeEach(async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
    });

    it("rejects each write from an outsider with Unauthorized", async function () {
      const c = supplyChain.connect(attacker);
      const calls = [
        () => c.registerBatch(lot("X"), 1),
        () => c.recordInspection(LOT, report, true),
        () => c.recordShipment(LOT, attacker.address),
        () => c.confirmReceipt(LOT),
      ];
      for (const call of calls) {
        await expect(call()).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
      }
      // Recall is gated on being the batch's processor, not on a credential (BSC-4).
      await expect(
        c.recordRecall(LOT, notice, 1)
      ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
    });

    it("rejects each write from a holder of the wrong credential", async function () {
      await expect(
        supplyChain.connect(inspector).registerBatch(lot("X"), 1)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
      await expect(
        supplyChain.connect(carrier).recordInspection(LOT, report, true)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
      await expect(
        supplyChain.connect(inspector).recordShipment(LOT, carrier.address)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
      await expect(
        supplyChain.connect(inspector).recordRecall(LOT, notice, 1)
      ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
    });

    it("rejects a credentialed custodian that is not the holder shipping the batch away", async function () {
      await expect(
        supplyChain.connect(carrier).recordShipment(LOT, carrier.address)
      ).to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
    });

    it("rejects a credentialed custodian confirming a shipment addressed to someone else", async function () {
      await supplyChain.connect(plantA).recordShipment(LOT, carrier.address);
      await expect(
        supplyChain.connect(retailer).confirmReceipt(LOT)
      ).to.be.revertedWithCustomError(supplyChain, "NotPendingReceiver");
    });

    it("rejects a pending receiver whose CUSTODIAN credential expired in transit", async function () {
      await registry.grant(carrier.address, CRED_CUSTODIAN, (await time.latest()) + 60);
      await supplyChain.connect(plantA).recordShipment(LOT, carrier.address);
      await time.increase(120);
      await expect(
        supplyChain.connect(carrier).confirmReceipt(LOT)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });
  });

  describe("hostile inputs", function () {
    it("rejects the zero batch id and a duplicate id", async function () {
      await expect(
        supplyChain.connect(plantA).registerBatch(ethers.ZeroHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "EmptyBatchId");
      await supplyChain.connect(plantA).registerBatch(LOT, 1);
      await expect(
        supplyChain.connect(plantB).registerBatch(LOT, 1)
      ).to.be.revertedWithCustomError(supplyChain, "BatchAlreadyExists");
    });

    it("FIXED BSC-6: rejects a batch with weight 0", async function () {
      await expect(
        supplyChain.connect(plantA).registerBatch(lot("ZERO"), 0)
      ).to.be.revertedWithCustomError(supplyChain, "ZeroWeight");
    });

    it("FINDING BSC-6 (residual): still accepts weight 2^256-1", async function () {
      // No upper bound was added; the fix only rules out an empty batch.
      await supplyChain.connect(plantA).registerBatch(lot("MAX"), ethers.MaxUint256);
      expect((await supplyChain.getBatch(lot("MAX"))).weightLbs).to.equal(ethers.MaxUint256);
    });

    it("FIXED BSC-6: rejects an inspection with a zero report hash", async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
      await expect(
        supplyChain.connect(inspector).recordInspection(LOT, ethers.ZeroHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "EmptyReportHash");
    });

    it("FIXED BSC-5: rejects recall classification 0, 4 and 255, and a zero notice hash", async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
      for (const cls of [0, 4, 255]) {
        await expect(
          supplyChain.connect(plantA).recordRecall(LOT, notice, cls)
        ).to.be.revertedWithCustomError(supplyChain, "InvalidClassification");
      }
      await expect(
        supplyChain.connect(plantA).recordRecall(LOT, ethers.ZeroHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "EmptyNoticeHash");
      expect((await supplyChain.getBatch(LOT)).recalled).to.equal(false);
    });

    it("FINDING BSC-7: lets the holder ship a batch to itself", async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
      await expect(supplyChain.connect(plantA).recordShipment(LOT, plantA.address))
        .to.emit(supplyChain, "ShipmentRecorded")
        .withArgs(LOT, plantA.address, plantA.address);
      await supplyChain.connect(plantA).confirmReceipt(LOT);
    });
  });

  describe("integrity of the record", function () {
    beforeEach(async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
    });

    it("FIXED BSC-1: a second inspector cannot overwrite a FAILED inspection", async function () {
      await supplyChain.connect(inspector).recordInspection(LOT, report, false);
      const cleanReport = ethers.id("a different, favourable report");
      await expect(
        supplyChain.connect(inspector2).recordInspection(LOT, cleanReport, true)
      ).to.be.revertedWithCustomError(supplyChain, "AlreadyInspected");
      await expect(
        supplyChain.connect(inspector).recordInspection(LOT, cleanReport, true)
      ).to.be.revertedWithCustomError(supplyChain, "AlreadyInspected");
      const b = await supplyChain.getBatch(LOT);
      expect(b.inspectionPassed).to.equal(false);
      expect(b.inspectionReportHash).to.equal(report);
    });

    it("FIXED BSC-1: no inspection can be recorded after a recall", async function () {
      await supplyChain.connect(plantA).recordRecall(LOT, notice, 1);
      await expect(
        supplyChain.connect(inspector).recordInspection(LOT, report, true)
      ).to.be.revertedWithCustomError(supplyChain, "BatchRecalled");
      expect((await supplyChain.getBatch(LOT)).inspected).to.equal(false);
    });

    it("FIXED BSC-2: a wallet holding PROCESSOR and INSPECTOR cannot inspect its own batch", async function () {
      await grant(plantA, CRED_INSPECTOR);
      await expect(
        supplyChain.connect(plantA).recordInspection(LOT, report, true)
      ).to.be.revertedWithCustomError(supplyChain, "SelfInspection");
      expect((await supplyChain.getBatch(LOT)).inspected).to.equal(false);
    });

    it("FINDING BSC-3: a rival processor pre-registers a predictable lot code (squat)", async function () {
      // Lot codes are human-readable (encodeBytes32String). Plant B registers
      // Plant A's next lot before Plant A does.
      const next = lot("BB-2026-015");
      await supplyChain.connect(plantB).registerBatch(next, 1);
      await expect(
        supplyChain.connect(plantA).registerBatch(next, 1000)
      ).to.be.revertedWithCustomError(supplyChain, "BatchAlreadyExists");
      // The squatter is the processor of record and the only one who can recall it.
      expect((await supplyChain.getBatch(next)).processor).to.equal(plantB.address);
      await expect(
        supplyChain.connect(plantA).recordRecall(next, notice, 1)
      ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
    });

    it("FIXED BSC-4: the processor can still recall its batch after its credential is revoked", async function () {
      await registry.revoke(plantA.address, CRED_PROCESSOR);
      await expect(supplyChain.connect(plantA).recordRecall(LOT, notice, 1))
        .to.emit(supplyChain, "RecallRecorded")
        .withArgs(LOT, plantA.address, notice, 1);
      expect((await supplyChain.getBatch(LOT)).recalled).to.equal(true);
    });

    it("FIXED BSC-4: the same holds when the credential simply expires", async function () {
      await time.increase(ONE_YEAR + 1);
      await supplyChain.connect(plantA).recordRecall(LOT, notice, 2);
      expect((await supplyChain.getBatch(LOT)).recalled).to.equal(true);
    });

    it("BSC-0 still holds after the BSC-4 fix: nobody but the processor of record can recall", async function () {
      await registry.revoke(plantA.address, CRED_PROCESSOR);
      for (const who of [plantB, inspector, attacker]) {
        await expect(
          supplyChain.connect(who).recordRecall(LOT, notice, 1)
        ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
      }
    });

    it("FIXED BSC-5: a recall can only escalate (Class III -> I), never downgrade", async function () {
      await supplyChain.connect(plantA).recordRecall(LOT, notice, 1); // Class I
      for (const cls of [1, 2, 3]) {
        await expect(
          supplyChain.connect(plantA).recordRecall(LOT, ethers.id("softer"), cls)
        ).to.be.revertedWithCustomError(supplyChain, "RecallNotEscalated");
      }
      expect((await supplyChain.getBatch(LOT)).recallClassification).to.equal(1);
    });

    it("FIXED BSC-5: escalating a Class III recall to Class I is accepted", async function () {
      await supplyChain.connect(plantA).recordRecall(LOT, notice, 3);
      await supplyChain.connect(plantA).recordRecall(LOT, ethers.id("worse"), 1);
      const b = await supplyChain.getBatch(LOT);
      expect(b.recallClassification).to.equal(1);
      expect(b.recallNoticeHash).to.equal(ethers.id("worse"));
    });

    it("FINDING BSC-8: a recalled, failed batch keeps moving through custody", async function () {
      await supplyChain.connect(inspector).recordInspection(LOT, report, false);
      await supplyChain.connect(plantA).recordRecall(LOT, notice, 1);
      await supplyChain.connect(plantA).recordShipment(LOT, retailer.address);
      await supplyChain.connect(retailer).confirmReceipt(LOT);
      expect((await supplyChain.getBatch(LOT)).currentHolder).to.equal(retailer.address);
    });
  });

  describe("ordering", function () {
    beforeEach(async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
    });

    it("rejects confirmReceipt before any shipment", async function () {
      await expect(
        supplyChain.connect(carrier).confirmReceipt(LOT)
      ).to.be.revertedWithCustomError(supplyChain, "NoPendingShipment");
    });

    it("rejects a second confirmReceipt for the same shipment", async function () {
      await supplyChain.connect(plantA).recordShipment(LOT, carrier.address);
      await supplyChain.connect(carrier).confirmReceipt(LOT);
      await expect(
        supplyChain.connect(carrier).confirmReceipt(LOT)
      ).to.be.revertedWithCustomError(supplyChain, "NoPendingShipment");
    });

    it("lets the holder re-point a pending shipment; the first receiver can no longer confirm", async function () {
      // Accepted behaviour: the sender still holds the batch until receipt.
      await supplyChain.connect(plantA).recordShipment(LOT, carrier.address);
      await supplyChain.connect(plantA).recordShipment(LOT, retailer.address);
      await expect(
        supplyChain.connect(carrier).confirmReceipt(LOT)
      ).to.be.revertedWithCustomError(supplyChain, "NotPendingReceiver");
      await supplyChain.connect(retailer).confirmReceipt(LOT);
    });

    it("FINDING BSC-9: a holder whose CUSTODIAN credential lapses strands the batch", async function () {
      await supplyChain.connect(plantA).recordShipment(LOT, carrier.address);
      await supplyChain.connect(carrier).confirmReceipt(LOT);
      await registry.revoke(carrier.address, CRED_CUSTODIAN);
      // Nobody else may move it, and there is no admin override.
      await expect(
        supplyChain.connect(carrier).recordShipment(LOT, retailer.address)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
      await expect(
        supplyChain.connect(plantA).recordShipment(LOT, retailer.address)
      ).to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
    });
  });

  describe("lots", function () {
    const L1 = lot("BB-2026-014-L1");
    const L2 = lot("BB-2026-014-L2");

    beforeEach(async function () {
      await supplyChain.connect(plantA).registerBatch(LOT, 1000);
    });

    it("FIXED BSC-10: a rival cannot take a lot's name ahead of the split", async function () {
      await expect(
        supplyChain.connect(plantB).registerBatch(L1, 1)
      ).to.be.revertedWithCustomError(supplyChain, "ReservedLotName");
      await supplyChain.connect(plantA).splitBatch(LOT, [500, 500]);
      expect((await supplyChain.getBatch(L1)).processor).to.equal(plantA.address);
    });

    it("only the holder can create lots, so no one else can forge one", async function () {
      await expect(
        supplyChain.connect(attacker).splitBatch(LOT, [500, 500])
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
      await expect(
        supplyChain.connect(plantB).splitBatch(LOT, [500, 500])
      ).to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
    });

    it("lots cannot add up to more product than the batch", async function () {
      await expect(
        supplyChain.connect(plantA).splitBatch(LOT, [ethers.MaxUint256, 2])
      ).to.be.revertedWithPanic(0x11); // checked overflow
      await expect(
        supplyChain.connect(plantA).splitBatch(LOT, [1000, 1000])
      ).to.be.revertedWithCustomError(supplyChain, "LotWeightMismatch");
    });

    it("a split batch cannot also ship as a whole (no double counting)", async function () {
      await supplyChain.connect(plantA).splitBatch(LOT, [500, 500]);
      await expect(
        supplyChain.connect(plantA).recordShipment(LOT, carrier.address)
      ).to.be.revertedWithCustomError(supplyChain, "AlreadySplit");
    });

    it("FIXED BSC-1: splitting cannot launder a failed inspection or a recall", async function () {
      await supplyChain.connect(inspector).recordInspection(LOT, report, false);
      await supplyChain.connect(plantA).recordRecall(LOT, notice, 1);
      await supplyChain.connect(plantA).splitBatch(LOT, [500, 500]);
      await expect(
        supplyChain.connect(inspector2).recordInspection(L2, ethers.id("clean"), true)
      ).to.be.revertedWithCustomError(supplyChain, "InspectParentBatch");
      const b = await supplyChain.getBatch(L2);
      expect(b.inspectionPassed).to.equal(false);
      expect(b.recalled).to.equal(true);
      expect(b.recallClassification).to.equal(1);
    });

    it("FIXED BSC-4: a processor whose credential lapsed can still recall a lot", async function () {
      await supplyChain.connect(plantA).splitBatch(LOT, [500, 500]);
      await registry.revoke(plantA.address, CRED_PROCESSOR);
      await supplyChain.connect(plantA).recordRecall(L1, notice, 1);
      expect((await supplyChain.getBatch(L1)).recalled).to.equal(true);
    });
  });

  describe("external call to the registry", function () {
    it("reverts every write when the registry address has no code", async function () {
      const Supply = await ethers.getContractFactory("BeefSupplyChain");
      const broken = await Supply.deploy(attacker.address); // an EOA
      await expect(broken.connect(plantA).registerBatch(LOT, 1)).to.be.reverted;
    });
  });
});

// The contract live at 0x20bA1c39…802e was built from commit 83d7418, before
// recordRecall became processor-only (ccee520). Its runtime bytecode matches
// contracts/test/DeployedBeefSupplyChainV1.sol, not contracts/BeefSupplyChain.sol.
describe("BeefSupplyChain as deployed on chain 252501 (v1, 83d7418)", function () {
  let registry, live, admin, plantA, inspector, attacker;

  beforeEach(async function () {
    [admin, plantA, inspector, attacker] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CredentialRegistry");
    registry = await Registry.deploy();
    const exp = (await time.latest()) + 365 * 24 * 60 * 60;
    for (const t of ["PROCESSOR", "INSPECTOR"]) {
      await registry.setIssuer(ethers.id(t), admin.address);
    }
    await registry.grant(plantA.address, ethers.id("PROCESSOR"), exp);
    await registry.grant(inspector.address, ethers.id("INSPECTOR"), exp);
    const V1 = await ethers.getContractFactory("DeployedBeefSupplyChainV1");
    live = await V1.deploy(await registry.getAddress());
    await live.connect(plantA).registerBatch(ethers.encodeBytes32String("BEEF-001"), 500);
  });

  it("FINDING BSC-0: any INSPECTOR can recall any processor's batch", async function () {
    const id = ethers.encodeBytes32String("BEEF-001");
    await expect(live.connect(inspector).recordRecall(id, ethers.id("n"), 1))
      .to.emit(live, "RecallRecorded");
    expect((await live.getBatch(id)).recalled).to.equal(true);
  });

  it("FINDING BSC-0: the processor that registered the batch cannot recall it", async function () {
    const id = ethers.encodeBytes32String("BEEF-001");
    await expect(
      live.connect(plantA).recordRecall(id, ethers.id("n"), 1)
    ).to.be.revertedWithCustomError(live, "Unauthorized");
  });

  it("FINDING BSC-0: a recall can never be undone, so a false recall is permanent", async function () {
    const id = ethers.encodeBytes32String("BEEF-001");
    await live.connect(inspector).recordRecall(id, ethers.id("n"), 1);
    const names = live.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    expect(names.some((n) => /unrecall|clearRecall|cancelRecall/i.test(n))).to.equal(false);
  });
});
