const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ProjectAnchor", function () {
  let anchor, owner, other;

  beforeEach(async function () {
    [owner, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ProjectAnchor");
    anchor = await Factory.deploy();
    await anchor.waitForDeployment();
  });

  it("sets the deployer as owner", async function () {
    expect(await anchor.owner()).to.equal(owner.address);
  });

  it("anchors a commitment and emits the event", async function () {
    const c = ethers.keccak256(ethers.toUtf8Bytes("shipment-001"));
    await expect(anchor.anchor(c)).to.emit(anchor, "CommitmentAnchored");
    const [stored] = await anchor.current();
    expect(stored).to.equal(c);
  });

  it("rejects a non-owner", async function () {
    const c = ethers.keccak256(ethers.toUtf8Bytes("x"));
    await expect(anchor.connect(other).anchor(c)).to.be.revertedWithCustomError(
      anchor,
      "NotOwner"
    );
  });

  it("rejects an empty commitment", async function () {
    await expect(anchor.anchor(ethers.ZeroHash)).to.be.revertedWithCustomError(
      anchor,
      "EmptyCommitment"
    );
  });
});
