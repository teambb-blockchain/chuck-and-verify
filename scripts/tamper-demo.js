
const crypto = require("crypto");

const url = "https://gateway.didlab.org/ipfs/QmRQskDgNSiJW55w8XZyEgFqqgGeiEGaJhrcfVCtaYCnzD";
const expectedHash = "cb48afddf061782b7d83ef8eb04c52196fac84420303e690a89d5723075dd095";

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function main() {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const original = Buffer.from(await response.arrayBuffer());
  const tampered = Buffer.from(original);

  // Flip exactly one bit in a separate copy.
  tampered[0] ^= 0x01;

  const originalHash = sha256(original);
  const tamperedHash = sha256(tampered);

  console.log("--- B1 Tamper Demonstration ---");
  console.log("File size (bytes):", original.length);
  console.log("Total file bits:", original.length * 8);
  console.log("Bits flipped:", 1);
  console.log("Original SHA-256:", originalHash);
  console.log("Tampered SHA-256:", tamperedHash);
  console.log("Original matches anchor:", originalHash === expectedHash);
  console.log("Hashes different:", originalHash !== tamperedHash);
}

main().catch(console.error);
