import { useState } from "react";
import { ethers } from "ethers";
import {
  Search, ShieldCheck, Package, Truck, ClipboardCheck,
  AlertTriangle, ExternalLink, Loader2
} from "lucide-react";

const RPC = "https://eth.didlab.org";
const CONTRACT = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";

const ABI = [
  "function getBatch(bytes32) view returns (address,uint256,address,address,bool,bool,bytes32,bool,bytes32,uint8)"
];

const provider = new ethers.JsonRpcProvider(RPC);
const DEPLOY_BLOCK = 7384345;


const EVENT_ABI = [
  "event BatchRegistered(bytes32 indexed batchId, address indexed processor, uint256 weightLbs)",
  "event InspectionRecorded(bytes32 indexed batchId, address indexed inspector, bytes32 reportHash, bool passed)",
  "event ShipmentRecorded(bytes32 indexed batchId, address indexed from, address indexed to)",
  "event ReceiptConfirmed(bytes32 indexed batchId, address indexed receiver)",
  "event RecallRecorded(bytes32 indexed batchId, address indexed by, bytes32 noticeHash, uint8 classification)",
  "event LotCreated(bytes32 indexed parentId, bytes32 indexed lotId, address indexed holder, uint256 weightLbs)"
];


async function fetchBatchHistory(batchId) {
  const contract = new ethers.Contract(CONTRACT, EVENT_ABI, provider);
  const idHex = ethers.encodeBytes32String(batchId);
  const latest = await provider.getBlockNumber();

  const events = [];
  const chunkSize = 2000;

  for (let from = DEPLOY_BLOCK; from <= latest; from += chunkSize) {
    const to = Math.min(from + chunkSize - 1, latest);

    const logs = await provider.getLogs({
      address: CONTRACT,
      fromBlock: from,
      toBlock: to,
      topics: [null, idHex]
    });

    for (const log of logs) {
      let eventName = "Blockchain Event";

      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed) eventName = parsed.name;
      } catch {
        // Other events will be displayed with their transaction proof.
      }

      events.push({
        name: eventName,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.index
      });
    }
  }

  return events.sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
  );
}

export default function VerifyProduct() {
  const [batchId, setBatchId] = useState("DEMO-BEEF-1112-01");
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState("");

  async function verify() {
    setLoading(true);
    setError("");
    setRecord(null);
    setHistory([]);
    setHistoryError("");

    try {
      const id = batchId.trim();

      if (!id || ethers.toUtf8Bytes(id).length > 32) {
        throw new Error("Enter a valid batch ID (maximum 32 bytes).");
      }

      const contract = new ethers.Contract(CONTRACT, ABI, provider);
      const raw = await contract.getBatch(ethers.encodeBytes32String(id));

      setRecord({
        id,
        processor: raw[0],
        weight: raw[1].toString(),
        holder: raw[2],
        pendingReceiver: raw[3],
        inspected: raw[4],
        inspectionPassed: raw[5],
        recalled: raw[7]
      });
      try {
  const events = await fetchBatchHistory(id);
  setHistory(events);
} catch (historyErr) {
  setHistoryError(
    historyErr.shortMessage ||
    historyErr.message ||
    "Unable to retrieve event history."
  );
}
    } catch (err) {
      setError(err.shortMessage || err.reason || err.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  const status = record?.recalled
    ? "Recalled"
    : record?.inspected
      ? record.inspectionPassed ? "Inspection passed" : "Inspection failed"
      : "Awaiting inspection";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Verify Product</h1>
        <p className="text-slate-500 mt-2">
          Verify beef supply chain records directly on the DIDLab blockchain.
        </p>
      </div>

      <div className="bg-white rounded-2xl border p-6 shadow-sm">
        <label className="block font-semibold mb-3">Batch or Lot ID</label>

        <form onSubmit={(e) => { e.preventDefault(); verify(); }}
              className="flex gap-3">
          <input
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            placeholder="Enter batch ID"
            className="flex-1 border rounded-xl px-4 py-3 text-slate-900"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-700 text-white rounded-xl px-6 py-3 flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={18}/> : <Search size={18}/>}
            Verify
          </button>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">
          <AlertTriangle className="inline mr-2" size={18}/>
          {error}
        </div>
      )}

      {record && (
        <>
          <div className="bg-white border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <ShieldCheck className="text-blue-700" size={30}/>
              <div>
                <h2 className="text-2xl font-bold">{record.id}</h2>
                <p className="text-slate-500">Verified blockchain record</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Info icon={<Package/>} label="Registered Weight" value={`${record.weight} lbs`}/>
              <Info icon={<ClipboardCheck/>} label="Inspection Status" value={status}/>
              <Info icon={<Truck/>} label="Recall Status" value={record.recalled ? "Recalled" : "Not recalled"}/>
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-xl font-bold">Chain of Custody</h3>
            <Info label="Processor Wallet" value={record.processor}/>
            <Info label="Current Holder" value={record.holder}/>
            <Info
              label="Pending Receiver"
              value={record.pendingReceiver === ethers.ZeroAddress
                ? "No pending transfer" : record.pendingReceiver}
            />
            <div className="mt-6 border-t pt-5">
  <h4 className="font-bold mb-4">Blockchain Event Timeline</h4>

  {historyError && (
    <p className="text-red-600 text-sm">{historyError}</p>
  )}

  {!historyError && history.length === 0 && (
    <p className="text-slate-500 text-sm">
      No events were returned for this batch.
    </p>
  )}

  <div className="space-y-4">
    {history.map((event) => (
      <div
        key={`${event.txHash}-${event.logIndex}`}
        className="border-l-4 border-blue-600 pl-4 py-2"
      >
        <p className="font-semibold">{event.name}</p>

        <p className="text-sm text-slate-500">
          Block #{event.blockNumber.toLocaleString()}
        </p>

        <a
          href={`${EXPLORER}/tx/${event.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 text-sm break-all"
        >
          View transaction: {event.txHash}
        </a>
      </div>
    ))}
  </div>
</div>
          </div>

          <div className="bg-white border rounded-2xl p-6 shadow-sm">
            <h3 className="text-xl font-bold mb-3">Blockchain Proof</h3>
            <p className="text-slate-500 mb-3">
              Record retrieved from DIDLab chain 252501.
            </p>
            <a
              href={`${EXPLORER}/address/${CONTRACT}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 flex items-center gap-2"
            >
              View Smart Contract <ExternalLink size={16}/>
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function Info({ icon, label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 min-w-0">
      <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
        {icon}{label}
      </div>
      <p className="font-semibold text-slate-900 break-all">{value}</p>
    </div>
  );
}
