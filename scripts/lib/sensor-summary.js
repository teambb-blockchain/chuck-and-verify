// Signed temperature summary, layout v1 (ADR 0002, 0004, 0005; §14 rows 5-7).
//
// This file is the one shared definition of what a sensor signs. The
// contract library contracts/SensorSummary.sol and any device firmware must
// hash identically; test/SensorSignature.test.js fails if the Solidity side
// drifts, and scripts/lib/sensor-summary.vector.json is a fixed example a
// device can check its output against.
//
// Layers (from the "Beef batches as on-chain tokens" design session):
//   1. The sensor logs readings, each with a counter, linked by hash.
//   2. The full log stays off chain with the custodian (encrypted on IPFS).
//   3. Once per custody leg, the sensor signs a summary; one summary goes on
//      chain per (batchId, leg), where leg = BeefSupplyChain.custodyLeg.
//   4. The receiver's dock reading checks it independently (row 7).
// Proof-of-concept assumption: each custodian is one zone with one sensor,
// so a batch's record for a leg is its holder's sensor record for that time.
// Daily checkpoints for long legs are a separate record (ADR 0006, row 7).
//
// ---------------------------------------------------------------- signing
//
// EIP-712 typed data.
//
//   domain:  name "Chuck and Verify Sensor", version "1",
//            chainId, verifyingContract (the contract that checks summaries)
//
//   TemperatureSummary(
//     bytes32 batchId            batch or lot ID, as ethers.encodeBytes32String
//     uint32  leg                BeefSupplyChain.custodyLeg(batchId) for this leg
//     address custodian          holder of the batch during this leg
//     uint64  startTime          unix seconds, first moment the log covers
//     uint64  endTime            unix seconds, last moment the log covers
//     int16   rangeLowCentiC     required range, inclusive, 0.01 °C
//     int16   rangeHighCentiC
//     int16   minCentiC          lowest reading
//     int16   maxCentiC          highest reading
//     uint32  secondsOutOfRange  see "out-of-range time" below
//     uint32  readingCount       readings in the log
//     uint32  firstSeq           counter of the first reading
//     uint32  lastSeq            counter of the last reading
//     bytes32 logRoot            Merkle root of the log, below
//   )
//
//   digest = keccak256(0x1901 || domainSeparator || structHash(summary))
//   signature = 65 bytes r || s || v, low-s, v = 27 or 28 (0/1 accepted)
//
// (batchId, leg) names exactly one custody leg, so a summary cannot be filed
// against another leg, and the checking contract keeps one summary per leg.
// The domain binds it to one chain and one contract.
//
// --------------------------------------------------------------------- log
//
// Each reading is 14 bytes, big-endian:
//
//   uint32 seq || uint64 timestamp (unix seconds) || int16 tempCentiC
//
// seq is the sensor's own counter: it never repeats and never goes back, and
// persists across reboots and legs. Readings are in seq order; timestamps
// strictly increase and lie within [startTime, endTime].
//
// Leaves are hash-linked: leaf_i = keccak256(reading_i || leaf_(i-1)), with
// leaf_(-1) = 32 zero bytes. A reading cannot be dropped, reordered or
// spliced in without changing every later leaf.
//
// logRoot is the Merkle root over the leaves: each pair is hashed sorted,
// keccak256(min(a, b) || max(a, b)); an unpaired node moves up unchanged;
// one leaf is its own root. A custodian proves a single reading by giving
// the reading, the previous leaf and a Merkle proof (proveReading), without
// publishing the rest of the log. A leaf hashes 46 bytes and an inner node
// 64, so a leaf can never be passed off as an inner node.
//
// ---------------------------------------------------------- missing data
//
// readingCount and the seq range are both signed. Missing readings =
// (lastSeq - firstSeq + 1) - readingCount. A gap is recorded, not refused:
// real devices drop readings, and the record shows when they did.
//
// ------------------------------------------------------ out-of-range time
//
// Reading i stands for the interval from its timestamp to the next reading's
// (the last reading runs to endTime; the first also covers startTime up to
// its own timestamp). secondsOutOfRange is the total length of the intervals
// whose reading is below rangeLowCentiC or above rangeHighCentiC.
//
// ------------------------------------------------------- device assumptions
//
// - Wall-clock time (NTP or GPS at the dock) before it opens a log. The chain
//   only rejects a window that ends in the future; BeefSupplyChain stores no
//   handoff times, so comparing the window with the actual receipt and
//   shipment is the portal index's job.
// - seq kept in flash, so a reboot continues the count instead of restarting.

const { ethers } = require("ethers");

const LAYOUT_VERSION = 1;
const DOMAIN_NAME = "Chuck and Verify Sensor";
const DOMAIN_VERSION = "1";
const READING_BYTES = 14;
const CHAIN_SEED = ethers.ZeroHash;

const TYPES = {
  TemperatureSummary: [
    { name: "batchId", type: "bytes32" },
    { name: "leg", type: "uint32" },
    { name: "custodian", type: "address" },
    { name: "startTime", type: "uint64" },
    { name: "endTime", type: "uint64" },
    { name: "rangeLowCentiC", type: "int16" },
    { name: "rangeHighCentiC", type: "int16" },
    { name: "minCentiC", type: "int16" },
    { name: "maxCentiC", type: "int16" },
    { name: "secondsOutOfRange", type: "uint32" },
    { name: "readingCount", type: "uint32" },
    { name: "firstSeq", type: "uint32" },
    { name: "lastSeq", type: "uint32" },
    { name: "logRoot", type: "bytes32" },
  ],
};

const TYPE_STRING = ethers.TypedDataEncoder.from(TYPES).encodeType(
  "TemperatureSummary"
);
const TYPEHASH = ethers.id(TYPE_STRING);

const INT16_MIN = -(2n ** 15n);
const INT16_MAX = 2n ** 15n - 1n;
const UINT32_MAX = 2n ** 32n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

function checkRange(name, value, min, max) {
  const v = BigInt(value);
  if (v < min || v > max) throw new RangeError(`${name} out of range: ${value}`);
  return v;
}

// domain: { chainId, verifier }
function eip712Domain({ chainId, verifier }) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: ethers.getAddress(verifier),
  };
}

// ------------------------------------------------------------------ log

// reading: { seq, timestamp, tempCentiC }
function encodeReading(r) {
  return ethers.solidityPacked(
    ["uint32", "uint64", "int16"],
    [
      checkRange("seq", r.seq, 0n, UINT32_MAX),
      checkRange("timestamp", r.timestamp, 0n, UINT64_MAX),
      checkRange("tempCentiC", r.tempCentiC, INT16_MIN, INT16_MAX),
    ]
  );
}

function leafFor(reading, prevLeaf) {
  return ethers.keccak256(ethers.concat([encodeReading(reading), prevLeaf]));
}

// The hash-linked leaves of a log, in order.
function logLeaves(readings) {
  const leaves = [];
  let prev = CHAIN_SEED;
  for (const r of readings) {
    prev = leafFor(r, prev);
    leaves.push(prev);
  }
  return leaves;
}

function hashPair(a, b) {
  return BigInt(a) <= BigInt(b)
    ? ethers.keccak256(ethers.concat([a, b]))
    : ethers.keccak256(ethers.concat([b, a]));
}

function nextLevel(level) {
  const up = [];
  for (let i = 0; i < level.length; i += 2) {
    up.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
  }
  return up;
}

function merkleRoot(leaves) {
  if (leaves.length === 0) throw new RangeError("a log needs at least one reading");
  let level = leaves;
  while (level.length > 1) level = nextLevel(level);
  return level[0];
}

function merkleProof(leaves, index) {
  if (index < 0 || index >= leaves.length) throw new RangeError(`no leaf ${index}`);
  const proof = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]);
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return proof;
}

function verifyProof(leaf, proof, root) {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h === root;
}

function logRoot(readings) {
  return merkleRoot(logLeaves(readings));
}

// Everything needed to show one reading belongs to a signed log.
function proveReading(readings, index) {
  const leaves = logLeaves(readings);
  return {
    reading: readings[index],
    prevLeaf: index === 0 ? CHAIN_SEED : leaves[index - 1],
    proof: merkleProof(leaves, index),
  };
}

// ------------------------------------------------------------- summary

// leg: { batchId, leg, custodian, startTime, endTime,
//        rangeLowCentiC, rangeHighCentiC }
// readings: [{ seq, timestamp, tempCentiC }, ...] in seq order.
// Returns the summary the sensor signs for this log.
function summarize(leg, readings) {
  const start = checkRange("startTime", leg.startTime, 0n, UINT64_MAX);
  const end = checkRange("endTime", leg.endTime, 0n, UINT64_MAX);
  const low = checkRange("rangeLowCentiC", leg.rangeLowCentiC, INT16_MIN, INT16_MAX);
  const high = checkRange("rangeHighCentiC", leg.rangeHighCentiC, INT16_MIN, INT16_MAX);
  if (end <= start) throw new RangeError("endTime must be after startTime");
  if (high < low) throw new RangeError("rangeHighCentiC is below rangeLowCentiC");
  if (readings.length === 0) throw new RangeError("a summary needs at least one reading");
  checkRange("readingCount", readings.length, 1n, UINT32_MAX);

  let min = INT16_MAX;
  let max = INT16_MIN;
  let outOfRange = 0n;
  let prevT = -1n;
  let prevSeq = -1n;
  readings.forEach((r, i) => {
    const seq = checkRange("seq", r.seq, 0n, UINT32_MAX);
    const t = BigInt(r.timestamp);
    const c = BigInt(r.tempCentiC);
    if (seq <= prevSeq) throw new RangeError(`reading ${i}: seq does not increase`);
    if (t < start || t > end) throw new RangeError(`reading ${i} is outside the window`);
    if (t <= prevT) throw new RangeError(`reading ${i} is not after reading ${i - 1}`);
    prevSeq = seq;
    prevT = t;
    if (c < min) min = c;
    if (c > max) max = c;
    const from = i === 0 ? start : t;
    const to = i === readings.length - 1 ? end : BigInt(readings[i + 1].timestamp);
    if (c < low || c > high) outOfRange += to - from;
  });

  return {
    batchId: leg.batchId,
    leg: checkRange("leg", leg.leg, 0n, UINT32_MAX),
    custodian: ethers.getAddress(leg.custodian),
    startTime: start,
    endTime: end,
    rangeLowCentiC: low,
    rangeHighCentiC: high,
    minCentiC: min,
    maxCentiC: max,
    secondsOutOfRange: checkRange("secondsOutOfRange", outOfRange, 0n, UINT32_MAX),
    readingCount: BigInt(readings.length),
    firstSeq: BigInt(readings[0].seq),
    lastSeq: BigInt(readings[readings.length - 1].seq),
    logRoot: logRoot(readings),
  };
}

function missingReadings(summary) {
  return BigInt(summary.lastSeq) - BigInt(summary.firstSeq) + 1n - BigInt(summary.readingCount);
}

// -------------------------------------------------------------- EIP-712

function structHash(summary) {
  return ethers.TypedDataEncoder.hashStruct("TemperatureSummary", TYPES, summary);
}

function domainSeparator(domain) {
  return ethers.TypedDataEncoder.hashDomain(eip712Domain(domain));
}

// The 32-byte value ecrecover is called with.
function digest(summary, domain) {
  return ethers.TypedDataEncoder.hash(eip712Domain(domain), TYPES, summary);
}

// wallet: an ethers Wallet or Signer holding the sensor key.
function sign(wallet, summary, domain) {
  return wallet.signTypedData(eip712Domain(domain), TYPES, summary);
}

function recover(summary, domain, signature) {
  return ethers.verifyTypedData(eip712Domain(domain), TYPES, summary, signature);
}

module.exports = {
  LAYOUT_VERSION,
  DOMAIN_NAME,
  DOMAIN_VERSION,
  READING_BYTES,
  CHAIN_SEED,
  TYPES,
  TYPE_STRING,
  TYPEHASH,
  eip712Domain,
  encodeReading,
  leafFor,
  logLeaves,
  merkleRoot,
  merkleProof,
  verifyProof,
  logRoot,
  proveReading,
  summarize,
  missingReadings,
  structHash,
  domainSeparator,
  digest,
  sign,
  recover,
};
