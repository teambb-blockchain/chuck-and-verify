import { getAddress, hexToBytes, keccak256 } from "viem";

// DIDLab's portal checks this protocol. The encryption signature never
// leaves the browser. The publish signature authorizes ciphertext only.
const PORTAL_ADD_URL = "https://blockchain.didlab.org/api/ipfs/add";
const SAME_ORIGIN_ADD_URL = "/api/ipfs/add";
const GATEWAY = "https://gateway.didlab.org/ipfs/";

export const MAX_FORM_BYTES = 25 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function importAesKey(signature) {
  // Same derivation the portal's decrypt script documents:
  // keccak256(signature bytes) is the AES-256-GCM key.
  const material = hexToBytes(keccak256(hexToBytes(signature)));
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
}

function formDataFor(
  encryptedFile,
  plaintextBytes,
  address,
  publishAt,
  digest,
  publishSignature
) {
  const body = new FormData();
  body.append("file", encryptedFile);
  body.append("pin", "true");
  body.append("wrapWithDirectory", "false");
  body.append("address", address);
  body.append("timestamp", String(publishAt));
  body.append("signature", publishSignature);
  body.append("sha256", digest);
  body.append("sizeBytes", String(plaintextBytes));
  return body;
}

async function postCiphertext(payload) {
  const targets = [SAME_ORIGIN_ADD_URL, PORTAL_ADD_URL];
  let sawNetworkFailure = false;

  for (const url of targets) {
    try {
      const response = await fetch(url, { method: "POST", body: payload.body() });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      // This host has no forwarder (nginx serves the files directly).
      // Try the portal itself next.
      if (response.status === 404) continue;

      if (!response.ok) {
        throw new Error(parsed?.error || "IPFS publish failed.");
      }
      if (!parsed?.cid) {
        throw new Error("IPFS publish returned no content id.");
      }
      return parsed;
    } catch (error) {
      if (error instanceof TypeError) {
        sawNetworkFailure = true;
        continue;
      }
      throw error;
    }
  }

  if (sawNetworkFailure) {
    throw new Error(
      "The encrypted form was not published. Start the page with npm start so this server can forward the upload. No batch transaction was sent."
    );
  }
  throw new Error(
    "The encrypted form was not published. No batch transaction was sent."
  );
}

export function gatewayUrlForCid(cid) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(cid || "")) return "";
  return GATEWAY + cid;
}

// `signMessage(text)` must personal-sign `text` with the connected account.
// `onStatus` is told what the wallet is about to ask for.
export async function publishEncryptedForm({
  file,
  account,
  signMessage,
  onStatus
}) {
  if (!file || file.size === 0) {
    throw new Error("Choose a form to publish with this batch.");
  }
  if (file.size > MAX_FORM_BYTES) {
    throw new Error("The form is larger than 25 MB.");
  }

  const address = getAddress(account);
  const encryptedAt = Math.floor(Date.now() / 1000);

  onStatus(
    "Sign to encrypt the form. This is not a transaction and uses no gas."
  );
  const encryptionSignature = await signMessage(
    "Authorize DIDLab IPFS upload\nAddress:" +
      address +
      "\nTimestamp:" +
      encryptedAt
  );

  onStatus("Encrypting the form in this browser.");
  const key = await importAesKey(encryptionSignature);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    await file.arrayBuffer()
  );
  const ciphertext = new Uint8Array(cipherBuffer);
  const digest = await sha256Hex(ciphertext);
  const storedName = "didlab-" + crypto.randomUUID() + ".bin";
  const encryptedFile = new File([ciphertext], storedName, {
    type: "application/octet-stream"
  });

  onStatus(
    "Sign to publish the encrypted form. This is not a transaction and uses no gas."
  );
  const publishAt = Math.floor(Date.now() / 1000);
  const publishSignature = await signMessage(
    "Authorize DIDLab IPFS publish\nAddress:" +
      address +
      "\nTimestamp:" +
      publishAt +
      "\nSHA256:" +
      digest +
      "\nSize:" +
      encryptedFile.size
  );

  onStatus("Publishing the encrypted form. No batch transaction yet.");
  const published = await postCiphertext({
    body: () =>
      formDataFor(
        encryptedFile,
        file.size,
        address,
        publishAt,
        digest,
        publishSignature
      )
  });

  return {
    bundleVersion: 2,
    cid: published.cid,
    name: published.name || storedName,
    size: published.size,
    ipfsUri: published.ipfsUri || "ipfs://" + published.cid,
    address: getAddress(
      typeof published.address === "string" && published.address
        ? published.address
        : address
    ),
    timestamp: encryptedAt,
    iv: bytesToBase64(iv),
    originalName: file.name,
    mimeType: file.type || "application/pdf",
    encryption: published.encryption || "AES-256-GCM",
    ciphertextSha256: published.ciphertextSha256 || digest,
    publishAuthorizedAt: published.publishAuthorizedAt ?? publishAt
  };
}

// Reopen a form this wallet published. The key is keccak256 of the wallet's
// signature over the same upload message, so signing it again (deterministic
// for a given wallet) rebuilds the key. Nothing secret is stored anywhere.
//   doc: { cid, iv (base64), timestamp (seconds), name }
export async function openEncryptedForm({ doc, account, signMessage }) {
  const url = gatewayUrlForCid(doc && doc.cid);
  if (!url) throw new Error("This form can't be found.");
  const signature = await signMessage(
    "Authorize DIDLab IPFS upload\nAddress:" +
      getAddress(account) +
      "\nTimestamp:" +
      doc.timestamp
  );
  const response = await fetch(url);
  if (!response.ok) throw new Error("The form couldn't be downloaded. Try again shortly.");
  const ciphertext = await response.arrayBuffer();
  const material = hexToBytes(keccak256(hexToBytes(signature)));
  const key = await crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = Uint8Array.from(atob(doc.iv), (c) => c.charCodeAt(0));
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  } catch {
    throw new Error("This form was saved by a different wallet and can't be opened here.");
  }
  return new Blob([plain], { type: "application/pdf" });
}
