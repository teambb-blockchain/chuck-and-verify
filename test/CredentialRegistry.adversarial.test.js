// Adversarial tests for CredentialRegistry (Guided Lab 3, Activity 7).
//
// These ask "does the unauthorized or hostile path fail?". A test whose name
// starts with "FINDING" documents behaviour the review in
// docs/SECURITY_REVIEW.md rates as a defect or accepted risk: it passes
// because the defect is present. When a fix lands, flip that test to assert
// the revert so it becomes the regression guard.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CredentialRegistry — adversarial", function () {
  let registry, admin, issuerP, issuerI, holder, attacker;
  let CRED_PROCESSOR, CRED_INSPECTOR;
  const ONE_DAY = 24 * 60 * 60;

  beforeEach(async function () {
    [admin, issuerP, issuerI, holder, attacker] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CredentialRegistry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
    CRED_PROCESSOR = await registry.CRED_PROCESSOR();
    CRED_INSPECTOR = await registry.CRED_INSPECTOR();
    await registry.setIssuer(CRED_PROCESSOR, issuerP.address);
    await registry.setIssuer(CRED_INSPECTOR, issuerI.address);
  });

  describe("role boundaries", function () {
    it("rejects setIssuer from an issuer, a holder and an outsider", async function () {
      for (const who of [issuerP, holder, attacker]) {
        await expect(
          registry.connect(who).setIssuer(CRED_PROCESSOR, who.address)
        ).to.be.revertedWithCustomError(registry, "NotAdmin");
      }
    });

    it("rejects grant and revoke from the admin when it is not the issuer", async function () {
      const exp = (await time.latest()) + ONE_DAY;
      await expect(
        registry.grant(holder.address, CRED_PROCESSOR, exp)
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
      await registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp);
      await expect(
        registry.revoke(holder.address, CRED_PROCESSOR)
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("rejects a holder granting itself a second credential type", async function () {
      const exp = (await time.latest()) + ONE_DAY;
      await registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp);
      await expect(
        registry.connect(holder).grant(holder.address, CRED_INSPECTOR, exp)
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("strips grant/revoke power from a replaced issuer at once", async function () {
      const exp = (await time.latest()) + ONE_DAY;
      await registry.setIssuer(CRED_PROCESSOR, attacker.address);
      await expect(
        registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp)
      ).to.be.revertedWithCustomError(registry, "NotIssuer");
    });

    it("has no function that changes admin", async function () {
      // admin is immutable; the ABI exposes no setter, so no one can take it.
      const names = registry.interface.fragments
        .filter((f) => f.type === "function")
        .map((f) => f.name);
      expect(names).to.not.include.members(["setAdmin", "transferAdmin", "setOwner"]);
      expect(await registry.admin()).to.equal(admin.address);
    });
  });

  describe("hostile inputs", function () {
    it("rejects expiresAt equal to the block time it is mined in", async function () {
      const at = (await time.latest()) + 10;
      await time.setNextBlockTimestamp(at);
      await expect(
        registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, at)
      ).to.be.revertedWithCustomError(registry, "InvalidExpiry");
    });

    it("rejects revoke of a credential that was never granted", async function () {
      await expect(
        registry.connect(issuerP).revoke(holder.address, CRED_PROCESSOR)
      ).to.be.revertedWithCustomError(registry, "CredentialNotFound");
    });

    it("treats the expiry second itself as still valid, the next as expired", async function () {
      const exp = (await time.latest()) + 100;
      await registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp);
      await time.setNextBlockTimestamp(exp);
      await ethers.provider.send("evm_mine", []);
      expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(true);
      await ethers.provider.send("evm_mine", []);
      expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(false);
    });

    it("FINDING CR-3: grants a credential to the zero address", async function () {
      const exp = (await time.latest()) + ONE_DAY;
      await expect(
        registry.connect(issuerP).grant(ethers.ZeroAddress, CRED_PROCESSOR, exp)
      ).to.emit(registry, "CredentialGranted");
      expect(await registry.isValid(ethers.ZeroAddress, CRED_PROCESSOR)).to.equal(true);
    });

    it("FINDING CR-4: accepts a credential that never expires (type(uint256).max)", async function () {
      await registry
        .connect(issuerP)
        .grant(holder.address, CRED_PROCESSOR, ethers.MaxUint256);
      await time.increase(100 * 365 * ONE_DAY);
      expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(true);
    });

    it("FINDING CR-5: setIssuer accepts a credential type nothing checks", async function () {
      const typo = ethers.id("PROCESOR"); // misspelled
      await registry.setIssuer(typo, issuerP.address);
      const exp = (await time.latest()) + ONE_DAY;
      await registry.connect(issuerP).grant(holder.address, typo, exp);
      expect(await registry.isValid(holder.address, typo)).to.equal(true);
      expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(false);
    });
  });

  describe("ordering", function () {
    it("FINDING CR-2: a revoked credential becomes valid again on a later grant", async function () {
      const exp = (await time.latest()) + ONE_DAY;
      await registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp);
      await registry.connect(issuerP).revoke(holder.address, CRED_PROCESSOR);
      expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(false);
      // "grant or renew" overwrites the revoked flag.
      await registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp);
      expect(await registry.isValid(holder.address, CRED_PROCESSOR)).to.equal(true);
    });

    it("FINDING CR-1: credentials a replaced issuer granted stay valid", async function () {
      // A compromised PROCESSOR issuer grants the attacker before the admin
      // notices and replaces it. setIssuer does not undo those grants.
      const exp = (await time.latest()) + 365 * ONE_DAY;
      await registry.connect(issuerP).grant(attacker.address, CRED_PROCESSOR, exp);
      await registry.setIssuer(CRED_PROCESSOR, admin.address);
      expect(await registry.isValid(attacker.address, CRED_PROCESSOR)).to.equal(true);
      // Recovery needs the new issuer to find and revoke each grant by hand.
      await registry.revoke(attacker.address, CRED_PROCESSOR);
      expect(await registry.isValid(attacker.address, CRED_PROCESSOR)).to.equal(false);
    });

    it("emits CredentialRevoked again for an already-revoked credential (no state change)", async function () {
      const exp = (await time.latest()) + ONE_DAY;
      await registry.connect(issuerP).grant(holder.address, CRED_PROCESSOR, exp);
      await registry.connect(issuerP).revoke(holder.address, CRED_PROCESSOR);
      await expect(
        registry.connect(issuerP).revoke(holder.address, CRED_PROCESSOR)
      ).to.emit(registry, "CredentialRevoked");
    });
  });
});
