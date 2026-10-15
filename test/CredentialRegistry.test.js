const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CredentialRegistry", function () {
  let registry;
  let admin, processorIssuer, inspectorIssuer, custodianIssuer, holder, other;
  let CRED_PROCESSOR, CRED_INSPECTOR, CRED_CUSTODIAN;
  const ONE_DAY = 24 * 60 * 60;

  beforeEach(async function () {
    [
      admin,
      processorIssuer,
      inspectorIssuer,
      custodianIssuer,
      holder,
      other,
    ] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("CredentialRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();

    CRED_PROCESSOR = await registry.CRED_PROCESSOR();
    CRED_INSPECTOR = await registry.CRED_INSPECTOR();
    CRED_CUSTODIAN = await registry.CRED_CUSTODIAN();

    await registry.setIssuer(CRED_PROCESSOR, processorIssuer.address);
    await registry.setIssuer(CRED_INSPECTOR, inspectorIssuer.address);
    await registry.setIssuer(CRED_CUSTODIAN, custodianIssuer.address);
  });

  it("sets the deployer as admin", async function () {
    expect(await registry.admin()).to.equal(admin.address);
  });

  it("records issuers per credential type", async function () {
    expect(await registry.issuerOf(CRED_PROCESSOR)).to.equal(
      processorIssuer.address
    );
    expect(await registry.issuerOf(CRED_INSPECTOR)).to.equal(
      inspectorIssuer.address
    );
    expect(await registry.issuerOf(CRED_CUSTODIAN)).to.equal(
      custodianIssuer.address
    );
  });

  it("allows only admin to setIssuer", async function () {
    await expect(
      registry
        .connect(other)
        .setIssuer(CRED_PROCESSOR, other.address)
    ).to.be.revertedWithCustomError(registry, "NotAdmin");
  });

  it("rejects setIssuer with the zero address", async function () {
    await expect(
      registry.setIssuer(CRED_PROCESSOR, ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(registry, "ZeroAddress");
  });

  it("emits IssuerSet when admin assigns an issuer", async function () {
    await expect(
      registry.setIssuer(CRED_PROCESSOR, other.address)
    )
      .to.emit(registry, "IssuerSet")
      .withArgs(CRED_PROCESSOR, other.address, admin.address);
  });

  it("grants a credential when called by that type's issuer", async function () {
    const expiresAt = (await time.latest()) + ONE_DAY;
    await expect(
      registry
        .connect(processorIssuer)
        .grant(holder.address, CRED_PROCESSOR, expiresAt)
    )
      .to.emit(registry, "CredentialGranted")
      .withArgs(
        holder.address,
        CRED_PROCESSOR,
        expiresAt,
        processorIssuer.address
      );

    expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(
      true
    );
  });

  it("rejects grant from an issuer of a different type", async function () {
    const expiresAt = (await time.latest()) + ONE_DAY;
    await expect(
      registry
        .connect(inspectorIssuer)
        .grant(holder.address, CRED_PROCESSOR, expiresAt)
    ).to.be.revertedWithCustomError(registry, "NotIssuer");
  });

  it("rejects grant when no issuer is set for the type", async function () {
    const unsetType = ethers.keccak256(ethers.toUtf8Bytes("UNSET"));
    const expiresAt = (await time.latest()) + ONE_DAY;
    await expect(
      registry
        .connect(processorIssuer)
        .grant(holder.address, unsetType, expiresAt)
    ).to.be.revertedWithCustomError(registry, "NotIssuer");
  });

  it("rejects grant from a non-issuer", async function () {
    const expiresAt = (await time.latest()) + ONE_DAY;
    await expect(
      registry.connect(other).grant(holder.address, CRED_PROCESSOR, expiresAt)
    ).to.be.revertedWithCustomError(registry, "NotIssuer");
  });

  it("rejects an expiry in the past", async function () {
    const expiresAt = await time.latest();
    await expect(
      registry
        .connect(processorIssuer)
        .grant(holder.address, CRED_PROCESSOR, expiresAt)
    ).to.be.revertedWithCustomError(registry, "InvalidExpiry");
  });

  it("rejects revoke from an issuer of a different type", async function () {
    const expiresAt = (await time.latest()) + ONE_DAY;
    await registry
      .connect(inspectorIssuer)
      .grant(holder.address, CRED_INSPECTOR, expiresAt);

    await expect(
      registry
        .connect(processorIssuer)
        .revoke(holder.address, CRED_INSPECTOR)
    ).to.be.revertedWithCustomError(registry, "NotIssuer");
  });

  it("reports revoked credentials as invalid", async function () {
    const expiresAt = (await time.latest()) + ONE_DAY;
    await registry
      .connect(processorIssuer)
      .grant(holder.address, CRED_PROCESSOR, expiresAt);

    await expect(
      registry
        .connect(processorIssuer)
        .revoke(holder.address, CRED_PROCESSOR)
    )
      .to.emit(registry, "CredentialRevoked")
      .withArgs(holder.address, CRED_PROCESSOR, processorIssuer.address);

    expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(
      false
    );
  });

  it("reports expired credentials as invalid", async function () {
    const expiresAt = (await time.latest()) + ONE_DAY;
    await registry
      .connect(processorIssuer)
      .grant(holder.address, CRED_PROCESSOR, expiresAt);

    await time.increaseTo(expiresAt + 1);

    expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(
      false
    );
  });
});
