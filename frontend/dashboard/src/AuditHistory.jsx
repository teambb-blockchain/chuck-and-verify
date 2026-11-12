
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { RefreshCw, ExternalLink, History } from "lucide-react";
import { provider } from "./lib/blockchain";

const CONTRACT = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
const EXPLORER = "https://explorer.didlab.org";
const DEPLOY_BLOCK = 7384345;

const EVENT_ABI = [
  "event BatchRegistered(bytes32 indexed batchId, address indexed processor, uint256 weightLbs)",
  "event InspectionRecorded(bytes32 indexed batchId, address indexed inspector, bytes32 reportHash, bool passed)",
  "event ShipmentRecorded(bytes32 indexed batchId, address indexed from, address indexed to)",
  "event ReceiptConfirmed(bytes32 indexed batchId, address indexed receiver)",
  "event RecallRecorded(bytes32 indexed batchId, address indexed by, bytes32 noticeHash, uint8 classification)",
  "event LotCreated(bytes32 indexed parentId, bytes32 indexed lotId, address indexed holder, uint256 weightLbs)"
];

const iface = new ethers.Interface(EVENT_ABI);

function decodeId(value) {
  try {
    return ethers.decodeBytes32String(value);
  } catch {
    return String(value);
  }
}

function getActor(parsed) {
  const names = ["processor", "inspector", "from", "receiver", "by", "holder"];
  for (const name of names) {
    if (parsed.args[name]) return parsed.args[name];
  }
  return "Unknown";
}

async function loadAuditEvents() {
  const latest = await provider.getBlockNumber();
  const events = [];
  const chunkSize = 2000;

  for (let from = DEPLOY_BLOCK; from <= latest; from += chunkSize) {
    const to = Math.min(from + chunkSize - 1, latest);

    const logs = await provider.getLogs({
      address: CONTRACT,
      fromBlock: from,
      toBlock: to
    });

    for (const log of logs) {
      try {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;

        const batchId = parsed.name === "LotCreated"
          ? decodeId(parsed.args.parentId)
          : decodeId(parsed.args.batchId);

        events.push({
          id: `${log.transactionHash}-${log.index}`,
          type: parsed.name,
          batchId,
          actor: getActor(parsed),
          block: log.blockNumber,
          txHash: log.transactionHash,
          logIndex: log.index
        });
      } catch {
        // Ignore unrelated contract events.
      }
    }
  }

  return events.sort(
    (a, b) => b.block - a.block || b.logIndex - a.logIndex
  );
}

export default function AuditHistory() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");

    try {
      setEvents(await loadAuditEvents());
    } catch (err) {
      setError(err.shortMessage || err.message || "Unable to load audit history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <History size={22} />
            Blockchain Audit History
          </h3>
          <p className="mt-2 text-sm text-stone-500">
            Verified supply-chain events recorded on DIDLab.
          </p>
        </div>

        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <RefreshCw size={16} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-stone-50 text-stone-600">
            <tr>
              <th className="p-3">Event</th>
              <th className="p-3">Batch ID</th>
              <th className="p-3">Performed By</th>
              <th className="p-3">Block</th>
              <th className="p-3">Transaction</th>
            </tr>
          </thead>

          <tbody>
            {events.map(event => (
              <tr key={event.id} className="border-b border-stone-100">
                <td className="p-3 font-semibold">{event.type}</td>
                <td className="p-3">{event.batchId}</td>
                <td className="p-3 font-mono text-xs">
                  {event.actor.slice(0, 8)}...
                  {event.actor.slice(-6)}
                </td>
                <td className="p-3">{event.block}</td>
                <td className="p-3">
                  <a
                    href={`${EXPLORER}/tx/${event.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-forest underline"
                  >
                    View <ExternalLink size={13} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && !error && events.length === 0 && (
          <p className="p-5 text-center text-sm text-stone-500">
            No blockchain events found.
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-stone-500">
        Showing {events.length} blockchain events. Data is read directly
        from the DIDLab network.
      </p>
    </section>
  );
}
