
const hre = require("hardhat");

// Which contracts to deploy against the registry, comma-separated.
// Default is BeefSupplyChain only, as before. SensorSignatureVerifier deploys
// the signing feasibility verifier (ADR 0004) and sets the SENSOR issuer.
// TemperatureLog (ADR 0005) stores verified summaries. It uses the
// BeefSupplyChain and verifier deployed in the same run, or BSC_ADDRESS and
// SENSOR_VERIFIER_ADDRESS (default: the verifier deployed 2026-11-17).
// The required range is TEMP_RANGE_LOW_CENTIC / TEMP_RANGE_HIGH_CENTIC
// (default -220 / 444, i.e. 28-40 °F, as in test/SensorSignature.test.js).
const KNOWN_CONTRACTS = ["BeefSupplyChain", "SensorSignatureVerifier", "TemperatureLog"];
const DEPLOYED_VERIFIER = "0x8Ddf5a13911F9f98c00BA2Af6A00aeB20A1b63f4";

function contractsToDeploy() {
  const list = (process.env.DEPLOY_CONTRACTS || "BeefSupplyChain")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of list) {
    if (!KNOWN_CONTRACTS.includes(name)) {
      throw new Error(
        `Unknown contract in DEPLOY_CONTRACTS: ${name}. Known: ${KNOWN_CONTRACTS.join(", ")}`
      );
    }
  }
  if (list.length === 0) throw new Error("DEPLOY_CONTRACTS is empty.");
  return list;
}

async function deployBeefSupplyChain(registryAddress) {
  const SupplyChain = await hre.ethers.getContractFactory("BeefSupplyChain");

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
  return supplyChainAddress;
}

async function deploySensorVerifier(registry, registryAddress, deployer, admin) {
  const Verifier = await hre.ethers.getContractFactory("SensorSignatureVerifier");
  const verifier = await Verifier.deploy(registryAddress);
  await verifier.waitForDeployment();

  console.log("SensorSignatureVerifier:", await verifier.getAddress());
  console.log("Verifier deployment TX:", verifier.deploymentTransaction().hash);

  const linkedRegistry = await verifier.registry();
  if (linkedRegistry.toLowerCase() !== registryAddress.toLowerCase()) {
    throw new Error(
      `verifier registry() mismatch: expected ${registryAddress}, got ${linkedRegistry}`
    );
  }
  console.log("Verifier registry:", linkedRegistry);

  // The registry accepts any bytes32 type, so SENSOR needs no registry
  // redeploy. Check the verifier uses the string the registry will be given.
  const CRED_SENSOR = await verifier.CRED_SENSOR();
  if (CRED_SENSOR !== hre.ethers.id("SENSOR")) {
    throw new Error(`CRED_SENSOR is not keccak256("SENSOR"): ${CRED_SENSOR}`);
  }

  await setSensorIssuer(registry, CRED_SENSOR, deployer, admin);
  return verifier.getAddress();
}

async function deployTemperatureLog(supplyChainAddress, verifierAddress, registryAddress) {
  for (const [name, value] of [["BeefSupplyChain", supplyChainAddress], ["SensorSignatureVerifier", verifierAddress]]) {
    if (!value || !hre.ethers.isAddress(value) || (await hre.ethers.provider.getCode(value)) === "0x") {
      throw new Error(`TemperatureLog needs a deployed ${name}; got ${value}`);
    }
  }
  const low = Number(process.env.TEMP_RANGE_LOW_CENTIC ?? -220);
  const high = Number(process.env.TEMP_RANGE_HIGH_CENTIC ?? 444);
  const Log = await hre.ethers.getContractFactory("TemperatureLog");
  const log = await Log.deploy(verifierAddress, supplyChainAddress, low, high);
  await log.waitForDeployment();
  console.log("TemperatureLog:", await log.getAddress());
  console.log("TemperatureLog deployment TX:", log.deploymentTransaction().hash);

  // Read back: it must point at this supply chain and verifier, and through
  // the verifier at the same registry.
  const checks = [
    ["supplyChain()", await log.supplyChain(), supplyChainAddress],
    ["verifier()", await log.verifier(), verifierAddress],
    ["registry()", await log.registry(), registryAddress],
  ];
  for (const [label, got, want] of checks) {
    if (got.toLowerCase() !== want.toLowerCase()) throw new Error(`TemperatureLog ${label} mismatch: expected ${want}, got ${got}`);
  }
  console.log(`TemperatureLog range: ${low} to ${high} (0.01 °C)`);
}

// SENSOR_ISSUER stands in for the calibration lab (0003). Without it, an
// unset SENSOR issuer becomes the deployer, and an issuer that is already
// set is left alone.
async function setSensorIssuer(registry, CRED_SENSOR, deployer, admin) {
  const requested = process.env.SENSOR_ISSUER;
  if (requested !== undefined) {
    if (!hre.ethers.isAddress(requested) || requested === hre.ethers.ZeroAddress) {
      throw new Error(`SENSOR_ISSUER is not a usable address: ${requested}`);
    }
  }

  const current = await registry.issuerOf(CRED_SENSOR);
  const target = requested
    ? hre.ethers.getAddress(requested)
    : current !== hre.ethers.ZeroAddress
      ? current
      : deployer.address;

  if (current.toLowerCase() === target.toLowerCase()) {
    console.log("SENSOR issuer: already", current);
    return;
  }

  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    console.warn(
      `SENSOR issuer NOT set: only the registry admin ${admin} can call setIssuer.\n` +
        `  The admin must call setIssuer(${CRED_SENSOR}, ${target}) on the registry.`
    );
    return;
  }

  if (target.toLowerCase() === admin.toLowerCase()) {
    console.warn(
      "Note: the admin is also the SENSOR issuer. Set SENSOR_ISSUER to a separate wallet for the calibration lab (§14 row 2)."
    );
  }

  const tx = await registry.setIssuer(CRED_SENSOR, target);
  console.log("setIssuer(SENSOR) TX:", tx.hash);
  await tx.wait();

  const after = await registry.issuerOf(CRED_SENSOR);
  if (after.toLowerCase() !== target.toLowerCase()) {
    throw new Error(`issuerOf(SENSOR) mismatch: expected ${target}, got ${after}`);
  }
  console.log("SENSOR issuer:", after);
}

async function main() {
  const contracts = contractsToDeploy();

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
  console.log("Deploying:", contracts.join(", "));

  let supplyChainAddress = process.env.BSC_ADDRESS;
  let verifierAddress = process.env.SENSOR_VERIFIER_ADDRESS || DEPLOYED_VERIFIER;
  if (contracts.includes("BeefSupplyChain")) {
    supplyChainAddress = await deployBeefSupplyChain(registryAddress);
  }
  if (contracts.includes("SensorSignatureVerifier")) {
    verifierAddress = await deploySensorVerifier(registry, registryAddress, deployer, admin);
  }
  if (contracts.includes("TemperatureLog")) {
    await deployTemperatureLog(supplyChainAddress, verifierAddress, registryAddress);
  }

  console.log("Deployment completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
