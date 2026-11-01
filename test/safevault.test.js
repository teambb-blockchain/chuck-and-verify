const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SafeVault — attacks now fail", function () {
  let vault, deployer, victim, attacker;

  beforeEach(async function () {
    [deployer, victim, attacker] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SafeVault");
    vault = await Factory.deploy();
    await vault.waitForDeployment();
    await vault.connect(victim).deposit({ value: ethers.parseEther("5") });
  });

  it("blocks the ownership seizure", async function () {
    await expect(vault.connect(attacker).setOwner(attacker.address))
      .to.be.revertedWithCustomError(vault, "NotOwner");
  });

  it("blocks the reentrancy drain", async function () {
    const Reenter = await ethers.getContractFactory("Reenterer");
    const bomb = await Reenter.deploy(await vault.getAddress());
    await bomb.waitForDeployment();

    // the re-entrant call reverts, which bubbles up and reverts the whole attack
    await expect(bomb.attack({ value: ethers.parseEther("1") })).to.be.reverted;

    const drained = await ethers.provider.getBalance(await bomb.getAddress());
    expect(drained).to.equal(0n);
  });

  it("rejects the zero address as owner", async function () {
    await expect(vault.setOwner(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("lets a depositor withdraw their own balance once", async function () {
    await vault.connect(victim).withdraw(ethers.parseEther("2"));
    expect(await vault.balances(victim.address)).to.equal(ethers.parseEther("3"));
  });
});