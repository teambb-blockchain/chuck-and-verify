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

  before(async function () {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cv-portal-"));
    fs.writeFileSync(
      path.join(dataDir, "portal.db"),
      JSON.stringify({
        users: [
          { address: adminWallet.address.toLowerCase(), label: "admin", roles: ["ADMIN"] },
          { address: processorWallet.address.toLowerCase(), label: "plant", roles: ["PROCESSOR"] },
        ],
        sessions: [],
      })
    );
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["index.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      server.stdout.on("data", (d) => /Serving/.test(d) && resolve());
      server.on("exit", (code) => reject(new Error("server exited " + code)));
    });
  });

  after(function () {
    if (server) server.kill();
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
      const db = fs.readFileSync(path.join(dataDir, "portal.db"), "utf8");
      expect(db).to.not.include(token);
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

    it("P-6: refuses framing and MIME sniffing on served files", async function () {
      const r = await fetch(base + "/");
      expect(r.headers.get("content-security-policy")).to.include("frame-ancestors 'none'");
      expect(r.headers.get("x-frame-options")).to.equal("DENY");
      expect(r.headers.get("x-content-type-options")).to.equal("nosniff");
    });
  });
});
