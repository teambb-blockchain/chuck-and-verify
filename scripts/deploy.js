
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying from:", deployer.address);
  console.log("Chain ID:", network.chainId.toString());

  if (network.chainId !== 252501n) {
    throw new Error("Wrong network. Expected DIDLab chain 252501.");
  }

  // Deploy the credential registry first.
  const Registry = await hre.ethers.getContractFactory(
    "CredentialRegistry"
  );

  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const registryAddress = await registry.getAddress();
  const registryTx = registry.deploymentTransaction();

  console.log("CredentialRegistry:", registryAddress);
  console.log("Registry deployment TX:", registryTx.hash);

  // Deploy the supply chain contract using the registry address.
  const SupplyChain = await hre.ethers.getContractFactory(
    "BeefSupplyChain"
  );

  const supplyChain = await SupplyChain.deploy(registryAddress);
  await supplyChain.waitForDeployment();

  const supplyChainAddress = await supplyChain.getAddress();
  const supplyChainTx = supplyChain.deploymentTransaction();

  console.log("BeefSupplyChain:", supplyChainAddress);
  console.log("SupplyChain deployment TX:", supplyChainTx.hash);

  console.log("Deployment completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
