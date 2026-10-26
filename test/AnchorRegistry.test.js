const { expect } = require("chai");
const { ethers } = require("hardhat");

const DIGEST = "0x" + "11".repeat(32);
// Activity 01 portal CID, CIDv0 as the gateway URL records it.
const CID = "QmYE3zK8Kov7vHQpSaETDqXyjUHnHHt9WBvTWKL5MVP1mG";

describe("AnchorRegistry", function () {
  let reg, admin, processor, inspector, outsider;
  let ADMIN, PROCESSOR, INSPECTOR, recordId;

  beforeEach(async function () {
    [admin, processor, inspector, outsider] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("AnchorRegistry");
    reg = await Factory.deploy();
    await reg.waitForDeployment();

    ADMIN = await reg.ADMIN();
    PROCESSOR = await reg.PROCESSOR();
    INSPECTOR = await reg.INSPECTOR();

    // Lot code only. Same rule as activity 04: not a person-identifying key.
    recordId = ethers.keccak256(ethers.toUtf8Bytes("BB-2026-014"));

    await reg.grantRole(PROCESSOR, processor.address);
    await reg.grantRole(INSPECTOR, inspector.address);
  });

  it("gives the deployer ADMIN only", async function () {
    expect(await reg.hasRole(ADMIN, admin.address)).to.equal(true);
    expect(await reg.hasRole(PROCESSOR, admin.address)).to.equal(false);
    expect(await reg.hasRole(INSPECTOR, admin.address)).to.equal(false);
  });

  it("lets a processor anchor a record", async function () {
    await expect(reg.connect(processor).anchor(recordId, DIGEST, CID)).to.emit(
      reg,
      "RecordAnchored"
    );

    const r = await reg.get(recordId);
    expect(r.digest).to.equal(DIGEST);
    expect(r.cid).to.equal(CID);
    expect(r.submitter).to.equal(processor.address);
  });

  it("rejects an anchor from an account without PROCESSOR", async function () {
    await expect(
      reg.connect(outsider).anchor(recordId, DIGEST, CID)
    ).to.be.revertedWithCustomError(reg, "NotAuthorized");
  });

  it("rejects an empty digest", async function () {
    await expect(
      reg.connect(processor).anchor(recordId, ethers.ZeroHash, CID)
    ).to.be.revertedWithCustomError(reg, "EmptyDigest");
  });

  it("rejects anchoring the same record twice", async function () {
    await reg.connect(processor).anchor(recordId, DIGEST, CID);
    await expect(
      reg.connect(processor).anchor(recordId, DIGEST, CID)
    ).to.be.revertedWithCustomError(reg, "AlreadyAnchored");
  });

  it("rejects verification from an account without INSPECTOR", async function () {
    await reg.connect(processor).anchor(recordId, DIGEST, CID);
    await expect(
      reg.connect(outsider).verify(recordId)
    ).to.be.revertedWithCustomError(reg, "NotAuthorized");
  });

  it("rejects self-verification", async function () {
    await reg.grantRole(INSPECTOR, processor.address);
    await reg.connect(processor).anchor(recordId, DIGEST, CID);
    await expect(
      reg.connect(processor).verify(recordId)
    ).to.be.revertedWithCustomError(reg, "SelfVerification");
  });

  it("rejects verification of an unknown record", async function () {
    await expect(
      reg.connect(inspector).verify(recordId)
    ).to.be.revertedWithCustomError(reg, "UnknownRecord");
  });

  it("records the verifier and time on success", async function () {
    await reg.connect(processor).anchor(recordId, DIGEST, CID);
    await expect(reg.connect(inspector).verify(recordId)).to.emit(
      reg,
      "RecordVerified"
    );

    const r = await reg.get(recordId);
    expect(r.verifier).to.equal(inspector.address);
    expect(r.verifiedAt).to.be.greaterThan(0n);
  });

  it("rejects a revoked processor", async function () {
    await reg.revokeRole(PROCESSOR, processor.address);
    await expect(
      reg.connect(processor).anchor(recordId, DIGEST, CID)
    ).to.be.revertedWithCustomError(reg, "NotAuthorized");
  });
});
