"use strict";

// Recovers the signer of an Ethereum personal_sign (EIP-191) message using
// only Node built-ins, so the server keeps zero runtime dependencies.
// Every input here is public (message, signature), so the math does not need
// to be constant-time.

const crypto = require("crypto");

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function invert(a, m) {
  let [x0, x1, r0, r1] = [0n, 1n, m, mod(a, m)];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [x0, x1] = [x1, x0 - q * x1];
    [r0, r1] = [r1, r0 - q * r1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return mod(x0, m);
}

function powMod(base, exp, m) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    base = (base * base) % m;
    exp >>= 1n;
  }
  return result;
}

// Affine point arithmetic; null is the point at infinity.
function add(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return null;
    const l = mod(3n * a.x * a.x * invert(2n * a.y, P), P);
    const x = mod(l * l - 2n * a.x, P);
    return { x, y: mod(l * (a.x - x) - a.y, P) };
  }
  const l = mod((b.y - a.y) * invert(b.x - a.x, P), P);
  const x = mod(l * l - a.x - b.x, P);
  return { x, y: mod(l * (a.x - x) - a.y, P) };
}

function multiply(point, k) {
  let result = null;
  let addend = point;
  while (k > 0n) {
    if (k & 1n) result = add(result, addend);
    addend = add(addend, addend);
    k >>= 1n;
  }
  return result;
}

// Keccak-256 as Ethereum uses it (original Keccak padding 0x01, not the
// SHA3-256 padding 0x06). OpenSSL only ships it from 3.2, so Node 20
// (OpenSSL 3.0) has no "keccak-256" digest. Use it when present, otherwise
// the small pure-JS version below. Inputs here are a few hundred bytes.
const MASK64 = (1n << 64n) - 1n;
const KECCAK_ROT = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
  41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
// Round constants from the Keccak LFSR (x^8 + x^6 + x^5 + x^4 + 1).
const KECCAK_RC = (() => {
  let r = 1;
  const bit = () => {
    const out = r & 1;
    r = r & 0x80 ? ((r << 1) ^ 0x171) & 0xff : r << 1;
    return out;
  };
  return Array.from({ length: 24 }, () => {
    let rc = 0n;
    for (let j = 0; j < 7; j++) if (bit()) rc |= 1n << BigInt((1 << j) - 1);
    return rc;
  });
})();

function rotl64(v, n) {
  return n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK64;
}

function keccakF(A) {
  const C = new Array(5);
  const B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(A[x + 5 * y], KECCAK_ROT[x + 5 * y]);
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        A[x + y] = B[x + y] ^ (~B[((x + 1) % 5) + y] & MASK64 & B[((x + 2) % 5) + y]);
      }
    }
    A[0] ^= KECCAK_RC[round];
  }
}

function keccak256Js(buf) {
  const RATE = 136;
  const padded = Buffer.alloc((Math.floor(buf.length / RATE) + 1) * RATE);
  buf.copy(padded);
  padded[buf.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) A[i] ^= padded.readBigUInt64LE(off + i * 8);
    keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

const HAS_NATIVE_KECCAK = crypto.getHashes().includes("keccak-256");

function keccak256(buf) {
  return HAS_NATIVE_KECCAK
    ? crypto.createHash("keccak-256").update(buf).digest()
    : keccak256Js(buf);
}

function toBigInt(buf) {
  return BigInt("0x" + buf.toString("hex"));
}

function hashPersonalMessage(message) {
  const body = Buffer.from(message, "utf8");
  const prefix = Buffer.from(
    "\x19Ethereum Signed Message:\n" + body.length,
    "utf8"
  );
  return keccak256(Buffer.concat([prefix, body]));
}

/**
 * Returns the lowercase 0x address that signed `message` with personal_sign,
 * or throws if the signature is malformed.
 */
function recoverPersonalSignAddress(message, signatureHex) {
  if (typeof signatureHex !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signatureHex)) {
    throw new Error("Signature must be 65 bytes of hex.");
  }
  const sig = Buffer.from(signatureHex.slice(2), "hex");
  const r = toBigInt(sig.subarray(0, 32));
  const s = toBigInt(sig.subarray(32, 64));
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error("Bad recovery id.");
  if (r <= 0n || r >= N) throw new Error("Bad r.");
  // EIP-2: reject high-s signatures so each signature has one valid form.
  if (s <= 0n || s > N / 2n) throw new Error("Bad s.");

  // Lift r to the curve point R with the parity given by v.
  const x = r;
  const ySquared = mod(x * x * x + 7n, P);
  let y = powMod(ySquared, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== ySquared) throw new Error("r is not on the curve.");
  if ((y & 1n) !== BigInt(v)) y = P - y;
  const R = { x, y };

  const e = toBigInt(hashPersonalMessage(message));
  const rInv = invert(r, N);
  const u1 = mod(-e * rInv, N);
  const u2 = mod(s * rInv, N);
  const Q = add(multiply(G, u1), multiply(R, u2));
  if (Q === null) throw new Error("Recovered point at infinity.");

  const pub = Buffer.from(
    Q.x.toString(16).padStart(64, "0") + Q.y.toString(16).padStart(64, "0"),
    "hex"
  );
  return "0x" + keccak256(pub).subarray(12).toString("hex");
}

module.exports = { recoverPersonalSignAddress, hashPersonalMessage, keccak256Js };
