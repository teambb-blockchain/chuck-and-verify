import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  stringToHex,
  hexToString,
  BaseError,
  ContractFunctionRevertedError
} from "https://esm.sh/viem@2";
import { abi } from "./abi.js";

// beefSupplyChainAddress is the contract every read and write uses, and it
// fills that contract's explorer link. The registry address is display-only.
const EXPLORER_BASE = "https://explorer.didlab.org";
const REQUIRED_CHAIN_ID = 252501;
const beefSupplyChainAddress = "0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e";
const credentialRegistryAddress = "0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E";

document.getElementById("deployedChainId").textContent = String(REQUIRED_CHAIN_ID);
document.getElementById("addrBeefSupplyChain").textContent = beefSupplyChainAddress;
document.getElementById("addrCredentialRegistry").textContent = credentialRegistryAddress;
document.getElementById("linkBeefSupplyChain").href =
  EXPLORER_BASE + "/address/" + beefSupplyChainAddress;
document.getElementById("linkCredentialRegistry").href =
  EXPLORER_BASE + "/address/" + credentialRegistryAddress;

const chain = {
  id: REQUIRED_CHAIN_ID,
  name: "DIDLab Blockchain",
  nativeCurrency: {
    name: "TRUST",
    symbol: "TRUST",
    decimals: 18
  },
  rpcUrls: {
    default: { http: ["https://eth.didlab.org"] }
  }
};

const publicClient = createPublicClient({
  chain,
  transport: http()
});

const networkStatus = document.getElementById("networkStatus");
const switchNetworkBtn = document.getElementById("switchNetwork");
const verificationStatus =
  document.getElementById("verificationStatus");

async function updateNetworkStatus() {
  switchNetworkBtn.hidden = true;
  networkStatus.classList.remove("network-status-warn");

  if (!window.ethereum) {
    networkStatus.textContent = "No Wallet Detected";
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
      return;
    }

    networkStatus.textContent =
      "Connected on DIDLab (" +
      REQUIRED_CHAIN_ID +
      "): " +
      accounts[0];
  } catch (error) {
    networkStatus.textContent =
      "Unable to read wallet network status: " + error.message;
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

function isUserRejection(error) {
  let current = error;
  while (current) {
    if (
      current.code === 4001 ||
      current.name === "UserRejectedRequestError"
    ) {
      return true;
    }
    current = current.cause;
  }
  const text = `${error?.shortMessage || ""} ${error?.message || ""}`;
  return /user rejected the request/i.test(text);
}

document.getElementById("connectWallet").onclick = async () => {
  if (!window.ethereum) {
    await updateNetworkStatus();
    return;
  }

  try {
    const walletClient = createWalletClient({
      chain,
      transport: custom(window.ethereum)
    });

    await walletClient.requestAddresses();
    await updateNetworkStatus();
  } catch (error) {
    if (isUserRejection(error)) {
      networkStatus.textContent =
        "Connection cancelled by user. No transaction was sent and no gas was used.";
      return;
    }
    networkStatus.textContent =
      "Wallet connection failed: " + error.message;
  }
};

switchNetworkBtn.onclick = () => {
  switchToDidLab();
};

updateNetworkStatus();

if (window.ethereum && window.ethereum.on) {
  window.ethereum.on("chainChanged", () => {
    updateNetworkStatus();
  });
  window.ethereum.on("accountsChanged", () => {
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

registerButton.onclick = async () => {
  registerButton.disabled = true;
  transactionDetails.textContent = "";

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

    // Simulate first. A call that would revert (no PROCESSOR credential,
    // duplicate batch id) is reported here, before MetaMask opens and
    // before any gas is spent.
    transactionStatus.textContent =
      "Simulating against DIDLab. No transaction sent yet.";

    const { request } = await publicClient.simulateContract({
      address: beefSupplyChainAddress,
      abi,
      functionName: "registerBatch",
      args: [batchId, weight],
      account: accounts[0]
    });

    transactionStatus.textContent =
      "Waiting for MetaMask approval. No transaction sent yet.";

    const hash = await walletClient.writeContract(request);

    transactionStatus.textContent =
      "PENDING: Transaction sent. Waiting for blockchain confirmation.";

    transactionDetails.innerHTML =
      'Transaction: <a target="_blank" rel="noopener noreferrer" href="' +
      EXPLORER_BASE + "/tx/" + hash + '">' + hash + "</a>";

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

    if (error.code === 4001 ||
        error.name === "UserRejectedRequestError") {
      transactionStatus.textContent =
        "REJECTED: You declined in MetaMask. No transaction was sent and no gas was used.";
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
