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

      describe("splitting a lot again", function () {
        const L1A = name("BEEF-01-L1-L1");
        const L1B = name("BEEF-01-L1-L2");
        const L1B1 = name("BEEF-01-L1-L2-L1");
        const L1B2 = name("BEEF-01-L1-L2-L2");

        beforeEach(async function () {
          // The distributor sends lot 1 to the grocery store, which splits it
          // for its own shelves, and splits one of those again.
          await supplyChain.connect(custodianA).recordShipment(L1, custodianB.address);
          await supplyChain.connect(custodianB).confirmReceipt(L1);
          await supplyChain.connect(custodianB).splitBatch(L1, [200, 400]);
          await supplyChain.connect(custodianB).splitBatch(L1B, [150, 250]);
        });

        it("the holder of a lot can split it into smaller lots", async function () {
          const info = await supplyChain.getLotInfo(L1);
          expect(info.parentId).to.equal(PARENT);
          expect(info.lotIds).to.deep.equal([L1A, L1B]);
          const deep = await supplyChain.getLotInfo(L1B1);
          expect(deep.parentId).to.equal(L1B);
          for (const [id, lbs] of [[L1A, 200], [L1B, 400], [L1B1, 150], [L1B2, 250]]) {
            const lot = await supplyChain.getBatch(id);
            expect(lot.weightLbs).to.equal(lbs);
            expect(lot.currentHolder).to.equal(custodianB.address);
            expect(lot.processor).to.equal(processor.address);
          }
        });

        it("only the lot's current holder can split it", async function () {
          await expect(supplyChain.connect(custodianA).splitBatch(L2, [100, 300]))
            .to.not.be.reverted;
          await expect(supplyChain.connect(custodianA).splitBatch(L1A, [100, 100]))
            .to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
        });

        it("a split lot cannot be split again or shipped as a whole", async function () {
          await expect(supplyChain.connect(custodianB).splitBatch(L1, [300, 300]))
            .to.be.revertedWithCustomError(supplyChain, "AlreadySplit");
          await expect(supplyChain.connect(custodianB).recordShipment(L1B, custodianA.address))
            .to.be.revertedWithCustomError(supplyChain, "AlreadySplit");
        });

        it("the smaller lots must add up to the lot they came from", async function () {
          await expect(supplyChain.connect(custodianB).splitBatch(L1A, [100, 50]))
            .to.be.revertedWithCustomError(supplyChain, "LotWeightMismatch");
        });

        it("every level shows the original batch's inspection and cannot be inspected itself", async function () {
          await supplyChain.connect(inspector).recordInspection(PARENT, reportHash, false);
          const lot = await supplyChain.getBatch(L1B1);
          expect(lot.inspected).to.equal(true);
          expect(lot.inspectionPassed).to.equal(false);
          expect(lot.inspectionReportHash).to.equal(reportHash);
          await expect(supplyChain.connect(inspector).recordInspection(L1B, reportHash, true))
            .to.be.revertedWithCustomError(supplyChain, "InspectParentBatch");
        });

        it("a recall anywhere above a lot reaches it, the most serious one winning", async function () {
          const midNotice = ethers.id("mid recall");
          await supplyChain.connect(processor).recordRecall(PARENT, noticeHash, 3);
          await supplyChain.connect(processor).recordRecall(L1B, midNotice, 2);
          let deep = await supplyChain.getBatch(L1B2);
          expect(deep.recallClassification).to.equal(2);
          expect(deep.recallNoticeHash).to.equal(midNotice);
          expect((await supplyChain.getBatch(L1A)).recallClassification).to.equal(3);
          // A later, more serious recall of the original batch still reaches the bottom.
          await supplyChain.connect(processor).recordRecall(PARENT, noticeHash, 1);
          deep = await supplyChain.getBatch(L1B2);
          expect(deep.recallClassification).to.equal(1);
          expect(deep.recallNoticeHash).to.equal(noticeHash);
          // And a recall below must be more serious than everything above it.
          await expect(supplyChain.connect(processor).recordRecall(L1B1, noticeHash, 1))
            .to.be.revertedWithCustomError(supplyChain, "RecallNotEscalated");
        });

        it("the smaller lots ship on their own and count their own legs", async function () {
          expect(await supplyChain.custodyLeg(L1A)).to.equal(0);
          await supplyChain.connect(custodianB).recordShipment(L1A, custodianA.address);
          await supplyChain.connect(custodianA).confirmReceipt(L1A);
          expect(await supplyChain.custodyLeg(L1A)).to.equal(1);
          expect((await supplyChain.getBatch(L1B1)).currentHolder).to.equal(custodianB.address);
        });

        it("splits stop when the next lot name would pass 31 bytes", async function () {
          const base = name("X".repeat(25)); // + "-L1" + "-L1" = 31 bytes
          await supplyChain.connect(processor).registerBatch(base, 100);
          await supplyChain.connect(processor).splitBatch(base, [50, 50]);
          const lot = name("X".repeat(25) + "-L1");
          await supplyChain.connect(processor).splitBatch(lot, [25, 25]);
          const deepest = name("X".repeat(25) + "-L1-L1");
          await expect(supplyChain.connect(processor).splitBatch(deepest, [10, 15]))
            .to.be.revertedWithCustomError(supplyChain, "LotNameTooLong");
        });

        it("names made by nested splits stay reserved", async function () {
          await expect(supplyChain.connect(processor).registerBatch(name("BEEF-09-L1-L1"), 10))
            .to.be.revertedWithCustomError(supplyChain, "ReservedLotName");
        });
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

  describe("use-by date and disposition (v5)", function () {
    const DAY = 24 * 60 * 60;
    const SOLD = 1, CONSUMED = 2, DISPOSED = 3;
    const reg3 = (signer, id, weight, useBy) =>
      supplyChain.connect(signer)["registerBatch(bytes32,uint256,uint64)"](id, weight, useBy);

    // Registered by the processor, shipped to and received by custodianA.
    async function heldByA(useBy) {
      const id = useBy ? await reg3(processor, batchId, 1000, useBy) : await supplyChain.connect(processor).registerBatch(batchId, 1000);
      await supplyChain.connect(processor).recordShipment(batchId, custodianA.address);
      await supplyChain.connect(custodianA).confirmReceipt(batchId);
      return id;
    }

    it("registers with a use-by date, emits both events, and reports it", async function () {
      const useBy = (await time.latest()) + 30 * DAY;
      await expect(reg3(processor, batchId, 1000, useBy))
        .to.emit(supplyChain, "BatchRegistered").withArgs(batchId, processor.address, 1000)
        .and.to.emit(supplyChain, "UseBySet").withArgs(batchId, useBy);
      const [date, disposition] = await supplyChain.getStatus(batchId);
      expect(date).to.equal(useBy);
      expect(disposition).to.equal(0);
    });

    it("keeps the two-argument registerBatch, with no use-by date", async function () {
      await expect(supplyChain.connect(processor).registerBatch(batchId, 1000)).to.not.emit(supplyChain, "UseBySet");
      expect((await supplyChain.getStatus(batchId))[0]).to.equal(0);
    });

    it("rejects a use-by date in the past, now, or past the shelf-life limit", async function () {
      const now = await time.latest();
      const max = await supplyChain.MAX_SHELF_LIFE();
      await expect(reg3(processor, batchId, 1000, now - DAY)).to.be.revertedWithCustomError(supplyChain, "InvalidUseBy");
      await expect(reg3(processor, batchId, 1000, 0)).to.be.revertedWithCustomError(supplyChain, "InvalidUseBy");
      // Milliseconds instead of seconds.
      await expect(reg3(processor, batchId, 1000, (now + DAY) * 1000)).to.be.revertedWithCustomError(supplyChain, "InvalidUseBy");
      await expect(reg3(processor, batchId, 1000, BigInt(now) + max + 60n)).to.be.revertedWithCustomError(supplyChain, "InvalidUseBy");
    });

    it("still checks the PROCESSOR credential on the three-argument form", async function () {
      const useBy = (await time.latest()) + DAY;
      await expect(reg3(unauthorized, batchId, 1000, useBy)).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("gives every lot, and lots of lots, the batch's use-by date", async function () {
      const name = (s) => ethers.encodeBytes32String(s);
      const useBy = (await time.latest()) + 10 * DAY;
      await reg3(processor, name("BEEF-UB"), 300, useBy);
      await supplyChain.connect(processor).splitBatch(name("BEEF-UB"), [100, 200]);
      await supplyChain.connect(processor).splitBatch(name("BEEF-UB-L2"), [50, 150]);
      for (const lot of ["BEEF-UB-L1", "BEEF-UB-L2", "BEEF-UB-L2-L1", "BEEF-UB-L2-L2"]) {
        expect((await supplyChain.getStatus(name(lot)))[0]).to.equal(useBy);
      }
    });

    it("lets the holder record each disposition once, and then the batch can't move", async function () {
      await heldByA();
      await expect(supplyChain.connect(custodianA).recordDisposition(batchId, SOLD))
        .to.emit(supplyChain, "DispositionRecorded").withArgs(batchId, custodianA.address, SOLD);
      expect((await supplyChain.getStatus(batchId))[1]).to.equal(SOLD);
      await expect(supplyChain.connect(custodianA).recordDisposition(batchId, DISPOSED))
        .to.be.revertedWithCustomError(supplyChain, "BatchDisposed");
      await expect(supplyChain.connect(custodianA).recordShipment(batchId, custodianB.address))
        .to.be.revertedWithCustomError(supplyChain, "BatchDisposed");
      await expect(supplyChain.connect(custodianA).splitBatch(batchId, [500, 500]))
        .to.be.revertedWithCustomError(supplyChain, "BatchDisposed");
    });

    it("accepts consumed and disposed, and rejects any other code", async function () {
      const name = (s) => ethers.encodeBytes32String(s);
      await supplyChain.connect(processor).registerBatch(name("C"), 10);
      await supplyChain.connect(processor).registerBatch(name("D"), 10);
      await supplyChain.connect(processor).recordDisposition(name("C"), CONSUMED);
      await supplyChain.connect(processor).recordDisposition(name("D"), DISPOSED);
      expect((await supplyChain.getStatus(name("C")))[1]).to.equal(CONSUMED);
      expect((await supplyChain.getStatus(name("D")))[1]).to.equal(DISPOSED);
      await supplyChain.connect(processor).registerBatch(batchId, 10);
      for (const bad of [0, 4, 255]) {
        await expect(supplyChain.connect(processor).recordDisposition(batchId, bad))
          .to.be.revertedWithCustomError(supplyChain, "InvalidDisposition");
      }
    });

    it("refuses a disposition from anyone but the credentialed current holder", async function () {
      await heldByA();
      await expect(supplyChain.connect(custodianB).recordDisposition(batchId, SOLD))
        .to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
      await expect(supplyChain.connect(processor).recordDisposition(batchId, SOLD))
        .to.be.revertedWithCustomError(supplyChain, "NotCurrentHolder");
      await registry.revoke(custodianA.address, CRED_CUSTODIAN);
      await expect(supplyChain.connect(custodianA).recordDisposition(batchId, SOLD))
        .to.be.revertedWithCustomError(supplyChain, "Unauthorized");
    });

    it("refuses a disposition while a shipment is pending or after a split", async function () {
      const name = (s) => ethers.encodeBytes32String(s);
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
      await supplyChain.connect(processor).recordShipment(batchId, custodianA.address);
      await expect(supplyChain.connect(processor).recordDisposition(batchId, SOLD))
        .to.be.revertedWithCustomError(supplyChain, "ShipmentPending");
      await supplyChain.connect(processor).registerBatch(name("S"), 20);
      await supplyChain.connect(processor).splitBatch(name("S"), [10, 10]);
      await expect(supplyChain.connect(processor).recordDisposition(name("S"), DISPOSED))
        .to.be.revertedWithCustomError(supplyChain, "AlreadySplit");
      // Each lot is closed on its own.
      await supplyChain.connect(processor).recordDisposition(name("S-L1"), SOLD);
      await supplyChain.connect(processor).recordDisposition(name("S-L2"), DISPOSED);
    });

    it("still lets the processor recall a batch that was already sold", async function () {
      await heldByA();
      await supplyChain.connect(custodianA).recordDisposition(batchId, SOLD);
      await expect(supplyChain.connect(processor).recordRecall(batchId, noticeHash, 1))
        .to.emit(supplyChain, "RecallRecorded");
      expect((await supplyChain.getBatch(batchId)).recalled).to.equal(true);
    });

    it("reverts getStatus for an unknown batch", async function () {
      await expect(supplyChain.getStatus(batchId)).to.be.revertedWithCustomError(supplyChain, "BatchNotFound");
    });
  });
});
