const { ethers } = require("hardhat");

function requireAddress(name, value) {
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(
      `${name} must be a non-zero address. Export it in the shell.`
    );
  }
  return ethers.getAddress(value);
}

function roleGranted(reg, receipt, label) {
  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = reg.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "RoleGranted") continue;
    console.log(`RoleGranted ${label}`);
    console.log("  role:", parsed.args.role);
    console.log("  account:", parsed.args.account);
    console.log("  by:", parsed.args.by);
    return;
  }
  throw new Error(`${label} receipt has no RoleGranted log`);
}

async function main() {
  const registry = requireAddress(
    "ANCHOR_REGISTRY_ADDRESS",
    process.env.ANCHOR_REGISTRY_ADDRESS
  );
  const processorAddr = requireAddress(
    "DEMO_PROCESSOR",
    process.env.DEMO_PROCESSOR
  );
  const inspectorAddr = requireAddress(
    "DEMO_INSPECTOR",
    process.env.DEMO_INSPECTOR
  );

  if (processorAddr === inspectorAddr) {
    throw new Error(
      "DEMO_PROCESSOR and DEMO_INSPECTOR must be two different wallets. " +
        "The inspector has to be an address that can sign a verification the processor did not anchor."
    );
  }

  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error(
      "No admin account. Export DIDLAB_PRIVATE_KEY for the wallet that deployed AnchorRegistry."
    );
  }

  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 252501n) {
    throw new Error(
      `Refusing to grant on chain ${network.chainId}. DIDLab is 252501.`
    );
  }

  const reg = await ethers.getContractAt("AnchorRegistry", registry);
  const ADMIN = await reg.ADMIN();
  if (!(await reg.hasRole(ADMIN, admin.address))) {
    throw new Error(
      `Caller ${admin.address} does not hold ADMIN on ${registry}.`
    );
  }

  const PROCESSOR = await reg.PROCESSOR();
  const INSPECTOR = await reg.INSPECTOR();

  if (await reg.hasRole(INSPECTOR, processorAddr)) {
    throw new Error(
      "DEMO_PROCESSOR already holds INSPECTOR. The two roles have to stay on different wallets."
    );
  }
  if (await reg.hasRole(PROCESSOR, inspectorAddr)) {
    throw new Error(
      "DEMO_INSPECTOR already holds PROCESSOR. The two roles have to stay on different wallets."
    );
  }

  console.log("Admin:", admin.address);
  console.log("Registry:", registry);
  console.log("PROCESSOR:", processorAddr);
  console.log("INSPECTOR:", inspectorAddr);

  let tx = await reg.grantRole(PROCESSOR, processorAddr);
  let receipt = await tx.wait();
  console.log("grant PROCESSOR:", receipt.hash);
  roleGranted(reg, receipt, "PROCESSOR");

  tx = await reg.grantRole(INSPECTOR, inspectorAddr);
  receipt = await tx.wait();
  console.log("grant INSPECTOR:", receipt.hash);
  roleGranted(reg, receipt, "INSPECTOR");

  if (!(await reg.hasRole(PROCESSOR, processorAddr))) {
    throw new Error("PROCESSOR grant did not stick");
  }
  if (!(await reg.hasRole(INSPECTOR, inspectorAddr))) {
    throw new Error("INSPECTOR grant did not stick");
  }
  if (await reg.hasRole(PROCESSOR, inspectorAddr)) {
    throw new Error("INSPECTOR wallet also holds PROCESSOR");
  }
  if (await reg.hasRole(INSPECTOR, processorAddr)) {
    throw new Error("PROCESSOR wallet also holds INSPECTOR");
  }

  console.log("hasRole PROCESSOR:", true);
  console.log("hasRole INSPECTOR:", true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
