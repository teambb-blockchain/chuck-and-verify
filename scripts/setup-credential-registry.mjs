import fs from "node:fs";
import { ethers } from "ethers";

const rpcUrl = process.env.DIDLAB_RPC_URL;
const privateKey = process.env.DIDLAB_PRIVATE_KEY;
const registryAddress = process.env.CREDENTIAL_REGISTRY_ADDRESS;

if (!rpcUrl || !privateKey) {
  throw new Error("Set DIDLAB_RPC_URL and DIDLAB_PRIVATE_KEY first.");
}
if (!registryAddress) {
  throw new Error(
    "Set CREDENTIAL_REGISTRY_ADDRESS to your deployed CredentialRegistry."
  );
}
if (!ethers.isAddress(registryAddress)) {
  throw new Error(`CREDENTIAL_REGISTRY_ADDRESS is not a valid address: ${registryAddress}`);
}

// Private keys are 32 bytes (64 hex chars). A 40-hex value is an address, not a key.
const keyHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  throw new Error(
    "DIDLAB_PRIVATE_KEY must be a 64-hex-character private key (optionally 0x-prefixed). " +
      "An account address (40 hex chars) will not work — export the private key from your disposable lab wallet."
  );
}

function requireAddress(name, value) {
  if (!ethers.isAddress(value)) {
    throw new Error(`${name} is not a valid address: ${value}`);
  }
  if (value === ethers.ZeroAddress) {
    throw new Error(`${name} cannot be the zero address.`);
  }
  return value;
}

const artifact = JSON.parse(
  fs.readFileSync(
    "./artifacts/contracts/CredentialRegistry.sol/CredentialRegistry.json",
    "utf8"
  )
);

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const registry = new ethers.Contract(registryAddress, artifact.abi, wallet);

const admin = await registry.admin();
if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
  throw new Error(
    `Caller ${wallet.address} is not registry admin ${admin}. ` +
      "setIssuer requires the admin key."
  );
}

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

const ttlSeconds = BigInt(process.env.CREDENTIAL_TTL_SECONDS || 365 * 24 * 60 * 60);
const latest = await provider.getBlock("latest");
const expiresAt = BigInt(latest.timestamp) + ttlSeconds;

const CRED_PROCESSOR = await registry.CRED_PROCESSOR();
const CRED_INSPECTOR = await registry.CRED_INSPECTOR();
const CRED_CUSTODIAN = await registry.CRED_CUSTODIAN();

console.log("Admin / issuer:", wallet.address);
console.log("Registry:", registryAddress);
console.log("Processor holder:", processor);
console.log("Inspector holder:", inspector);
console.log("Custodian holder:", custodian);
console.log("Expires at:", expiresAt.toString());

// Lab default: admin is issuer for every type (same as BeefSupplyChain tests).
for (const [label, credentialType] of [
  ["PROCESSOR", CRED_PROCESSOR],
  ["INSPECTOR", CRED_INSPECTOR],
  ["CUSTODIAN", CRED_CUSTODIAN],
]) {
  const tx = await registry.setIssuer(credentialType, wallet.address);
  console.log(`setIssuer(${label}) tx:`, tx.hash);
  await tx.wait();
}

const grants = [
  ["PROCESSOR", processor, CRED_PROCESSOR],
  ["INSPECTOR", inspector, CRED_INSPECTOR],
  ["CUSTODIAN", custodian, CRED_CUSTODIAN],
  // Processor also needs CUSTODIAN to ship after register (matches tests).
  ["CUSTODIAN (processor)", processor, CRED_CUSTODIAN],
];

for (const [label, holder, credentialType] of grants) {
  const tx = await registry.grant(holder, credentialType, expiresAt);
  console.log(`grant(${label}) tx:`, tx.hash);
  await tx.wait();
}

const checks = [
  ["processor/PROCESSOR", processor, CRED_PROCESSOR],
  ["inspector/INSPECTOR", inspector, CRED_INSPECTOR],
  ["custodian/CUSTODIAN", custodian, CRED_CUSTODIAN],
  ["processor/CUSTODIAN", processor, CRED_CUSTODIAN],
];

for (const [label, holder, credentialType] of checks) {
  const ok = await registry.isValid(holder, credentialType);
  if (!ok) {
    throw new Error(`isValid failed for ${label}`);
  }
  console.log(`isValid(${label}):`, ok);
}
