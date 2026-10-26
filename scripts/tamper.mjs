import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const path = process.argv[2];
const bytes = Buffer.from(await readFile(path));

const before = createHash("sha256").update(bytes).digest("hex");

bytes[0] ^= 0x01;   // flip a single bit in the first byte

const after = createHash("sha256").update(bytes).digest("hex");

console.log("before  ", before);
console.log("after   ", after);
console.log("changed ", 1, "bit of", bytes.length * 8);
console.log("same?   ", before === after);
