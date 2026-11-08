// Portal session: wallet sign-in against the server, plus permission-based
// visibility. Any element with data-requires="<permission>" is shown only
// when the signed-in wallet holds that permission.
//
// Hiding is a convenience, not the security boundary. The server checks the
// same permissions on its routes, and the contracts check CredentialRegistry.

const SIGNED_OUT = { address: null, roles: [], permissions: [] };

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error || "Request failed."), {
      status: response.status
    });
  }
  return body;
}

function utf8ToHex(text) {
  return (
    "0x" +
    Array.from(new TextEncoder().encode(text), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("")
  );
}

export async function fetchSession() {
  try {
    return await api("/api/me");
  } catch {
    // Static hosting with no Node process: behave as signed out.
    return SIGNED_OUT;
  }
}

export async function signIn(address) {
  const { nonce, message } = await api("/api/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address })
  });
  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [utf8ToHex(message), address]
  });
  return api("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ nonce, signature })
  });
}

export async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // Already signed out or no server.
  }
  return SIGNED_OUT;
}

export function applyPermissions(permissions) {
  const held = new Set(permissions || []);
  for (const el of document.querySelectorAll("[data-requires]")) {
    el.hidden = !held.has(el.dataset.requires);
  }
}

export { api, SIGNED_OUT };
