const tx = "0xd1718894205be6af1fb5e44caccdf9ac548a007701acc616c3d751cbc200fd53";

async function main() {
  const start = performance.now();

  const response = await fetch("https://eth.didlab.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
      params: [tx],
      id: 1
    })
  });

  const data = await response.json();

  if (data.error || !data.result) {
    throw new Error(JSON.stringify(data.error || data));
  }

  const receipt = data.result;

  console.log("Gas used:", parseInt(receipt.gasUsed, 16));
  console.log("Block:", parseInt(receipt.blockNumber, 16));
  console.log(
    "Status:",
    parseInt(receipt.status, 16) === 1 ? "Success" : "Reverted"
  );
  console.log(
    "Receipt lookup:",
    (performance.now() - start).toFixed(1),
    "ms"
  );
}

main().catch(console.error);
