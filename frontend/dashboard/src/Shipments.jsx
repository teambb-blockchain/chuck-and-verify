
import { useState } from "react";
import { BrowserProvider, Contract, encodeBytes32String, isAddress } from "ethers";
import { Truck, PackageCheck, ExternalLink } from "lucide-react";

const CHAIN_ID = 252501;
const CONTRACT = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";

const ABI = [
  "function recordShipment(bytes32 batchId, address to)",
  "function confirmReceipt(bytes32 batchId)"
];

const ERRORS = {
  Unauthorized: "A valid CUSTODIAN credential is required.",
  BatchNotFound: "Batch not found on the blockchain.",
  NotCurrentHolder: "Only the current batch holder can ship this batch.",
  AlreadySplit: "This batch has been split and cannot be shipped as a parent batch.",
  NoPendingShipment: "This batch has no pending shipment.",
  NotPendingReceiver: "Only the designated receiving wallet can confirm receipt.",
  ZeroAddress: "Enter a valid receiving wallet address."
};

function explainError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "MetaMask request cancelled.";
  }

  const message = [
    error?.reason,
    error?.shortMessage,
    error?.message,
    error?.info?.error?.message
  ].filter(Boolean).join(" ");

  for (const [key, description] of Object.entries(ERRORS)) {
    if (message.includes(key)) return description;
  }

  return error?.shortMessage || error?.message || "Transaction failed.";
}

export default function Shipments({ portalUser, dashboardData }) {
  const [batchId, setBatchId] = useState("");
  const [receiver, setReceiver] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const isCustodian = (dashboardData?.roles || []).includes("CUSTODIAN");

  async function execute(action) {
    if (loading) return;

    setLoading(true);
    setError("");
    setStatus("");
    setTxHash("");

    try {
      if (!portalUser?.address) {
        throw new Error("Sign in to the portal first.");
      }

      if (!isCustodian) {
        throw new Error("A CUSTODIAN portal role is required.");
      }

      if (!window.ethereum) {
        throw new Error("MetaMask is required.");
      }

      const name = batchId.trim();

      if (!name || new TextEncoder().encode(name).length > 31) {
        throw new Error("Enter a batch ID of up to 31 UTF-8 bytes.");
      }

      if (action === "ship" && !isAddress(receiver.trim())) {
        throw new Error("Enter a valid receiving wallet address.");
      }

      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== CHAIN_ID) {
        throw new Error("Switch MetaMask to DIDLab (chain 252501).");
      }

      const signer = await provider.getSigner();
      const wallet = await signer.getAddress();

      if (wallet.toLowerCase() !== portalUser.address.toLowerCase()) {
        throw new Error("Connected MetaMask wallet does not match your portal login.");
      }

      if (
        action === "ship" &&
        receiver.trim().toLowerCase() === wallet.toLowerCase()
      ) {
        throw new Error("Use a different wallet as the receiver.");
      }

      const contract = new Contract(CONTRACT, ABI, signer);
      const encodedId = encodeBytes32String(name);

      setStatus("Checking blockchain permissions...");

      if (action === "ship") {
        await contract.recordShipment.staticCall(
          encodedId,
          receiver.trim()
        );
      } else {
        await contract.confirmReceipt.staticCall(encodedId);
      }

      setStatus("Waiting for MetaMask confirmation...");

      const transaction =
        action === "ship"
          ? await contract.recordShipment(encodedId, receiver.trim())
          : await contract.confirmReceipt(encodedId);

      setTxHash(transaction.hash);
      setStatus("Transaction submitted. Waiting for confirmation...");

      const receipt = await transaction.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error("Transaction was not successful.");
      }

      setStatus(
        action === "ship"
          ? "Shipment recorded successfully. Awaiting receiver confirmation."
          : "Receipt confirmed successfully. Blockchain custody updated."
      );

    } catch (err) {
      setError(explainError(err));
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-3">
          <Truck className="text-green-800" size={24} />
          <h2 className="text-xl font-semibold">Shipments</h2>
        </div>

        <p className="text-sm text-gray-600">
          Record custody transfers and confirm product deliveries
          using DIDLab blockchain transactions.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-lg font-semibold">Shipment Details</h3>

        <div>
          <label className="block text-sm font-medium mb-2">
            Batch ID
          </label>

          <input
            type="text"
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
            placeholder="DEMO-BEEF-1112-02"
            disabled={loading}
            className="w-full rounded-lg border border-gray-300 px-4 py-3"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Receiving Wallet Address
          </label>

          <input
            type="text"
            value={receiver}
            onChange={(event) => setReceiver(event.target.value)}
            placeholder="0x..."
            disabled={loading}
            className="w-full rounded-lg border border-gray-300 px-4 py-3"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => execute("ship")}
            disabled={loading}
            className="rounded-lg bg-green-900 px-5 py-3 text-white disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-2">
              <Truck size={18} />
              Record Shipment
            </span>
          </button>

          <button
            type="button"
            onClick={() => execute("receive")}
            disabled={loading}
            className="rounded-lg bg-gray-800 px-5 py-3 text-white disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-2">
              <PackageCheck size={18} />
              Confirm Receipt
            </span>
          </button>
        </div>

        {!isCustodian && (
          <p className="text-sm text-amber-700">
            A CUSTODIAN portal role is required for shipment operations.
          </p>
        )}

        {status && (
          <p className="text-sm text-green-800" role="status">
            {status}
          </p>
        )}

        {error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        {txHash && (
          <a
            href={`${EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-blue-700 underline"
          >
            View transaction on DIDLab Explorer
            <ExternalLink size={16} />
          </a>
        )}
      </div>
    </div>
  );
}
