import { BrowserProvider } from "ethers";
import { useEffect, useRef, useState } from "react";
import { provider } from "./lib/blockchain";
import AdminPanel from "./AdminPanel";
import BatchRegistration from "./BatchRegistration";
import VerifyProduct from "./VerifyProduct";
import Inspections from "./Inspections";
import Shipments from "./Shipments";
import Recalls from "./Recalls";
import {
  LayoutDashboard, Package, ClipboardCheck, Truck, ShieldAlert,
  ScanLine, Users, History, ShieldCheck, Wallet, Menu, Activity,
  ArrowRight, LogOut, RefreshCw,
} from "lucide-react";

const CHAIN_ID = 252501;
const CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;
const ORGANIZATIONS = [
  { value: "processor", label: "Beef processor", role: "PROCESSOR" },
  { value: "fsis", label: "USDA FSIS inspector", role: "INSPECTOR" },
  { value: "storage", label: "Storage facility", role: "CUSTODIAN" },
  { value: "distributor", label: "Distributor", role: "CUSTODIAN" },
  { value: "carrier", label: "Carrier", role: "CUSTODIAN" },
  { value: "retailer", label: "Retailer", role: "CUSTODIAN" },
  { value: "restaurant", label: "Restaurant", role: "CUSTODIAN" },
];
const navigation = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Batches", icon: Package },
  { name: "Inspections", icon: ClipboardCheck },
  { name: "Shipments", icon: Truck },
  { name: "Recalls", icon: ShieldAlert },
  { name: "Verify Product", icon: ScanLine },
  { name: "Users & Roles", icon: Users },
  { name: "Audit History", icon: History },
];

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function MetricCard({ title, value, icon: Icon, color, subtitle }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">{title}</p>
        <Icon className={color} size={22} />
      </div>
      <p className="mt-5 text-3xl font-bold">{value ?? "â€”"}</p>
      <p className="mt-2 text-xs text-stone-400">{subtitle}</p>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [networkStatus, setNetworkStatus] = useState("Connecting...");
  const [latestBlock, setLatestBlock] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletError, setWalletError] = useState("");
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [portalUser, setPortalUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState(null);
  const [organization, setOrganization] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const [requestError, setRequestError] = useState("");
  const sessionVersion = useRef(0);
  const sessionBusyRef = useRef(false);

  useEffect(() => {
    let active = true;
    async function updateNetwork() {
      try {
        const network = await provider.getNetwork();
        if (Number(network.chainId) !== CHAIN_ID) throw new Error("Unexpected network");
        const block = await provider.getBlockNumber();
        if (active) {
          setLatestBlock(block);
          setNetworkStatus("Connected");
        }
      } catch (error) {
        console.error("DIDLab connection failed:", error);
        if (active) setNetworkStatus("Disconnected");
      }
    }
    updateNetwork();
    const interval = setInterval(updateNetwork, 10000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    async function handleWalletChange() {
      sessionVersion.current += 1;
      sessionBusyRef.current = true;
      setSessionBusy(true);
      setPortalUser(null);
      setDashboardData(null);
      setWalletAddress(null);
      setRequestMessage("");
      setRequestError("");
      setWalletError("Wallet changed. Connect and sign in again.");
      try {
        await apiRequest("/api/auth/logout", { method: "POST" });
      } catch (error) {
        setWalletError(`Session logout failed: ${error.message}. Reload before signing in.`);
      } finally {
        sessionBusyRef.current = false;
        setSessionBusy(false);
      }
    }
    window.ethereum.on("accountsChanged", handleWalletChange);
    window.ethereum.on("chainChanged", handleWalletChange);
    return () => {
      window.ethereum.removeListener("accountsChanged", handleWalletChange);
      window.ethereum.removeListener("chainChanged", handleWalletChange);
    };
  }, []);

  useEffect(() => {
    if (!portalUser?.address) {
      setDashboardData(null);
      setDashboardError("");
      setDashboardUpdatedAt(null);
      setDashboardLoading(false);
      return;
    }
    let active = true;
    let inProgress = false;
    const controller = new AbortController();
    async function loadDashboard() {
      if (inProgress) return;
      inProgress = true;
      try {
        setDashboardLoading(true);
        const data = await apiRequest("/api/dashboard", { signal: controller.signal });
        if (active) {
          setDashboardData(data);
          setDashboardError("");
          setDashboardUpdatedAt(new Date());
        }
      } catch (error) {
        if (active && error.name !== "AbortError") setDashboardError(error.message);
      } finally {
        inProgress = false;
        if (active) setDashboardLoading(false);
      }
    }
    loadDashboard();
    const interval = setInterval(loadDashboard, 15000);
    return () => { active = false; clearInterval(interval); controller.abort(); };
  }, [portalUser?.address]);

  // Restore the form fields from the user's pending request, if present.
  useEffect(() => {
    const request = dashboardData?.request;
    if (!request) return;
    if (typeof request.organization === "string") setOrganization(request.organization);
    if (typeof request.note === "string") setRequestNote(request.note);
  }, [dashboardData?.request?.organization, dashboardData?.request?.note]);

  async function connectWallet() {
    if (!window.ethereum) { setWalletError("MetaMask is not installed."); return; }
    if (sessionBusyRef.current) { setWalletError("Wait for the previous session to close."); return; }
    setWalletConnecting(true);
    setWalletError("");
    try {
      const walletProvider = new BrowserProvider(window.ethereum);
      await walletProvider.send("eth_requestAccounts", []);
      const network = await walletProvider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
        } catch (error) {
          if (error.code !== 4902) throw error;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: CHAIN_HEX, chainName: "DIDLab", rpcUrls: ["https://eth.didlab.org"], nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 } }],
          });
        }
      }
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      setWalletAddress(await signer.getAddress());
    } catch (error) {
      console.error(error);
      setWalletError(error.message || "Wallet connection failed.");
    } finally { setWalletConnecting(false); }
  }

  async function signInToPortal() {
    if (!window.ethereum || !walletAddress) { setWalletError("Connect MetaMask first."); return; }
    if (sessionBusyRef.current || signingIn) return;
    setSigningIn(true);
    setWalletError("");
    const version = sessionVersion.current;
    try {
      const walletProvider = new BrowserProvider(window.ethereum);
      const network = await walletProvider.getNetwork();
      if (Number(network.chainId) !== CHAIN_ID) throw new Error("Switch MetaMask to DIDLab.");
      const signer = await walletProvider.getSigner();
      const address = await signer.getAddress();
      if (address.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("Wallet changed. Reconnect.");
      const challenge = await apiRequest("/api/auth/challenge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }),
      });
      const signature = await signer.signMessage(challenge.message);
      if (version !== sessionVersion.current) return;
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (!accounts[0] || accounts[0].toLowerCase() !== address.toLowerCase()) throw new Error("Wallet changed during sign-in.");
      const user = await apiRequest("/api/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, signature }),
      });
      if (version !== sessionVersion.current) { await apiRequest("/api/auth/logout", { method: "POST" }); return; }
      if (user.address?.toLowerCase() !== address.toLowerCase()) throw new Error("Authenticated wallet mismatch.");
      setPortalUser(user);
    } catch (error) {
      console.error("Portal sign-in failed:", error);
      setWalletError(error.message || "Unable to sign in.");
    } finally { setSigningIn(false); }
  }

  async function logoutPortal() {
    if (sessionBusyRef.current) return;
    sessionVersion.current += 1;
    sessionBusyRef.current = true;
    setSessionBusy(true);
    setPortalUser(null);
    setDashboardData(null);
    setRequestMessage("");
    setRequestError("");
    setWalletError("");
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch (error) {
      setWalletError(`Logout failed: ${error.message}. Reload before signing in.`);
    } finally {
      sessionBusyRef.current = false;
      setSessionBusy(false);
    }
  }

  async function submitAccessRequest(event) {
    event.preventDefault();
    if (!organization || !portalUser?.address || requestBusy) return;
    setRequestBusy(true);
    setRequestError("");
    setRequestMessage("");
    try {
      const role = ORGANIZATIONS.find((item) => item.value === organization)?.role;
      if (!role) throw new Error("Select an organization type.");
      const result = await apiRequest("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization, roles: [role], note: requestNote.trim() }),
      });
      setDashboardData((previous) => previous ? { ...previous, request: result.request } : previous);
      setRequestMessage("Your access request has been saved. An administrator must review it.");
    } catch (error) { setRequestError(error.message); }
    finally { setRequestBusy(false); }
  }

  async function cancelAccessRequest() {
    if (!portalUser?.address || requestBusy) return;
    if (!window.confirm("Cancel your pending access request?")) return;
    setRequestBusy(true);
    setRequestError("");
    setRequestMessage("");
    try {
      await apiRequest("/api/access-request", { method: "DELETE" });
      setDashboardData((previous) => previous ? { ...previous, request: null } : previous);
      setOrganization("");
      setRequestNote("");
      setRequestMessage("Your access request was cancelled.");
    } catch (error) { setRequestError(error.message); }
    finally { setRequestBusy(false); }
  }

  const views = dashboardData?.views || {};
  const processor = views.PROCESSOR;
  const inspector = views.INSPECTOR;
  const custodian = views.CUSTODIAN;
  const admin = views.ADMIN;
  const roleMetrics = [
    ...(processor ? [
      { title: "Registered Batches", value: processor.registered, icon: Package, color: "text-forest" },
      { title: "Batches in Custody", value: processor.inCustody, icon: Truck, color: "text-harvest" },
      { title: "Recalled Batches", value: processor.recalled, icon: ShieldAlert, color: "text-beef" },
    ] : []),
    ...(inspector ? [
      { title: "Completed Inspections", value: inspector.inspected, icon: ClipboardCheck, color: "text-green-700" },
      { title: "Pending Inspections", value: inspector.waiting, icon: History, color: "text-harvest" },
    ] : []),
    ...(custodian ? [
      { title: "Products in Custody", value: custodian.inCustody, icon: Package, color: "text-forest" },
      { title: "Incoming Shipments", value: custodian.incoming, icon: Truck, color: "text-harvest" },
      { title: "Recalled in Custody", value: custodian.recalledInCustody, icon: ShieldAlert, color: "text-beef" },
    ] : []),
    ...(admin ? [
      { title: "Portal Users", value: admin.users, icon: Users, color: "text-forest" },
      { title: "Access Requests", value: admin.requests, icon: ShieldCheck, color: "text-harvest" },
    ] : []),
  ];
  const displayMetrics = roleMetrics.length ? roleMetrics : [
    { title: "Registered Batches", icon: Package, color: "text-forest" },
    { title: "Verified Inspections", icon: ShieldCheck, color: "text-green-700" },
    { title: "Active Shipments", icon: Truck, color: "text-harvest" },
    { title: "Active Recalls", icon: ShieldAlert, color: "text-beef" },
  ];
  const batchRows = [ ...(processor?.rows || []), ...(inspector?.rows || []), ...(custodian?.rows || []) ];
  const uniqueRows = Array.from(new Map(batchRows.map((item, index) => [item.batchId || `row-${index}`, item])).values());
  const request = dashboardData?.request;
  const needsRole = Boolean(portalUser?.address && dashboardData && !(dashboardData.roles || []).length);
  const selectedRole = ORGANIZATIONS.find((item) => item.value === organization)?.role;

  return (
    <div className="min-h-screen bg-ivory text-slate-navy md:flex">
      {sidebarOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-forest text-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 border-b border-white/10 px-6 py-7">
          <div className="rounded-xl bg-white/10 p-2"><ShieldCheck className="h-7 w-7 text-amber-300" /></div>
          <div><h1 className="text-lg font-bold">Chuck & Verify</h1><p className="text-xs text-white/60">Supply Chain Platform</p></div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-6">
          {navigation.map(({ name, icon: Icon }) => (
            <button key={name} onClick={() => { setActivePage(name); setSidebarOpen(false); }} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${activePage === name ? "bg-white/15 font-semibold text-amber-200" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
              <Icon size={19} />{name}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 p-5"><p className="text-xs text-white/50">Powered by DIDLab</p><p className="mt-1 text-xs text-white/75">Chain ID: {CHAIN_ID}</p></div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <button aria-label="Open navigation" className="rounded-lg p-2 hover:bg-stone-100 md:hidden" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button>
            <div><p className="text-xs text-stone-500">Beef Traceability Network</p><h2 className="text-lg font-bold">{activePage}</h2></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="hidden rounded-full bg-stone-100 px-3 py-2 text-xs text-stone-600 sm:inline-flex">{networkStatus}</span>
            <button type="button" onClick={connectWallet} disabled={walletConnecting || sessionBusy} className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-sm hover:bg-stone-50 disabled:opacity-50">
              <Wallet size={17} /><span>{walletConnecting ? "Connecting..." : walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Connect Wallet"}</span>
            </button>
            {walletAddress && !portalUser?.address && <button type="button" onClick={signInToPortal} disabled={signingIn || sessionBusy} className="rounded-xl bg-forest px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{signingIn ? "Signing in..." : "Sign In"}</button>}
            {portalUser?.address && <>
              <span className="rounded-full bg-green-50 px-3 py-2 text-xs font-medium text-green-700">Signed in{portalUser.roles?.length ? ` Â· ${portalUser.roles.join(", ")}` : " Â· No role assigned"}</span>
              <button type="button" onClick={logoutPortal} disabled={sessionBusy} className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50"><LogOut size={15} />Logout</button>
            </>}
          </div>
        </header>
        {walletError && <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{walletError}</div>}

<div className="mx-auto max-w-7xl space-y-7 p-5 md:p-8">
  {activePage === "Overview" && portalUser?.address && (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-forest">
            Live Portal Dashboard
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            {dashboardData?.organization
              ? `Organization: ${
                  ORGANIZATIONS.find(
                    (o) => o.value === dashboardData.organization
                  )?.label || dashboardData.organization
                }`
              : "Organization not assigned"}
          </p>
        </div>

        <span className="inline-flex items-center gap-2 text-xs text-stone-500">
          <RefreshCw
            size={14}
            className={dashboardLoading ? "animate-spin" : ""}
          />
          {dashboardUpdatedAt
            ? `Updated ${dashboardUpdatedAt.toLocaleTimeString()}`
            : "Not updated yet"}
        </span>
      </div>

      <p className="mt-3 text-sm text-stone-600">
        {dashboardLoading && !dashboardData
          ? "Loading dashboard data..."
          : dashboardError
          ? `Error: ${dashboardError}`
          : dashboardData
          ? "Connected to the portal API · Refreshes every 15 seconds"
          : "Waiting for dashboard data"}
      </p>

      {dashboardData && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(dashboardData.roles || []).map((role) => (
            <span
              key={role}
              className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700"
            >
              {role}
            </span>
          ))}

          {dashboardData.roles?.length === 0 && (
            <p className="text-sm text-amber-700">
              No role assigned. Request access below.
            </p>
          )}
        </div>
      )}
    </section>
  )}


          {activePage === "Overview" && needsRole && <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="text-lg font-bold text-forest">Request Portal Access</h3><p className="mt-1 text-sm text-stone-500">Choose your organization type. Your requested role is selected automatically.</p></div>
              {request && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Request submitted Â· Awaiting review</span>}
            </div>
            {request && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A request is saved for this wallet. You can update it below or cancel it. Approval is handled by an administrator.</p>}
            <form onSubmit={submitAccessRequest} className="mt-5 space-y-4">
              <div><label htmlFor="org-type" className="mb-2 block text-sm font-medium">Organization type</label><select id="org-type" value={organization} onChange={(e) => setOrganization(e.target.value)} required disabled={requestBusy} className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm focus:border-green-700 focus:outline-none"><option value="">Select your organization</option>{ORGANIZATIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              {selectedRole && <p className="text-sm text-stone-600">Requested role: <strong className="text-forest">{selectedRole}</strong></p>}
              <div><label htmlFor="request-note" className="mb-2 block text-sm font-medium">Note for administrator (optional)</label><textarea id="request-note" value={requestNote} onChange={(e) => setRequestNote(e.target.value)} maxLength={280} rows={3} disabled={requestBusy} placeholder="Briefly describe your organization and why you need access." className="w-full rounded-xl border border-stone-300 px-4 py-3 text-sm focus:border-green-700 focus:outline-none" /><p className="mt-1 text-right text-xs text-stone-500">{requestNote.length}/280 characters</p></div>
              {requestError && <p role="alert" className="text-sm text-red-700">{requestError}</p>}
              {requestMessage && <p role="status" className="text-sm text-green-700">{requestMessage}</p>}
              <div className="flex flex-wrap gap-3"><button type="submit" disabled={!organization || requestBusy} className="rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{requestBusy ? "Please wait..." : request ? "Update Request" : "Submit Access Request"}</button>{request && <button type="button" onClick={cancelAccessRequest} disabled={requestBusy} className="rounded-xl border border-red-200 px-5 py-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Cancel Request</button>}</div>
            </form>
          </section>}

          {activePage === "Overview" && (
            <section className="rounded-2xl bg-forest p-7 text-white md:p-9">
            <p className="text-sm font-medium text-amber-200">BLOCKCHAIN-POWERED TRACEABILITY</p>
            <h2 className="mt-3 text-2xl font-bold md:text-3xl">Welcome to Chuck & Verify</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">Track beef batches, verify inspections, monitor custody transfers, and review recalls through a transparent blockchain-backed supply chain.</p>
            <div className="mt-6 inline-flex items-center gap-2 text-sm text-amber-200">DIDLab Network <ArrowRight size={16} /></div>
          </section>
        )}
          {activePage === "Overview" ? <>
            
{custodian && Number(custodian.recalledInCustody) > 0 && (
  <section
    role="alert"
    className="rounded-2xl border-2 border-red-300 bg-red-50 p-6"
  >
    <div className="flex items-start gap-3">
      <ShieldAlert className="mt-1 shrink-0 text-red-700" size={28} />
      <div>
        <h3 className="text-lg font-bold text-red-900">
          Recall Safety Alert
        </h3>
        <p className="mt-2 text-sm text-red-800">
          You currently hold {custodian.recalledInCustody} recalled
          beef batch(es). Stop distribution, isolate the affected
          products, and review their recall records immediately.
        </p>
        <button
          type="button"
          onClick={() => setActivePage("Recalls")}
          className="mt-4 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          View Recalls
        </button>
      </div>
    </div>
  </section>
)}

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{displayMetrics.map(({ title, value, icon, color }) => <MetricCard key={title} title={title} value={value} icon={icon} color={color} subtitle={roleMetrics.length ? "From the portal dashboard API" : "Awaiting authorized role data"} />)}</section>
            <section className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-2xl border border-stone-200 bg-white p-6 lg:col-span-2"><h3 className="text-lg font-bold">Supply Chain Lifecycle</h3><p className="mt-1 text-sm text-stone-500">Follow every stage from registration to verification.</p><div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Register", Package], ["Inspect", ClipboardCheck], ["Ship", Truck], ["Verify", ScanLine]].map(([label, Icon]) => <div key={label} className="rounded-xl bg-ivory p-4 text-center"><Icon className="mx-auto text-forest" size={25} /><p className="mt-3 text-sm font-medium">{label}</p></div>)}</div></div>
              <div className="rounded-2xl border border-stone-200 bg-white p-6"><div className="flex items-center gap-2"><Activity className="text-forest" size={21} /><h3 className="text-lg font-bold">Network Status</h3></div><div className="mt-6 space-y-4 text-sm"><div className="flex justify-between gap-3"><span className="text-stone-500">Network</span><span className="font-medium">DIDLab</span></div><div className="flex justify-between gap-3"><span className="text-stone-500">Chain ID</span><span className="font-medium">{CHAIN_ID}</span></div><div className="flex justify-between gap-3"><span className="text-stone-500">Latest Block</span><span className="font-medium">{latestBlock === null ? "â€”" : latestBlock.toLocaleString()}</span></div><div className="flex justify-between gap-3"><span className="text-stone-500">Connection</span><span className={networkStatus === "Connected" ? "font-medium text-green-700" : "font-medium text-beef"}>{networkStatus}</span></div></div></div>
            </section>
            <section className="rounded-2xl border border-stone-200 bg-white p-6"><h3 className="text-lg font-bold">Recent Supply Chain Records</h3><p className="mt-2 text-sm text-stone-500">Batch records available to your assigned portal roles.</p>{uniqueRows.length ? <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-stone-200 text-stone-500"><tr><th className="px-3 py-3">Batch</th><th className="px-3 py-3">Inspection</th><th className="px-3 py-3">Recall</th><th className="px-3 py-3">Holder</th></tr></thead><tbody>{uniqueRows.slice(0, 8).map((item, index) => <tr key={item.batchId || index} className="border-b border-stone-100"><td className="px-3 py-3 font-medium">{item.batchId || "â€”"}</td><td className="px-3 py-3">{item.inspected ? "Inspected" : "Pending"}</td><td className="px-3 py-3">{item.recalled ? "Recalled" : "Clear"}</td><td className="px-3 py-3">{item.holder || "â€”"}</td></tr>)}</tbody></table></div> : <div className="mt-6 rounded-xl border border-dashed border-stone-200 p-10 text-center"><History className="mx-auto text-stone-400" size={28} /><p className="mt-3 text-sm text-stone-500">{portalUser?.address ? "No accessible batch records loaded yet." : "Sign in to load authorized batch records."}</p></div>}</section>
                    </> : activePage === "Batches" ? (
            <BatchRegistration
              portalUser={portalUser}
              dashboardData={dashboardData}
            />
                    ) : activePage === "Inspections" ? (
            <Inspections
              portalUser={portalUser}
              dashboardData={dashboardData}
            />
                    ) : activePage === "Shipments" ? (
            <Shipments
              portalUser={portalUser}
              dashboardData={dashboardData}
            />
          ) : activePage === "Recalls" ? (
            <Recalls
              portalUser={portalUser}
              dashboardData={dashboardData}
            />
          ) : activePage === "Verify Product" ? (
            <VerifyProduct />
          ) : activePage === "Users & Roles" ? (
            <AdminPanel
              portalUser={portalUser}
              dashboardData={dashboardData}
              walletAddress={walletAddress}
            />
          ) : (
            <section className="rounded-2xl border border-stone-200 bg-white p-8">
              <h3 className="text-xl font-bold">{activePage}</h3>
              <p className="mt-3 text-sm text-stone-500">
                This module is ready for its next implementation step.
                Blockchain actions and backend data are not connected yet.
              </p>
            </section>
          )}
                  </div>
      </main>
    </div>
  );
}
