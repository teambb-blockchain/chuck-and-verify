
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

  // Read back from the chain: the deployer must be the registry admin,
  // otherwise setupCredentials.js cannot call setIssuer later.
  const admin = await registry.admin();

  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(
      `admin() mismatch: expected ${deployer.address}, got ${admin}`
    );
  }

  console.log("Registry admin:", admin);

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

  // Read back from the chain: the supply chain must point at the registry
  // we just deployed, not at a stale address from an earlier run.
  const linkedRegistry = await supplyChain.registry();

  if (linkedRegistry.toLowerCase() !== registryAddress.toLowerCase()) {
    throw new Error(
      `registry() mismatch: expected ${registryAddress}, got ${linkedRegistry}`
    );
  }

  console.log("SupplyChain registry:", linkedRegistry);

  console.log("Deployment completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
