"use strict";

// A read-only copy of BeefSupplyChain's events, kept in portal.db so the
// role dashboards can count batches without asking the browser to scan the
// chain. The chain stays the source of truth: this table is rebuilt from
// logs, never written from anything a user sends.
//
// DIDLab's RPC refuses eth_getLogs ranges wider than ~5,000 blocks, so the
// index catches up in chunks from the deployment block and remembers how far
// it got (app_state 'chain_indexed_to').

const http = require("http");
const https = require("https");
const { keccak256Js } = require("./ethsig");

const DEFAULTS = {
  rpcUrl: "https://eth.didlab.org",
  // BeefSupplyChain v2, deployed in block 7269167 (tx 0xe97d465f…).
  contract: "0x903359014d55a25ed1d4a8dca6740dd30a90448a",
  fromBlock: 7269167,
  chunk: 5000,
};

const topic = (signature) => "0x" + Buffer.from(keccak256Js(Buffer.from(signature))).toString("hex");

const EVENTS = {
  [topic("BatchRegistered(bytes32,address,uint256)")]: "BatchRegistered",
  [topic("InspectionRecorded(bytes32,address,bytes32,bool)")]: "InspectionRecorded",
  [topic("ShipmentRecorded(bytes32,address,address)")]: "ShipmentRecorded",
  [topic("ReceiptConfirmed(bytes32,address)")]: "ReceiptConfirmed",
  [topic("RecallRecorded(bytes32,address,bytes32,uint8)")]: "RecallRecorded",
  [topic("LotCreated(bytes32,bytes32,address,uint256)")]: "LotCreated",
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chain_events (
  block     INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  tx        TEXT NOT NULL,
  name      TEXT NOT NULL,
  batch_id  TEXT NOT NULL,
  actor     TEXT NOT NULL,
  other     TEXT,
  hash      TEXT,
  num       INTEGER,
  ts        INTEGER,
  PRIMARY KEY (block, log_index)
);
CREATE INDEX IF NOT EXISTS chain_events_batch ON chain_events(batch_id);
`;

const word = (data, i) => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const topicAddress = (t) => "0x" + t.slice(26).toLowerCase();

// Batch ids are short UTF-8 strings right-padded to bytes32 (stringToHex
// with size 32 in app.js). Fall back to the hex for anything else.
function batchName(bytes32) {
  const bytes = Buffer.from(bytes32.slice(2), "hex");
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  const text = bytes.subarray(0, end).toString("utf8");
  return end > 0 && !text.includes("�") && !/[\x00-\x1f]/.test(text) ? text : bytes32;
}

function decodeLog(log) {
  const name = EVENTS[log.topics[0]];
  if (!name) return null;
  const data = log.data || "0x";
  const row = {
    block: parseInt(log.blockNumber, 16),
    logIndex: parseInt(log.logIndex, 16),
    tx: log.transactionHash,
    name,
    batchId: batchName(log.topics[1]),
    actor: topicAddress(log.topics[2]),
    other: null,
    hash: null,
    num: null,
  };
  if (name === "BatchRegistered") {
    row.num = Number(BigInt("0x" + word(data, 0)));
  } else if (name === "InspectionRecorded") {
    row.hash = word(data, 0);
    row.num = Number(BigInt("0x" + word(data, 1)));
  } else if (name === "ShipmentRecorded") {
    row.other = topicAddress(log.topics[3]);
  } else if (name === "RecallRecorded") {
    row.hash = word(data, 0);
    row.num = Number(BigInt("0x" + word(data, 1)));
  } else if (name === "LotCreated") {
    // LotCreated(parentId, lotId, holder, weightLbs): the row is about the
    // new lot, and `other` names the batch it was split from.
    row.batchId = batchName(log.topics[2]);
    row.other = batchName(log.topics[1]);
    row.actor = topicAddress(log.topics[3]);
    row.num = Number(BigInt("0x" + word(data, 0)));
  }
  return row;
}

function rpcCall(url, method, params) {
  const target = new URL(url);
  const client = target.protocol === "http:" ? http : https;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (parsed.error) reject(new Error(parsed.error.message || "RPC error"));
            else resolve(parsed.result);
          } catch {
            reject(new Error("RPC returned a non-JSON reply."));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("RPC timed out.")));
    req.on("error", reject);
    req.end(body);
  });
}

async function createChainIndex(db, options = {}) {
  const config = {
    rpcUrl: process.env.CHAIN_RPC || DEFAULTS.rpcUrl,
    contract: (process.env.BSC_ADDRESS || DEFAULTS.contract).toLowerCase(),
    fromBlock: Number(process.env.BSC_FROM_BLOCK) || DEFAULTS.fromBlock,
    chunk: Number(process.env.LOG_CHUNK) || DEFAULTS.chunk,
    minIntervalMs: 5000,
    ...options,
  };
  const sqlite = db.sqlite;
  await sqlite.exec(SCHEMA);

  // `conn` is the connection, or the transaction handle inside transaction().
  const getState = async (key, conn = sqlite) =>
    (await conn.get("SELECT value FROM app_state WHERE key = ?", key))?.value ?? null;
  const setState = (key, value, conn = sqlite) =>
    conn.run(
      "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      String(value)
    );

  // A redeploy (new address) starts the index over.
  if ((await getState("chain_contract")) !== config.contract) {
    await sqlite.transaction(async (tx) => {
      await tx.exec("DELETE FROM chain_events");
      await tx.run("DELETE FROM app_state WHERE key = 'chain_indexed_to'");
      await setState("chain_contract", config.contract, tx);
    });
  }

  const insert =
    "INSERT OR IGNORE INTO chain_events (block, log_index, tx, name, batch_id, actor, other, hash, num, ts) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

  let inFlight = null;
  let lastSyncAt = 0;
  let lastError = null;

  async function blockTime(block, cache) {
    if (!cache.has(block)) {
      const b = await rpcCall(config.rpcUrl, "eth_getBlockByNumber", ["0x" + block.toString(16), false]);
      cache.set(block, b ? parseInt(b.timestamp, 16) * 1000 : null);
    }
    return cache.get(block);
  }

  async function catchUp() {
    const latest = parseInt(await rpcCall(config.rpcUrl, "eth_blockNumber", []), 16);
    let from = Number((await getState("chain_indexed_to")) ?? config.fromBlock - 1) + 1;
    const times = new Map();
    while (from <= latest) {
      const to = Math.min(from + config.chunk - 1, latest);
      const logs = await rpcCall(config.rpcUrl, "eth_getLogs", [
        { address: config.contract, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) },
      ]);
      const rows = [];
      for (const log of logs || []) {
        if (log.removed) continue;
        const row = decodeLog(log);
        if (row) rows.push({ ...row, ts: await blockTime(row.block, times) });
      }
      await sqlite.transaction(async (tx) => {
        for (const r of rows) {
          await tx.run(insert, r.block, r.logIndex, r.tx, r.name, r.batchId, r.actor, r.other, r.hash, r.num, r.ts);
        }
        await setState("chain_indexed_to", to, tx);
      });
      from = to + 1;
    }
    await setState("chain_synced_at", Date.now());
  }

  // Many dashboards can load at once; they share one catch-up.
  function sync() {
    if (inFlight) return inFlight;
    if (Date.now() - lastSyncAt < config.minIntervalMs) return Promise.resolve();
    inFlight = catchUp()
      .then(() => {
        lastError = null;
      })
      .catch((error) => {
        lastError = error;
      })
      .finally(() => {
        lastSyncAt = Date.now();
        inFlight = null;
      });
    return inFlight;
  }

  // Wait for a sync, but never longer than `ms`: a slow RPC serves what is
  // already indexed and says so.
  async function fresh(ms = 8000) {
    let timer;
    await Promise.race([sync(), new Promise((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
    const syncedAt = Number(await getState("chain_synced_at")) || null;
    return {
      syncedAt,
      stale: Boolean(lastError) || Boolean(inFlight) || !syncedAt,
    };
  }

  function events() {
    return sqlite.all("SELECT * FROM chain_events ORDER BY block, log_index");
  }

  return { sync, fresh, events, config };
}

// Fold the event log into one record per batch: the same facts getBatch
// returns, plus who did what and when.
function batchesFrom(events) {
  const batches = new Map();
  const newBatch = (e, { processor, holder, weightLbs, parentId = null }) => ({
    batchId: e.batch_id,
    processor,
    weightLbs,
    registeredAt: e.ts,
    registeredTx: e.tx,
    holder,
    pendingReceiver: null,
    shippedAt: null,
    receivedAt: null,
    inspected: false,
    passed: false,
    inspector: null,
    inspectedAt: null,
    reportHash: null,
    recalled: false,
    recallClass: null,
    recallHash: null,
    recalledAt: null,
    parentId,
    lotIds: [],
    handlers: new Set([holder]),
  });
  for (const e of events) {
    if (e.name === "BatchRegistered") {
      batches.set(e.batch_id, newBatch(e, { processor: e.actor, holder: e.actor, weightLbs: e.num }));
      continue;
    }
    if (e.name === "LotCreated") {
      const parent = batches.get(e.other);
      if (!parent) continue;
      parent.lotIds.push(e.batch_id);
      batches.set(e.batch_id, newBatch(e, {
        processor: parent.processor,
        holder: e.actor,
        weightLbs: e.num,
        parentId: e.other,
      }));
      continue;
    }
    const b = batches.get(e.batch_id);
    if (!b) continue;
    if (e.name === "InspectionRecorded") {
      Object.assign(b, {
        inspected: true,
        passed: Boolean(e.num),
        inspector: e.actor,
        inspectedAt: e.ts,
        reportHash: e.hash,
      });
    } else if (e.name === "ShipmentRecorded") {
      Object.assign(b, { pendingReceiver: e.other, shippedAt: e.ts });
    } else if (e.name === "ReceiptConfirmed") {
      Object.assign(b, { holder: e.actor, pendingReceiver: null, receivedAt: e.ts });
      b.handlers.add(e.actor);
    } else if (e.name === "RecallRecorded") {
      Object.assign(b, { recalled: true, recallClass: e.num, recallHash: e.hash, recalledAt: e.ts });
    }
  }
  // A lot reads through to its parent, as getBatch does on chain: the
  // parent's inspection, and the parent's recall when it is more serious.
  // Done after the fold so a parent event recorded after the split still
  // reaches the lots.
  for (const b of batches.values()) {
    const p = b.parentId && batches.get(b.parentId);
    if (!p) continue;
    Object.assign(b, {
      inspected: p.inspected,
      passed: p.passed,
      inspector: p.inspector,
      inspectedAt: p.inspectedAt,
      reportHash: p.reportHash,
    });
    if (p.recalled && (!b.recalled || p.recallClass < b.recallClass)) {
      Object.assign(b, { recalled: true, recallClass: p.recallClass, recallHash: p.recallHash, recalledAt: p.recalledAt });
    }
  }
  return [...batches.values()];
}

module.exports = { createChainIndex, batchesFrom, decodeLog, EVENTS, DEFAULTS };
