
const hre = require("hardhat");

const SUPPLY_CHAIN_ADDRESS =
  "0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e";

async function main() {
  const [wallet] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();

  if (network.chainId !== 252501n) {
    throw new Error("Wrong network. Expected DIDLab 252501.");
  }

  const supplyChain = await hre.ethers.getContractAt(
    "BeefSupplyChain",
    SUPPLY_CHAIN_ADDRESS
  );

  const batchId = hre.ethers.encodeBytes32String("BEEF-001");
  const weightLbs = 500;

  console.log("Registering batch: BEEF-001");
  console.log("Processor:", wallet.address);
  console.log("Weight:", weightLbs, "lbs");

  // Check whether the batch already exists.
  try {
    const existing = await supplyChain.getBatch(batchId);
    console.log("Batch already registered.");
    console.log("Existing weight:", existing.weightLbs.toString());
    return;
  } catch (error) {
    // Only proceed if the contract reports BatchNotFound.
    const data =
      error.data ||
      error.error?.data ||
      error.info?.error?.data;

    if (!data) throw error;

    const decoded = supplyChain.interface.parseError(data);

    if (!decoded || decoded.name !== "BatchNotFound") {
      throw error;
    }
  }

  // Submit the transaction.
  const tx = await supplyChain.registerBatch(batchId, weightLbs);
  console.log("Registration TX:", tx.hash);

  const receipt = await tx.wait();

  if (receipt.status !== 1) {
    throw new Error("Batch registration failed.");
  }

  console.log("Transaction confirmed in block:", receipt.blockNumber);

  // Read the batch directly from the blockchain.
  const batch = await supplyChain.getBatch(batchId);

  console.log("Batch ID: BEEF-001");
  console.log("Weight:", batch.weightLbs.toString(), "lbs");
  console.log("Current holder:", batch.currentHolder);
  console.log("Inspected:", batch.inspected);
  console.log("Recalled:", batch.recalled);
  console.log("Batch registration completed successfully!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
