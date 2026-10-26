import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const url = process.argv[2];
const expected = (process.argv[3] || "").toLowerCase().replace(/^0x/, "");

if (!url) {
  console.error("usage: node scripts/verify-stored.mjs <gateway-url> [expected-sha256]");
  process.exit(1);
}

const res = await fetch(url);
if (!res.ok) throw new Error(`gateway returned ${res.status}`);

const bytes = Buffer.from(await res.arrayBuffer());
const digest = createHash("sha256").update(bytes).digest("hex");

console.log("bytes      ", bytes.length);
console.log("sha256     ", digest);
console.log("expected   ", expected || "(none supplied)");
console.log("match      ", expected ? String(digest === expected) : "n/a");

await writeFile("retrieved.bin", bytes);
console.log("saved      retrieved.bin");
