import {
  createPublicClient, createWalletClient, custom, http, defineChain,
  keccak256, stringToHex, zeroHash,
  BaseError, ContractFunctionRevertedError, UserRejectedRequestError
} from "https://esm.sh/viem@2";

import { abi } from "./abi.js";
import { anchorAbi } from "./anchor-abi.js";

export const didlab = defineChain({
  id: 252501,
  name: "DIDLab",
  nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 },
  rpcUrls: { default: { http: ["https://eth.didlab.org"] } },
  blockExplorers: { default: { name: "DIDLab Explorer", url: "https://explorer.didlab.org" } }
});

const CONTRACT = "0x981aE7CcD177a5F137CF49Eed2CA7122B3F783D8";

const publicClient = createPublicClient({ chain: didlab, transport: http() });

const $ = (id) => document.getElementById(id);

function explorerTxUrl(hash) {
  return `${didlab.blockExplorers.default.url}/tx/${hash}`;
}

/** Set #status to text, with `hash` rendered as an explorer link when provided. */
function setStatus(before, hash, after = "") {
  const el = $("status");
  el.replaceChildren();
  el.append(before);
  if (hash) {
    const a = document.createElement("a");
    a.href = explorerTxUrl(hash);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = hash;
    el.append(a);
  }
  if (after) el.append(after);
}

// Don't block the rest of module init on RPC — a hung getBlockNumber()
// left #state stuck on the HTML "loading…" placeholder forever.
publicClient.getBlockNumber()
  .then((block) => {
    $("network").textContent = `chain 252501 · block ${block}`;
  })
  .catch((err) => {
    $("network").textContent =
      `network: unreachable — ${err.shortMessage ?? err.message}`;
  });

let walletClient = null;
let account = null;

async function connect() {
  if (!window.ethereum) {
    $("account").textContent = "wallet: no wallet extension found";
    return;
  }

  walletClient = createWalletClient({ chain: didlab, transport: custom(window.ethereum) });

  [account] = await walletClient.requestAddresses();

  const chainId = await walletClient.getChainId();
  if (chainId !== didlab.id) {
    try {
      await walletClient.switchChain({ id: didlab.id });
    } catch (err) {
      if (err.code === 4902) {
        await walletClient.addChain({ chain: didlab });
      } else {
        $("account").textContent = "wallet: wrong network — switch to DIDLab to continue";
        account = null;
        return;
      }
    }
  }

  $("account").textContent = `wallet: ${account}`;
  $("submit").disabled = false;
  await refreshRole();
}

$("connect").addEventListener("click", connect);

window.ethereum?.on?.("chainChanged", () => window.location.reload());
window.ethereum?.on?.("accountsChanged", () => window.location.reload());

function jsonState(value) {
  return JSON.stringify(value, (_, v) =>
    typeof v === "bigint" ? v.toString() : v, 2);
}

/** Operational-chain read: batch lineage anyone can verify (CHECKPOINT_REPORT §4–§5). */
async function loadState() {
  const raw = $("input").value.trim();
  if (!raw) {
    $("state").textContent =
      "enter a batch id to load inspection, custody, and recall state";
    return;
  }

  const batchId = keccak256(stringToHex(raw));

  try {
    const result = await publicClient.readContract({
      address: CONTRACT,
      abi,
      functionName: "getBatch",
      args: [batchId],
    });

    $("state").textContent = jsonState({
      batchId,
      batchLabel: raw,
      processor: result.processor,
      weightLbs: result.weightLbs,
      currentHolder: result.currentHolder,
      pendingReceiver: result.pendingReceiver,
      inspected: result.inspected,
      inspectionPassed: result.inspectionPassed,
      inspectionReportHash: result.inspectionReportHash,
      recalled: result.recalled,
      recallNoticeHash: result.recallNoticeHash,
      recallClassification: result.recallClassification,
    });
  } catch (err) {
    if (err instanceof BaseError) {
      const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (reverted?.data?.errorName === "BatchNotFound") {
        $("state").textContent = jsonState({
          batchId,
          batchLabel: raw,
          error: "BatchNotFound",
        });
        return;
      }
    }
    $("state").textContent = `error — ${err.shortMessage ?? err.message}`;
  }
}

$("load").addEventListener("click", loadState);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    loadState();
  }
});

await loadState();

/** First operational write: processor registers a batch (CHECKPOINT_REPORT §4 / plan #3). */
function buildArgs() {
  const raw = $("input").value.trim();
  const batchId = keccak256(stringToHex(raw));
  const weightLbs = 1000n; // demo lbs; UI weight field can replace this later
  return [batchId, weightLbs];
}

async function simulate() {
  return await publicClient.simulateContract({
    account,
    address: CONTRACT,
    abi,
    functionName: "registerBatch",
    args: buildArgs(),
  });
}

async function submit() {
  $("submit").disabled = true;
  try {
    setStatus("simulating…");
    const { request } = await simulate();

    setStatus("awaiting signature…");
    const hash = await walletClient.writeContract(request);

    setStatus("pending — ", hash);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      setStatus(
        "reverted on chain — ",
        hash,
        ` (block ${receipt.blockNumber}, gas ${receipt.gasUsed} spent)`,
      );
    } else {
      setStatus(
        "confirmed — ",
        hash,
        ` (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`,
      );
    }
  } catch (err) {
    if (err instanceof BaseError) {
      const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
      if (rejected) {
        setStatus("cancelled — you rejected the request. Nothing was sent.");
        return;
      }
      const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (reverted) {
        setStatus(
          `would revert: ${reverted.data?.errorName ?? reverted.shortMessage} — nothing was sent`,
        );
        return;
      }
    }
    setStatus(`error — ${err.shortMessage ?? err.message}`);
  } finally {
    $("submit").disabled = false;
  }
}

$("submit").addEventListener("click", submit);

// Activity 08/11 lab: browser console must reach module locals.
// Modules do not put locals on `window`; expose what the console snippet needs.
// Activity 11 (no-role wallet, panels hidden):
//   await dapp.publicClient.simulateContract({
//     account: dapp.account,
//     address: dapp.REGISTRY,
//     abi: dapp.anchorAbi,
//     functionName: "anchor",
//     args: [dapp.recordIdFor("console-probe"), `0x${"22".repeat(32)}`, "bafyPROBE"],
//   });
Object.defineProperty(globalThis, "dapp", {
  configurable: true,
  get: () => ({
    walletClient,
    account,
    didlab,
    CONTRACT,
    abi,
    zeroHash,
    publicClient,
    anchorAbi,
    recordIdFor,
    setStatus,
    anchorRecord,
    anchorStoredLot,
    verifyRecord,
    verifyStoredLot,
    getStoredLot,
    refreshRole,
    loadAnchorRecord,
    REGISTRY,
    PROCESSOR,
    INSPECTOR,
  }),
});

const REGISTRY = "0x5dcEde6EFeBE6592874b263456232fD2328f89B2";

// Activity 01 ciphertext. The business key is the lot code, not the filename.
const STORED_LOT = "BB-2026-014";
const STORED_DIGEST = "afe5eb481bbcd5e4329aa884ab05e5d2d319cc5567dee386867751503cdfe66e";
const STORED_CID = "QmYE3zK8Kov7vHQpSaETDqXyjUHnHHt9WBvTWKL5MVP1mG";

const PROCESSOR = await publicClient.readContract({
  address: REGISTRY,
  abi: anchorAbi,
  functionName: "PROCESSOR",
});

const INSPECTOR = await publicClient.readContract({
  address: REGISTRY,
  abi: anchorAbi,
  functionName: "INSPECTOR",
});

function recordIdFor(businessKey) {
  // businessKey must identify nothing about a person.
  return keccak256(stringToHex(businessKey));
}

// Activity 11 lab snippet uses bare names. Console `abi` is AnchorRegistry;
// BeefSupplyChain stays at dapp.abi.
Object.defineProperties(globalThis, {
  publicClient: { configurable: true, get: () => publicClient },
  account: { configurable: true, get: () => account },
  REGISTRY: { configurable: true, get: () => REGISTRY },
  recordIdFor: { configurable: true, get: () => recordIdFor },
  abi: { configurable: true, get: () => anchorAbi },
});

async function anchorRecord(businessKey, sha256Hex, cid) {
  const { request } = await publicClient.simulateContract({
    account,
    address: REGISTRY,
    abi: anchorAbi,
    functionName: "anchor",
    args: [recordIdFor(businessKey), `0x${sha256Hex}`, cid],
  });

  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt;
}

async function anchorStoredLot() {
  if (!account || !walletClient) {
    setStatus("connect wallet A (the processor) before anchoring");
    return;
  }

  const canAnchor = await publicClient.readContract({
    address: REGISTRY,
    abi: anchorAbi,
    functionName: "hasRole",
    args: [PROCESSOR, account],
  });
  if (!canAnchor) {
    setStatus("this wallet does not hold PROCESSOR — nothing was sent");
    return;
  }

  setStatus("simulating anchor…");
  try {
    const receipt = await anchorRecord(STORED_LOT, STORED_DIGEST, STORED_CID);
    const recordId = recordIdFor(STORED_LOT);
    console.log({
      transactionHash: receipt.transactionHash,
      block: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      recordId,
      digest: `0x${STORED_DIGEST}`,
      cid: STORED_CID,
    });
    setStatus(
      `${receipt.status} — `,
      receipt.transactionHash,
      ` (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`,
    );
    return receipt;
  } catch (err) {
    if (err instanceof BaseError) {
      const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
      if (rejected) {
        setStatus("cancelled — you rejected the request. Nothing was sent.");
        return;
      }
      const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (reverted) {
        setStatus(
          `would revert: ${reverted.data?.errorName ?? reverted.shortMessage} — nothing was sent`,
        );
        return;
      }
    }
    setStatus(`error — ${err.shortMessage ?? err.message}`);
  }
}

async function getStoredLot() {
  return publicClient.readContract({
    address: REGISTRY,
    abi: anchorAbi,
    functionName: "get",
    args: [recordIdFor(STORED_LOT)],
  });
}

async function verifyRecord(businessKey) {
  const { request } = await publicClient.simulateContract({
    account,
    address: REGISTRY,
    abi: anchorAbi,
    functionName: "verify",
    args: [recordIdFor(businessKey)],
  });

  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt;
}

async function verifyStoredLot() {
  if (!account || !walletClient) {
    setStatus("connect wallet B (the inspector) before verifying");
    return;
  }

  setStatus("simulating verify…");
  try {
    const receipt = await verifyRecord(STORED_LOT);
    const recordId = recordIdFor(STORED_LOT);
    const rec = await getStoredLot();
    console.log({
      transactionHash: receipt.transactionHash,
      block: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
      recordId,
      verifier: rec.verifier,
      verifiedAt: rec.verifiedAt.toString(),
    });
    setStatus(
      `${receipt.status} — `,
      receipt.transactionHash,
      ` (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`,
    );
    return receipt;
  } catch (err) {
    if (err instanceof BaseError) {
      const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
      if (rejected) {
        setStatus("cancelled — you rejected the request. Nothing was sent.");
        return;
      }
      const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (reverted) {
        setStatus(
          `would revert: ${reverted.data?.errorName ?? reverted.shortMessage} — nothing was sent`,
        );
        return;
      }
    }
    setStatus(`error — ${err.shortMessage ?? err.message}`);
  }
}

publicClient.watchContractEvent({
  address: CONTRACT,
  abi,
  eventName: "BatchRegistered",
  onLogs: async (logs) => {
    for (const log of logs) {
      const li = document.createElement("li");
      li.textContent =
        `block ${log.blockNumber} · ${JSON.stringify(log.args, (_, v) =>
          typeof v === "bigint" ? v.toString() : v)}`;
      $("events").prepend(li);
    }
    await loadState();
  },
});

async function refreshRole() {
  if (!account) return;

  const [canSubmit, canVerify] = await Promise.all([
    publicClient.readContract({
      address: REGISTRY,
      abi: anchorAbi,
      functionName: "hasRole",
      args: [PROCESSOR, account],
    }),
    publicClient.readContract({
      address: REGISTRY,
      abi: anchorAbi,
      functionName: "hasRole",
      args: [INSPECTOR, account],
    }),
  ]);

  $("anchor-panel").hidden = !canSubmit;
  $("verify-panel").hidden = !canVerify;

  $("role").textContent =
    canSubmit && canVerify ? "submitter + verifier"
    : canSubmit ? "submitter"
    : canVerify ? "verifier"
    : "no role on this registry";
}

async function loadAnchorRecord() {
  const el = $("anchor-record");
  el.replaceChildren();

  try {
    const rec = await getStoredLot();
    if (rec.submittedAt === 0n) {
      el.textContent = "not anchored yet";
      return;
    }

    const line = (label, value) => {
      const p = document.createElement("p");
      p.append(`${label}: `);
      p.append(value);
      el.append(p);
    };

    line("digest", rec.digest);
    const cidLink = document.createElement("a");
    cidLink.href = `https://gateway.didlab.org/ipfs/${rec.cid}`;
    cidLink.target = "_blank";
    cidLink.rel = "noopener noreferrer";
    cidLink.textContent = rec.cid;
    line("cid", cidLink);
    line("submitter", rec.submitter);

    if (rec.verifiedAt === 0n) {
      line("verified", "no");
    } else {
      line("verified", `yes, by ${rec.verifier} at ${rec.verifiedAt.toString()}`);
    }
  } catch (err) {
    el.textContent = `error — ${err.shortMessage ?? err.message}`;
  }
}

$("anchor").addEventListener("click", async () => {
  await anchorStoredLot();
  await loadAnchorRecord();
});

$("verify-lot").addEventListener("click", async () => {
  await verifyStoredLot();
  await loadAnchorRecord();
});

await loadAnchorRecord();
