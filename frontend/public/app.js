import {
  createWalletClient,
  custom,
  stringToHex,
  hexToString,
  BaseError,
  ContractFunctionRevertedError
} from "https://esm.sh/viem@2";
import { abi } from "./abi.js";
import {
  api,
  fetchSession,
  signIn,
  signOut,
  applyPermissions,
  SIGNED_OUT
} from "./session.js";
import { loadAdmin } from "./admin.js";
import { renderForSession, refreshDashboard } from "./dashboard.js";
import "./actions.js";
import { showBatch } from "./consumer.js";
import {
  gatewayUrlForCid,
  publishEncryptedForm
} from "./ipfs.js";
import {
  EXPLORER_BASE,
  REQUIRED_CHAIN_ID,
  beefSupplyChainAddress,
  chain,
  publicClient,
  isUserRejection
} from "./chain.js";

// BeefSupplyChain writes happen here; the read-only consumer verify flow
// (lookup, result page, network pill) lives in consumer.js and needs no
// wallet. CredentialRegistry writes (grant/revoke) happen in admin.js.

const switchNetworkBtn = document.getElementById("switchNetwork");
const connectWalletBtn = document.getElementById("connectWallet");
const connectWalletLabel = document.getElementById("connectWalletLabel");
const walletNotice = document.getElementById("walletNotice");
const signOutBtn = document.getElementById("signOut");
const sessionRoles = document.getElementById("sessionRoles");

// Server-side portal session. A wallet is "signed in" only when the
// connected account matches the address that signed the login message.
let session = SIGNED_OUT;
let adminLoaded = false;


function shortAddress(address) {
  return address.slice(0, 6) + "…" + address.slice(-4);
}

const LOGGED_OUT_LABEL = "Sign in";

function syncWalletChrome(accounts) {
  const account = accounts && accounts[0];
  const signedIn =
    Boolean(account && session.address) &&
    session.address === account.toLowerCase();

  signOutBtn.hidden = !signedIn;
  sessionRoles.hidden = !signedIn;
  sessionRoles.replaceChildren(
    ...(signedIn ? session.roles : []).map((role) =>
      Object.assign(document.createElement("span"), {
        className: "role-chip",
        textContent: role
      })
    )
  );
  applyPermissions(signedIn ? session.permissions : []);
  renderForSession(signedIn ? session : null);

  if (signedIn && session.permissions.includes("users.manage") && !adminLoaded) {
    adminLoaded = true;
    loadAdmin();
  }

  if (!account) {
    connectWalletLabel.textContent = LOGGED_OUT_LABEL;
    connectWalletBtn.removeAttribute("aria-label");
    return;
  }

  const label = shortAddress(account);
  if (signedIn) {
    connectWalletLabel.textContent = label;
    connectWalletBtn.setAttribute("aria-label", "Signed in as " + label);
    walletNotice.hidden = true;
    walletNotice.textContent = "";
  } else {
    connectWalletLabel.textContent = "Sign in";
    connectWalletBtn.setAttribute(
      "aria-label",
      "Sign in as " + label + " with a wallet signature"
    );
  }
}

// The wallet's network matters only to handlers logging events. Verifying
// reads DIDLab directly (consumer.js), so a missing wallet is not an error.
let chainNoticeShown = false;

function walletChainNotice(text) {
  chainNoticeShown = Boolean(text);
  walletNotice.hidden = !text;
  walletNotice.textContent = text || "";
}

async function updateNetworkStatus() {
  switchNetworkBtn.hidden = true;

  if (!window.ethereum) {
    syncWalletChrome(null);
    return;
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_accounts"
    });
    const chainIdHex = await window.ethereum.request({
      method: "eth_chainId"
    });
    const currentChainId = Number(chainIdHex);

    if (accounts && accounts.length && currentChainId !== REQUIRED_CHAIN_ID) {
      walletChainNotice(
        "Your wallet is on chain " + currentChainId +
        ". Switch it to DIDLab (" + REQUIRED_CHAIN_ID + ") to log events."
      );
      switchNetworkBtn.hidden = false;
    } else if (chainNoticeShown) {
      walletChainNotice("");
    }
    syncWalletChrome(accounts);
  } catch (error) {
    walletChainNotice("Couldn't read your wallet's network: " + error.message);
    syncWalletChrome(null);
  }
}

async function switchToDidLab() {
  if (!window.ethereum) return;

  const chainIdHex = "0x" + REQUIRED_CHAIN_ID.toString(16);

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }]
    });
  } catch (error) {
    if (error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http
          }
        ]
      });
    } else {
      walletChainNotice("Couldn't switch networks: " + error.message);
    }
  }

  await updateNetworkStatus();
}

// Login = connect the wallet, then sign a one-time message so the server
// can map this address to its portal roles. Signing costs no gas.
connectWalletBtn.onclick = async () => {
  if (!window.ethereum) {
    walletNotice.hidden = false;
    walletNotice.textContent =
      "Handlers log events with a browser wallet such as MetaMask. Verifying a batch needs no wallet.";
    return;
  }

  try {
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });
    const account = accounts[0].toLowerCase();
    if (session.address !== account) {
      walletNotice.hidden = false;
      walletNotice.textContent =
        "Check your wallet: sign the login message (no gas, no transaction).";
      session = await signIn(accounts[0]);
      walletNotice.hidden = true;
    }
    await updateNetworkStatus();
  } catch (error) {
    if (isUserRejection(error)) {
      walletNotice.hidden = false;
      walletNotice.textContent =
        "Sign-in cancelled. No transaction was sent and no gas was used.";
      return;
    }
    walletNotice.hidden = false;
    walletNotice.textContent = "Sign-in failed: " + error.message;
  }
};

signOutBtn.onclick = async () => {
  session = await signOut();
  adminLoaded = false;
  await updateNetworkStatus();
};

switchNetworkBtn.onclick = () => {
  switchToDidLab();
};

// Roles are re-read on every request, so a role an admin adds shows up the
// next time this tab asks. Ask when the tab comes back into view, and every
// 30 seconds while a wallet with no role waits on the onboarding card.
async function recheckRoles() {
  if (!session.address) return;
  const next = await fetchSession();
  if (next.address === session.address && next.roles.join() !== session.roles.join()) {
    session = next;
    await updateNetworkStatus();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") recheckRoles();
});
setInterval(() => {
  if (session.address && session.roles.length === 0 && document.visibilityState === "visible") {
    recheckRoles();
  }
}, 30000);

// Remember a confirmed form on the server so it opens from any browser.
function recordDocument(kind, batchId, bundle) {
  api("/api/documents", {
    method: "POST",
    body: JSON.stringify({ kind, batchId, bundle })
  })
    .catch(() => {})
    .finally(refreshDashboard);
}

session = await fetchSession();
updateNetworkStatus();

if (window.ethereum && window.ethereum.on) {
  window.ethereum.on("chainChanged", () => {
    updateNetworkStatus();
  });
  window.ethereum.on("accountsChanged", async (accounts) => {
    // Switching wallets ends the portal session for the old address.
    const next = accounts && accounts[0] && accounts[0].toLowerCase();
    if (session.address && session.address !== next) {
      session = await signOut();
      adminLoaded = false;
    }
    updateNetworkStatus();
  });
}

const eventList = document.getElementById("events");

function decodeBatchId(value) {
  try {
    return hexToString(value, { size: 32 });
  } catch {
    return value;
  }
}

publicClient.watchContractEvent({
  address: beefSupplyChainAddress,
  abi,
  eventName: "BatchRegistered",
  onLogs: (logs) => {
    for (const log of logs) {
      const batchName = decodeBatchId(log.args.batchId);
      const args = {
        batchId: batchName,
        processor: log.args.processor,
        weightLbs:
          typeof log.args.weightLbs === "bigint"
            ? log.args.weightLbs.toString()
            : log.args.weightLbs
      };
      const item = document.createElement("li");
      item.textContent =
        "block " + log.blockNumber + " · " + JSON.stringify(args);
      eventList.prepend(item);

      // Open the result only for a batch this wallet just registered; other
      // visitors keep the page they are on.
      if (session.address && args.processor.toLowerCase() === session.address) {
        showBatch(batchName);
      }
    }
  },
  onError: (error) => {
    console.error(error);
  }
});

const registerButton = document.getElementById("registerBatch");
const transactionStatus = document.getElementById("transactionStatus");
const transactionDetails = document.getElementById("transactionDetails");
const batchFormFile = document.getElementById("batchFormFile");
const formReceipt = document.getElementById("formReceipt");
const downloadRecovery = document.getElementById("downloadRecovery");

const FORM_STORE = "chuck-and-verify.formBundles";

function readFormStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FORM_STORE) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveFormBundle(batchName, bundle) {
  const store = readFormStore();
  store[batchName] = bundle;
  localStorage.setItem(FORM_STORE, JSON.stringify(store));
}

function showCidLink(anchor, bundle) {
  const href = gatewayUrlForCid(bundle && bundle.cid);
  if (!href) {
    anchor.removeAttribute("href");
    anchor.textContent = "";
    return false;
  }
  anchor.href = href;
  anchor.textContent = bundle.cid;
  return true;
}

// Inspection report bundles share the store with lot forms, under their own
// key so an inspection never replaces the processor's lot form for a batch.
const reportKey = (batchName) => "inspection:" + batchName;

const reportHashOf = (bundle) => "0x" + bundle.ciphertextSha256;

// The recovery file holds the CID and decryption details; without it the
// published ciphertext can't be found or opened again.
function bindRecovery(button, bundle) {
  button.hidden = !bundle.cid;
  button.onclick = () => {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ipfs-upload-" + bundle.cid + ".json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
}

function showFormReceipt(bundle) {
  const linked = showCidLink(document.getElementById("formCidLink"), bundle);
  document.getElementById("formDigest").textContent =
    bundle.ciphertextSha256 || "";
  formReceipt.hidden = !linked;
  bindRecovery(downloadRecovery, bundle);
  downloadRecovery.hidden = !linked;
}

async function selectedForm(input = batchFormFile, what = "lot form") {
  const picked = input.files && input.files[0];
  if (!picked) {
    throw new Error("Choose a PDF for the " + what + ".");
  }
  const pdf =
    picked.type === "application/pdf" ||
    picked.name.toLowerCase().endsWith(".pdf");
  if (!pdf) throw new Error("The " + what + " needs to be a PDF.");
  return {
    file: picked,
    source: "upload:" + picked.name + ":" + picked.lastModified
  };
}

let preparedForm = null;

registerButton.onclick = async () => {
  registerButton.disabled = true;
  transactionDetails.textContent = "";
  formReceipt.hidden = true;
  downloadRecovery.hidden = true;
  let formPublished = false;

  try {
    if (!window.ethereum) {
      throw new Error("Connect a browser wallet such as MetaMask first.");
    }

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    const walletChainId = Number(
      await window.ethereum.request({ method: "eth_chainId" })
    );

    if (walletChainId !== REQUIRED_CHAIN_ID) {
      throw new Error("Wrong network. Switch MetaMask to DIDLab.");
    }

    const batchName = document.getElementById("newBatchId").value.trim();
    const weightText = document.getElementById("newBatchWeight").value;

    if (!batchName || new TextEncoder().encode(batchName).length > 31) {
      throw new Error("Batch ID must contain 1–31 UTF-8 bytes.");
    }
    // The contract keeps "-L<number>" endings for lots made by a split.
    if (/-L[0-9]+$/.test(batchName)) {
      throw new Error("IDs ending in -L and a number are kept for lots. Choose another batch ID.");
    }

    const weight = BigInt(weightText);

    if (weight <= 0n) {
      throw new Error("Weight must be greater than zero.");
    }

    const batchId = stringToHex(batchName, { size: 32 });

    const walletClient = createWalletClient({
      chain,
      transport: custom(window.ethereum)
    });

    const { file, source } = await selectedForm();
    const formKey = accounts[0].toLowerCase() + ":" + source + ":" + file.size;

    // Simulate first. A call that would revert (no PROCESSOR credential,
    // duplicate batch id) is reported here, before the form is published
    // and before any gas is spent.
    transactionStatus.textContent =
      "Simulating against DIDLab. No transaction sent yet.";

    const { request } = await publicClient.simulateContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "registerBatch",
      args: [batchId, weight],
      account: accounts[0]
    });

    let bundle = preparedForm && preparedForm.key === formKey
      ? preparedForm.bundle
      : null;

    if (!bundle) {
      bundle = await publishEncryptedForm({
        file,
        account: accounts[0],
        onStatus: (text) => {
          transactionStatus.textContent = text;
        },
        signMessage: (message) =>
          walletClient.signMessage({
            account: accounts[0],
            message
          })
      });
      preparedForm = { key: formKey, bundle };
    }

    showFormReceipt(bundle);
    formPublished = true;

    transactionStatus.textContent =
      "Waiting for MetaMask approval of batch registration. The form is already published.";

    const hash = await walletClient.writeContract(request);

    transactionStatus.textContent =
      "PENDING: Transaction sent. Waiting for blockchain confirmation.";

    transactionDetails.replaceChildren();
    transactionDetails.append("Transaction: ");
    const txLink = document.createElement("a");
    txLink.target = "_blank";
    txLink.rel = "noopener noreferrer";
    txLink.href = EXPLORER_BASE + "/tx/" + hash;
    txLink.textContent = hash;
    transactionDetails.append(txLink);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1
    });

    if (receipt.status !== "success") {
      transactionStatus.textContent =
        "REVERTED: Transaction reached the blockchain but failed. Gas was consumed.";
      transactionDetails.textContent +=
        " | Block: " + receipt.blockNumber +
        " | Gas used: " + receipt.gasUsed;
      return;
    }

    transactionStatus.textContent =
      "CONFIRMED: Batch successfully registered on DIDLab.";

    saveFormBundle(batchName, bundle);
    recordDocument("lot", batchName, bundle);

    // Do not open the result here. The BatchRegistered watcher opens it
    // once the log is observed on chain.
    transactionDetails.textContent =
      "Transaction: " + hash +
      " | Block: " + receipt.blockNumber +
      " | Gas used: " + receipt.gasUsed;

  } catch (error) {
    const reverted =
      error instanceof BaseError
        ? error.walk((e) => e instanceof ContractFunctionRevertedError)
        : null;

    if (isUserRejection(error)) {
      transactionStatus.textContent = formPublished
        ? "REJECTED: You declined batch registration. The encrypted form is published. No batch transaction was sent and no gas was used."
        : "REJECTED: You declined in MetaMask. No transaction was sent and no gas was used.";
    } else if (reverted) {
      transactionStatus.textContent =
        "WOULD REVERT: " +
        (reverted.data?.errorName || reverted.shortMessage) +
        ". No transaction was sent and no gas was used.";
    } else {
      transactionStatus.textContent =
        "Transaction not completed: " +
        (error.shortMessage || error.message);
    }
  } finally {
    registerButton.disabled = false;
  }
};

// --- Record inspection ------------------------------------------------------
// Same pattern as registration: check, publish the encrypted report, then send
// recordInspection(batchId, reportHash, passed). reportHash is the SHA-256 of
// the published ciphertext, so the CID can be checked against the chain
// without decrypting anything. Messages stay plain; details live in the
// recovery file and on the explorer.

const inspectButton = document.getElementById("recordInspection");
const inspectStatus = document.getElementById("inspectStatus");
const inspectReportFile = document.getElementById("inspectReportFile");
const inspectRecovery = document.getElementById("inspectRecovery");

const REVERT_MESSAGES = {
  Unauthorized: "This wallet isn't authorized to record inspections.",
  BatchNotFound: "No batch found with that ID.",
  SelfInspection: "You can't inspect a batch your own wallet registered.",
  AlreadyInspected: "This batch has already been inspected.",
  BatchRecalled: "This batch has been recalled and can't be inspected.",
  EmptyReportHash: "The report couldn't be read. Choose the file again.",
  InspectParentBatch: "This is a lot. It carries the inspection of the batch it was split from, so inspect that batch instead."
};

// Plain-language versions of publishEncryptedForm's progress messages.
function reportProgress(text) {
  if (text.startsWith("Sign to encrypt")) return "Approve in your wallet to secure the report (no fee).";
  if (text.startsWith("Encrypting")) return "Securing the report…";
  if (text.startsWith("Sign to publish")) return "Approve in your wallet to upload the report (no fee).";
  return "Uploading the report…";
}

let preparedReport = null;

inspectButton.onclick = async () => {
  inspectButton.disabled = true;
  inspectRecovery.hidden = true;
  let reportPublished = false;

  try {
    if (!window.ethereum) {
      throw new Error("Connect a browser wallet first.");
    }
    const [account] = await window.ethereum.request({
      method: "eth_requestAccounts"
    });
    const walletChainId = Number(
      await window.ethereum.request({ method: "eth_chainId" })
    );
    if (walletChainId !== REQUIRED_CHAIN_ID) {
      throw new Error("Switch your wallet to DIDLab.");
    }

    const batchName = document.getElementById("inspectBatchId").value.trim();
    if (!batchName || new TextEncoder().encode(batchName).length > 31) {
      throw new Error("Enter a batch ID (up to 31 characters).");
    }
    const batchId = stringToHex(batchName, { size: 32 });
    const passed = document.getElementById("inspectResult").value === "pass";
    const { file, source } = await selectedForm(inspectReportFile, "inspection report");
    const reportKeyId = account.toLowerCase() + ":" + source + ":" + file.size;

    // Check with a placeholder hash. The revert conditions (no INSPECTOR
    // credential, unknown batch) don't depend on the hash, so this catches
    // them before anything is signed or published.
    inspectStatus.textContent = "Checking…";
    await publicClient.simulateContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "recordInspection",
      args: [batchId, "0x" + "11".repeat(32), passed],
      account
    });

    const walletClient = createWalletClient({
      chain,
      transport: custom(window.ethereum)
    });

    let bundle = preparedReport && preparedReport.key === reportKeyId
      ? preparedReport.bundle
      : null;
    if (!bundle) {
      bundle = await publishEncryptedForm({
        file,
        account,
        onStatus: (text) => {
          inspectStatus.textContent = reportProgress(text);
        },
        signMessage: (message) => walletClient.signMessage({ account, message })
      });
      preparedReport = { key: reportKeyId, bundle };
    }
    reportPublished = true;
    saveFormBundle(reportKey(batchName), bundle);
    bindRecovery(inspectRecovery, bundle);

    const { request } = await publicClient.simulateContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "recordInspection",
      args: [batchId, reportHashOf(bundle), passed],
      account
    });

    inspectStatus.textContent = "Approve the inspection in your wallet.";
    const hash = await walletClient.writeContract(request);

    inspectStatus.textContent = "Recording…";
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1
    });
    const txLink = Object.assign(document.createElement("a"), {
      href: EXPLORER_BASE + "/tx/" + hash,
      target: "_blank",
      rel: "noopener noreferrer",
      textContent: "View transaction"
    });
    if (receipt.status !== "success") {
      inspectStatus.replaceChildren("The inspection could not be recorded. ", txLink);
      return;
    }
    inspectStatus.replaceChildren(
      "Inspection recorded: " + batchName + " " + (passed ? "passed" : "failed") + ". ",
      txLink
    );
    recordDocument("inspection", batchName, bundle);
    showBatch(batchName);
  } catch (error) {
    const reverted =
      error instanceof BaseError
        ? error.walk((e) => e instanceof ContractFunctionRevertedError)
        : null;
    if (isUserRejection(error)) {
      inspectStatus.textContent = reportPublished
        ? "Cancelled. Your report is uploaded; click Record Inspection to finish."
        : "Cancelled. Nothing was recorded.";
    } else if (reverted) {
      inspectStatus.textContent =
        REVERT_MESSAGES[reverted.data?.errorName] ||
        "The inspection can't be recorded for this batch.";
    } else {
      inspectStatus.textContent = error.shortMessage || error.message;
    }
  } finally {
    inspectButton.disabled = false;
  }
};
