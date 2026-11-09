const { performance } = require("node:perf_hooks");

async function measure(name, url, method = "GET", body = undefined) {
  const start = performance.now();

  try {
    const response = await fetch(url, {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });

    const bytes = await response.arrayBuffer();
    const elapsed = performance.now() - start;

    console.log(`${name}: ${elapsed.toFixed(1)} ms | ${bytes.byteLength} bytes | HTTP ${response.status}`);
  } catch (error) {
    console.log(`${name}: ERROR - ${error.message}`);
  }
}

(async () => {
  const rpc = "https://eth.didlab.org";
  const cid = "QmRQskDgNSiJW55w8XZyEgFqqgGeiEGaJhrcfVCtaYCnzD";

  for (let i = 1; i <= 3; i++) {
    await measure(
      `DIDLab RPC read ${i}`,
      rpc,
      "POST",
      {
        jsonrpc: "2.0",
        method: "eth_blockNumber",
        params: [],
        id: i
      }
    );
  }

  for (let i = 1; i <= 3; i++) {
    await measure(
      `IPFS retrieval ${i}`,
      `https://gateway.didlab.org/ipfs/${cid}`
    );
  }
})();
