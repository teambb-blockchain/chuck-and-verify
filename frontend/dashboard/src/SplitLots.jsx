import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, encodeBytes32String } from "ethers";
import { Scissors, ExternalLink } from "lucide-react";
import { provider } from "./lib/blockchain";

const CHAIN_ID = 252501;
const CONTRACT = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";
const MAX_LOTS = 20;

const ABI = [
  "function splitBatch(bytes32 batchId, uint256[] weights)",
  "function getBatch(bytes32 batchId) view returns (address processor, uint256 weightLbs, address currentHolder, address pendingReceiver, bool inspected, bool inspectionPassed, bytes32 inspectionReportHash, bool recalled, bytes32 recallNoticeHash, uint8 recallClassification)"
];

// Custodian types that don't split, as on the main dashboard. A carrier or
// storage facility moves product as it is, and a restaurant uses what it
// receives. Distributors, retailers (grocery stores) and custodians with no
// type can split. The chain can't tell them apart: this is a portal rule.
const NO_SPLIT_REASON = {
  carrier: "Carriers haul lots as they are, so they don't split them.",
  storage: "Storage facilities keep lots as they are, so they don't split them.",
  restaurant: "Restaurants use what they receive, so they don't split lots."
};

const ERRORS = {
  Unauthorized: "A valid CUSTODIAN credential is required.",
  BatchNotFound: "No batch or lot found with that ID.",
  NotCurrentHolder: "This batch or lot isn't in your custody.",
  AlreadySplit: "This has already been split. Split one of its lots instead.",
  ShipmentPending: "This has a shipment waiting. It can be split once the receiver confirms it.",
  LotCannotBeSplit: "The contract this portal uses doesn't allow splitting a lot yet.",
  BadLotCount: `Split into 2 to ${MAX_LOTS} lots.`,
  LotWeightMismatch: "The lot weights must add up to the total weight.",
  LotNameTooLong: "This ID is too long to add another lot number.",
  ZeroWeight: "Every lot needs a weight of at least 1 lb."
};

function explainError(error) {
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return "MetaMask request cancelled.";
  }
  const message = [
    error?.reason,
    error?.shortMessage,
    error?.message,
    error?.info?.error?.message,
    error?.revert?.name
  ].filter(Boolean).join(" ");
  for (const [key, description] of Object.entries(ERRORS)) {
    if (message.includes(key)) return description;
  }
  return error?.shortMessage || error?.message || "Transaction failed.";
}

// Lot names mirror the contract's: "<id>-L1" … "<id>-Ln".
const lotName = (id, n) => `${id}-L${n}`;
const byteLength = (s) => new TextEncoder().encode(s).length;

// Whole pounds, with any remainder spread a pound at a time over the first
// lots: 1000 lbs into 3 lots is 334, 333, 333.
function equalWeights(total, n) {
  const base = Math.floor(total / n);
  const extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

// Your batches and lots in tree order, each with how many splits it sits
// below the top row it's listed under. Numeric ID order puts each lot right
// after the lot it came from: -L1, -L1-L1, -L1-L2, -L2, … -L10.
function treeRows(rows) {
  const byId = new Map(rows.map((r) => [r.batchId, r]));
  const depthOf = (r) => {
    let depth = 0;
    for (let p = r.parentId; p && byId.has(p); p = byId.get(p).parentId) depth++;
    return depth;
  };
  return [...rows]
    .sort((a, b) => a.batchId.localeCompare(b.batchId, undefined, { numeric: true }))
    .map((r) => ({ ...r, depth: depthOf(r) }));
}

// Something can be split when you hold it, it isn't on its way anywhere,
// and it hasn't been split already.
const splittable = (r) => r.holderIsYou && !r.inTransit && !r.lotCount;

export default function SplitLots({ portalUser, dashboardData }) {
  const [batchId, setBatchId] = useState("");
  const [equal, setEqual] = useState(true);
  const [count, setCount] = useState(2);
  const [custom, setCustom] = useState("");
  // { id, lbs } read from the chain for an ID the dashboard doesn't list.
  const [chainWeight, setChainWeight] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const isCustodian = (dashboardData?.roles || []).includes("CUSTODIAN");
  const organization = dashboardData?.organization;
  const orgCanSplit = !NO_SPLIT_REASON[organization];
  const canSplit = isCustodian && orgCanSplit;

  const rows = useMemo(() => dashboardData?.views?.CUSTODIAN?.rows || [], [dashboardData]);
  const yours = useMemo(
    () => treeRows(rows.filter((r) => r.holderIsYou)),
    [rows]
  );

  const name = batchId.trim();
  const known = rows.find((r) => r.batchId === name);
  const isKnown = Boolean(known);

  // A batch's weight never changes. Use the dashboard's when it has the row,
  // otherwise read it from the chain once the ID stops changing.
  useEffect(() => {
    if (!name || isKnown || byteLength(name) > 31) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const contract = new Contract(CONTRACT, ABI, provider);
        const batch = await contract.getBatch(encodeBytes32String(name));
        if (active) setChainWeight({ id: name, lbs: Number(batch.weightLbs) });
      } catch {
        // Not found yet, or still typing.
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [name, isKnown]);

  const total = known ? Number(known.weightLbs) : chainWeight?.id === name ? chainWeight.lbs : null;
  const customParts = custom.split(",").map((w) => w.trim()).filter(Boolean);
  const n = equal ? Number(count) : customParts.length;
  const weights = equal
    ? (total && Number.isInteger(n) && n >= 2 && n <= MAX_LOTS && total >= n ? equalWeights(total, n) : [])
    : customParts.map(Number);
  const sum = weights.reduce((a, b) => a + b, 0);

  function pick(row) {
    setBatchId(row.batchId);
    setError("");
    setStatus("");
    setTxHash("");
  }

  async function split() {
    if (loading) return;
    setLoading(true);
    setError("");
    setStatus("");
    setTxHash("");
    try {
      if (!portalUser?.address) throw new Error("Sign in to the portal first.");
      if (!isCustodian) throw new Error("A CUSTODIAN portal role is required.");
      if (!orgCanSplit) throw new Error(NO_SPLIT_REASON[organization]);
      if (!name || byteLength(name) > 31) throw new Error("Enter a batch or lot ID of up to 31 characters.");
      if (!Number.isInteger(n) || n < 2 || n > MAX_LOTS) throw new Error(ERRORS.BadLotCount);
      if (byteLength(lotName(name, n)) > 31) throw new Error(ERRORS.LotNameTooLong);
      if (!equal && customParts.some((w) => !/^[1-9]\d*$/.test(w))) {
        throw new Error("Enter a whole-number weight for each lot, separated by commas.");
      }
      if (!total) throw new Error("No batch or lot found with that ID.");
      if (equal && total < n) throw new Error(`${name} weighs ${total} lbs, too little for ${n} lots.`);
      if (sum !== total) throw new Error(`The lots add up to ${sum} lbs, but ${name} weighs ${total} lbs.`);

      // Say what's wrong with the form before the wallet is involved.
      if (!window.ethereum) throw new Error("MetaMask is required.");

      const walletProvider = new BrowserProvider(window.ethereum);
      const network = await walletProvider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) throw new Error("Switch MetaMask to DIDLab (chain 252501).");
      const signer = await walletProvider.getSigner();
      const wallet = await signer.getAddress();
      if (wallet.toLowerCase() !== portalUser.address.toLowerCase()) {
        throw new Error("Connected MetaMask wallet does not match your portal login.");
      }

      const contract = new Contract(CONTRACT, ABI, signer);
      const encodedId = encodeBytes32String(name);
      setStatus("Checking the split...");
      await contract.splitBatch.staticCall(encodedId, weights);

      setStatus("Waiting for MetaMask confirmation...");
      const transaction = await contract.splitBatch(encodedId, weights);
      setTxHash(transaction.hash);
      setStatus("Transaction submitted. Waiting for confirmation...");
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Transaction was not successful.");

      setStatus(`Split ${name} into ${weights.length} lots: ${lotName(name, 1)} to ${lotName(name, weights.length)}. They'll appear in your list shortly.`);
      setBatchId("");
      setCustom("");
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
        <div className="mb-3 flex items-center gap-3">
          <Scissors className="text-green-800" size={24} />
          <h2 className="text-xl font-semibold">Split Lots</h2>
        </div>
        <p className="text-sm text-gray-600">
          Divide a batch or lot in your custody into smaller lots. Each new lot ships on its own,
          and you or the next custodian can split it again. Every lot keeps the original batch's
          inspection and any recall above it.
        </p>
      </div>

      {!isCustodian && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          A CUSTODIAN portal role is required to split lots.
        </p>
      )}
      {isCustodian && !orgCanSplit && (
        <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
          {NO_SPLIT_REASON[organization]}
        </p>
      )}

      {canSplit && (
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 lg:col-span-2">
            <h3 className="text-lg font-semibold">In your custody</h3>
            <p className="mt-1 text-sm text-gray-500">Choose one to split.</p>
            {yours.length ? (
              <ul className="mt-4 space-y-1">
                {yours.map((r) => {
                  const ready = splittable(r);
                  const selected = r.batchId === name;
                  return (
                    <li key={r.batchId} style={{ paddingLeft: `${r.depth * 18}px` }}>
                      <button
                        type="button"
                        onClick={() => pick(r)}
                        disabled={!ready || loading}
                        aria-pressed={selected}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                          selected
                            ? "border-green-700 bg-green-100 ring-1 ring-green-700"
                            : ready
                            ? "border-gray-200 hover:bg-stone-50"
                            : "border-transparent text-gray-400"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block break-all font-mono font-medium">{r.batchId}</span>
                          <span className="block text-xs text-gray-500">
                            {r.weightLbs} lbs
                            {r.lotCount ? ` · Split into ${r.lotCount} lots` : r.inTransit ? " · Shipment waiting" : ""}
                          </span>
                        </span>
                        {r.recalled && (
                          <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                            Recalled
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-stone-200 p-6 text-center text-sm text-gray-500">
                {dashboardData ? "Nothing is in your custody yet." : "Loading your batches..."}
              </p>
            )}
          </section>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 lg:col-span-3">
            <h3 className="text-lg font-semibold">Split details</h3>

            <div>
              <label htmlFor="split-id" className="mb-2 block text-sm font-medium">Batch or lot ID</label>
              <input
                id="split-id"
                type="text"
                value={batchId}
                onChange={(event) => setBatchId(event.target.value)}
                placeholder="BEEF-01-L2"
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 font-mono"
              />
              {name && total ? <p className="mt-1 text-xs text-gray-500">{total} lbs to divide</p> : null}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={equal} onChange={(e) => setEqual(e.target.checked)} disabled={loading} />
              Equal weights
            </label>

            {equal ? (
              <div>
                <label htmlFor="split-count" className="mb-2 block text-sm font-medium">Number of lots</label>
                <input
                  id="split-count"
                  type="number"
                  min={2}
                  max={MAX_LOTS}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  disabled={loading}
                  className="w-32 rounded-lg border border-gray-300 px-4 py-3"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="split-weights" className="mb-2 block text-sm font-medium">Lot weights (lbs), separated by commas</label>
                <input
                  id="split-weights"
                  type="text"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder="200, 150, 150"
                  disabled={loading}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                />
                {total && customParts.length ? (
                  <p className={`mt-1 text-xs ${sum === total ? "text-green-700" : "text-amber-700"}`}>
                    {sum} of {total} lbs
                  </p>
                ) : null}
              </div>
            )}

            {name && weights.length >= 2 && (
              <div className="rounded-xl bg-ivory p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">New lots</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {weights.map((w, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="break-all font-mono">{lotName(name, i + 1)}</span>
                      <span className="shrink-0 whitespace-nowrap text-gray-600">{Number.isFinite(w) ? w : "?"} lbs</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={split}
              disabled={loading || !name}
              className="rounded-lg bg-green-900 px-5 py-3 text-white disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <Scissors size={18} />
                {loading ? "Splitting..." : "Split into lots"}
              </span>
            </button>

            {status && <p className="text-sm text-green-800" role="status">{status}</p>}
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
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
          </section>
        </div>
      )}
    </div>
  );
}
