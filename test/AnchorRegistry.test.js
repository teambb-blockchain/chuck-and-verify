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

  // Sends the transaction first. revertedWithCustomError looks the error name
  // up on the contract before sending, so on the old source it fails in the
  // matcher and never shows that the call succeeded.
  async function expectNamedRevert(tx, errorName, succeeded) {
    let caught;
    try {
      await tx;
    } catch (err) {
      caught = err;
    }
    expect(caught, succeeded).to.not.equal(undefined);
    expect(String(caught.message)).to.include(errorName);
  }

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

  it("rejects grantRole to the zero address", async function () {
    await expectNamedRevert(
      reg.grantRole(PROCESSOR, ethers.ZeroAddress),
      "ZeroAddress",
      "grantRole stored the zero address"
    );

    expect(await reg.hasRole(PROCESSOR, ethers.ZeroAddress)).to.equal(false);
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


  it("rejects the last admin revoking itself", async function () {
    // A second grant of ADMIN to the same account must not open a way out.
    await reg.grantRole(ADMIN, admin.address);

    await expectNamedRevert(
      reg.revokeRole(ADMIN, admin.address),
      "LastAdmin",
      "the last admin revoked itself"
    );

    expect(await reg.hasRole(ADMIN, admin.address)).to.equal(true);

    await expect(reg.grantRole(PROCESSOR, outsider.address)).to.emit(
      reg,
      "RoleGranted"
    );
    expect(await reg.hasRole(PROCESSOR, outsider.address)).to.equal(true);
  });

  it("lets an admin step down when another admin remains", async function () {
    await reg.grantRole(ADMIN, outsider.address);

    await expect(reg.revokeRole(ADMIN, admin.address))
      .to.emit(reg, "RoleRevoked")
      .withArgs(ADMIN, admin.address, admin.address);

    expect(await reg.hasRole(ADMIN, admin.address)).to.equal(false);
    expect(await reg.hasRole(ADMIN, outsider.address)).to.equal(true);

    await expectNamedRevert(
      reg.connect(outsider).revokeRole(ADMIN, outsider.address),
      "LastAdmin",
      "the remaining admin revoked itself"
    );
    expect(await reg.hasRole(ADMIN, outsider.address)).to.equal(true);
  });

  it("rejects an empty cid", async function () {
    await expectNamedRevert(
      reg.connect(processor).anchor(recordId, DIGEST, ""),
      "EmptyCid",
      "empty cid was stored"
    );

    await expect(reg.connect(processor).anchor(recordId, DIGEST, CID)).to.emit(
      reg,
      "RecordAnchored"
    );
    expect((await reg.get(recordId)).cid).to.equal(CID);
  });

  it("rejects a zero recordId", async function () {
    await expectNamedRevert(
      reg.connect(processor).anchor(ethers.ZeroHash, DIGEST, CID),
      "EmptyRecordId",
      "bytes32(0) was stored"
    );

    const empty = await reg.get(ethers.ZeroHash);
    expect(empty.submittedAt).to.equal(0n);
    expect(empty.digest).to.equal(ethers.ZeroHash);

    await expect(reg.connect(processor).anchor(recordId, DIGEST, CID)).to.emit(
      reg,
      "RecordAnchored"
    );
  });

  it("rejects a cid longer than the maximum", async function () {
    // 128 matches MAX_CID_LENGTH. 1024 is the length the audit stored.
    // The old contract accepts 1024, so this test fails there.
    const atMax = "x".repeat(128);
    await reg.connect(processor).anchor(recordId, DIGEST, atMax);
    expect((await reg.get(recordId)).cid).to.equal(atMax);

    const tooLong = "x".repeat(1024);
    const otherId = ethers.keccak256(ethers.toUtf8Bytes("BB-2026-015"));
    await expectNamedRevert(
      reg.connect(processor).anchor(otherId, DIGEST, tooLong),
      "CidTooLong",
      "1024-character cid was stored"
    );
    expect((await reg.get(otherId)).submittedAt).to.equal(0n);
  });

  it("rejects a cid that is not a bare identifier", async function () {
    const gateway =
      "https://gateway.didlab.org/ipfs/QmYE3zK8Kov7vHQpSaETDqXyjUHnHHt9WBvTWKL5MVP1mG";
    const filename = "mock-boxed-beef-lot-BB-2026-014.pdf";

    for (const bad of [gateway, filename]) {
      await expectNamedRevert(
        reg.connect(processor).anchor(recordId, DIGEST, bad),
        "InvalidCid",
        "a gateway URL or filename was stored"
      );
    }

    expect((await reg.get(recordId)).submittedAt).to.equal(0n);
  });
});
