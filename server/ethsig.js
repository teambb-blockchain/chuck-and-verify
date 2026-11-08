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

function keccak256(buf) {
  return crypto.createHash("keccak-256").update(buf).digest();
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

module.exports = { recoverPersonalSignAddress, hashPersonalMessage };
