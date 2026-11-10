// Custody handoffs (recordShipment / confirmReceipt) and recalls
// (recordRecall). Same pattern as the inspection card in app.js: check the
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
  EmptyNoticeHash: "The notice couldn't be read. Choose the file again."
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

async function custody(button, run) {
  button.disabled = true;
  try {
    await run();
  } catch (error) {
    custodyStatus.textContent = isUserRejection(error)
      ? "Cancelled. Nothing was recorded."
      : explain(error, "This batch can't be moved right now.");
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
