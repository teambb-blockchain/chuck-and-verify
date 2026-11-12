import { useRef, useState } from "react";
import { ethers } from "ethers";
import { ClipboardCheck, FileText, ExternalLink, Download, Loader2, ShieldCheck } from "lucide-react";
import { publishEncryptedForm } from "./lib/ipfs";

const CHAIN_ID = 252501;
const CONTRACT = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";
const STORE_KEY = "chuck-and-verify.formBundles";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ABI = ["function recordInspection(bytes32 batchId, bytes32 reportHash, bool passed)"];

const ERROR_MESSAGES = {
  Unauthorized: "This wallet isn't authorized to record inspections on-chain.",
  BatchNotFound: "No batch found with that ID.",
  SelfInspection: "You cannot inspect a batch registered by your own wallet.",
  AlreadyInspected: "This batch has already been inspected.",
  BatchRecalled: "This batch has been recalled.",
  EmptyReportHash: "The report hash is missing.",
  InspectParentBatch: "Inspect the original batch rather than a split lot."
};

function getErrorMessage(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "Wallet request cancelled.";
  }
  const message = [error?.reason, error?.shortMessage, error?.message, error?.info?.error?.message]
    .filter(Boolean).join(" ");
  for (const [name, friendly] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(name)) return friendly;
  }
  return error?.shortMessage || error?.message || "Something went wrong.";
}

function saveBundle(batchName, data) {
  let store = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) store = parsed;
  } catch { /* Preserve a usable new store if existing JSON is invalid. */ }
  store[`inspection:${batchName}`] = data;
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function downloadRecovery(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ipfs-upload-${data.cid}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Inspections({ portalUser, dashboardData }) {
  const [batchId, setBatchId] = useState("");
  const [result, setResult] = useState("pass");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [bundle, setBundle] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [metadataSaved, setMetadataSaved] = useState(null);
  const pendingRef = useRef(null);
  const lockedRef = useRef(false);
  const isInspector = (dashboardData?.roles || []).includes("INSPECTOR");

  async function recordInspection(event) {
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
      if (!isInspector) throw new Error("An INSPECTOR portal role is required.");
      if (!window.ethereum) throw new Error("Install or enable MetaMask first.");
      const name = batchId.trim();
      if (!name || ethers.toUtf8Bytes(name).length > 31) {
        throw new Error("Enter a batch ID of up to 31 UTF-8 bytes.");
      }
      if (!file || !(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
        throw new Error("Choose an inspection report PDF.");
      }
      if (!file.size || file.size > MAX_FILE_SIZE) {
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
        throw new Error("Your MetaMask wallet does not match your portal session.");
      }
      const contract = new ethers.Contract(CONTRACT, ABI, signer);
      const idHex = ethers.encodeBytes32String(name);
      const passed = result === "pass";
      const uploadKey = `${account.toLowerCase()}:${name}:${result}:${file.name}:${file.lastModified}:${file.size}`;

      setStatus("Checking inspector authorization and batch eligibility...");
      await contract.recordInspection.staticCall(idHex, `0x${"11".repeat(32)}`, passed);

      let reportBundle = pendingRef.current?.key === uploadKey ? pendingRef.current.data : null;
      if (!reportBundle) {
        reportBundle = await publishEncryptedForm({
          file,
          account,
          signMessage: (message) => signer.signMessage(message),
          onStatus: setStatus
        });
        uploaded = true;
        pendingRef.current = { key: uploadKey, data: reportBundle };
        setBundle(reportBundle);
        // Persist immediately after publishing, before requesting the on-chain transaction.
        try {
          saveBundle(name, reportBundle);
        } catch (storageError) {
          setStatus("Report published. Download and safely store the recovery JSON before continuing.");
          downloadRecovery(reportBundle);
          throw new Error("Report published, but browser storage failed. Keep the downloaded recovery file and do not re-upload yet.");
        }
        downloadRecovery(reportBundle);
      } else {
        uploaded = true;
        setBundle(reportBundle);
      }

      const reportHash = `0x${reportBundle.ciphertextSha256}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(reportHash)) {
        throw new Error("The published report has an invalid SHA-256 hash.");
      }
      setStatus("Checking the final inspection transaction...");
      await contract.recordInspection.staticCall(idHex, reportHash, passed);

      setStatus("Approve the inspection transaction in MetaMask...");
      const tx = await contract.recordInspection(idHex, reportHash, passed);
      transactionSent = true;
      setTxHash(tx.hash);
      setStatus("Transaction submitted. Waiting for one confirmation...");
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) {
        throw new Error("Inspection transaction failed. Review the transaction before trying again.");
      }
      setConfirmed(true);
      setStatus(`Inspection confirmed on DIDLab: ${passed ? "Passed" : "Failed"}.`);

      try {
        const response = await fetch("/api/documents", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "inspection", batchId: name, bundle: reportBundle })
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || `HTTP ${response.status}`);
        }
        setMetadataSaved(true);
      } catch (saveError) {
        setMetadataSaved(false);
        setError(`Inspection confirmed on-chain, but portal metadata was not saved: ${saveError.message}. Keep your recovery JSON; do not repeat the blockchain transaction.`);
      }
    } catch (err) {
      setError(getErrorMessage(err) + (transactionSent
        ? " A transaction was submitted. Check its explorer status before retrying."
        : uploaded || pendingRef.current ? " The encrypted report may already be published. Keep its recovery JSON; don't re-upload unnecessarily." : ""));
      if (!transactionSent) setStatus("");
    } finally {
      lockedRef.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Inspection Management</h1>
        <p className="mt-1 text-sm text-slate-500">Record authenticated inspections on the DIDLab blockchain.</p>
      </div>
      <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <ClipboardCheck className="text-blue-600" size={24} />
          <h2 className="text-lg font-semibold text-slate-900">Record Inspection</h2>
        </div>
        {!isInspector && (
          <div role="status" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            An INSPECTOR portal role is required. Use a separate authorized inspector wallet; the processor cannot inspect its own batch.
          </div>
        )}
        <form onSubmit={recordInspection} className="space-y-5">
          <div>
            <label htmlFor="inspection-batch" className="mb-2 block text-sm font-medium">Batch ID</label>
            <input id="inspection-batch" value={batchId} onChange={e => setBatchId(e.target.value)}
              placeholder="Enter registered batch ID" className="w-full rounded-lg border border-slate-300 px-4 py-3" required disabled={loading || confirmed} />
          </div>
          <div>
            <label htmlFor="inspection-result" className="mb-2 block text-sm font-medium">Inspection Result</label>
            <select id="inspection-result" value={result} onChange={e => setResult(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-4 py-3" disabled={loading || confirmed}>
              <option value="pass">Passed</option><option value="fail">Failed</option>
            </select>
          </div>
          <div>
            <label htmlFor="inspection-pdf" className="mb-2 block text-sm font-medium">Inspection Report (PDF)</label>
            <input id="inspection-pdf" type="file" accept=".pdf,application/pdf"
              onChange={e => { setFile(e.target.files?.[0] || null); pendingRef.current = null; setBundle(null); }}
              className="w-full rounded-lg border border-slate-300 p-3" required disabled={loading || confirmed} />
            <p className="mt-2 text-xs text-slate-500">Maximum 25 MB. Encrypted before IPFS upload.</p>
          </div>
          <button type="submit" disabled={loading || confirmed || !isInspector}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
            {loading ? "Processing..." : confirmed ? "Inspection Recorded" : "Record Inspection"}
          </button>
        </form>
        {status && <div role="status" className="mt-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">{status}</div>}
        {error && <div role="alert" className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {metadataSaved === true && <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">Inspection document metadata saved in the portal.</div>}
        {txHash && <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="mt-4 flex items-center gap-2 text-sm text-blue-600 underline"><ExternalLink size={16} />View blockchain transaction</a>}
        {bundle && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 font-semibold text-amber-900"><FileText size={18} />Encrypted report recovery</div>
          <p className="mt-2 text-sm text-amber-800">Keep the recovery JSON securely. It contains the details needed to locate and decrypt the published report.</p>
          <button type="button" onClick={() => downloadRecovery(bundle)}
            className="mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium"><Download size={16} />Download Recovery File</button>
        </div>}
      </div>
    </div>
  );
}
