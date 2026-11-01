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

  it("keeps the first processor's record when a second processor anchors the same id", async function () {
    const signers = await ethers.getSigners();
    const processorB = signers[4];
    const digestB = "0x" + "22".repeat(32);

    await reg.grantRole(PROCESSOR, processorB.address);
    await reg.connect(processor).anchor(recordId, DIGEST, CID);

    await expect(
      reg.connect(processorB).anchor(recordId, digestB, CID)
    ).to.be.revertedWithCustomError(reg, "AlreadyAnchored");

    const r = await reg.get(recordId);
    expect(r.digest).to.equal(DIGEST);
    expect(r.cid).to.equal(CID);
    expect(r.submitter).to.equal(processor.address);
  });

  it("keeps a squatter's record after PROCESSOR is revoked and an inspector verifies it", async function () {
    const signers = await ethers.getSigners();
    const processorB = signers[4];
    const digestB = "0x" + "22".repeat(32);

    await reg.grantRole(PROCESSOR, processorB.address);
    await reg.connect(processorB).anchor(recordId, digestB, CID);

    await expect(
      reg.connect(processor).anchor(recordId, DIGEST, CID)
    ).to.be.revertedWithCustomError(reg, "AlreadyAnchored");

    await reg.revokeRole(PROCESSOR, processorB.address);
    expect(await reg.hasRole(PROCESSOR, processorB.address)).to.equal(false);

    const anchored = await reg.get(recordId);
    expect(anchored.digest).to.equal(digestB);
    expect(anchored.submitter).to.equal(processorB.address);

    await expect(reg.connect(inspector).verify(recordId)).to.emit(
      reg,
      "RecordVerified"
    );

    const verified = await reg.get(recordId);
    expect(verified.digest).to.equal(digestB);
    expect(verified.submitter).to.equal(processorB.address);
    expect(verified.verifier).to.equal(inspector.address);
    expect(verified.verifiedAt).to.be.greaterThan(0n);
  });

  it("mines the higher-fee anchor and reverts the earlier one in the Hardhat mempool", async function () {
    // Hardhat's mempool only. This does not show that DIDLab orders transactions by fee.
    const signers = await ethers.getSigners();
    const processorB = signers[4];
    const digestB = "0x" + "22".repeat(32);
    const cidB = "bafySQUAT";

    await reg.grantRole(PROCESSOR, processorB.address);

    const latest = await ethers.provider.getBlock("latest");
    const base = latest.baseFeePerGas;
    const lowTip = 1n;
    const highTip = 2_000_000_000n;

    await ethers.provider.send("evm_setAutomine", [false]);
    try {
      const txA = await reg.connect(processor).anchor(recordId, DIGEST, CID, {
        maxPriorityFeePerGas: lowTip,
        maxFeePerGas: base * 2n + lowTip,
      });
      const txB = await reg
        .connect(processorB)
        .anchor(recordId, digestB, cidB, {
          maxPriorityFeePerGas: highTip,
          maxFeePerGas: base * 2n + highTip,
        });

      await ethers.provider.send("evm_mine", []);

      const receiptA = await ethers.provider.getTransactionReceipt(txA.hash);
      const receiptB = await ethers.provider.getTransactionReceipt(txB.hash);

      expect(receiptA).to.not.equal(null);
      expect(receiptB).to.not.equal(null);
      expect(receiptA.status).to.equal(0);
      expect(receiptB.status).to.equal(1);
      expect(receiptB.index).to.be.lessThan(receiptA.index);

      const r = await reg.get(recordId);
      expect(r.digest).to.equal(digestB);
      expect(r.cid).to.equal(cidB);
      expect(r.submitter).to.equal(processorB.address);
    } finally {
      await ethers.provider.send("evm_setAutomine", [true]);
    }
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

  it("rejects a second verification of the same record", async function () {
    await reg.connect(processor).anchor(recordId, DIGEST, CID);
    await reg.connect(inspector).verify(recordId);

    await expect(
      reg.connect(inspector).verify(recordId)
    ).to.be.revertedWithCustomError(reg, "AlreadyVerified");

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


  it("rejects grantRole from an account without ADMIN", async function () {
    await expect(
      reg.connect(processor).grantRole(INSPECTOR, outsider.address)
    )
      .to.be.revertedWithCustomError(reg, "NotAuthorized")
      .withArgs(ADMIN);

    expect(await reg.hasRole(INSPECTOR, outsider.address)).to.equal(false);
  });

  it("rejects revokeRole from an account without ADMIN", async function () {
    await expect(
      reg.connect(processor).revokeRole(PROCESSOR, processor.address)
    )
      .to.be.revertedWithCustomError(reg, "NotAuthorized")
      .withArgs(ADMIN);

    expect(await reg.hasRole(PROCESSOR, processor.address)).to.equal(true);
  });

  it("rejects verify from a processor who does not hold INSPECTOR", async function () {
    await reg.connect(processor).anchor(recordId, DIGEST, CID);
    await expect(reg.connect(processor).verify(recordId))
      .to.be.revertedWithCustomError(reg, "NotAuthorized")
      .withArgs(INSPECTOR);
  });

  it("rejects a non-admin granting themselves ADMIN", async function () {
    await expect(
      reg.connect(outsider).grantRole(ADMIN, outsider.address)
    )
      .to.be.revertedWithCustomError(reg, "NotAuthorized")
      .withArgs(ADMIN);

    expect(await reg.hasRole(ADMIN, outsider.address)).to.equal(false);
  });

  it("accepts a misspelled role id that does not let the account anchor", async function () {
    const typo = ethers.keccak256(ethers.toUtf8Bytes("PROCESOR"));

    await expect(reg.grantRole(typo, outsider.address))
      .to.emit(reg, "RoleGranted")
      .withArgs(typo, outsider.address, admin.address);

    expect(await reg.hasRole(typo, outsider.address)).to.equal(true);
    expect(await reg.hasRole(PROCESSOR, outsider.address)).to.equal(false);

    await expect(reg.connect(outsider).anchor(recordId, DIGEST, CID))
      .to.be.revertedWithCustomError(reg, "NotAuthorized")
      .withArgs(PROCESSOR);
  });

  it("accepts grantRole to the zero address", async function () {
    await expect(reg.grantRole(PROCESSOR, ethers.ZeroAddress))
      .to.emit(reg, "RoleGranted")
      .withArgs(PROCESSOR, ethers.ZeroAddress, admin.address);

    expect(await reg.hasRole(PROCESSOR, ethers.ZeroAddress)).to.equal(true);
  });

  it("emits a second RoleGranted when the role is already held", async function () {
    expect(await reg.hasRole(PROCESSOR, processor.address)).to.equal(true);
    const prior = await reg.queryFilter(
      reg.filters.RoleGranted(PROCESSOR, processor.address)
    );

    await expect(reg.grantRole(PROCESSOR, processor.address))
      .to.emit(reg, "RoleGranted")
      .withArgs(PROCESSOR, processor.address, admin.address);

    const after = await reg.queryFilter(
      reg.filters.RoleGranted(PROCESSOR, processor.address)
    );
    expect(after.length).to.equal(prior.length + 1);
    expect(await reg.hasRole(PROCESSOR, processor.address)).to.equal(true);
  });

  it("emits RoleRevoked when the account does not hold the role", async function () {
    expect(await reg.hasRole(PROCESSOR, outsider.address)).to.equal(false);

    await expect(reg.revokeRole(PROCESSOR, outsider.address))
      .to.emit(reg, "RoleRevoked")
      .withArgs(PROCESSOR, outsider.address, admin.address);

    expect(await reg.hasRole(PROCESSOR, outsider.address)).to.equal(false);
  });


  it("lets the last ADMIN revoke itself and leave zero admins", async function () {
    await expect(reg.revokeRole(ADMIN, admin.address))
      .to.emit(reg, "RoleRevoked")
      .withArgs(ADMIN, admin.address, admin.address);

    expect(await reg.hasRole(ADMIN, admin.address)).to.equal(false);

    for (const caller of [admin, processor, inspector, outsider]) {
      await expect(
        reg.connect(caller).grantRole(PROCESSOR, outsider.address)
      )
        .to.be.revertedWithCustomError(reg, "NotAuthorized")
        .withArgs(ADMIN);
    }

    await expect(reg.connect(processor).anchor(recordId, DIGEST, CID)).to.emit(
      reg,
      "RecordAnchored"
    );
  });

  it("accepts an empty cid", async function () {
    await reg.connect(processor).anchor(recordId, DIGEST, "");

    await expect(reg.connect(inspector).verify(recordId)).to.emit(
      reg,
      "RecordVerified"
    );

    const r = await reg.get(recordId);
    expect(r.cid).to.equal("");
    expect(r.digest).to.equal(DIGEST);
    expect(r.submitter).to.equal(processor.address);
    expect(r.verifier).to.equal(inspector.address);
    expect(r.verifiedAt).to.be.greaterThan(0n);
    expect(r.submittedAt).to.be.greaterThan(0n);

    await expect(
      reg.connect(processor).anchor(recordId, DIGEST, CID)
    ).to.be.revertedWithCustomError(reg, "AlreadyAnchored");
  });

  it("accepts a zero recordId", async function () {
    await reg.connect(processor).anchor(ethers.ZeroHash, DIGEST, CID);

    const r = await reg.get(ethers.ZeroHash);
    expect(r.digest).to.equal(DIGEST);
    expect(r.cid).to.equal(CID);
    expect(r.submitter).to.equal(processor.address);

    // Zero is a real key, so the next anchor of the default id is permanent.
    await expect(
      reg.connect(processor).anchor(ethers.ZeroHash, DIGEST, CID)
    ).to.be.revertedWithCustomError(reg, "AlreadyAnchored");
  });

  it("accepts a very long cid", async function () {
    // A portal CIDv0 is 46 characters. anchor stores whatever string it is given.
    const longCid = "x".repeat(1024);
    await reg.connect(processor).anchor(recordId, DIGEST, longCid);

    const r = await reg.get(recordId);
    expect(r.cid).to.equal(longCid);
    expect(r.cid.length).to.equal(1024);
    expect(r.digest).to.equal(DIGEST);
    expect(r.submittedAt).to.be.greaterThan(0n);
  });
});
