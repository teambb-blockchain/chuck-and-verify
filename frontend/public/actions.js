// Custody handoffs (recordShipment / confirmReceipt), splitting a batch into
// lots (splitBatch) and recalls (recordRecall). Same pattern as the inspection card in app.js: check the
// call first so a refusal costs nothing, then send it from the wallet.
// Messages stay plain; the transaction link carries the detail.

import {
  createWalletClient,
  custom,
  stringToHex,
  isAddress,
  BaseError,
  ContractFunctionRevertedError
} from "https://esm.sh/viem@2";
import { abi } from "./abi.js";
import { api } from "./session.js";
import { publishEncryptedForm } from "./ipfs.js";
import {
  EXPLORER_BASE,
  REQUIRED_CHAIN_ID,
  beefSupplyChainAddress,
  chain,
  publicClient,
  isUserRejection
} from "./chain.js";
import { refreshDashboard } from "./dashboard.js";

const MAX_LOTS = 20; // BeefSupplyChain.MAX_LOTS
const LOT_COUNT_HINT = `Split into 2 to ${MAX_LOTS} lots.`;

const REVERT_MESSAGES = {
  Unauthorized: "This wallet isn't authorized to do this on the blockchain.",
  BatchNotFound: "No batch found with that ID.",
  NotCurrentHolder: "This batch isn't in your custody.",
  NoPendingShipment: "Nothing has been shipped for this batch.",
  NotPendingReceiver: "This shipment is addressed to a different wallet.",
  ZeroAddress: "Enter the receiving wallet.",
  NotBatchProcessor: "Only the processor that registered this batch can recall it.",
  RecallNotEscalated: "This batch is already recalled at this class or a more serious one.",
  InvalidClassification: "Choose a recall class.",
  EmptyNoticeHash: "The notice couldn't be read. Choose the file again.",
  AlreadySplit: "This batch has been split into lots. Use the lots instead.",
  ShipmentPending: "This batch has a shipment waiting. It can be split once the receiver confirms it.",
  LotCannotBeSplit: "A lot can't be split again.",
  BadLotCount: LOT_COUNT_HINT,
  LotWeightMismatch: "The lot weights must add up to the batch weight.",
  LotNameTooLong: "Use a shorter batch ID so the lot numbers fit."
};

const $ = (id) => document.getElementById(id);

function txLink(hash) {
  return Object.assign(document.createElement("a"), {
    href: EXPLORER_BASE + "/tx/" + hash,
    target: "_blank",
    rel: "noopener noreferrer",
    textContent: "View transaction"
  });
}

function explain(error, fallback) {
  const reverted =
    error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  if (reverted) return REVERT_MESSAGES[reverted.data?.errorName] || fallback;
  return error.shortMessage || error.message;
}

async function walletOnDidLab() {
  if (!window.ethereum) throw new Error("No wallet detected.");
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const chainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
  if (chainId !== REQUIRED_CHAIN_ID) throw new Error("Switch your wallet to DIDLab.");
  return { account, walletClient: createWalletClient({ chain, transport: custom(window.ethereum) }) };
}

function batchIdFrom(inputId) {
  const name = $(inputId).value.trim();
  if (!name || new TextEncoder().encode(name).length > 31) {
    throw new Error("Enter a batch ID (up to 31 characters).");
  }
  return { name, id: stringToHex(name, { size: 32 }) };
}

// Simulate, send, wait. Returns true when the change is on chain.
async function send({ account, walletClient, functionName, args, status, done }) {
  status.textContent = "Checking…";
  const { request } = await publicClient.simulateContract({
    address: beefSupplyChainAddress,
    abi,
    functionName,
    args,
    account
  });
  status.textContent = "Approve in your wallet.";
  const hash = await walletClient.writeContract(request);
  status.textContent = "Recording…";
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") {
    status.replaceChildren("It couldn't be recorded. ", txLink(hash));
    return false;
  }
  status.replaceChildren(done + " ", txLink(hash));
  refreshDashboard();
  return true;
}

// --- Custody -------------------------------------------------------------

const custodyStatus = $("custodyStatus");

async function custody(button, run, status = custodyStatus, fallback = "This batch can't be moved right now.") {
  button.disabled = true;
  try {
    await run();
  } catch (error) {
    status.textContent = isUserRejection(error)
      ? "Cancelled. Nothing was recorded."
      : explain(error, fallback);
  } finally {
    button.disabled = false;
  }
}

$("recordShipment").onclick = () =>
  custody($("recordShipment"), async () => {
    const batch = batchIdFrom("custodyBatchId");
    const to = $("custodyTo").value.trim();
    if (!isAddress(to)) throw new Error("Enter the receiving wallet (0x followed by 40 characters).");
    const wallet = await walletOnDidLab();
    if (to.toLowerCase() === wallet.account.toLowerCase()) {
      throw new Error("Enter the wallet you're shipping to, not your own.");
    }
    await send({
      ...wallet,
      functionName: "recordShipment",
      args: [batch.id, to],
      status: custodyStatus,
      done: "Shipment recorded: " + batch.name + ". It stays in your custody until the receiver confirms."
    });
  });

$("confirmReceipt").onclick = () =>
  custody($("confirmReceipt"), async () => {
    const batch = batchIdFrom("custodyBatchId");
    const wallet = await walletOnDidLab();
    await send({
      ...wallet,
      functionName: "confirmReceipt",
      args: [batch.id],
      status: custodyStatus,
      done: "Received: " + batch.name + " is now in your custody."
    });
  });

// --- Split into lots ------------------------------------------------------

const splitStatus = $("splitStatus");
const splitEqual = $("splitEqual");
const splitCount = $("splitCount");
const splitWeights = $("splitWeights");

// Lot names mirror the contract's: "<batch>-L1" … "<batch>-Ln".
const lotName = (batchName, n) => batchName + "-L" + n;

// Whole pounds, with any remainder spread a pound at a time over the first
// lots: 1000 lbs into 3 lots is 334, 333, 333.
function equalWeights(total, n) {
  const base = total / BigInt(n);
  const extra = total % BigInt(n);
  return Array.from({ length: n }, (_, i) => base + (BigInt(i) < extra ? 1n : 0n));
}

const lotCount = () => Number(splitCount.value);
const validCount = (n) => Number.isInteger(n) && n >= 2 && n <= MAX_LOTS;
const typedWeights = () => splitWeights.value.split(",").map((w) => w.trim()).filter(Boolean);

// A batch's weight never changes, so each one is read once.
const batchWeights = new Map();
async function batchWeight(batch) {
  if (!batchWeights.has(batch.id)) {
    const [, weight] = await publicClient.readContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "getBatch",
      args: [batch.id]
    });
    batchWeights.set(batch.id, weight);
  }
  return batchWeights.get(batch.id);
}

// Equal weights: the lot count is yours and the weights box shows the
// result. Otherwise the weights are yours and the count follows them.
let previewRun = 0;
async function refreshSplitForm() {
  const equal = splitEqual.checked;
  splitWeights.disabled = equal;
  splitCount.disabled = !equal;
  $("splitWeightsHint").textContent = equal
    ? "Worked out from the batch weight. Clear Equal weights to set each lot yourself."
    : "Enter one weight per lot. They must add up to the batch weight.";
  if (!equal) {
    const n = typedWeights().length;
    if (n) splitCount.value = n;
    return;
  }
  const run = ++previewRun;
  let preview = "";
  try {
    const total = await batchWeight(batchIdFrom("splitBatchId"));
    const n = lotCount();
    if (validCount(n) && total >= BigInt(n)) preview = equalWeights(total, n).join(", ");
  } catch {
    // No batch ID yet, or no such batch: leave the box empty.
  }
  if (run === previewRun) splitWeights.value = preview;
}

let idTimer;
$("splitBatchId").addEventListener("input", () => {
  clearTimeout(idTimer);
  idTimer = setTimeout(refreshSplitForm, 300);
});
splitCount.addEventListener("input", refreshSplitForm);
splitEqual.addEventListener("change", refreshSplitForm);
splitWeights.addEventListener("input", refreshSplitForm);
// The dashboard's Split button fills in the batch ID without an input event.
$("splitSection").addEventListener("focusin", (e) => {
  if (e.target === splitCount) refreshSplitForm();
});

$("splitBatch").onclick = () =>
  custody(
    $("splitBatch"),
    async () => {
      const batch = batchIdFrom("splitBatchId");
      const equal = splitEqual.checked;
      const parts = typedWeights();
      const n = equal ? lotCount() : parts.length;
      if (!validCount(n)) throw new Error(LOT_COUNT_HINT);
      if (!equal && parts.some((w) => !/^[1-9]\d*$/.test(w))) {
        throw new Error("Enter a whole-number weight for each lot, separated by commas.");
      }
      if (new TextEncoder().encode(lotName(batch.name, n)).length > 31) {
        throw new Error(REVERT_MESSAGES.LotNameTooLong);
      }
      // Say what's wrong with the weights before the wallet is involved.
      const total = await batchWeight(batch);
      if (equal && total < BigInt(n)) {
        throw new Error(`${batch.name} weighs ${total} lbs, too little for ${n} lots.`);
      }
      const weights = equal ? equalWeights(total, n) : parts.map(BigInt);
      const sum = weights.reduce((a, b) => a + b, 0n);
      if (sum !== total) {
        throw new Error(`The lots add up to ${sum} lbs, but ${batch.name} weighs ${total} lbs.`);
      }
      const wallet = await walletOnDidLab();
      await send({
        ...wallet,
        functionName: "splitBatch",
        args: [batch.id, weights],
        status: splitStatus,
        done: `Split ${batch.name} into ${weights.length} lots: ${lotName(batch.name, 1)} to ${lotName(batch.name, weights.length)}.`
      });
    },
    splitStatus,
    "This batch can't be split right now."
  );

// --- Recall --------------------------------------------------------------

const recallStatus = $("recallStatus");
const recallButton = $("recordRecall");
let preparedNotice = null;

recallButton.onclick = async () => {
  recallButton.disabled = true;
  let published = false;
  try {
    const batch = batchIdFrom("recallBatchId");
    const classification = Number($("recallClass").value);
    const picked = $("recallNoticeFile").files?.[0];
    if (!picked) throw new Error("Choose the recall notice (PDF).");
    if (!(picked.type === "application/pdf" || picked.name.toLowerCase().endsWith(".pdf"))) {
      throw new Error("The recall notice needs to be a PDF.");
    }
    const wallet = await walletOnDidLab();

    // Check with a placeholder fingerprint first: who may recall, and
    // whether the class escalates, don't depend on the notice.
    recallStatus.textContent = "Checking…";
    await publicClient.simulateContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "recordRecall",
      args: [batch.id, "0x" + "11".repeat(32), classification],
      account: wallet.account
    });

    const key = wallet.account.toLowerCase() + ":" + picked.name + ":" + picked.lastModified + ":" + picked.size;
    let bundle = preparedNotice?.key === key ? preparedNotice.bundle : null;
    if (!bundle) {
      bundle = await publishEncryptedForm({
        file: picked,
        account: wallet.account,
        onStatus: (text) => {
          recallStatus.textContent = text.startsWith("Sign to encrypt")
            ? "Approve in your wallet to secure the notice (no fee)."
            : text.startsWith("Sign to publish")
              ? "Approve in your wallet to upload the notice (no fee)."
              : "Uploading the notice…";
        },
        signMessage: (message) => wallet.walletClient.signMessage({ account: wallet.account, message })
      });
      preparedNotice = { key, bundle };
    }
    published = true;

    const ok = await send({
      ...wallet,
      functionName: "recordRecall",
      args: [batch.id, "0x" + bundle.ciphertextSha256, classification],
      status: recallStatus,
      done: "Recall recorded: " + batch.name + ", Class " + ["I", "II", "III"][classification - 1] + "."
    });
    if (ok) {
      preparedNotice = null;
      api("/api/documents", {
        method: "POST",
        body: JSON.stringify({ kind: "recall", batchId: batch.name, bundle })
      })
        .then(refreshDashboard)
        .catch(() => {});
    }
  } catch (error) {
    if (isUserRejection(error)) {
      recallStatus.textContent = published
        ? "Cancelled. Your notice is uploaded; click Recall batch to finish."
        : "Cancelled. Nothing was recorded.";
    } else {
      recallStatus.textContent = explain(error, "This batch can't be recalled.");
    }
  } finally {
    recallButton.disabled = false;
  }
};
