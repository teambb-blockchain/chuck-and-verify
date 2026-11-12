
import { useRef, useState } from "react";
import { ethers } from "ethers";
import { ShieldAlert, ExternalLink, Loader2, Download } from "lucide-react";
import { publishEncryptedForm } from "./lib/ipfs";

const CHAIN_ID = 252501;
const CONTRACT = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";
const STORE_KEY = "chuck-and-verify.formBundles";
const ABI = [
  "function recordRecall(bytes32 batchId, bytes32 noticeHash, uint8 classification)"
];

function friendlyError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "Wallet request cancelled.";
  }
  const message = [
    error?.reason,
    error?.shortMessage,
    error?.message,
    error?.info?.error?.message
  ].filter(Boolean).join(" ");

  const messages = {
    NotBatchProcessor: "Only the original batch processor can record a recall.",
    BatchNotFound: "The batch was not found on DIDLab.",
    InvalidClassification: "Choose Class I, II, or III.",
    EmptyNoticeHash: "The recall notice hash cannot be empty.",
    RecallNotEscalated: "This batch is already recalled. You can only increase recall severity."
  };
  for (const [key, value] of Object.entries(messages)) {
    if (message.includes(key)) return value;
  }
  return error?.shortMessage || error?.message || "Recall failed.";
}

function downloadRecovery(bundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `recall-recovery-${bundle.cid}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveRecovery(batchId, bundle) {
  let store = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      store = parsed;
    }
  } catch {
    // Preserve a fresh recovery store.
  }
  store[`recall:${batchId}:${bundle.ciphertextSha256}`] = bundle;
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export default function Recalls({ portalUser, dashboardData }) {
  const [batchId, setBatchId] = useState("");
  const [classification, setClassification] = useState("2");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [metadataSaved, setMetadataSaved] = useState(null);
  const [bundle, setBundle] = useState(null);
  const pendingRef = useRef(null);
  const lockedRef = useRef(false);

  const isProcessor = (dashboardData?.roles || []).includes("PROCESSOR");

  async function recordRecall(event) {
    event.preventDefault();
    if (lockedRef.current || confirmed) return;
    lockedRef.current = true;
    setLoading(true);
    setError("");
    setStatus("");
    setMetadataSaved(null);

    let uploaded = false;
    let transactionSent = false;

    try {
      if (!portalUser?.address) throw new Error("Sign in to the portal first.");
      if (!isProcessor) throw new Error("A PROCESSOR portal role is required.");
      if (!window.ethereum) throw new Error("Install or enable MetaMask.");

      const name = batchId.trim();
      if (!name || ethers.toUtf8Bytes(name).length > 31) {
        throw new Error("Enter a batch ID of up to 31 UTF-8 bytes.");
      }
      if (!file || !(file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf"))) {
        throw new Error("Choose a recall notice PDF.");
      }
      if (!file.size || file.size > 25 * 1024 * 1024) {
        throw new Error("The PDF must be between 1 byte and 25 MB.");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) {
        throw new Error("Switch MetaMask to DIDLab (chain 252501).");
      }

      const signer = await provider.getSigner();
      const account = await signer.getAddress();
      if (account.toLowerCase() !== portalUser.address.toLowerCase()) {
        throw new Error("MetaMask wallet does not match your portal session.");
      }

      const contract = new ethers.Contract(CONTRACT, ABI, signer);
      const idHex = ethers.encodeBytes32String(name);
      const recallClass = Number(classification);

      setStatus("Checking recall authorization and eligibility...");
      await contract.recordRecall.staticCall(
        idHex, `0x${"11".repeat(32)}`, recallClass
      );

      const uploadKey = [
        account.toLowerCase(), name, classification,
        file.name, file.size, file.lastModified
      ].join(":");

      let reportBundle = pendingRef.current?.key === uploadKey
        ? pendingRef.current.data
        : null;

      if (!reportBundle) {
        reportBundle = await publishEncryptedForm({
          file,
          account,
          signMessage: message => signer.signMessage(message),
          onStatus: setStatus
        });

        uploaded = true;
        pendingRef.current = { key: uploadKey, data: reportBundle };
        setBundle(reportBundle);

        try {
          saveRecovery(name, reportBundle);
        } catch {
          downloadRecovery(reportBundle);
          throw new Error(
            "Recall notice uploaded, but browser storage failed. Keep the recovery JSON."
          );
        }
        downloadRecovery(reportBundle);
      } else {
        uploaded = true;
        setBundle(reportBundle);
      }

      const noticeHash = `0x${reportBundle.ciphertextSha256}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(noticeHash)) {
        throw new Error("Invalid encrypted recall notice SHA-256 hash.");
      }

      setStatus("Validating the final recall transaction...");
      await contract.recordRecall.staticCall(idHex, noticeHash, recallClass);

      setStatus("Approve the recall transaction in MetaMask...");
      const tx = await contract.recordRecall(idHex, noticeHash, recallClass);
      transactionSent = true;
      setTxHash(tx.hash);

      setStatus("Waiting for blockchain confirmation...");
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) {
        throw new Error("Recall transaction failed. Check the explorer.");
      }

      setConfirmed(true);
      setStatus(`Class ${["", "I", "II", "III"][recallClass]} recall confirmed on DIDLab.`);

      try {
        const response = await fetch("/api/documents", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "recall",
            batchId: name,
            bundle: reportBundle
          })
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || `HTTP ${response.status}`);
        }
        setMetadataSaved(true);
      } catch (saveError) {
        setMetadataSaved(false);
        setError(
          `Recall confirmed on-chain, but document metadata was not saved: ${saveError.message}. Keep the recovery JSON. Do not repeat the blockchain transaction.`
        );
      }
    } catch (err) {
      setError(
        friendlyError(err) +
        (transactionSent
          ? " A transaction was submitted. Check its explorer status before retrying."
          : uploaded || pendingRef.current
            ? " Your encrypted notice may already be uploaded. Keep the recovery JSON."
            : "")
      );
      if (!transactionSent) setStatus("");
    } finally {
      lockedRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Recall Management</h1>
        <p className="mt-1 text-sm text-slate-500">
          Record and verify beef product recalls on DIDLab.
        </p>
      </div>

      <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <ShieldAlert className="text-red-600" size={24} />
          <h2 className="text-lg font-semibold">Record Product Recall</h2>
        </div>

        {!isProcessor && (
          <p className="mb-4 text-sm text-amber-700">
            A PROCESSOR portal role is required.
          </p>
        )}

        <form onSubmit={recordRecall} className="space-y-5">
          <div>
            <label htmlFor="recall-batch" className="mb-2 block text-sm font-medium">
              Batch ID
            </label>
            <input
              id="recall-batch"
              value={batchId}
              onChange={e => setBatchId(e.target.value)}
              placeholder="Enter registered batch ID"
              className="w-full rounded-lg border border-slate-300 px-4 py-3"
              required
              disabled={loading || confirmed}
            />
          </div>

          <div>
            <label htmlFor="recall-class" className="mb-2 block text-sm font-medium">
              USDA Recall Classification
            </label>
            <select
              id="recall-class"
              value={classification}
              onChange={e => setClassification(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-4 py-3"
              disabled={loading || confirmed}
            >
              <option value="1">Class I - High risk</option>
              <option value="2">Class II - Moderate risk</option>
              <option value="3">Class III - Low risk</option>
            </select>
          </div>

          <div>
            <label htmlFor="recall-file" className="mb-2 block text-sm font-medium">
              Recall Notice (PDF)
            </label>
            <input
              id="recall-file"
              type="file"
              accept=".pdf,application/pdf"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border border-slate-300 px-4 py-3"
              disabled={loading || confirmed}
              required
            />
            <p className="mt-2 text-xs text-slate-500">
              Maximum 25 MB. Encrypted before uploading to IPFS.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || confirmed || !isProcessor || !portalUser?.address}
            className="flex items-center justify-center gap-2 rounded-lg bg-red-700 px-5 py-3 font-medium text-white disabled:opacity-50"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {confirmed ? "Recall Confirmed" : loading ? "Processing..." : "Record Recall on DIDLab"}
          </button>
        </form>

        {status && <p role="status" className="mt-5 text-sm text-blue-700">{status}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}

        {txHash && (
          <a
            href={`${EXPLORER}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center gap-2 text-sm text-blue-700 underline"
          >
            View blockchain transaction <ExternalLink size={15} />
          </a>
        )}

        {bundle && (
          <button
            type="button"
            onClick={() => downloadRecovery(bundle)}
            className="mt-4 flex items-center gap-2 text-sm text-slate-700 underline"
          >
            <Download size={15} /> Download recovery JSON
          </button>
        )}

        {metadataSaved === true && (
          <p className="mt-3 text-sm text-green-700">
            Recall notice metadata saved to the portal.
          </p>
        )}
      </div>
    </div>
  );
}
