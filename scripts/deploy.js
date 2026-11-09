
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  console.log("Deploying from:", deployer.address);
  console.log("Chain ID:", network.chainId.toString());

  if (network.chainId !== 252501n) {
    throw new Error("Wrong network. Expected DIDLab chain 252501.");
  }

  // With CREDENTIAL_REGISTRY_ADDRESS set, reuse that registry and deploy only
  // BeefSupplyChain. Its issuers and grants carry over, so no credential
  // setup is needed. Without it, deploy a fresh registry first.
  const existing = process.env.CREDENTIAL_REGISTRY_ADDRESS;
  let registry;

  if (existing) {
    if (!hre.ethers.isAddress(existing)) {
      throw new Error(`CREDENTIAL_REGISTRY_ADDRESS is not an address: ${existing}`);
    }
    if ((await hre.ethers.provider.getCode(existing)) === "0x") {
      throw new Error(`No contract at CREDENTIAL_REGISTRY_ADDRESS ${existing}`);
    }
    registry = await hre.ethers.getContractAt("CredentialRegistry", existing);
    console.log("Reusing CredentialRegistry:", existing);
  } else {
    const Registry = await hre.ethers.getContractFactory(
      "CredentialRegistry"
    );
    registry = await Registry.deploy();
    await registry.waitForDeployment();
    console.log("CredentialRegistry:", await registry.getAddress());
    console.log("Registry deployment TX:", registry.deploymentTransaction().hash);
  }

  const registryAddress = await registry.getAddress();

  // Read back from the chain: the deployer must be the registry admin,
  // otherwise setupCredentials.js cannot call setIssuer later. A reused
  // registry with a different admin still works, but warn about it.
  const admin = await registry.admin();

  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    if (!existing) {
      throw new Error(
        `admin() mismatch: expected ${deployer.address}, got ${admin}`
      );
    }
    console.warn(`Note: registry admin is ${admin}, not the deployer.`);
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
