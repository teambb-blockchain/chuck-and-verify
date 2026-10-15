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
if (registryAddress === ethers.ZeroAddress) {
  throw new Error("CREDENTIAL_REGISTRY_ADDRESS cannot be the zero address.");
}

// Private keys are 32 bytes (64 hex chars). A 40-hex value is an address, not a key.
const keyHex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  throw new Error(
    "DIDLAB_PRIVATE_KEY must be a 64-hex-character private key (optionally 0x-prefixed). " +
      "An account address (40 hex chars) will not work — export the private key from your disposable lab wallet."
  );
}

const artifact = JSON.parse(
  fs.readFileSync(
    "./artifacts/contracts/BeefSupplyChain.sol/BeefSupplyChain.json",
    "utf8"
  )
);

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const factory = new ethers.ContractFactory(
  artifact.abi,
  artifact.bytecode,
  wallet
);

console.log("Deployer:", wallet.address);
console.log("Registry:", registryAddress);
const contract = await factory.deploy(registryAddress);
await contract.waitForDeployment();

const address = await contract.getAddress();
const deploymentTx = contract.deploymentTransaction();
console.log("Contract:", address);
console.log("Deployment tx:", deploymentTx?.hash);

const linkedRegistry = await contract.registry();
if (linkedRegistry.toLowerCase() !== registryAddress.toLowerCase()) {
  throw new Error(
    `registry() mismatch: expected ${registryAddress}, got ${linkedRegistry}`
  );
}
console.log("registry():", linkedRegistry);
