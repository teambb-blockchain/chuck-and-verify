
import { useState } from "react";
import { BrowserProvider, Contract, encodeBytes32String } from "ethers";
import { PackagePlus, FileUp, ExternalLink, Download } from "lucide-react";
import { publishEncryptedForm } from "./lib/ipfs";

const CHAIN_ID = 252501;
const CONTRACT_ADDRESS = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ABI = [
  "function registerBatch(bytes32 batchId, uint256 weightLbs)"
];

export default function BatchRegistration({ portalUser, dashboardData }) {
  const [batchId, setBatchId] = useState("");
  const [weight, setWeight] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState(null);

  const roles = dashboardData?.roles || [];
  const isProcessor = roles.includes("PROCESSOR");

  async function register(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    setTransaction(null);

    try {
      if (!portalUser?.address) {
        throw new Error("Sign in to the portal first.");
      }
      if (!isProcessor) {
        throw new Error("A PROCESSOR role is required.");
      }
      if (!window.ethereum) {
        throw new Error("Install MetaMask to register batches.");
      }

      const name = batchId.trim();

      if (!name || new TextEncoder().encode(name).length > 31) {
        throw new Error("Batch ID must contain 1–31 UTF-8 bytes.");
      }
      if (/-L[0-9]+$/.test(name)) {
        throw new Error("This ID ending is reserved for split lots.");
      }
      if (!/^[0-9]+$/.test(weight) || BigInt(weight) === 0n) {
        throw new Error("Enter a positive whole-number weight.");
      }
      if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error("Select a PDF lot form.");
      }
      if (file.size === 0 || file.size > MAX_FILE_BYTES) {
        throw new Error("PDF must be between 1 byte and 25 MB.");
      }

      const walletProvider = new BrowserProvider(window.ethereum);
      const network = await walletProvider.getNetwork();

      if (Number(network.chainId) !== CHAIN_ID) {
        throw new Error("Switch MetaMask to the DIDLab network.");
      }

      const signer = await walletProvider.getSigner();
      const account = await signer.getAddress();

      if (account.toLowerCase() !== portalUser.address.toLowerCase()) {
        throw new Error("Your wallet does not match your portal session.");
      }

      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer);
      const encodedId = encodeBytes32String(name);

      setStatus("Checking contract permissions and batch availability...");
      await contract.registerBatch.staticCall(encodedId, BigInt(weight));

      setStatus("Validation successful. Preparing encrypted documentation...");

const bundle = await publishEncryptedForm({
  file,
  account,
  signMessage: (message) => signer.signMessage(message),
  onStatus: (message) => setStatus(message),
});

const recoveryData = bundle;

const recoveryBlob = new Blob(
  [JSON.stringify(recoveryData, null, 2)],
  { type: "application/json" }
);

const recoveryUrl = URL.createObjectURL(recoveryBlob);

const recoveryLink = document.createElement("a");
recoveryLink.href = recoveryUrl;
recoveryLink.download = `ipfs-upload-${bundle.cid}.json`;
document.body.appendChild(recoveryLink);
recoveryLink.click();
recoveryLink.remove();

setTimeout(() => URL.revokeObjectURL(recoveryUrl), 1000);

setStatus("Documentation encrypted and published. Confirm registration in MetaMask.");

const tx = await contract.registerBatch(encodedId, BigInt(weight));

setStatus("Transaction submitted. Waiting for blockchain confirmation...");

const receipt = await tx.wait(1);

if (receipt.status !== 1) {
  throw new Error("Registration transaction failed.");
}

setTransaction({
  hash: tx.hash,
  batchId: name,
  cid: bundle.cid,
});
// Save the document using Britt's original localStorage key.
const FORM_STORE = "chuck-and-verify.formBundles";

let stored = {};

try {
  const parsed = JSON.parse(localStorage.getItem(FORM_STORE) || "{}");

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    stored = parsed;
  }
} catch {
  stored = {};
}

stored[name] = bundle;
localStorage.setItem(FORM_STORE, JSON.stringify(stored));

// Save the document metadata to the portal database.
try {
  const response = await fetch("/api/documents", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: "lot",
      batchId: name,
      bundle,
    }),
  });

  if (!response.ok) {
    throw new Error(`Portal returned HTTP ${response.status}`);
  }
} catch (documentError) {
  console.error("Document metadata save failed:", documentError);

  setError(
    "Batch registered on the blockchain, but document metadata could not be saved to the portal."
  );
}
setStatus("Batch registered successfully on DIDLab!");

    } catch (err) {
      setError(err.reason || err.shortMessage || err.message);
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <PackagePlus className="text-forest" size={26} />
          <div>
            <h3 className="text-xl font-bold">Register New Beef Batch</h3>
            <p className="text-sm text-stone-500">
              Record a new beef batch on DIDLab.
            </p>
          </div>
        </div>

        {!isProcessor && (
          <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Registration requires a PROCESSOR role assigned by an administrator.
          </div>
        )}

        <form onSubmit={register} className="mt-6 space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium">Batch ID</label>
            <input
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              placeholder="Example: BEEF-A1-002"
              required
              className="w-full rounded-xl border border-stone-300 px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Weight (lbs)
            </label>
            <input
              type="number"
              min="1"
              step="1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="Example: 1200"
              required
              className="w-full rounded-xl border border-stone-300 px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Lot Documentation (PDF)
            </label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-stone-300 p-5">
              <FileUp className="text-forest" size={23} />
              <span className="text-sm text-stone-600">
                {file ? file.name : "Choose a PDF (maximum 25 MB)"}
              </span>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          {status && (
            <p className="rounded-xl bg-green-50 p-4 text-sm text-green-800">
              {status}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !isProcessor || !portalUser?.address}
            className="rounded-xl bg-forest px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Processing..." : "Register Beef Batch"}
          </button>
        </form>
        {transaction && (
  <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
    <h4 className="font-semibold text-green-800">
      Batch Registered Successfully
    </h4>

    <p className="mt-2 text-sm">
      Batch ID: {transaction.batchId}
    </p>

    <p className="mt-1 text-sm">
      IPFS CID: {transaction.cid}
    </p>

    <a
      href={`${EXPLORER}/tx/${transaction.hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-green-800 underline"
    >
      View Blockchain Transaction
      <ExternalLink size={16} />
    </a>
  </div>
)}
      </section>
    </div>
  );
}
