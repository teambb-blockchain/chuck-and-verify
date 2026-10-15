
const hre = require("hardhat");

const REGISTRY_ADDRESS =
  "0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E";

async function main() {
  const [wallet] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  if (network.chainId !== 252501n) {
    throw new Error("Wrong network. Expected DIDLab 252501.");
  }

  const registry = await hre.ethers.getContractAt(
    "CredentialRegistry",
    REGISTRY_ADDRESS
  );

  const processorType = await registry.CRED_PROCESSOR();

  console.log("Wallet:", wallet.address);

  // Step 1: Appoint the wallet as processor credential issuer
  const issuer = await registry.issuerOf(processorType);

  if (issuer.toLowerCase() !== wallet.address.toLowerCase()) {
    const tx = await registry.setIssuer(processorType, wallet.address);
    console.log("Set issuer TX:", tx.hash);
    await tx.wait();
  }

  // Step 2: Grant processor credential valid for 30 days
  const isValid = await registry.isValid(wallet.address, processorType);

  if (!isValid) {
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const tx = await registry.grant(
      wallet.address,
      processorType,
      expiresAt
    );
    console.log("Grant credential TX:", tx.hash);
    await tx.wait();
  }

  console.log(
    "Processor credential valid:",
    await registry.isValid(wallet.address, processorType)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
