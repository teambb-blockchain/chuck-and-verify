import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, isAddress, id, ZeroAddress } from "ethers";
import { provider } from "./lib/blockchain";
import { ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

const CHAIN_ID = 252501;
const CHAIN_ROLES = ["PROCESSOR", "INSPECTOR", "CUSTODIAN"];
const REGISTRY_ABI = [
  "function isValid(address account, bytes32 credentialType) view returns (bool)",
  "function issuerOf(bytes32 credentialType) view returns (address)",
  "function admin() view returns (address)",
  "function grant(address account, bytes32 credentialType, uint256 expiresAt)",
  "function revoke(address account, bytes32 credentialType)",
  "function setIssuer(bytes32 credentialType, address issuer)"
];
const REGISTRY_ADDRESS = import.meta.env.VITE_CREDENTIAL_REGISTRY_ADDRESS || "";
const cls = "rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm";
const btn = "rounded-xl bg-forest px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export default function AdminPanel({ portalUser, dashboardData, walletAddress }) {
  const roles = dashboardData?.roles || portalUser?.roles || [];
  const isAdmin = roles.includes("ADMIN");
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [form, setForm] = useState({ address: "", label: "", organization: "", roles: [] });
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentialStatus, setCredentialStatus] = useState({});
  const [issuerStatus, setIssuerStatus] = useState({});
  const [txLog, setTxLog] = useState([]);
  const [selectedIssuerRole, setSelectedIssuerRole] = useState("PROCESSOR");
  const [newIssuerAddress, setNewIssuerAddress] = useState("");
  const [issuerBusy, setIssuerBusy] = useState(false);

  const registry = isAddress(REGISTRY_ADDRESS) ? new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider) : null;

async function updateIssuer() {
  setError("");
  setMessage("");

  if (!registry) {
    setError("Credential registry is not configured.");
    return;
  }

  if (!isAddress(newIssuerAddress) || newIssuerAddress === ZeroAddress) {
    setError("Enter a valid, nonzero Ethereum wallet address.");
    return;
  }

  if (!window.ethereum) {
    setError("MetaMask is required.");
    return;
  }

  setIssuerBusy(true);

  try {
    const browserProvider = new BrowserProvider(window.ethereum);
    const network = await browserProvider.getNetwork();

    if (Number(network.chainId) !== CHAIN_ID) {
      throw new Error("Switch MetaMask to the DIDLab network.");
    }

    const signer = await browserProvider.getSigner();
    const signerAddress = await signer.getAddress();
    const registryAdmin = await registry.admin();

    if (signerAddress.toLowerCase() !== registryAdmin.toLowerCase()) {
      throw new Error("Only the registry administrator can change issuers.");
    }

    const currentIssuer = await registry.issuerOf(id(selectedIssuerRole));

    if (currentIssuer.toLowerCase() === newIssuerAddress.toLowerCase()) {
      setMessage("This wallet is already the issuer for this role.");
      return;
    }

    const confirmed = window.confirm(
      `Change the ${selectedIssuerRole} issuer from ${currentIssuer} to ${newIssuerAddress}? This will change who can grant and revoke credentials.`
    );

    if (!confirmed) return;

    const writableRegistry = registry.connect(signer);
    const tx = await writableRegistry.setIssuer(
      id(selectedIssuerRole),
      newIssuerAddress
    );

    setMessage(`Transaction submitted: ${tx.hash}`);
    await tx.wait();

    const updatedIssuer = await registry.issuerOf(id(selectedIssuerRole));

    if (updatedIssuer.toLowerCase() !== newIssuerAddress.toLowerCase()) {
      throw new Error("Transaction completed, but issuer verification failed.");
    }

    setIssuerStatus(previous => ({
      ...previous,
      [selectedIssuerRole]: updatedIssuer
    }));

    setNewIssuerAddress("");
    setMessage(`${selectedIssuerRole} issuer updated successfully.`);
  } catch (e) {
    setError(e.shortMessage || e.message || "Issuer update failed.");
  } finally {
    setIssuerBusy(false);
  }
}

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError("");
    try {
      const [u, r] = await Promise.all([api("/api/admin/users"), api("/api/admin/requests")]);
      setUsers(u.users || []);
      setCatalog(u.roles || []);
      setOrganizations(u.organizations || []);
      setRequests(r.requests || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    if (!registry || !isAdmin) return;
    (async () => {
      try {
        const entries = await Promise.all(CHAIN_ROLES.map(async role => [role, await registry.issuerOf(id(role))]));
        if (active) setIssuerStatus(Object.fromEntries(entries));
      } catch (e) { if (active) setError(`Could not read credential issuers: ${e.shortMessage || e.message}`); }
    })();
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    let active = true;
    if (!registry || !isAdmin || !users.length) return;
    (async () => {
      const pairs = users.flatMap(u => CHAIN_ROLES.map(role => ({ address: u.address, role })));
      const results = await Promise.all(pairs.map(async p => {
        try { return Boolean(await registry.isValid(p.address, id(p.role))); }
        catch { return null; }
      }));
      if (active) setCredentialStatus(Object.fromEntries(pairs.map((p, i) => [`${p.address.toLowerCase()}:${p.role}`, results[i]])));
    })();
    return () => { active = false; };
  }, [users, isAdmin]);

  function editUser(u) {
    setForm({ address: u.address, label: u.label || "", organization: u.organization || "", roles: [...(u.roles || [])] });
    setMessage(""); setError(""); setTxLog([]);
  }
  function selectRequest(r) {
    setForm({ address: r.address, label: "", organization: r.organization || "", roles: [...(r.roles || [])] });
    setMessage(`Review the requested roles for ${r.address}, then select Save & Sync.`);
    setError(""); setTxLog([]);
  }
  function changeOrg(value) {
    const org = organizations.find(o => o.key === value);
    setForm(f => ({ ...f, organization: value, roles: org ? [...new Set([...f.roles, org.role])] : f.roles }));
  }
  async function save(event) {
    event.preventDefault();
    if (!isAdmin || busy) return;
    if (!isAddress(form.address)) { setError("Enter a valid Ethereum wallet address."); return; }
    if (form.organization) {
      const org = organizations.find(o => o.key === form.organization);
      if (!org || !form.roles.includes(org.role)) { setError("Selected organization requires its matching role."); return; }
    }
    if (walletAddress?.toLowerCase() === form.address.toLowerCase() && !form.roles.includes("ADMIN")) {
      setError("You cannot remove your own ADMIN role."); return;
    }
    setBusy(true); setError(""); setMessage(""); setTxLog([]);
    try {
      const data = await api(`/api/admin/users/${encodeURIComponent(form.address)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: form.label.trim(), roles: form.roles, organization: form.organization })
      });
      setUsers(data.users || []);
      setMessage("Portal roles saved. Checking on-chain credentials…");
      await refresh();
      if (!registry) {
        setMessage("Portal roles saved, but blockchain credentials NOT checked or updated. Configure VITE_CREDENTIAL_REGISTRY_ADDRESS first.");
        return;
      }
      const changes = [];
      for (const role of CHAIN_ROLES) {
        const valid = await registry.isValid(form.address, id(role));
        const want = form.roles.includes(role);
        if (want !== valid) changes.push({ role, action: want ? "grant" : "revoke" });
      }
      if (!changes.length) { setMessage("Portal roles saved. On-chain credentials already match."); return; }
      if (!window.ethereum) { setMessage("Portal roles saved, but MetaMask is required to sync on-chain credentials."); return; }
      const walletProvider = new BrowserProvider(window.ethereum);
      const network = await walletProvider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) { setMessage("Portal roles saved. Switch MetaMask to DIDLab, then save again to sync credentials."); return; }
      const signer = await walletProvider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== walletAddress?.toLowerCase()) {
        setMessage("Portal roles saved. Wallet changed; reconnect and sign in again before syncing."); return;
      }
      const writeRegistry = registry.connect(signer);
      const latestBlock = await provider.getBlock("latest");
      const expiry = BigInt(latestBlock.timestamp) + BigInt(Math.max(1, Math.floor(Number(days) || 30))) * 86400n;
      let completed = 0;
      for (const change of changes) {
        try {
          const issuer = await registry.issuerOf(id(change.role));
          if (issuer === ZeroAddress || issuer.toLowerCase() !== signerAddress.toLowerCase()) {
            setTxLog(log => [...log, `${change.role}: not updated — issuer must be ${issuer}`]);
            continue;
          }
          const tx = change.action === "grant"
            ? await writeRegistry.grant(form.address, id(change.role), expiry)
            : await writeRegistry.revoke(form.address, id(change.role));
          setTxLog(log => [...log, `${change.role}: ${change.action} submitted — ${tx.hash}`]);
          const receipt = await tx.wait(1);
          if (receipt?.status === 1) { completed++; setTxLog(log => [...log, `${change.role}: ${change.action} confirmed`]); }
          else setTxLog(log => [...log, `${change.role}: transaction reverted`]);
        } catch (e) { setTxLog(log => [...log, `${change.role}: ${e.shortMessage || e.message}`]); }
      }
      setMessage(`Portal roles saved. ${completed} of ${changes.length} blockchain changes confirmed. Check the transaction log before considering the user fully authorized.`);
      await refresh();
    } catch (e) { setError(e.shortMessage || e.message); }
    finally { setBusy(false); }
  }
  async function dismissRequest(address) {
    if (!window.confirm(`Dismiss the access request from ${address}?`)) return;
    setBusy(true); setError("");
    try { await api(`/api/admin/requests/${encodeURIComponent(address)}`, { method: "DELETE" }); await refresh(); setMessage("Access request dismissed. No roles were granted."); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!portalUser?.address) return <div className="rounded-2xl border bg-white p-6">Connect MetaMask and sign in to manage users.</div>;
  if (!isAdmin) return <div className="rounded-2xl border bg-white p-6"><h3 className="font-bold text-forest">Administrator access required</h3><p className="mt-2 text-sm text-stone-600">Only wallets with the ADMIN portal role can manage users. You cannot request ADMIN through the normal access form.</p></div>;
  return <div className="space-y-6">
    <section className="rounded-2xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-lg font-bold text-forest"><ShieldCheck size={21}/> Users & Roles</h3><p className="mt-1 text-sm text-stone-500">Review access requests, manage portal roles, and synchronize DIDLab credentials.</p></div><button className={btn} disabled={loading || busy} onClick={refresh}><RefreshCw size={15} className="mr-2 inline"/>Refresh</button></div>
      {!registry && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle size={16} className="mr-2 inline"/>Credential registry address not configured. Portal changes can be saved, but blockchain permissions cannot be checked or changed.</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    </section>
    <section className="rounded-2xl border border-stone-200 bg-white p-6"><h3 className="font-bold">Pending access requests ({requests.length})</h3>
      {loading ? <p className="mt-3 text-sm text-stone-500">Loading…</p> : !requests.length ? <p className="mt-3 text-sm text-stone-500">No pending requests.</p> : <div className="mt-4 space-y-3">{requests.map(r => <div key={r.address} className="rounded-xl border border-stone-200 p-4"><p className="break-all text-sm font-semibold">{r.address}</p><p className="mt-1 text-sm text-stone-600">{organizations.find(o => o.key === r.organization)?.name || r.organization || "No organization"} · {(r.roles || []).join(", ")}</p>{r.note && <p className="mt-2 text-sm text-stone-500">{r.note}</p>}<div className="mt-3 flex gap-2"><button className={btn} disabled={busy} onClick={() => selectRequest(r)}>Review for approval</button><button className={cls} disabled={busy} onClick={() => dismissRequest(r.address)}>Dismiss</button></div></div>)}</div>}
    </section>
    <section className="rounded-2xl border border-stone-200 bg-white p-6"><h3 className="font-bold">Assign or edit user roles</h3><p className="mt-1 text-sm text-stone-500">Saving updates the portal first. Blockchain credentials require separate MetaMask confirmations.</p>
      <form onSubmit={save} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm">Wallet address<input required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="0x…" className={`mt-1 w-full ${cls}`}/></label>
        <label className="text-sm">Display label<input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} className={`mt-1 w-full ${cls}`}/></label>
        <label className="text-sm">Organization<select value={form.organization} onChange={e => changeOrg(e.target.value)} className={`mt-1 w-full ${cls}`}><option value="">Not set</option>{organizations.map(o => <option key={o.key} value={o.key}>{o.name} ({o.role})</option>)}</select></label>
        <label className="text-sm">Credential validity (days)<input type="number" min="1" max="3650" value={days} onChange={e => setDays(e.target.value)} className={`mt-1 w-full ${cls}`}/></label>
        <div className="md:col-span-2"><p className="mb-2 text-sm font-medium">Portal roles</p><div className="flex flex-wrap gap-4">{catalog.map(role => <label key={role.name} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.roles.includes(role.name)} onChange={e => setForm(f => ({ ...f, roles: e.target.checked ? [...f.roles, role.name] : f.roles.filter(r => r !== role.name) }))}/>{role.name}{CHAIN_ROLES.includes(role.name) && <span className="text-xs text-stone-500">(on-chain)</span>}</label>)}</div></div>
        <div className="md:col-span-2"><button className={btn} type="submit" disabled={busy || !isAddress(form.address)}>{busy ? "Saving / waiting for wallet…" : "Save roles & sync credentials"}</button></div>
      </form>
      {txLog.length > 0 && <div className="mt-4 rounded-xl bg-stone-50 p-4"><h4 className="text-sm font-semibold">Blockchain transaction log</h4>{txLog.map((line, i) => <p key={i} className="mt-2 break-all text-xs text-stone-700">{line}</p>)}</div>}
    </section>
    <section className="rounded-2xl border border-stone-200 bg-white p-6"><h3 className="font-bold">Registered portal users ({users.length})</h3><div className="mt-4 space-y-3">{users.map(u => <div key={u.address} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 p-4"><div className="min-w-0"><p className="break-all text-sm font-medium">{u.address}</p><p className="mt-1 text-xs text-stone-500">{u.label || "No label"} · {organizations.find(o => o.key === u.organization)?.name || u.organization || "No organization"}</p><div className="mt-2 flex flex-wrap gap-2">{(u.roles || []).map(role => { const status = credentialStatus[`${u.address.toLowerCase()}:${role}`]; return <span key={role} className={`rounded-full px-2 py-1 text-xs ${status === false ? "bg-amber-100 text-amber-900" : "bg-green-50 text-green-800"}`}>{role}{CHAIN_ROLES.includes(role) ? status === true ? " · chain valid" : status === false ? " · chain missing" : " · chain unverified" : " · portal only"}</span>; })}</div></div><button className={cls} onClick={() => editUser(u)}>Edit</button></div>)}{!users.length && <p className="text-sm text-stone-500">No portal users found.</p>}</div></section>
    
{registry && (
  <section className="rounded-2xl border border-stone-200 bg-white p-6">
    <h3 className="font-bold">Credential Issuers</h3>
    <p className="mt-1 text-sm text-stone-500">
      Manage which wallet can grant or revoke credentials for each role.
      Only the blockchain registry administrator can change issuers.
    </p>

    <div className="mt-4 space-y-2">
      {CHAIN_ROLES.map(role => (
        <p key={role} className="break-all text-xs">
          <strong>{role}:</strong>{" "}
          {issuerStatus[role] || "Checking..."}
        </p>
      ))}
    </div>

    <div className="mt-6 space-y-3 border-t border-stone-200 pt-4">
      <h4 className="text-sm font-semibold">Change Credential Issuer</h4>

      <select
        className={cls}
        value={selectedIssuerRole}
        onChange={e => setSelectedIssuerRole(e.target.value)}
        disabled={issuerBusy}
      >
        {CHAIN_ROLES.map(role => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>

      <input
        className={`${cls} w-full`}
        type="text"
        placeholder="New issuer wallet address (0x...)"
        value={newIssuerAddress}
        onChange={e => setNewIssuerAddress(e.target.value)}
        disabled={issuerBusy}
      />

      <button
        type="button"
        className={btn}
        onClick={updateIssuer}
        disabled={issuerBusy || !isAddress(newIssuerAddress)}
      >
        {issuerBusy ? "Updating Issuer..." : "Set Issuer"}
      </button>

      <p className="text-xs text-amber-700">
        Warning: Changing an issuer immediately changes which wallet
        is authorized to grant or revoke credentials for that role.
      </p>
    </div>
  </section>
)}

  </div>;
}
