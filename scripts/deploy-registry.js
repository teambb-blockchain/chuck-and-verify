const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No deployer account. Export DIDLAB_PRIVATE_KEY in the shell. Do not write it to a file."
    );
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 252501n) {
    throw new Error(
      `Refusing to deploy on chain ${network.chainId}. DIDLab is 252501.`
    );
  }

  console.log("Deployer:", deployer.address);

  const Factory = await ethers.getContractFactory("AnchorRegistry");
  const reg = await Factory.deploy();
  await reg.waitForDeployment();

  const address = await reg.getAddress();
  const deployTx = reg.deploymentTransaction();
  console.log("AnchorRegistry:", address);
  console.log("deploy tx:", deployTx.hash);

  const ADMIN = await reg.ADMIN();
  const PROCESSOR = await reg.PROCESSOR();
  const INSPECTOR = await reg.INSPECTOR();

  const hasAdmin = await reg.hasRole(ADMIN, deployer.address);
  const hasProcessor = await reg.hasRole(PROCESSOR, deployer.address);
  const hasInspector = await reg.hasRole(INSPECTOR, deployer.address);

  if (!hasAdmin || hasProcessor || hasInspector) {
    throw new Error(
      `Deployer roles unexpected: ADMIN=${hasAdmin} PROCESSOR=${hasProcessor} INSPECTOR=${hasInspector}`
    );
  }

  console.log("deployer has ADMIN only");
  console.log("PROCESSOR role:", PROCESSOR);
  console.log("INSPECTOR role:", INSPECTOR);
  console.log(`Next: export ANCHOR_REGISTRY_ADDRESS=${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
