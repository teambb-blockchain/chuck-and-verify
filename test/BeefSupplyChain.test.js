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
  });

  describe("recordRecall", function () {
    beforeEach(async function () {
      await supplyChain.connect(processor).registerBatch(batchId, 1000);
    });

    it("allows a credentialed inspector", async function () {
      await expect(
        supplyChain.connect(inspector).recordRecall(batchId, noticeHash, 1)
      )
        .to.emit(supplyChain, "RecallRecorded")
        .withArgs(batchId, inspector.address, noticeHash, 1);

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.recalled).to.equal(true);
      expect(batch.recallNoticeHash).to.equal(noticeHash);
      expect(batch.recallClassification).to.equal(1);
    });

    it("rejects an unauthorized caller", async function () {
      await expect(
        supplyChain.connect(unauthorized).recordRecall(batchId, noticeHash, 1)
      ).to.be.revertedWithCustomError(supplyChain, "Unauthorized");
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
    await supplyChain.connect(inspector).recordRecall(batchId, noticeHash, 1);

    const batch = await supplyChain.getBatch(batchId);
    expect(batch.currentHolder).to.equal(custodianB.address);
    expect(batch.inspected).to.equal(true);
    expect(batch.recalled).to.equal(true);
  });
});
