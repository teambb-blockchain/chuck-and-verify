// Adversarial tests for the portal server (index.js + server/auth.js).
// Starts the real server on a free port with a throwaway DATA_DIR, so no
// chain, wallet extension or network access is needed.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

describe("Portal server — adversarial", function () {
  this.timeout(20000);
  let server, base, dataDir;
  const adminWallet = ethers.Wallet.createRandom();
  const processorWallet = ethers.Wallet.createRandom();
  const inspectorWallet = ethers.Wallet.createRandom();
  const custodianWallet = ethers.Wallet.createRandom();
  const newcomerWallet = ethers.Wallet.createRandom();

  // A fake DIDLab RPC for the dashboard's event index: three batches from the
  // processor, the first one inspected (passed) with REPORT_SHA. The third is
  // shipped to the custodian, split into two lots, then recalled (Class II)
  // after the split. One LotCreated names a parent that doesn't exist.
  const CONTRACT = "0x" + "ab".repeat(20);
  const REPORT_SHA = "cd".repeat(32);
  const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
  const addrTopic = (a) => "0x" + word(a.toLowerCase());
  const batchTopic = (name) => ethers.encodeBytes32String(name);
  const fakeLogs = () => [
    {
      blockNumber: "0xa", logIndex: "0x0", transactionHash: "0x" + "01".repeat(32),
      topics: [ethers.id("BatchRegistered(bytes32,address,uint256)"), batchTopic("BB-T-1"), addrTopic(processorWallet.address)],
      data: "0x" + word("1f4"),
    },
    {
      blockNumber: "0xb", logIndex: "0x0", transactionHash: "0x" + "02".repeat(32),
      topics: [ethers.id("BatchRegistered(bytes32,address,uint256)"), batchTopic("BB-T-2"), addrTopic(processorWallet.address)],
      data: "0x" + word("1c2"),
    },
    {
      blockNumber: "0xc", logIndex: "0x0", transactionHash: "0x" + "03".repeat(32),
      topics: [ethers.id("InspectionRecorded(bytes32,address,bytes32,bool)"), batchTopic("BB-T-1"), addrTopic(inspectorWallet.address)],
      data: "0x" + REPORT_SHA + word("1"),
    },
    {
      blockNumber: "0xd", logIndex: "0x0", transactionHash: "0x" + "04".repeat(32),
      topics: [ethers.id("BatchRegistered(bytes32,address,uint256)"), batchTopic("BB-T-3"), addrTopic(processorWallet.address)],
      data: "0x" + word("3e8"),
    },
    {
      blockNumber: "0xe", logIndex: "0x0", transactionHash: "0x" + "05".repeat(32),
      topics: [ethers.id("ShipmentRecorded(bytes32,address,address)"), batchTopic("BB-T-3"), addrTopic(processorWallet.address), addrTopic(custodianWallet.address)],
      data: "0x",
    },
    {
      blockNumber: "0xf", logIndex: "0x0", transactionHash: "0x" + "06".repeat(32),
      topics: [ethers.id("ReceiptConfirmed(bytes32,address)"), batchTopic("BB-T-3"), addrTopic(custodianWallet.address)],
      data: "0x",
    },
    ...[["BB-T-3-L1", "258"], ["BB-T-3-L2", "190"]].map(([lot, weight], i) => ({
      blockNumber: "0x10", logIndex: "0x" + i.toString(16), transactionHash: "0x" + "07".repeat(32),
      topics: [ethers.id("LotCreated(bytes32,bytes32,address,uint256)"), batchTopic("BB-T-3"), batchTopic(lot), addrTopic(custodianWallet.address)],
      data: "0x" + word(weight),
    })),
    {
      blockNumber: "0x11", logIndex: "0x0", transactionHash: "0x" + "08".repeat(32),
      topics: [ethers.id("LotCreated(bytes32,bytes32,address,uint256)"), batchTopic("BB-NOPE"), batchTopic("BB-NOPE-L1"), addrTopic(custodianWallet.address)],
      data: "0x" + word("1"),
    },
    {
      blockNumber: "0x12", logIndex: "0x0", transactionHash: "0x" + "09".repeat(32),
      topics: [ethers.id("RecallRecorded(bytes32,address,bytes32,uint8)"), batchTopic("BB-T-3"), addrTopic(processorWallet.address)],
      data: "0x" + "ee".repeat(32) + word("2"),
    },
  ];
  let rpc;

  before(async function () {
    rpc = require("http")
      .createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const { id, method } = JSON.parse(body);
          const result =
            method === "eth_blockNumber" ? "0x14"
            : method === "eth_getLogs" ? fakeLogs()
            : method === "eth_getBlockByNumber" ? { timestamp: "0x6553f100" }
            : null;
          res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
        });
      })
      .listen(0);
    await new Promise((r) => rpc.once("listening", r));

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-portal-"));
    fs.writeFileSync(
      path.join(dataDir, "portal.db"),
      JSON.stringify({
        users: [
          { address: adminWallet.address.toLowerCase(), label: "admin", roles: ["ADMIN"] },
          { address: processorWallet.address.toLowerCase(), label: "plant", roles: ["PROCESSOR"] },
          { address: inspectorWallet.address.toLowerCase(), label: "usda", roles: ["INSPECTOR"] },
          { address: custodianWallet.address.toLowerCase(), label: "carrier", roles: ["CUSTODIAN"] },
        ],
        sessions: [],
      })
    );
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["index.js"], {
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        CHAIN_RPC: `http://127.0.0.1:${rpc.address().port}`,
        BSC_ADDRESS: CONTRACT,
        BSC_FROM_BLOCK: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      server.stdout.on("data", (d) => /Serving/.test(d) && resolve());
      server.on("exit", (code) => reject(new Error("server exited " + code)));
    });
  });

  after(function () {
    if (server) server.kill();
    if (rpc) rpc.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const post = (p, body, headers = {}) =>
    fetch(base + p, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  async function signIn(wallet, headers = {}) {
    const c = await (await post("/api/auth/challenge", { address: wallet.address }, headers)).json();
    const signature = await wallet.signMessage(c.message);
    const r = await post("/api/auth/verify", { nonce: c.nonce, signature }, headers);
    return { r, c, signature, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
  }

  describe("sign-in", function () {
    // P-1 regression guard. Before the fix, a relaying look-alike site could
    // send X-Forwarded-Host: <its own domain>, the message named that domain,
    // the wallet showed no mismatch warning, and the signature it collected
    // opened a real ADMIN session (reproduced on teambb.didlab.org 2026-11-08).
    it("P-1: ignores a client-sent X-Forwarded-Host that is not on PORTAL_ORIGINS", async function () {
      const c = await (
        await post(
          "/api/auth/challenge",
          { address: adminWallet.address },
          { "x-forwarded-host": "teambb-didlab.example" }
        )
      ).json();
      expect(c.message.split("\n")[0]).to.equal(
        "teambb.didlab.org wants you to sign in with your Ethereum account:"
      );
      expect(c.message).to.include("URI: https://teambb.didlab.org");
    });

    it("P-1: ignores a non-local Host header that is not on PORTAL_ORIGINS", async function () {
      // fetch() cannot override Host, so send this one with http.request.
      const body = JSON.stringify({ address: adminWallet.address });
      const text = await new Promise((resolve, reject) => {
        const req = require("http").request(
          base + "/api/auth/challenge",
          {
            method: "POST",
            headers: {
              host: "teambb-didlab.example",
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let out = "";
            res.on("data", (d) => (out += d));
            res.on("end", () => resolve(out));
          }
        );
        req.on("error", reject);
        req.end(body);
      });
      expect(JSON.parse(text).message.split("\n")[0]).to.match(/^teambb\.didlab\.org wants you/);
    });

    it("P-1: keeps the listed public host when the proxy forwards it", async function () {
      const c = await (
        await post("/api/auth/challenge", { address: adminWallet.address }, {
          "x-forwarded-host": "teambb.didlab.org",
        })
      ).json();
      expect(c.message.split("\n")[0]).to.match(/^teambb\.didlab\.org wants you/);
    });

    it("ignores an Origin that is not on PORTAL_ORIGINS when Host is local", async function () {
      const c = await (
        await post("/api/auth/challenge", { address: adminWallet.address }, {
          origin: "https://teambb-didlab.example",
        })
      ).json();
      expect(c.message.split("\n")[0]).to.match(/^127\.0\.0\.1:\d+ wants you/);
    });

    it("rejects a replayed nonce", async function () {
      const { c, signature } = await signIn(processorWallet);
      const again = await post("/api/auth/verify", { nonce: c.nonce, signature });
      expect(again.status).to.equal(401);
    });

    it("rejects a signature from a wallet other than the one challenged", async function () {
      const c = await (await post("/api/auth/challenge", { address: adminWallet.address })).json();
      const signature = await processorWallet.signMessage(c.message);
      const r = await post("/api/auth/verify", { nonce: c.nonce, signature });
      expect(r.status).to.equal(401);
    });

    it("rejects a high-s (malleated) form of a valid signature", async function () {
      const c = await (await post("/api/auth/challenge", { address: adminWallet.address })).json();
      const sig = ethers.Signature.from(await adminWallet.signMessage(c.message));
      const N = ethers.N;
      const highS = ethers.toBeHex(N - BigInt(sig.s), 32);
      const v = sig.v === 27 ? 28 : 27;
      const malleated = ethers.concat([sig.r, highS, ethers.toBeHex(v, 1)]);
      const r = await post("/api/auth/verify", { nonce: c.nonce, signature: malleated });
      expect(r.status).to.equal(401);
    });

    it("sets an HttpOnly, SameSite=Strict session cookie", async function () {
      const { r } = await signIn(processorWallet);
      const cookie = r.headers.get("set-cookie");
      expect(cookie).to.match(/HttpOnly/);
      expect(cookie).to.match(/SameSite=Strict/);
    });

    it("stores only a hash of the session token on disk", async function () {
      const { cookie } = await signIn(processorWallet);
      const token = cookie.split("=")[1];
      // WAL mode can hold the new session in a sidecar until the next checkpoint.
      const blob = Buffer.concat(
        ["portal.db", "portal.db-wal", "portal.db-shm"].map((name) => {
          const filePath = path.join(dataDir, name);
          return fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
        })
      );
      expect(blob.includes(Buffer.from(token))).to.equal(false);
    });
  });

  describe("authorization", function () {
    it("rejects admin routes with no session (401) and from a PROCESSOR (403)", async function () {
      expect((await fetch(base + "/api/admin/users")).status).to.equal(401);
      const { cookie } = await signIn(processorWallet);
      const r = await fetch(base + "/api/admin/users", { headers: { cookie } });
      expect(r.status).to.equal(403);
      const put = await fetch(base + "/api/admin/users/" + processorWallet.address, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ roles: ["ADMIN"] }),
      });
      expect(put.status).to.equal(403);
    });

    it("rejects a cross-site form post (text/plain) to an admin route", async function () {
      const { cookie } = await signIn(adminWallet);
      const r = await fetch(base + "/api/admin/users/" + processorWallet.address, {
        method: "PUT",
        headers: { cookie, "content-type": "text/plain" },
        body: JSON.stringify({ roles: ["ADMIN"] }),
      });
      expect(r.status).to.equal(415);
    });

    it("rejects an IPFS upload with no session", async function () {
      const r = await fetch(base + "/api/ipfs/add", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: "--x--",
      });
      expect(r.status).to.equal(401);
    });
  });

  describe("dashboards", function () {
    const bundle = (wallet, sha = "ef".repeat(32)) => ({
      address: wallet.address,
      cid: "QmTestCid123",
      ciphertextSha256: sha,
      iv: "AAAAAAAAAAAAAAAA",
      timestamp: 1700000000,
      originalName: "lot.pdf",
    });
    const send = (method, p, cookie, body, type = "application/json") =>
      fetch(base + p, { method, headers: { cookie, "content-type": type }, body: JSON.stringify(body) });
    const dashboard = async (cookie) =>
      (await fetch(base + "/api/dashboard", { headers: { cookie } })).json();

    it("requires a session", async function () {
      expect((await fetch(base + "/api/dashboard")).status).to.equal(401);
    });

    it("counts a processor's batches from the indexed events", async function () {
      const { cookie } = await signIn(processorWallet);
      const d = await dashboard(cookie);
      expect(d.chain.stale).to.equal(false);
      // The split batch counts once as a registration; its recall counts
      // once per lot, since the lots are what is out there.
      expect(d.views.PROCESSOR).to.include({ registered: 3, inCustody: 2, recalled: 2 });
      expect(d.views.PROCESSOR.rows.map((r) => r.batchId)).to.have.members(
        ["BB-T-1", "BB-T-2", "BB-T-3", "BB-T-3-L1", "BB-T-3-L2"]
      );
      expect(d.views).to.not.have.property("INSPECTOR");
    });

    it("shows an inspector what is waiting, excluding what they already inspected", async function () {
      const { cookie } = await signIn(inspectorWallet);
      const d = await dashboard(cookie);
      expect(d.views.INSPECTOR).to.include({ inspected: 1, waiting: 1 });
      expect(d.views.INSPECTOR.rows.map((r) => r.batchId)).to.not.include("BB-T-3-L1");
    });

    it("shows a custodian the lots of a batch they split, each with the batch's recall", async function () {
      const { cookie } = await signIn(custodianWallet);
      const v = (await dashboard(cookie)).views.CUSTODIAN;
      // The split batch is listed but not counted: only its lots are in hand.
      expect(v).to.include({ inCustody: 2, recalledInCustody: 2, incoming: 0 });
      const byId = Object.fromEntries(v.rows.map((r) => [r.batchId, r]));
      expect(Object.keys(byId)).to.have.members(["BB-T-3", "BB-T-3-L1", "BB-T-3-L2"]);
      expect(byId["BB-T-3"]).to.include({ lotCount: 2, parentId: null });
      expect(byId["BB-T-3-L1"]).to.include({
        parentId: "BB-T-3", lotCount: 0, weightLbs: 600, holderIsYou: true,
        processorIsYou: false, recalled: true, recallClass: 2,
      });
      expect(byId["BB-T-3-L2"].weightLbs).to.equal(400);
    });

    it("refuses a form receipt for another wallet or the wrong role", async function () {
      const { cookie } = await signIn(processorWallet);
      const other = await send("POST", "/api/documents", cookie, {
        kind: "lot", batchId: "BB-T-1", bundle: bundle(inspectorWallet),
      });
      expect(other.status).to.equal(403);
      const role = await send("POST", "/api/documents", cookie, {
        kind: "inspection", batchId: "BB-T-1", bundle: bundle(processorWallet),
      });
      expect(role.status).to.equal(403);
    });

    it("lists an inspection report only when its fingerprint matches the chain", async function () {
      const { cookie } = await signIn(inspectorWallet);
      const wrong = await send("POST", "/api/documents", cookie, {
        kind: "inspection", batchId: "BB-T-1", bundle: bundle(inspectorWallet),
      });
      expect(wrong.status).to.equal(200);
      let row = (await dashboard(cookie)).views.INSPECTOR.rows.find((r) => r.batchId === "BB-T-1");
      expect(row.documents).to.have.length(0);

      await send("POST", "/api/documents", cookie, {
        kind: "inspection", batchId: "BB-T-1", bundle: { ...bundle(inspectorWallet, REPORT_SHA), cid: "QmRealReport" },
      });
      row = (await dashboard(cookie)).views.INSPECTOR.rows.find((r) => r.batchId === "BB-T-1");
      expect(row.documents.map((d) => d.cid)).to.deep.equal(["QmRealReport"]);
      expect(row.documents[0]).to.not.have.property("sha256");
    });

    it("lets a wallet with no role request one, and shows it to admins only", async function () {
      const { cookie } = await signIn(newcomerWallet);
      const d = await dashboard(cookie);
      expect(d.roles).to.deep.equal([]);
      expect(d.views).to.deep.equal({});

      const admin = await send("POST", "/api/access-request", cookie, { roles: ["ADMIN"] });
      expect(admin.status).to.equal(400);
      const crossSite = await send("POST", "/api/access-request", cookie, { roles: ["INSPECTOR"] }, "text/plain");
      expect(crossSite.status).to.equal(415);

      const ok = await send("POST", "/api/access-request", cookie, { roles: ["INSPECTOR"], note: "FSIS" });
      expect((await ok.json()).request.roles).to.deep.equal(["INSPECTOR"]);
      expect((await fetch(base + "/api/admin/requests", { headers: { cookie } })).status).to.equal(403);

      const adminCookie = (await signIn(adminWallet)).cookie;
      const list = await (await fetch(base + "/api/admin/requests", { headers: { cookie: adminCookie } })).json();
      expect(list.requests.map((r) => r.address)).to.include(newcomerWallet.address.toLowerCase());
    });

    it("refuses an access request from a wallet that already has a role", async function () {
      const { cookie } = await signIn(processorWallet);
      const r = await send("POST", "/api/access-request", cookie, { roles: ["INSPECTOR"] });
      expect(r.status).to.equal(400);
    });

    it("drops a request once the admin gives that wallet a role", async function () {
      const adminCookie = (await signIn(adminWallet)).cookie;
      await send("PUT", "/api/admin/users/" + newcomerWallet.address, adminCookie, { roles: ["CUSTODIAN"] });
      const list = await (await fetch(base + "/api/admin/requests", { headers: { cookie: adminCookie } })).json();
      expect(list.requests.map((r) => r.address)).to.not.include(newcomerWallet.address.toLowerCase());
    });
  });

  describe("organization types", function () {
    const send = (method, p, cookie, body) =>
      fetch(base + p, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const me = async (cookie) => (await fetch(base + "/api/me", { headers: { cookie } })).json();
    const carrierWallet = ethers.Wallet.createRandom();
    const askerWallet = ethers.Wallet.createRandom();

    it("saves a type only with the credential role behind it", async function () {
      const adminCookie = (await signIn(adminWallet)).cookie;
      const url = "/api/admin/users/" + carrierWallet.address;
      const unpaired = await send("PUT", url, adminCookie, { roles: ["PROCESSOR"], organization: "carrier" });
      expect(unpaired.status).to.equal(400);
      expect((await unpaired.json()).error).to.match(/Carrier needs the CUSTODIAN role/);
      const unknown = await send("PUT", url, adminCookie, { roles: ["CUSTODIAN"], organization: "__proto__" });
      expect(unknown.status).to.equal(400);

      const ok = await send("PUT", url, adminCookie, { roles: ["CUSTODIAN"], organization: "carrier" });
      expect(ok.status).to.equal(200);
      const listed = (await ok.json()).users.find((u) => u.address === carrierWallet.address.toLowerCase());
      expect(listed.organization).to.equal("carrier");

      const { cookie } = await signIn(carrierWallet);
      expect(await me(cookie)).to.include({ organization: "carrier" });
      const d = await (await fetch(base + "/api/dashboard", { headers: { cookie } })).json();
      expect(d.organization).to.equal("carrier");
      expect(d.views).to.have.property("CUSTODIAN");
    });

    it("keeps the type on a save that omits it, and drops it with its role", async function () {
      const adminCookie = (await signIn(adminWallet)).cookie;
      const url = "/api/admin/users/" + carrierWallet.address;
      await send("PUT", url, adminCookie, { roles: ["CUSTODIAN", "PROCESSOR"] });
      const { cookie } = await signIn(carrierWallet);
      expect((await me(cookie)).organization).to.equal("carrier");
      await send("PUT", url, adminCookie, { roles: ["PROCESSOR"] });
      expect((await me(cookie)).organization).to.equal(null);
    });

    it("turns a newcomer's organization type into the role it requests", async function () {
      const { cookie } = await signIn(askerWallet);
      const bad = await send("POST", "/api/access-request", cookie, { organization: "consumer" });
      expect(bad.status).to.equal(400);
      const ok = await send("POST", "/api/access-request", cookie, { organization: "retailer", note: "Corner market" });
      expect((await ok.json()).request).to.deep.include({ roles: ["CUSTODIAN"], organization: "retailer" });
      const adminCookie = (await signIn(adminWallet)).cookie;
      const list = await (await fetch(base + "/api/admin/requests", { headers: { cookie: adminCookie } })).json();
      const mine = list.requests.find((r) => r.address === askerWallet.address.toLowerCase());
      expect(mine.organization).to.equal("retailer");
    });
  });

  describe("static files", function () {
    for (const probe of [
      "/../server/auth.js",
      "/%2e%2e/server/auth.js",
      "/..%2f..%2fpackage.json",
      "/frontend/public/../../.env",
    ]) {
      it(`does not serve ${probe}`, async function () {
        const r = await fetch(base + probe);
        expect(r.status).to.be.oneOf([400, 404]);
      });
    }

    it("serves the repo-root page at / with assets from frontend/public", async function () {
      const page = await fetch(base + "/");
      expect(page.status).to.equal(200);
      const html = await page.text();
      expect(html).to.include("<title>Chuck and Verify</title>");
      expect(html).to.not.include("http-equiv=\"refresh\"");
      expect(html).to.include('src="/frontend/public/app.js?v=');
      const css = await fetch(base + "/frontend/public/styles.css");
      expect(css.status).to.equal(200);
      expect(css.headers.get("content-type")).to.include("text/css");
    });

    it("P-6: refuses framing and MIME sniffing on served files", async function () {
      const r = await fetch(base + "/");
      expect(r.headers.get("content-security-policy")).to.include("frame-ancestors 'none'");
      expect(r.headers.get("x-frame-options")).to.equal("DENY");
      expect(r.headers.get("x-content-type-options")).to.equal("nosniff");
    });
  });
});
