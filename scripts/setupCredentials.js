
const hre = require("hardhat");

// CP2 deployment on DIDLab. Override with CREDENTIAL_REGISTRY_ADDRESS after
// a redeploy.
const DEFAULT_REGISTRY_ADDRESS =
  "0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E";

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function requireAddress(name, value) {
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }

  if (value === hre.ethers.ZeroAddress) {
    throw new Error(`${name} cannot be the zero address.`);
  }

  return value;
}

async function main() {
  const [wallet] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  if (network.chainId !== 252501n) {
    throw new Error("Wrong network. Expected DIDLab 252501.");
  }

  const registryAddress = requireAddress(
    "CREDENTIAL_REGISTRY_ADDRESS",
    process.env.CREDENTIAL_REGISTRY_ADDRESS || DEFAULT_REGISTRY_ADDRESS
  );

  const registry = await hre.ethers.getContractAt(
    "CredentialRegistry",
    registryAddress
  );

  // setIssuer is admin-only. Fail early with a clear message instead of a
  // NotAdmin revert on the first transaction.
  const admin = await registry.admin();

  if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(
      `Wallet ${wallet.address} is not the registry admin ${admin}.`
    );
  }

  // Demo holders. Each defaults to the deployer, which reproduces the CP2
  // single-wallet setup. Set DEMO_PROCESSOR, DEMO_INSPECTOR and
  // DEMO_CUSTODIAN to separate wallets to show role separation on chain.
  const processor = requireAddress(
    "DEMO_PROCESSOR",
    process.env.DEMO_PROCESSOR || wallet.address
  );
  const inspector = requireAddress(
    "DEMO_INSPECTOR",
    process.env.DEMO_INSPECTOR || wallet.address
  );
  const custodian = requireAddress(
    "DEMO_CUSTODIAN",
    process.env.DEMO_CUSTODIAN || wallet.address
  );

  const ttlSeconds = BigInt(
    process.env.CREDENTIAL_TTL_SECONDS || DEFAULT_TTL_SECONDS
  );

  // Expiry is checked against block.timestamp on chain, so base it on the
  // latest block rather than the local clock.
  const latest = await hre.ethers.provider.getBlock("latest");
  const expiresAt = BigInt(latest.timestamp) + ttlSeconds;

  const CRED_PROCESSOR = await registry.CRED_PROCESSOR();
  const CRED_INSPECTOR = await registry.CRED_INSPECTOR();
  const CRED_CUSTODIAN = await registry.CRED_CUSTODIAN();

  console.log("Admin / issuer:", wallet.address);
  console.log("Registry:", registryAddress);
  console.log("Processor holder:", processor);
  console.log("Inspector holder:", inspector);
  console.log("Custodian holder:", custodian);
  console.log("New grants expire at:", expiresAt.toString());

  // Step 1: the admin is the issuer for every credential type (same setup
  // as test/BeefSupplyChain.test.js).
  const issuers = [
    ["PROCESSOR", CRED_PROCESSOR],
    ["INSPECTOR", CRED_INSPECTOR],
    ["CUSTODIAN", CRED_CUSTODIAN],
  ];

  for (const [label, credentialType] of issuers) {
    const issuer = await registry.issuerOf(credentialType);

    if (issuer.toLowerCase() !== wallet.address.toLowerCase()) {
      const tx = await registry.setIssuer(credentialType, wallet.address);
      console.log(`setIssuer(${label}) TX:`, tx.hash);
      await tx.wait();
    } else {
      console.log(`setIssuer(${label}): already set`);
    }
  }

  // Step 2: grant demo credentials. The processor also needs CUSTODIAN so it
  // can ship a batch after registering it (matches the tests).
  const grants = [
    ["processor/PROCESSOR", processor, CRED_PROCESSOR],
    ["inspector/INSPECTOR", inspector, CRED_INSPECTOR],
    ["custodian/CUSTODIAN", custodian, CRED_CUSTODIAN],
    ["processor/CUSTODIAN", processor, CRED_CUSTODIAN],
  ];

  for (const [label, holder, credentialType] of grants) {
    const alreadyValid = await registry.isValid(holder, credentialType);

    if (!alreadyValid) {
      const tx = await registry.grant(holder, credentialType, expiresAt);
      console.log(`grant(${label}) TX:`, tx.hash);
      await tx.wait();
    } else {
      console.log(`grant(${label}): already valid`);
    }
  }

  // Step 3: read back every credential the demo depends on.
  for (const [label, holder, credentialType] of grants) {
    const ok = await registry.isValid(holder, credentialType);

    if (!ok) {
      throw new Error(`isValid(${label}) is false after setup.`);
    }

    console.log(`isValid(${label}):`, ok);
  }

  console.log("Credential setup completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
