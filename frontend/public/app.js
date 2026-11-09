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
  fetchSession,
  signIn,
  signOut,
  applyPermissions,
  SIGNED_OUT
} from "./session.js";
import { loadAdmin } from "./admin.js";
import {
  gatewayUrlForCid,
  publishEncryptedForm
} from "./ipfs.js";
import {
  EXPLORER_BASE,
  REQUIRED_CHAIN_ID,
  beefSupplyChainAddress,
  credentialRegistryAddress,
  chain,
  publicClient,
  isUserRejection
} from "./chain.js";

// BeefSupplyChain carries batch reads and writes here. CredentialRegistry
// writes (grant/revoke) happen on the admin page, in admin.js.
document.getElementById("deployedChainId").textContent = String(REQUIRED_CHAIN_ID);
document.getElementById("addrBeefSupplyChain").textContent = beefSupplyChainAddress;
document.getElementById("addrCredentialRegistry").textContent = credentialRegistryAddress;
document.getElementById("linkBeefSupplyChain").href =
  EXPLORER_BASE + "/address/" + beefSupplyChainAddress;
document.getElementById("linkCredentialRegistry").href =
  EXPLORER_BASE + "/address/" + credentialRegistryAddress;

const networkStatus = document.getElementById("networkStatus");
const switchNetworkBtn = document.getElementById("switchNetwork");
const verificationStatus =
  document.getElementById("verificationStatus");
const connectWalletBtn = document.getElementById("connectWallet");
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

const LOGGED_OUT_LABEL = "Connect Wallet";

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

  if (signedIn && session.permissions.includes("users.manage") && !adminLoaded) {
    adminLoaded = true;
    loadAdmin();
  }

  if (!account) {
    connectWalletBtn.textContent = LOGGED_OUT_LABEL;
    connectWalletBtn.setAttribute("aria-label", LOGGED_OUT_LABEL);
    return;
  }

  const label = shortAddress(account);
  if (signedIn) {
    connectWalletBtn.textContent = label;
    connectWalletBtn.setAttribute("aria-label", "Signed in as " + label);
    walletNotice.hidden = true;
    walletNotice.textContent = "";
  } else {
    connectWalletBtn.textContent = "Sign in";
    connectWalletBtn.setAttribute(
      "aria-label",
      "Sign in as " + label + " with a wallet signature"
    );
  }
}

async function updateNetworkStatus() {
  switchNetworkBtn.hidden = true;
  networkStatus.classList.remove("network-status-warn");

  if (!window.ethereum) {
    networkStatus.textContent = "No Wallet Detected";
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

    if (!accounts || accounts.length === 0) {
      networkStatus.textContent =
        "Wallet detected, not connected.";
      syncWalletChrome(accounts);
      return;
    }

    if (currentChainId !== REQUIRED_CHAIN_ID) {
      networkStatus.textContent =
        "WARNING: Connected on chain " +
        currentChainId +
        "; required " +
        REQUIRED_CHAIN_ID +
        " (DIDLab).";
      networkStatus.classList.add("network-status-warn");
      switchNetworkBtn.hidden = false;
      syncWalletChrome(accounts);
      return;
    }

    networkStatus.textContent =
      "Connected on DIDLab (" +
      REQUIRED_CHAIN_ID +
      "): " +
      accounts[0];
    syncWalletChrome(accounts);
  } catch (error) {
    networkStatus.textContent =
      "Unable to read wallet network status: " + error.message;
    syncWalletChrome(null);
  }
}

async function switchToDidLab() {
  if (!window.ethereum) {
    networkStatus.textContent = "No Wallet Detected";
    return;
  }

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
      networkStatus.textContent =
        "Could not switch network: " + error.message;
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
      "No wallet detected in this browser.";
    await updateNetworkStatus();
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
      if (session.roles.length === 0) {
        walletNotice.hidden = false;
        walletNotice.textContent =
          "Signed in. This wallet has no portal roles yet; ask an admin to assign one.";
      }
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

async function loadBatch(batchName) {
  const result = document.getElementById("batchResult");

  result.hidden = true;
  verificationStatus.textContent = "Reading DIDLab blockchain...";

  try {
    const batchId = stringToHex(batchName, { size: 32 });

    const batch = await publicClient.readContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "getBatch",
      args: [batchId]
    });

    document.getElementById("resultId").textContent = batchName;
    document.getElementById("resultProcessor").textContent = batch[0];
    document.getElementById("resultWeight").textContent =
      batch[1].toString() + " lbs";
    document.getElementById("resultHolder").textContent = batch[2];
    document.getElementById("resultInspected").textContent =
      batch[4] ? "Yes" : "No";
    document.getElementById("resultPassed").textContent =
      batch[5] ? "Yes" : "No";
    document.getElementById("resultRecalled").textContent =
      batch[7] ? "Yes" : "No";
    showStoredForm(batchName);

    result.hidden = false;
    verificationStatus.textContent =
      "Verified against DIDLab blockchain.";
  } catch (error) {
    verificationStatus.textContent =
      "Unable to verify batch. Check the ID or network connection.";
    console.error(error);
  }
}

document.getElementById("verifyBatch").onclick = () => {
  loadBatch(document.getElementById("batchId").value.trim());
};

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
  onLogs: async (logs) => {
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

      document.getElementById("batchId").value = batchName;
      await loadBatch(batchName);
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

function showStoredForm(batchName) {
  const row = document.getElementById("resultFormRow");
  const link = document.getElementById("resultFormLink");
  const bundle = readFormStore()[batchName];
  row.hidden = !showCidLink(link, bundle);
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
      throw new Error("No wallet detected. Install MetaMask.");
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
    showStoredForm(batchName);

    // Do not loadBatch here. The BatchRegistered watcher refreshes
    // the record after the log is observed on chain.
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
  EmptyReportHash: "The report couldn't be read. Choose the file again."
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
      throw new Error("No wallet detected.");
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
    document.getElementById("batchId").value = batchName;
    await loadBatch(batchName);
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
