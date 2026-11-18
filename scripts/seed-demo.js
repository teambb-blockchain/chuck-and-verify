// Seed the demo supply chain: 13 fictional businesses and 15 batches with
// stories (scripts/demo/), run as real transactions so every record on the
// batch page is a real on-chain record.
//
//   Local dry run (deploys its own contracts, nothing leaves this machine):
//     npx hardhat run scripts/seed-demo.js
//     npx hardhat run scripts/seed-demo.js --network localhost   # against `npx hardhat node`
//   On localhost, set BSC_ADDRESS to the contracts a first run deployed to
//   resume or rerun against them.
//
//   DIDLab (BeefSupplyChain v5 only):
//     npx hardhat run scripts/seed-demo.js --network didlab             # plan and cost, sends nothing
//     DEMO_GO=1 npx hardhat run scripts/seed-demo.js --network didlab   # do it
//
// On DIDLab the deployer wallet (DEPLOYER_KEY) must be the CredentialRegistry
// issuer for PROCESSOR, INSPECTOR and CUSTODIAN (npm run setup:credentials).
// It grants each business its credentials, sends each one enough TRUST for its
// own transactions, and publishes the photos and mock PDFs to IPFS.
//
// Business wallets are derived from DEMO_SEED, or from DEPLOYER_KEY when that
// is unset, so a rerun finds the same wallets and nothing new needs storing.
// No private key is printed or written anywhere.
//
// On DIDLab, progress is saved after every transaction
// (cache/demo-progress-*.json), so a run that stops partway resumes where it
// left off.
//
// Writes:
//   frontend/public/demo/stories.json   what the batch page shows (DIDLab)
//   scripts/demo/directory.json         business names, places and roles, for
//                                       the Portal users import or seed:directory
// A local run writes both under cache/demo-dryrun/ instead.
//
// Temperature (ADR 0005): each business that holds beef gets a demo sensor
// key (derived like the wallets). Before each leg ends, its sensor signs a
// summary of simulated readings (scripts/lib/sensor-summary.js) and the
// holder records it in TemperatureLog. On DIDLab this needs
// TEMPERATURE_LOG_ADDRESS and the deployer as SENSOR issuer (the registry
// admin's setIssuer); without them the batches are seeded with no readings.
//
// Env: BSC_ADDRESS (default: server/chainIndex.js DEFAULTS.contract),
// TEMPERATURE_LOG_ADDRESS,
// DEMO_SEED, DEMO_CREDENTIAL_DAYS (365), DEMO_SKIP_IPFS=1, DEMO_GO=1,
// DEMO_STOP_AFTER=n (stop after n batch transactions, to test resuming).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const hre = require("hardhat");
const { BUSINESSES } = require("./demo/businesses");
const { BATCHES, PHOTOS } = require("./demo/batches");
const { makePdf } = require("./lib/mini-pdf");
const sensorLayout = require("./lib/sensor-summary");
const { DEFAULTS } = require("../server/chainIndex");

const { ethers } = hre;
const ROOT = path.join(__dirname, "..");
const IPFS_ADD_URL = "https://blockchain.didlab.org/api/ipfs/add";
const DIDLAB = 252501n;
const GAS_PER_TX = 260000n; // generous: a 4-way split is the heaviest step
const FINAL = { sold: 1, consumed: 2, disposed: 3 };
const FINAL_TEXT = { 1: "sold", 2: "consumed", 3: "disposed" };
const ORG_LABEL = { processor: "Processor", fsis: "Inspector", storage: "Cold storage", carrier: "Carrier", distributor: "Distributor", retailer: "Grocery store", restaurant: "Restaurant" };

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const id32 = (name) => ethers.encodeBytes32String(name);
const business = (slug) => {
  const b = BUSINESSES.find((x) => x.slug === slug);
  if (!b) throw new Error("Unknown business in scripts/demo/batches.js: " + slug);
  return b;
};

// --- The plan: each batch's steps as single transactions -------------------

function expandPlan() {
  const actions = [];
  const expected = new Map(); // name -> { holder, pending, disposition, recallClass, lots }
  for (const batch of BATCHES) {
    const state = (name) => expected.get(name);
    expected.set(batch.id, { holder: batch.processor, pending: null, disposition: 0, recallClass: 0, parent: null, lots: 0, leg: 0 });
    // A holder's sensor summary for its leg goes on chain before the leg
    // ends (TemperatureLog reads the leg and holder from chain state).
    const recorded = new Set();
    const temp = (name) => {
      const s = state(name);
      const key = name + "#" + s.leg;
      if (recorded.has(key)) return;
      recorded.add(key);
      // A lot's first leg is at the business that split it, after the split;
      // the time before is on the parent's record. Keep it short.
      push({ kind: "temp", by: s.holder, name, leg: s.leg, afterSplit: s.leg === 0 && Boolean(s.parent), profile: (batch.temperature || {})[s.holder] || "cold" });
    };
    const push = (a) => actions.push({ batch: batch.id, key: batch.id + "#" + actions.filter((x) => x.batch === batch.id).length, ...a });
    push({ kind: "register", by: batch.processor, name: batch.id });
    for (const step of batch.steps) {
      const [op] = step;
      if (op === "inspect") {
        push({ kind: "inspect", by: "usda", name: batch.id, passed: step[1] });
      } else if (op === "move") {
        const name = batch.id + step[1];
        const stops = step[2];
        for (let i = 1; i < stops.length; i++) {
          const inTransit = stops[i].startsWith("~");
          const to = stops[i].replace(/^~/, "");
          const from = stops[i - 1].replace(/^~/, "");
          if (state(name).holder !== from) throw new Error(`${name}: ${from} ships it but ${state(name).holder} holds it`);
          push({ kind: "ship", by: from, to, name });
          state(name).pending = to;
          if (!inTransit) {
            temp(name);
            push({ kind: "receive", by: to, name });
            Object.assign(state(name), { holder: to, pending: null });
            state(name).leg += 1;
          }
        }
      } else if (op === "split") {
        const name = batch.id + step[1];
        const holder = state(name).holder;
        temp(name);
        push({ kind: "split", by: holder, name, weights: step[2] });
        state(name).lots = step[2].length;
        step[2].forEach((_, i) => expected.set(name + "-L" + (i + 1), { holder, pending: null, disposition: 0, recallClass: 0, parent: name, lots: 0, leg: 0 }));
      } else if (op === "final") {
        const name = batch.id + step[1];
        push({ kind: "final", by: state(name).holder, name, disposition: FINAL[step[2]] });
        state(name).disposition = FINAL[step[2]];
      } else if (op === "recall") {
        const name = batch.id + step[1];
        push({ kind: "recall", by: batch.processor, name, classification: step[2] });
        state(name).recallClass = step[2];
      } else {
        throw new Error(batch.id + ": unknown step " + op);
      }
    }
    // The leg each batch or lot is on now: sold, served, held or in transit.
    for (const [name, s] of expected) {
      if ((name === batch.id || name.startsWith(batch.id + "-L")) && !s.lots) temp(name);
    }
  }
  // A recall reaches every lot below it; the most serious class wins.
  for (const [name, s] of expected) {
    let p = s.parent;
    while (p) {
      const up = expected.get(p);
      if (up.recallClass && (!s.recallClass || up.recallClass < s.recallClass)) s.recallClass = up.recallClass;
      p = up.parent;
    }
    void name;
  }
  return { actions, expected };
}

// --- Simulated sensor readings ----------------------------------------------

// How long each kind of business holds a batch, in hours. The windows are
// simulated: the seed runs in minutes, so a leg's window ends just before its
// summary is recorded and reaches back this far. The chain only refuses a
// window that ends in the future.
const LEG_HOURS = { processor: 6, storage: 36, carrier: 8, distributor: 12, retailer: 20, restaurant: 5 };

// Deterministic noise, so a rerun signs the same readings for the same leg.
function noise(seedText) {
  let h = ethers.id(seedText);
  return () => {
    h = ethers.keccak256(h);
    return Number(BigInt(h) % 10000n) / 10000;
  };
}

// Readings for one leg, in 0.01 °C. Cold storage runs near freezing, the
// rest a little warmer; both sit inside the 28-40 °F range. "warm-truck"
// adds a 30-minute spell near 41-43 °F; "freezer-failure" climbs to about
// 52 °F over the last 40% of the window.
function legReadings({ name, leg, holder, profile, afterSplit, end, seq0 }) {
  const org = business(holder).organization;
  const hours = afterSplit ? 2 : LEG_HOURS[org] || 8;
  const step = hours > 24 ? 1800 : 900;
  const count = Math.floor((hours * 3600) / step);
  const start = end - hours * 3600;
  const rand = noise(name + "#" + leg);
  const base = org === "storage" ? -60 : 190;
  const readings = [];
  for (let i = 0; i < count; i++) {
    let c = base + Math.round((rand() - 0.5) * 90);
    if (profile === "warm-truck" && i >= Math.floor(count / 2) && i < Math.floor(count / 2) + 2) c = 520 + Math.round(rand() * 80);
    if (profile === "freezer-failure" && i >= Math.floor(count * 0.6)) {
      c = Math.round(base + ((i - count * 0.6) / (count * 0.4)) * 1180 + rand() * 40);
    }
    readings.push({ seq: seq0 + i, timestamp: start + 60 + i * step, tempCentiC: c });
  }
  return { start, readings };
}

// --- Mock documents ----------------------------------------------------------

function documentsFor(batch) {
  const processor = business(batch.processor);
  const docs = [];
  docs.push({
    kind: "lot",
    label: "Lot form",
    file: batch.id + "-lot-form.pdf",
    bytes: makePdf("Lot form (sample)", [
      { text: "Batch " + batch.id, bold: true, size: 13 },
      { text: "Product: " + batch.cut + ", " + batch.lbs + " lb" },
      { text: "Processor: " + processor.name + ", " + processor.city },
      { text: "Source: " + batch.ranch },
      { text: "Keep refrigerated at 32-39 F. Use by the date shown on the batch record.", gap: 8 },
    ]),
  });
  const inspection = batch.steps.find((s) => s[0] === "inspect");
  if (inspection) {
    docs.push({
      kind: "inspection",
      label: "Inspection certificate",
      file: batch.id + "-inspection.pdf",
      bytes: makePdf("Inspection certificate (sample)", [
        { text: "Batch " + batch.id + " (" + batch.cut + ", " + batch.lbs + " lb)", bold: true, size: 13 },
        { text: "Result: " + (inspection[1] ? "PASSED" : "FAILED"), bold: true },
        { text: "Establishment: " + processor.name + ", " + processor.city },
        { text: inspection[1] ? "Carcasses and cuts examined. No findings." : "Contamination found during examination. Product retained and not to be shipped.", gap: 8 },
      ]),
    });
  }
  const recall = batch.steps.find((s) => s[0] === "recall");
  if (recall) {
    const reason = recall[2] === 1 ? "possible E. coli O157:H7 contamination" : "a labeling error (allergen statement missing)";
    docs.push({
      kind: "recall",
      label: "Recall notice",
      file: batch.id + "-recall.pdf",
      bytes: makePdf("Recall notice (sample)", [
        { text: "Class " + "I".repeat(recall[2]) + " recall: batch " + batch.id, bold: true, size: 13 },
        { text: "Issued by " + processor.name + ", " + processor.city },
        { text: "Reason: " + reason + "." },
        { text: "Every lot made from this batch is included. Stop selling and serving it, and hold it for return or disposal.", gap: 8 },
      ]),
    });
  }
  return docs;
}

// --- IPFS --------------------------------------------------------------------

// The DIDLab portal's publish protocol (frontend/public/ipfs.js), with the
// file sent as is: these are public demo files, not private forms.
async function ipfsAdd(wallet, bytes, filename, mime) {
  const address = ethers.getAddress(wallet.address);
  const digest = sha256(bytes);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await wallet.signMessage(
    "Authorize DIDLab IPFS publish\nAddress:" + address + "\nTimestamp:" + timestamp + "\nSHA256:" + digest + "\nSize:" + bytes.length
  );
  const body = new FormData();
  body.append("file", new Blob([bytes], { type: mime }), filename);
  body.append("pin", "true");
  body.append("wrapWithDirectory", "false");
  body.append("address", address);
  body.append("timestamp", String(timestamp));
  body.append("signature", signature);
  body.append("sha256", digest);
  body.append("sizeBytes", String(bytes.length));
  const response = await fetch(IPFS_ADD_URL, { method: "POST", body });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok || !parsed || !parsed.cid) {
    throw new Error("IPFS publish failed (" + response.status + "): " + ((parsed && parsed.error) || text.slice(0, 120)));
  }
  return parsed.cid;
}

// --- Main --------------------------------------------------------------------

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const local = chainId !== DIDLAB;
  // A local run deploys its own contracts unless BSC_ADDRESS names some.
  const fresh = local && !process.env.BSC_ADDRESS;
  // The in-process network vanishes when the run ends, so its progress is
  // never kept. A `hardhat node` (localhost) and DIDLab keep theirs.
  const persist = hre.network.name !== "hardhat";
  const go = local || process.env.DEMO_GO === "1";
  const skipIpfs = local || process.env.DEMO_SKIP_IPFS === "1";

  // Contracts: a local run deploys its own; DIDLab must be v5.
  let supplyChain, registry, temperatureLog = null;
  if (fresh) {
    registry = await (await ethers.getContractFactory("CredentialRegistry")).deploy();
    await registry.waitForDeployment();
    for (const type of ["CRED_PROCESSOR", "CRED_INSPECTOR", "CRED_CUSTODIAN"]) {
      await (await registry.setIssuer(await registry[type](), deployer.address)).wait();
    }
    supplyChain = await (await ethers.getContractFactory("BeefSupplyChain")).deploy(await registry.getAddress());
    await supplyChain.waitForDeployment();
    await (await registry.setIssuer(ethers.id("SENSOR"), deployer.address)).wait();
    const verifier = await (await ethers.getContractFactory("SensorSignatureVerifier")).deploy(await registry.getAddress());
    await verifier.waitForDeployment();
    temperatureLog = await (await ethers.getContractFactory("TemperatureLog")).deploy(
      await verifier.getAddress(), await supplyChain.getAddress(), -220, 444
    );
    await temperatureLog.waitForDeployment();
  } else {
    const address = process.env.BSC_ADDRESS || DEFAULTS.contract;
    supplyChain = await ethers.getContractAt("BeefSupplyChain", address);
    try {
      await supplyChain.MAX_SHELF_LIFE();
    } catch {
      throw new Error(address + " is not BeefSupplyChain v5 (no MAX_SHELF_LIFE). Deploy v5 and set BSC_ADDRESS.");
    }
    registry = await ethers.getContractAt("CredentialRegistry", await supplyChain.registry());
    if (process.env.TEMPERATURE_LOG_ADDRESS) {
      temperatureLog = await ethers.getContractAt("TemperatureLog", process.env.TEMPERATURE_LOG_ADDRESS);
      if ((await temperatureLog.supplyChain()).toLowerCase() !== (await supplyChain.getAddress()).toLowerCase()) {
        throw new Error("TEMPERATURE_LOG_ADDRESS points at a different BeefSupplyChain. Deploy TemperatureLog for this one.");
      }
    }
  }
  const contractAddress = (await supplyChain.getAddress()).toLowerCase();
  const outDir = local ? path.join(ROOT, "cache", "demo-dryrun") : null;
  const storiesPath = local ? path.join(outDir, "stories.json") : path.join(ROOT, "frontend", "public", "demo", "stories.json");
  const directoryPath = local ? path.join(outDir, "directory.json") : path.join(ROOT, "scripts", "demo", "directory.json");
  const progressPath = path.join(ROOT, "cache", `demo-progress-${chainId}-${contractAddress}.json`);

  // Business wallets.
  const seed = process.env.DEMO_SEED || (local ? "chuck-and-verify-local-dry-run" : process.env.DEPLOYER_KEY);
  if (!seed) throw new Error("Set DEMO_SEED or DEPLOYER_KEY to derive the demo wallets.");
  const wallets = Object.fromEntries(
    BUSINESSES.map((b) => [b.slug, new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(seed + ":chuck-and-verify-demo:" + b.slug)), ethers.provider)])
  );

  // One demo sensor per business that holds beef. Sensors only sign; they
  // never send a transaction, so they need no TRUST.
  const holders = BUSINESSES.filter((b) => b.roles.includes("CUSTODIAN"));
  const sensors = Object.fromEntries(
    holders.map((b) => [b.slug, new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes(seed + ":chuck-and-verify-demo-sensor:" + b.slug)))])
  );
  const CRED_SENSOR = ethers.id("SENSOR");
  let temperatureOff = null;
  if (!temperatureLog) temperatureOff = "no TEMPERATURE_LOG_ADDRESS";
  else if ((await registry.issuerOf(CRED_SENSOR)).toLowerCase() !== deployer.address.toLowerCase()) {
    temperatureOff = "the deployer is not the SENSOR issuer (the registry admin must call setIssuer, see docs/references/notes.md)";
  }
  const verifierAddress = temperatureLog ? await temperatureLog.verifier() : null;
  const range = temperatureLog
    ? { low: Number(await temperatureLog.rangeLowCentiC()), high: Number(await temperatureLog.rangeHighCentiC()) }
    : null;

  const { actions: planned, expected } = expandPlan();
  const actions = temperatureOff ? planned.filter((a) => a.kind !== "temp") : planned;
  const progress = persist && fs.existsSync(progressPath)
    ? JSON.parse(fs.readFileSync(progressPath, "utf8"))
    : { contract: contractAddress, done: {}, useBy: {}, cids: {} };
  progress.seq = progress.seq || {};
  const save = () => {
    if (!persist) return;
    fs.mkdirSync(path.dirname(progressPath), { recursive: true });
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  };
  const todo = actions.filter((a) => !progress.done[a.key]);

  // Credentials and gas each business still needs.
  const creds = {};
  for (const type of ["PROCESSOR", "INSPECTOR", "CUSTODIAN"]) creds[type] = await registry["CRED_" + type]();
  for (const [type, hash] of Object.entries(creds)) {
    const issuer = await registry.issuerOf(hash);
    if (issuer.toLowerCase() !== deployer.address.toLowerCase()) {
      throw new Error(`The deployer ${deployer.address} is not the ${type} issuer (${issuer}). Run npm run setup:credentials first.`);
    }
  }
  const grants = [];
  for (const b of BUSINESSES) {
    for (const role of b.roles) {
      if (!(await registry.isValid(wallets[b.slug].address, creds[role]))) grants.push([b, role, wallets[b.slug].address, creds[role]]);
    }
  }
  const sensorRegs = [];
  if (!temperatureOff) {
    for (const b of holders) {
      if (!(await registry.isValid(sensors[b.slug].address, CRED_SENSOR))) grants.push([b, "SENSOR", sensors[b.slug].address, CRED_SENSOR]);
      if ((await temperatureLog.sensorOf(wallets[b.slug].address)) !== sensors[b.slug].address) sensorRegs.push(b);
    }
  }
  const fee = await ethers.provider.getFeeData();
  const gasPrice = ((fee.gasPrice ?? fee.maxFeePerGas ?? 0n) * 125n) / 100n;
  const topUps = [];
  for (const b of BUSINESSES) {
    const count = BigInt(todo.filter((a) => a.by === b.slug).length + sensorRegs.filter((x) => x === b).length);
    const need = count * GAS_PER_TX * gasPrice;
    const have = await ethers.provider.getBalance(wallets[b.slug].address);
    if (need > have) topUps.push([b, need - have + (need / 5n)]);
  }
  const topUpTotal = topUps.reduce((sum, [, v]) => sum + v, 0n);
  const ownGas = BigInt(grants.length + topUps.length) * 60000n * gasPrice;

  console.log(`Network ${chainId}${local ? " (local dry run)" : ""} · BeefSupplyChain ${contractAddress}`);
  console.log(`Deployer ${deployer.address} · balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);
  console.log(`${BATCHES.length} batches · ${actions.length} transactions planned, ${todo.length} still to send`);
  console.log(temperatureOff ? `Temperature: off, ${temperatureOff}` : `Temperature: on · TemperatureLog ${(await temperatureLog.getAddress()).toLowerCase()} · range ${range.low} to ${range.high} (0.01 °C)`);
  console.log(`${grants.length} credential grants · ${topUps.length} wallets to fund, ${ethers.formatEther(topUpTotal)} sent plus about ${ethers.formatEther(ownGas)} in the deployer's own gas`);
  if (!go) {
    console.log("\nNothing sent. Run again with DEMO_GO=1 to seed.");
    return;
  }

  // Documents: hashes go on chain; files go to IPFS.
  const docsByBatch = Object.fromEntries(BATCHES.map((b) => [b.id, documentsFor(b)]));
  if (!skipIpfs) {
    console.log("\nPublishing photos and mock documents to IPFS…");
    const uploads = [
      ...Object.values(PHOTOS).map((p) => ({ key: "photo:" + p.file, bytes: fs.readFileSync(path.join(ROOT, "frontend", "public", "img", "slides", p.file)), file: p.file, mime: "image/webp" })),
      ...Object.values(docsByBatch).flat().map((d) => ({ key: "doc:" + d.file + ":" + sha256(d.bytes), bytes: d.bytes, file: d.file, mime: "application/pdf" })),
    ];
    for (const u of uploads) {
      if (progress.cids[u.key]) continue;
      try {
        progress.cids[u.key] = await ipfsAdd(deployer, u.bytes, u.file, u.mime);
        save();
        console.log("  " + u.file + " → " + progress.cids[u.key]);
      } catch (error) {
        console.log("  " + u.file + ": " + error.message + " (the page falls back to the local copy or leaves it out)");
      }
    }
  }

  const send = async (label, txPromise) => {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(label + " failed: " + tx.hash);
    return tx.hash;
  };

  if (grants.length) console.log("\nGranting credentials…");
  const latest = await ethers.provider.getBlock("latest");
  const expiresAt = BigInt(latest.timestamp) + BigInt(Number(process.env.DEMO_CREDENTIAL_DAYS || 365) * 86400);
  for (const [b, role, holder, type] of grants) {
    await send("grant", registry.connect(deployer).grant(holder, type, expiresAt));
    console.log(`  ${b.name}: ${role}${role === "SENSOR" ? " (its demo sensor)" : ""}`);
  }
  if (topUps.length) console.log("\nFunding business wallets…");
  for (const [b, amount] of topUps) {
    await send("fund", deployer.sendTransaction({ to: wallets[b.slug].address, value: amount }));
    console.log(`  ${b.name}: ${ethers.formatEther(amount)}`);
  }

  if (sensorRegs.length) console.log("\nRegistering demo sensors…");
  for (const b of sensorRegs) {
    await send("registerSensor", temperatureLog.connect(wallets[b.slug]).registerSensor(sensors[b.slug].address));
    console.log(`  ${b.name}`);
  }

  console.log("\nRecording batches…");
  let sent = 0;
  const stopAfter = Number(process.env.DEMO_STOP_AFTER) || Infinity;
  for (const a of actions) {
    if (progress.done[a.key]) continue;
    if (sent >= stopAfter) {
      console.log(`\nStopped after ${sent} transactions (DEMO_STOP_AFTER). Run again to resume.`);
      return;
    }
    sent++;
    const w = wallets[a.by];
    const c = supplyChain.connect(w);
    const docs = docsByBatch[a.batch];
    const hashOf = (kind) => "0x" + sha256(docs.find((d) => d.kind === kind).bytes);
    let hash;
    try {
      if (a.kind === "register") {
        const exists = await supplyChain.getBatch(id32(a.name)).then(() => true, () => false);
        if (exists) {
          hash = "already registered";
        } else {
          const batch = BATCHES.find((b) => b.id === a.batch);
          const now = (await ethers.provider.getBlock("latest")).timestamp;
          const useBy = now + Math.max(600, Math.ceil(batch.useByDays * 86400));
          progress.useBy[a.batch] = useBy;
          hash = await send(a.key, c["registerBatch(bytes32,uint256,uint64)"](id32(a.name), batch.lbs, useBy));
        }
      } else if (a.kind === "inspect") hash = await send(a.key, c.recordInspection(id32(a.name), hashOf("inspection"), a.passed));
      else if (a.kind === "ship") hash = await send(a.key, c.recordShipment(id32(a.name), wallets[a.to].address));
      else if (a.kind === "receive") hash = await send(a.key, c.confirmReceipt(id32(a.name)));
      else if (a.kind === "split") hash = await send(a.key, c.splitBatch(id32(a.name), a.weights));
      else if (a.kind === "final") hash = await send(a.key, c.recordDisposition(id32(a.name), a.disposition));
      else if (a.kind === "recall") hash = await send(a.key, c.recordRecall(id32(a.name), hashOf("recall"), a.classification));
      else if (a.kind === "temp") {
        const end = (await ethers.provider.getBlock("latest")).timestamp - 5;
        const seq0 = (progress.seq[a.by] || 1000) + 1;
        const { start, readings } = legReadings({ ...a, holder: a.by, end, seq0 });
        const summary = sensorLayout.summarize(
          { batchId: id32(a.name), leg: a.leg, custodian: wallets[a.by].address, startTime: start, endTime: end, rangeLowCentiC: range.low, rangeHighCentiC: range.high },
          readings
        );
        const sig = await sensorLayout.sign(sensors[a.by], summary, { chainId, verifier: verifierAddress });
        const tuple = sensorLayout.TYPES.TemperatureSummary.map((f) => summary[f.name]);
        hash = await send(a.key, temperatureLog.connect(w).recordSummary(tuple, sig));
        progress.seq[a.by] = seq0 + readings.length - 1;
      }
    } catch (error) {
      save();
      throw new Error(`Stopped at ${a.key} (${a.kind} ${a.name} by ${business(a.by).name}): ${error.shortMessage || error.message}\nRun the same command again to resume.`);
    }
    progress.done[a.key] = hash;
    save();
    console.log(`  ${a.name.padEnd(18)} ${a.kind.padEnd(8)} ${business(a.by).name}`);
  }

  // Check every batch and lot against the plan.
  console.log("\nChecking the chain against the plan…");
  const problems = [];
  for (const [name, want] of expected) {
    const b = await supplyChain.getBatch(id32(name));
    const [, disposition] = await supplyChain.getStatus(id32(name));
    const got = {
      holder: b.currentHolder.toLowerCase(),
      pending: b.pendingReceiver === ethers.ZeroAddress ? null : b.pendingReceiver.toLowerCase(),
      disposition: Number(disposition),
      recallClass: b.recalled ? Number(b.recallClassification) : 0,
    };
    const wantHolder = wallets[want.holder].address.toLowerCase();
    const wantPending = want.pending ? wallets[want.pending].address.toLowerCase() : null;
    if (got.holder !== wantHolder || got.pending !== wantPending || got.disposition !== want.disposition || got.recallClass !== want.recallClass) {
      problems.push(name + ": expected " + JSON.stringify({ ...want, holder: wantHolder, pending: wantPending }) + ", got " + JSON.stringify(got));
    }
  }
  if (!temperatureOff) {
    for (const a of actions.filter((x) => x.kind === "temp")) {
      const rec = await temperatureLog.getSummary(id32(a.name), a.leg);
      if (rec.recordedAt === 0n) problems.push(`${a.name} leg ${a.leg}: no temperature summary`);
      else if (a.profile !== "cold" && rec.secondsOutOfRange === 0n) problems.push(`${a.name} leg ${a.leg}: expected time out of range`);
    }
  }
  const lines = [...expected].map(([name, s]) => {
    const where = s.lots ? "split into " + s.lots : s.disposition ? FINAL_TEXT[s.disposition] + " at " + business(s.holder).name : s.pending ? "in transit to " + business(s.pending).name : "held by " + business(s.holder).name;
    return "  " + name.padEnd(18) + where + (s.recallClass ? " · recalled (Class " + "I".repeat(s.recallClass) + ")" : "");
  });
  console.log(lines.join("\n"));
  if (problems.length) {
    console.log("\nMismatches:\n  " + problems.join("\n  "));
    process.exitCode = 1;
  } else {
    const temps = actions.filter((x) => x.kind === "temp").length;
    console.log(`\nAll ${expected.size} batches and lots match the plan${temps ? `, with ${temps} temperature summaries` : ""}.`);
  }

  // Outputs.
  const stories = {
    contract: contractAddress,
    chainId: Number(chainId),
    generatedAt: new Date().toISOString(),
    note: "Demo data: fictional businesses and stories. Written by scripts/seed-demo.js.",
    batches: Object.fromEntries(
      BATCHES.map((b) => {
        const photo = PHOTOS[b.photo];
        return [b.id, {
          cut: b.cut,
          ranch: b.ranch,
          story: b.story,
          photo: { src: "/frontend/public/img/slides/" + photo.file, cid: progress.cids["photo:" + photo.file] || null, alt: photo.alt },
          documents: docsByBatch[b.id]
            .map((d) => ({ label: d.label, cid: progress.cids["doc:" + d.file + ":" + sha256(d.bytes)] || null, sha256: sha256(d.bytes) }))
            .filter((d) => d.cid),
        }];
      })
    ),
  };
  const directory = {
    note: "Demo businesses for the Portal users import (or npm run seed:directory). Fictional.",
    users: BUSINESSES.map((b) => ({
      address: wallets[b.slug].address.toLowerCase(),
      label: "Demo · " + ORG_LABEL[b.organization],
      organization: b.organization,
      roles: b.roles,
      profile: { name: b.name, city: b.city, lat: b.lat, lng: b.lng },
    })),
  };
  for (const [file, data] of [[storiesPath, stories], [directoryPath, directory]]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    console.log("Wrote " + path.relative(ROOT, file));
  }
  if (local) {
    console.log("\nLocal contracts: BeefSupplyChain " + contractAddress + " · CredentialRegistry " + (await registry.getAddress()) +
      (temperatureLog ? " · TemperatureLog " + (await temperatureLog.getAddress()) : ""));
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
