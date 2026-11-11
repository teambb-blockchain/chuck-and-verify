const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BeefSupplyChain", function () {
  let registry, supplyChain;
  let admin, processor, inspector, custodianA, custodianB, unauthorized;
  let CRED_PROCESSOR, CRED_INSPECTOR, CRED_CUSTODIAN;
  const ONE_YEAR = 365 * 24 * 60 * 60;

  const batchId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));
  const reportHash = ethers.keccak256(ethers.toUtf8Bytes("inspection-report"));
  const noticeHash = ethers.keccak256(ethers.toUtf8Bytes("recall-notice"));

  async function grantAll() {
    const expiresAt = (await time.latest()) + ONE_YEAR;
    await registry.grant(processor.address, CRED_PROCESSOR, expiresAt);
    await registry.grant(inspector.address, CRED_INSPECTOR, expiresAt);
    await registry.grant(custodianA.address, CRED_CUSTODIAN, expiresAt);
    await registry.grant(custodianB.address, CRED_CUSTODIAN, expiresAt);
    // Processor also needs CUSTODIAN to ship the batch they hold after register.
    await registry.grant(processor.address, CRED_CUSTODIAN, expiresAt);
  }

  beforeEach(async function () {
    [admin, processor, inspector, custodianA, custodianB, unauthorized] =
      await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CredentialRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    CRED_PROCESSOR = await registry.CRED_PROCESSOR();
    CRED_INSPECTOR = await registry.CRED_INSPECTOR();
    CRED_CUSTODIAN = await registry.CRED_CUSTODIAN();

    // Admin acts as issuer for all types in supply-chain tests.
    await registry.setIssuer(CRED_PROCESSOR, admin.address);
    await registry.setIssuer(CRED_INSPECTOR, admin.address);
    await registry.setIssuer(CRED_CUSTODIAN, admin.address);

    await grantAll();

    const Supply = await ethers.getContractFactory("BeefSupplyChain");
    supplyChain = await Supply.deploy(await registry.getAddress());
    await supplyChain.waitForDeployment();
  });

  describe("registerBatch", function () {
    it("allows a credentialed processor", async function () {
      await expect(
        supplyChain.connect(processor).registerBatch(batchId, 1000)
      )
        .to.emit(supplyChain, "BatchRegistered")
        .withArgs(batchId, processor.address, 1000);

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.processor).to.equal(processor.address);
      expect(batch.currentHolder).to.equal(processor.address);
      expect(batch.weightLbs).to.equal(1000);
    });

    it("rejects an unauthorized caller", async function () {
      await expect(
        supplyChain.connect(unauthorized).registerBatch(batchId, 1000)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("rejects an empty batch id", async function () {
      await expect(
        supplyChain.connect(processor).registerBatch(ethers.ZeroHash, 1000)
      ).to.be.revertedWithCustomError(supplyChain, "EmptyBatchId");
    });

    it("rejects registering a batch that already exists", async function () {
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
      await expect(
        supplyChain.connect(processor).registerBatch(batchId, 1000)
      ).to.be.revertedWithCustomError(supplyChain, "BatchAlreadyExists");
    });

    it("rejects a zero weight", async function () {
      await expect(
        supplyChain.connect(processor).registerBatch(batchId, 0)
      ).to.be.revertedWithCustomError(supplyChain, "ZeroWeight");
    });

    it("rejects a processor whose credential was revoked", async function () {
      // Same wallet, same call: it works before the revoke, not after.
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
      await registry.revoke(processor.address, CRED_PROCESSOR);
      const nextId = ethers.keccak256(ethers.toUtf8Bytes("batch-002"));
      await expect(
        supplyChain.connect(processor).registerBatch(nextId, 1000)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });
  });

  describe("recordInspection", function () {
    beforeEach(async function () {
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
    });

    it("allows a credentialed inspector", async function () {
      await expect(
        supplyChain
          .connect(inspector)
          .recordInspection(batchId, reportHash, true)
      )
        .to.emit(supplyChain, "InspectionRecorded")
        .withArgs(batchId, inspector.address, reportHash, true);

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.inspected).to.equal(true);
      expect(batch.inspectionPassed).to.equal(true);
      expect(batch.inspectionReportHash).to.equal(reportHash);
    });

    it("rejects an unauthorized caller", async function () {
      await expect(
        supplyChain
          .connect(unauthorized)
          .recordInspection(batchId, reportHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("rejects inspecting a batch that does not exist", async function () {
      const missingId = ethers.keccak256(ethers.toUtf8Bytes("missing-batch"));
      await expect(
        supplyChain
          .connect(inspector)
          .recordInspection(missingId, reportHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "BatchNotFound");
    });

    it("rejects the batch's own processor inspecting it, even with INSPECTOR", async function () {
      const expiresAt = (await time.latest()) + ONE_YEAR;
      await registry.grant(processor.address, CRED_INSPECTOR, expiresAt);
      await expect(
        supplyChain
          .connect(processor)
          .recordInspection(batchId, reportHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "SelfInspection");
    });

    it("rejects a second inspection of the same batch", async function () {
      await supplyChain.connect(inspector).recordInspection(batchId, reportHash, false);
      await expect(
        supplyChain.connect(inspector).recordInspection(batchId, reportHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "AlreadyInspected");
    });

    it("rejects an empty report hash", async function () {
      await expect(
        supplyChain.connect(inspector).recordInspection(batchId, ethers.ZeroHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "EmptyReportHash");
    });

    it("rejects an inspector whose credential was revoked", async function () {
      await registry.revoke(inspector.address, CRED_INSPECTOR);
      await expect(
        supplyChain.connect(inspector).recordInspection(batchId, reportHash, true)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });
  });

  describe("recordShipment", function () {
    beforeEach(async function () {
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
    });

    it("allows the current holder with a custodian credential", async function () {
      await expect(
        supplyChain
          .connect(processor)
          .recordShipment(batchId, custodianA.address)
      )
        .to.emit(supplyChain, "ShipmentRecorded")
        .withArgs(batchId, processor.address, custodianA.address);

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.pendingReceiver).to.equal(custodianA.address);
    });

    it("rejects an unauthorized caller", async function () {
      await expect(
        supplyChain
          .connect(unauthorized)
          .recordShipment(batchId, custodianA.address)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("rejects shipping to the zero address", async function () {
      await expect(
        supplyChain
          .connect(processor)
          .recordShipment(batchId, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(supplyChain, "ZeroAddress");
    });

    it("rejects a shipment from someone who is not the current holder", async function () {
      await expect(
        supplyChain
          .connect(custodianA)
          .recordShipment(batchId, custodianB.address)
      ).to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
    });
  });

  describe("confirmReceipt", function () {
    beforeEach(async function () {
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
      await supplyChain
        .connect(processor)
        .recordShipment(batchId, custodianA.address);
    });

    it("allows the pending receiver with a custodian credential", async function () {
      await expect(supplyChain.connect(custodianA).confirmReceipt(batchId))
        .to.emit(supplyChain, "ReceiptConfirmed")
        .withArgs(batchId, custodianA.address);

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.currentHolder).to.equal(custodianA.address);
      expect(batch.pendingReceiver).to.equal(ethers.ZeroAddress);
    });

    it("rejects an unauthorized caller", async function () {
      await expect(
        supplyChain.connect(unauthorized).confirmReceipt(batchId)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("rejects confirming receipt when no shipment is pending", async function () {
      const unshippedId = ethers.keccak256(ethers.toUtf8Bytes("batch-unshipped"));
      await supplyChain.connect(processor).registerBatch(unshippedId, 500);
      await expect(
        supplyChain.connect(processor).confirmReceipt(unshippedId)
      ).to.be.revertedWithCustomError(supplyChain, "NoPendingShipment");
    });

    it("rejects confirming receipt by someone who is not the pending receiver", async function () {
      await expect(
        supplyChain.connect(custodianB).confirmReceipt(batchId)
      ).to.be.revertedWithCustomError(supplyChain, "NotPendingReceiver");
    });

    it("counts custody legs: a pending shipment stays in the sender's leg", async function () {
      expect(await supplyChain.custodyLeg(batchId)).to.equal(0);
      await supplyChain.connect(custodianA).confirmReceipt(batchId);
      expect(await supplyChain.custodyLeg(batchId)).to.equal(1);
      await supplyChain.connect(custodianA).recordShipment(batchId, custodianB.address);
      expect(await supplyChain.custodyLeg(batchId)).to.equal(1);
      await supplyChain.connect(custodianB).confirmReceipt(batchId);
      expect(await supplyChain.custodyLeg(batchId)).to.equal(2);
    });

    it("a failed receipt does not advance the leg", async function () {
      await expect(supplyChain.connect(custodianB).confirmReceipt(batchId))
        .to.be.revertedWithCustomError(supplyChain, "NotPendingReceiver");
      expect(await supplyChain.custodyLeg(batchId)).to.equal(0);
    });

    it("custodyLeg rejects a batch that does not exist", async function () {
      const missing = ethers.keccak256(ethers.toUtf8Bytes("batch-missing"));
      await expect(supplyChain.custodyLeg(missing))
        .to.be.revertedWithCustomError(supplyChain, "BatchNotFound");
    });
  });

  describe("recordRecall", function () {
    beforeEach(async function () {
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
    });

    it("allows the processor that registered the batch", async function () {
      await expect(
        supplyChain.connect(processor).recordRecall(batchId, noticeHash, 1)
      )
        .to.emit(supplyChain, "RecallRecorded")
        .withArgs(batchId, processor.address, noticeHash, 1);

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.recalled).to.equal(true);
      expect(batch.recallNoticeHash).to.equal(noticeHash);
      expect(batch.recallClassification).to.equal(1);
    });

    it("rejects an inspector", async function () {
      await expect(
        supplyChain.connect(inspector).recordRecall(batchId, noticeHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
    });

    it("rejects a different credentialed processor", async function () {
      const expiresAt = (await time.latest()) + ONE_YEAR;
      await registry.grant(custodianB.address, CRED_PROCESSOR, expiresAt);
      await expect(
        supplyChain.connect(custodianB).recordRecall(batchId, noticeHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
    });

    it("still lets the registering processor recall once its credential is revoked", async function () {
      await registry.revoke(processor.address, CRED_PROCESSOR);
      await expect(
        supplyChain.connect(processor).recordRecall(batchId, noticeHash, 1)
      ).to.emit(supplyChain, "RecallRecorded");
    });

    it("rejects an unauthorized caller", async function () {
      await expect(
        supplyChain.connect(unauthorized).recordRecall(batchId, noticeHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
    });

    it("rejects a classification outside Class I–III", async function () {
      await expect(
        supplyChain.connect(processor).recordRecall(batchId, noticeHash, 0)
      ).to.be.revertedWithCustomError(supplyChain, "InvalidClassification");
      await expect(
        supplyChain.connect(processor).recordRecall(batchId, noticeHash, 4)
      ).to.be.revertedWithCustomError(supplyChain, "InvalidClassification");
    });

    it("rejects an empty notice hash", async function () {
      await expect(
        supplyChain.connect(processor).recordRecall(batchId, ethers.ZeroHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "EmptyNoticeHash");
    });

    it("rejects downgrading a recall", async function () {
      await supplyChain.connect(processor).recordRecall(batchId, noticeHash, 1);
      await expect(
        supplyChain.connect(processor).recordRecall(batchId, noticeHash, 3)
      ).to.be.revertedWithCustomError(supplyChain, "RecallNotEscalated");
    });

    it("rejects recalling a batch that does not exist", async function () {
      const missingId = ethers.keccak256(ethers.toUtf8Bytes("missing-batch"));
      await expect(
        supplyChain.connect(processor).recordRecall(missingId, noticeHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "BatchNotFound");
    });
  });

  it("runs register → inspect → ship → confirm → recall", async function () {
    await supplyChain.connect(processor).registerBatch(batchId, 2500);
    await supplyChain
      .connect(inspector)
      .recordInspection(batchId, reportHash, true);
    await supplyChain
      .connect(processor)
      .recordShipment(batchId, custodianA.address);
    await supplyChain.connect(custodianA).confirmReceipt(batchId);
    await supplyChain
      .connect(custodianA)
      .recordShipment(batchId, custodianB.address);
    await supplyChain.connect(custodianB).confirmReceipt(batchId);
    await supplyChain.connect(processor).recordRecall(batchId, noticeHash, 1);

    const batch = await supplyChain.getBatch(batchId);
    expect(batch.currentHolder).to.equal(custodianB.address);
    expect(batch.inspected).to.equal(true);
    expect(batch.recalled).to.equal(true);
  });

  describe("splitBatch", function () {
    // Lots are named from the readable batch ID, so these tests use the
    // portal's encoding rather than the keccak ID above.
    const name = (s) => ethers.encodeBytes32String(s);
    const PARENT = name("BEEF-01");
    const L1 = name("BEEF-01-L1");
    const L2 = name("BEEF-01-L2");
    const L3 = name("BEEF-01-L3");

    beforeEach(async function () {
      await supplyChain.connect(processor).registerBatch(PARENT, 1000);
      await supplyChain.connect(processor).recordShipment(PARENT, custodianA.address);
      await supplyChain.connect(custodianA).confirmReceipt(PARENT);
    });

    it("splits a held batch into named lots that add up to its weight", async function () {
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [400, 350, 250]))
        .to.emit(supplyChain, "LotCreated").withArgs(PARENT, L1, custodianA.address, 400)
        .and.to.emit(supplyChain, "LotCreated").withArgs(PARENT, L2, custodianA.address, 350)
        .and.to.emit(supplyChain, "LotCreated").withArgs(PARENT, L3, custodianA.address, 250);

      const lot = await supplyChain.getBatch(L2);
      expect(lot.processor).to.equal(processor.address);
      expect(lot.currentHolder).to.equal(custodianA.address);
      expect(lot.weightLbs).to.equal(350);
      expect(lot.pendingReceiver).to.equal(ethers.ZeroAddress);

      const parentInfo = await supplyChain.getLotInfo(PARENT);
      expect(parentInfo.parentId).to.equal(ethers.ZeroHash);
      expect(parentInfo.lotIds).to.deep.equal([L1, L2, L3]);
      const lotInfo = await supplyChain.getLotInfo(L3);
      expect(lotInfo.parentId).to.equal(PARENT);
      expect(lotInfo.lotIds).to.deep.equal([]);
      expect((await supplyChain.getBatch(PARENT)).weightLbs).to.equal(1000);
    });

    it("names lots 10 and up with two digits", async function () {
      await supplyChain.connect(custodianA).splitBatch(PARENT, Array(20).fill(50));
      const { lotIds } = await supplyChain.getLotInfo(PARENT);
      expect(lotIds.map(ethers.decodeBytes32String).slice(8, 11))
        .to.deep.equal(["BEEF-01-L9", "BEEF-01-L10", "BEEF-01-L11"]);
      expect(ethers.decodeBytes32String(lotIds[19])).to.equal("BEEF-01-L20");
    });

    it("rejects a caller who is not the current holder", async function () {
      await expect(supplyChain.connect(processor).splitBatch(PARENT, [500, 500]))
        .to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
    });

    it("rejects a holder without a valid CUSTODIAN credential", async function () {
      await registry.revoke(custodianA.address, CRED_CUSTODIAN);
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [500, 500]))
        .to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("rejects fewer than 2 or more than 20 lots", async function () {
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [1000]))
        .to.be.revertedWithCustomError(supplyChain, "BadLotCount");
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, Array(21).fill(1)))
        .to.be.revertedWithCustomError(supplyChain, "BadLotCount");
    });

    it("rejects weights that do not add up to the batch weight", async function () {
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [500, 499]))
        .to.be.revertedWithCustomError(supplyChain, "LotWeightMismatch");
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [500, 501]))
        .to.be.revertedWithCustomError(supplyChain, "LotWeightMismatch");
    });

    it("rejects a lot with zero weight", async function () {
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [1000, 0]))
        .to.be.revertedWithCustomError(supplyChain, "ZeroWeight");
    });

    it("rejects a split while a shipment is pending", async function () {
      await supplyChain.connect(custodianA).recordShipment(PARENT, custodianB.address);
      await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [500, 500]))
        .to.be.revertedWithCustomError(supplyChain, "ShipmentPending");
    });

    it("rejects a parent ID too long to take a lot number", async function () {
      const long = name("X".repeat(28)); // 28 + "-L1" = 31 bytes: fits up to lot 9
      await supplyChain.connect(processor).registerBatch(long, 100);
      await expect(supplyChain.connect(processor).splitBatch(long, Array(10).fill(10)))
        .to.be.revertedWithCustomError(supplyChain, "LotNameTooLong");
      await supplyChain.connect(processor).splitBatch(long, [50, 50]);
    });

    describe("after a split", function () {
      beforeEach(async function () {
        await supplyChain.connect(custodianA).splitBatch(PARENT, [600, 400]);
      });

      it("the batch cannot be split again or shipped as a whole", async function () {
        await expect(supplyChain.connect(custodianA).splitBatch(PARENT, [500, 500]))
          .to.be.revertedWithCustomError(supplyChain, "AlreadySplit");
        await expect(supplyChain.connect(custodianA).recordShipment(PARENT, custodianB.address))
          .to.be.revertedWithCustomError(supplyChain, "AlreadySplit");
      });

      it("a lot cannot be split", async function () {
        await expect(supplyChain.connect(custodianA).splitBatch(L1, [300, 300]))
          .to.be.revertedWithCustomError(supplyChain, "LotCannotBeSplit");
      });

      it("each lot ships to its own custodian independently", async function () {
        await supplyChain.connect(custodianA).recordShipment(L1, custodianB.address);
        await supplyChain.connect(custodianB).confirmReceipt(L1);
        expect((await supplyChain.getBatch(L1)).currentHolder).to.equal(custodianB.address);
        expect((await supplyChain.getBatch(L2)).currentHolder).to.equal(custodianA.address);
      });

      it("each lot starts at leg 0 and counts its own legs", async function () {
        expect(await supplyChain.custodyLeg(PARENT)).to.equal(1);
        expect(await supplyChain.custodyLeg(L1)).to.equal(0);
        await supplyChain.connect(custodianA).recordShipment(L1, custodianB.address);
        await supplyChain.connect(custodianB).confirmReceipt(L1);
        expect(await supplyChain.custodyLeg(L1)).to.equal(1);
        expect(await supplyChain.custodyLeg(L2)).to.equal(0);
        expect(await supplyChain.custodyLeg(PARENT)).to.equal(1);
      });

      it("a lot shows the inspection of its batch, even one recorded after the split", async function () {
        await supplyChain.connect(inspector).recordInspection(PARENT, reportHash, true);
        const lot = await supplyChain.getBatch(L1);
        expect(lot.inspected).to.equal(true);
        expect(lot.inspectionPassed).to.equal(true);
        expect(lot.inspectionReportHash).to.equal(reportHash);
      });

      it("a lot cannot be inspected on its own", async function () {
        await expect(supplyChain.connect(inspector).recordInspection(L1, reportHash, true))
          .to.be.revertedWithCustomError(supplyChain, "InspectParentBatch");
      });

      it("a recall of the batch applies to every lot", async function () {
        await supplyChain.connect(processor).recordRecall(PARENT, noticeHash, 2);
        for (const id of [L1, L2]) {
          const lot = await supplyChain.getBatch(id);
          expect(lot.recalled).to.equal(true);
          expect(lot.recallClassification).to.equal(2);
          expect(lot.recallNoticeHash).to.equal(noticeHash);
        }
      });

      it("one lot can be recalled more seriously without touching its sibling", async function () {
        const lotNotice = ethers.id("lot recall");
        await supplyChain.connect(processor).recordRecall(PARENT, noticeHash, 2);
        await supplyChain.connect(processor).recordRecall(L1, lotNotice, 1);
        expect((await supplyChain.getBatch(L1)).recallClassification).to.equal(1);
        expect((await supplyChain.getBatch(L1)).recallNoticeHash).to.equal(lotNotice);
        expect((await supplyChain.getBatch(L2)).recallClassification).to.equal(2);
        expect((await supplyChain.getBatch(PARENT)).recallClassification).to.equal(2);
      });

      it("a lot recall no more serious than the batch's is refused", async function () {
        await supplyChain.connect(processor).recordRecall(PARENT, noticeHash, 2);
        await expect(supplyChain.connect(processor).recordRecall(L1, noticeHash, 2))
          .to.be.revertedWithCustomError(supplyChain, "RecallNotEscalated");
        await expect(supplyChain.connect(processor).recordRecall(L1, noticeHash, 3))
          .to.be.revertedWithCustomError(supplyChain, "RecallNotEscalated");
      });

      it("only the batch's processor can recall a lot", async function () {
        await expect(supplyChain.connect(custodianA).recordRecall(L1, noticeHash, 1))
          .to.be.revertedWithCustomError(supplyChain, "NotBatchProcessor");
      });
    });

    it("a recalled batch can still be split and its lots shipped (BSC-8)", async function () {
      await supplyChain.connect(processor).recordRecall(PARENT, noticeHash, 1);
      await supplyChain.connect(custodianA).splitBatch(PARENT, [500, 500]);
      await supplyChain.connect(custodianA).recordShipment(L1, custodianB.address);
      await supplyChain.connect(custodianB).confirmReceipt(L1);
      expect((await supplyChain.getBatch(L1)).recalled).to.equal(true);
    });

    it("rejects registering a batch under a lot-style name", async function () {
      await expect(supplyChain.connect(processor).registerBatch(name("BEEF-02-L1"), 10))
        .to.be.revertedWithCustomError(supplyChain, "ReservedLotName");
      // Names that only look similar are still allowed.
      for (const ok of ["BEEF-L", "BEEF-L1X", "BEEFL1", "L1", "BEEF-02-l1"]) {
        await supplyChain.connect(processor).registerBatch(name(ok), 10);
      }
    });
  });
});
