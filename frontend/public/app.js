import {
  createPublicClient, createWalletClient, custom, http, defineChain,
  keccak256, stringToHex, zeroHash,
  BaseError, ContractFunctionRevertedError, UserRejectedRequestError
} from "https://esm.sh/viem@2";

import { abi } from "./abi.js";

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

// Activity 08 lab: on-chain revert screenshot bypasses simulation (browser console).
// Modules do not put locals on `window`; expose what the console snippet needs.
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
    setStatus,
  }),
});

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
