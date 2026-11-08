// Portal user management. Only rendered for wallets holding users.manage;
// the server enforces the same rule on /api/admin/*.
//
// Saving a user does two things:
//   1. PUT /api/admin/users/:address  -> portal roles (what the UI shows).
//   2. CredentialRegistry.grant/revoke -> on-chain credentials (what
//      BeefSupplyChain actually checks), signed by the admin's own wallet.
// Only PROCESSOR, INSPECTOR and CUSTODIAN exist on chain; ADMIN is portal-only.
// grant/revoke are restricted to issuerOf[type], so the connected wallet must
// be the registered issuer for each credential it changes.

import {
  createWalletClient,
  custom,
  keccak256,
  stringToHex,
  zeroAddress,
  BaseError,
  ContractFunctionRevertedError
} from "https://esm.sh/viem@2";
import { api } from "./session.js";
import { registryAbi } from "./registryAbi.js";
import {
  EXPLORER_BASE,
  REQUIRED_CHAIN_ID,
  credentialRegistryAddress,
  chain,
  publicClient,
  isUserRejection
} from "./chain.js";

const list = document.getElementById("adminUsers");
const form = document.getElementById("adminUserForm");
const status = document.getElementById("adminStatus");
const roleBoxes = document.getElementById("adminRoleBoxes");
const chainLog = document.getElementById("adminChainLog");
const saveButton = form.querySelector("button[type=submit]");

const CHAIN_ROLES = ["PROCESSOR", "INSPECTOR", "CUSTODIAN"];
// Matches `keccak256("PROCESSOR")` etc. in CredentialRegistry.sol.
const credentialType = (role) => keccak256(stringToHex(role));

let catalog = [];
let annotateRun = 0;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function txLink(hash) {
  return el(
    "a",
    {
      href: EXPLORER_BASE + "/tx/" + hash,
      target: "_blank",
      rel: "noopener noreferrer"
    },
    hash.slice(0, 10) + "…"
  );
}

function registryRead(functionName, args) {
  return publicClient.readContract({
    address: credentialRegistryAddress,
    abi: registryAbi,
    functionName,
    args
  });
}

function renderRoleBoxes() {
  roleBoxes.replaceChildren(
    ...catalog.map((role) =>
      el(
        "label",
        { className: "role-option" },
        el("input", { type: "checkbox", name: "roles", value: role.name }),
        el(
          "span",
          { className: "role-option-text" },
          el(
            "span",
            { className: "role-option-name" },
            role.name,
            CHAIN_ROLES.includes(role.name)
              ? el("span", { className: "role-option-tag" }, "on-chain")
              : ""
          ),
          el("span", { className: "role-option-desc" }, role.description)
        )
      )
    )
  );
}

function renderUsers(users) {
  if (!users.length) {
    list.replaceChildren(el("li", { className: "muted" }, "No portal users yet."));
    return;
  }
  list.replaceChildren(
    ...users.map((user) => {
      const edit = el("button", { type: "button", className: "btn btn-ghost btn-small" }, "Edit");
      edit.onclick = () => {
        form.address.value = user.address;
        form.label.value = user.label;
        for (const box of form.querySelectorAll("input[name=roles]")) {
          box.checked = user.roles.includes(box.value);
        }
        form.address.focus();
      };
      const remove = el("button", { type: "button", className: "btn btn-ghost btn-small" }, "Remove");
      remove.onclick = async () => {
        if (!confirm("Remove " + user.address + " from the portal?")) return;
        status.textContent = "Saving…";
        try {
          const { users: next } = await api("/api/admin/users/" + user.address, {
            method: "DELETE"
          });
          renderUsers(next);
          status.textContent =
            "Removed from the portal. On-chain credentials are unchanged; " +
            "edit the user and clear their roles first to revoke them.";
        } catch (error) {
          status.textContent = error.message;
        }
      };
      return el(
        "li",
        { className: "admin-user" },
        el(
          "div",
          {},
          el("code", {}, user.address),
          user.label ? el("span", { className: "muted" }, " — " + user.label) : "",
          el("div", { className: "role-chips" },
            ...(user.roles.length
              ? user.roles.map((r) => {
                  const chip = el("span", { className: "role-chip" }, r);
                  chip.dataset.role = r;
                  return chip;
                })
              : [el("span", { className: "muted" }, "no roles")]))
        ),
        el("div", { className: "admin-actions" }, edit, remove)
      );
    })
  );
  annotateOnChain(users);
}

// Flag chain-backed portal roles that have no valid credential on chain.
// Those wallets see the UI for the role but their contract calls revert.
async function annotateOnChain(users) {
  const runId = ++annotateRun;
  const checks = users.flatMap((user) =>
    user.roles
      .filter((r) => CHAIN_ROLES.includes(r))
      .map((role) => ({ user, role }))
  );
  const results = await Promise.all(
    checks.map(({ user, role }) =>
      registryRead("isValid", [user.address, credentialType(role)]).catch(() => null)
    )
  );
  if (runId !== annotateRun) return;
  checks.forEach(({ user, role }, i) => {
    const chip = [...list.querySelectorAll(".admin-user")]
      .find((li) => li.querySelector("code")?.textContent === user.address)
      ?.querySelector(`.role-chip[data-role="${role}"]`);
    if (!chip || results[i] === null) return;
    chip.classList.toggle("role-chip-warn", !results[i]);
    chip.title = results[i]
      ? "Valid credential in CredentialRegistry."
      : "No valid credential in CredentialRegistry. Contract writes for this role will revert.";
  });
}

// Work out which credentials must change so the chain matches the form.
// `credentials` is private on the registry, so isValid is all we can see:
// grant when wanted and not valid (also renews an expired one), revoke only
// when unwanted and currently valid (revoke on a missing one would revert).
async function planCredentials(address, roles) {
  const wanted = CHAIN_ROLES.filter((r) => catalog.some((c) => c.name === r));
  const valid = await Promise.all(
    wanted.map((role) => registryRead("isValid", [address, credentialType(role)]))
  );
  return wanted.flatMap((role, i) => {
    const want = roles.includes(role);
    if (want && !valid[i]) return [{ role, action: "grant" }];
    if (!want && valid[i]) return [{ role, action: "revoke" }];
    return [];
  });
}

function logLine(change) {
  const li = el("li", {}, el("strong", {}, change.role), " ");
  const text = el("span", {}, change.action + ": queued");
  li.append(text);
  chainLog.append(li);
  return (message, hash, tone) => {
    text.textContent = change.action + ": " + message;
    li.className = tone || "";
    if (hash) li.append(" ", txLink(hash));
  };
}

function revertName(error) {
  const reverted =
    error instanceof BaseError
      ? error.walk((e) => e instanceof ContractFunctionRevertedError)
      : null;
  return reverted ? reverted.data?.errorName || reverted.shortMessage : null;
}

async function syncCredentials(address, plan) {
  chainLog.replaceChildren();
  chainLog.hidden = false;
  const lines = new Map(plan.map((change) => [change, logLine(change)]));
  const skipAll = (message) => {
    for (const set of lines.values()) set(message, null, "is-skipped");
  };

  if (!window.ethereum) {
    skipAll("skipped, no wallet detected");
    return { done: 0, total: plan.length };
  }
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const walletChainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
  if (walletChainId !== REQUIRED_CHAIN_ID) {
    skipAll("skipped, switch your wallet to DIDLab and save again");
    return { done: 0, total: plan.length };
  }

  // grant/revoke revert with NotIssuer unless msg.sender is issuerOf[type].
  // Check up front so the admin sees who must sign instead of a revert.
  const issuers = await Promise.all(
    plan.map((c) => registryRead("issuerOf", [credentialType(c.role)]))
  );

  // Expiry is compared to block.timestamp, so base it on the chain's clock.
  let expiresAt = 0n;
  if (plan.some((c) => c.action === "grant")) {
    const days = Math.max(1, Math.floor(Number(form.validDays.value) || 30));
    const latest = await publicClient.getBlock();
    expiresAt = latest.timestamp + BigInt(days) * 86400n;
  }

  const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  let done = 0;

  // One transaction per credential, sequentially, so each wallet prompt maps
  // to one line in the log and a rejection only skips that credential.
  for (const [i, change] of plan.entries()) {
    const set = lines.get(change);
    if (issuers[i] === zeroAddress) {
      set(
        "skipped, no " + change.role + " issuer is set in CredentialRegistry " +
          "(the registry admin must call setIssuer first)",
        null,
        "is-skipped"
      );
      continue;
    }
    if (issuers[i].toLowerCase() !== account.toLowerCase()) {
      set(
        "skipped, only the " + change.role + " issuer " + issuers[i] + " can sign this",
        null,
        "is-skipped"
      );
      continue;
    }
    try {
      set("simulating…");
      const typeHash = credentialType(change.role);
      const { request } = await publicClient.simulateContract({
        address: credentialRegistryAddress,
        abi: registryAbi,
        functionName: change.action,
        args: change.action === "grant" ? [address, typeHash, expiresAt] : [address, typeHash],
        account
      });
      set("waiting for wallet approval…");
      const hash = await walletClient.writeContract(request);
      set("pending", hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status === "success") {
        done += 1;
        set(change.action === "grant" ? "granted" : "revoked", null, "is-ok");
      } else {
        set("reverted on chain (gas used)", null, "is-error");
      }
    } catch (error) {
      if (isUserRejection(error)) {
        set("rejected in wallet, nothing sent", null, "is-skipped");
      } else {
        const name = revertName(error);
        set(
          name
            ? "would revert (" + name + "), nothing sent"
            : "failed: " + (error.shortMessage || error.message),
          null,
          "is-error"
        );
      }
    }
  }
  return { done, total: plan.length };
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const address = form.address.value.trim().toLowerCase();
  const roles = [...form.querySelectorAll("input[name=roles]:checked")].map((b) => b.value);
  saveButton.disabled = true;
  chainLog.hidden = true;
  status.textContent = "Saving portal roles…";
  try {
    const { users } = await api("/api/admin/users/" + encodeURIComponent(address), {
      method: "PUT",
      body: JSON.stringify({ label: form.label.value.trim(), roles })
    });
    renderUsers(users);

    status.textContent = "Portal roles saved. Checking CredentialRegistry…";
    const plan = await planCredentials(address, roles);
    if (!plan.length) {
      status.textContent = "Saved " + address + ". On-chain credentials already match.";
      return;
    }

    status.textContent =
      "Portal roles saved. Updating " + plan.length + " on-chain credential" +
      (plan.length === 1 ? "" : "s") + "; approve each transaction in your wallet.";
    const { done, total } = await syncCredentials(address, plan);
    status.textContent =
      done === total
        ? "Saved " + address + ". Portal roles and on-chain credentials match."
        : "Portal roles saved. " + done + " of " + total +
          " on-chain changes went through; see below. Save again to retry.";
    annotateOnChain(users);
  } catch (error) {
    status.textContent = error.shortMessage || error.message;
  } finally {
    saveButton.disabled = false;
  }
};

export async function loadAdmin() {
  status.textContent = "";
  try {
    const data = await api("/api/admin/users");
    catalog = data.roles;
    renderRoleBoxes();
    renderUsers(data.users);
  } catch (error) {
    status.textContent = error.message;
  }
}
