// Software sensor signer (ADR 0004, stage 1).
//
// Reads one custody leg's temperature log, computes the per-leg summary in
// the shared layout (scripts/lib/sensor-summary.js) and signs it with the
// sensor key. Prints JSON that SensorSignatureVerifier.verify accepts.
//
//   SENSOR_KEY=0x... node scripts/sign-summary.js --log leg.json --verifier 0x...
//
// leg.json (the "log" object of scripts/lib/sensor-summary.vector.json has
// the same shape):
//   {
//     "batch": "BB-2026-014",          // or "batchId": "0x…" (bytes32)
//     "leg": 1,                        // BeefSupplyChain.custodyLeg(batchId)
//     "custodian": "0x…",
//     "startTime": 1793750400, "endTime": 1793772000,
//     "rangeLowCentiC": -220, "rangeHighCentiC": 444,
//     "readings": [{ "seq": 1001, "timestamp": 1793750400, "tempCentiC": 210 }, …]
//   }
//
// Options: --log (required), --verifier (required), --chain-id (default
// 252501). Without SENSOR_KEY a throwaway key is generated and its address
// printed.
//
//   node scripts/sign-summary.js --vector
//
// rewrites scripts/lib/sensor-summary.vector.json from a fixed, public test key.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const layout = require("./lib/sensor-summary");

const VECTOR_PATH = path.join(__dirname, "lib", "sensor-summary.vector.json");

// Public test-only key. Never register it on a live chain.
const VECTOR_KEY = ethers.id("chuck-and-verify sensor-summary test vector v1");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function requireValue(args, name) {
  const v = args[name];
  if (v === undefined || v === true) throw new Error(`--${name} <value> is required`);
  return v;
}

function legFromLog(log) {
  return {
    batchId: log.batchId ?? ethers.encodeBytes32String(String(log.batch)),
    leg: log.leg,
    custodian: log.custodian,
    startTime: log.startTime,
    endTime: log.endTime,
    rangeLowCentiC: log.rangeLowCentiC,
    rangeHighCentiC: log.rangeHighCentiC,
  };
}

// JSON cannot hold BigInt; summary fields are small enough for Number.
function plain(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
  );
}

async function signed(wallet, log, domain) {
  const summary = layout.summarize(legFromLog(log), log.readings);
  return {
    sensor: wallet.address,
    domain: {
      name: layout.DOMAIN_NAME,
      version: layout.DOMAIN_VERSION,
      chainId: Number(domain.chainId),
      verifyingContract: ethers.getAddress(domain.verifier),
    },
    summary: plain(summary),
    missingReadings: Number(layout.missingReadings(summary)),
    typeHash: layout.TYPEHASH,
    domainSeparator: layout.domainSeparator(domain),
    structHash: layout.structHash(summary),
    digest: layout.digest(summary, domain),
    signature: await layout.sign(wallet, summary, domain),
  };
}

async function writeVector() {
  const wallet = new ethers.Wallet(VECTOR_KEY);
  const domain = {
    chainId: 252501,
    verifier: "0x000000000000000000000000000000000000c0de",
  };
  // Leg 1 (first receipt) of a six-hour cold-storage stay, one reading every
  // 30 minutes, with a one-hour excursion above 4.44 °C (40 °F). The sensor's
  // counter is at 1001 because it carries over from earlier legs, and one
  // reading (seq 1007) was dropped, so the log shows one missing reading.
  // The lower bound is an example, not FSIS policy.
  const start = 1793750400; // 2026-11-04T00:00:00Z
  const temps = [210, 180, 190, 230, 520, 610, 300, 220, 200, 190, 185, 180];
  const readings = temps.map((tempCentiC, i) => ({
    seq: 1001 + i + (i >= 6 ? 1 : 0),
    timestamp: start + i * 1800,
    tempCentiC,
  }));
  const log = {
    batch: "BB-2026-014",
    leg: 1,
    custodian: "0x000000000000000000000000000000000000beef",
    startTime: start,
    endTime: start + 6 * 3600,
    rangeLowCentiC: -220,
    rangeHighCentiC: 444,
    readings,
  };
  const excursion = 5; // the 6.10 °C reading
  const vector = {
    note: "Fixed example of layout v1 (scripts/lib/sensor-summary.js). A device given this log and privateKey must produce exactly these readingBytes, leaves, summary (logRoot included), typeHash, domainSeparator, structHash and digest, and a signature that recovers to sensor. The signature here is RFC 6979 deterministic; a device using random nonces produces a different, equally valid one. readingProof shows one reading belongs to the log without the rest. Test key only.",
    privateKey: VECTOR_KEY,
    log,
    readingBytes: readings.map(layout.encodeReading),
    leaves: layout.logLeaves(readings),
    readingProof: { index: excursion, ...layout.proveReading(readings, excursion) },
    ...(await signed(wallet, log, domain)),
  };
  fs.writeFileSync(VECTOR_PATH, JSON.stringify(vector, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), VECTOR_PATH)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.vector) return writeVector();

  const file = JSON.parse(fs.readFileSync(requireValue(args, "log"), "utf8"));
  const log = file.log ?? file;
  let wallet;
  if (process.env.SENSOR_KEY) {
    wallet = new ethers.Wallet(process.env.SENSOR_KEY);
  } else {
    wallet = ethers.Wallet.createRandom();
    console.error(`No SENSOR_KEY set; using a throwaway key for ${wallet.address}`);
  }
  const domain = {
    chainId: BigInt(args["chain-id"] ?? 252501),
    verifier: requireValue(args, "verifier"),
  };
  console.log(JSON.stringify(await signed(wallet, log, domain), null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
