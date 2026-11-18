// Shared DIDLab chain config, contract addresses and a read-only client.
// app.js uses BeefSupplyChain; admin.js uses CredentialRegistry.

import { createPublicClient, http } from "https://esm.sh/viem@2";

export const EXPLORER_BASE = "https://explorer.didlab.org";
export const REQUIRED_CHAIN_ID = 252501;
// Every BeefSupplyChain deployment, newest first. The first entry is the one
// the app writes to; the verify page also looks up batches on the older ones
// (each redeploy starts with no batches, but the old records stay on chain).
// After a redeploy, add the new contract at the top. `deployBlock` is where
// the verify page starts reading a batch's events; for the current contract
// it is the same block the portal's index starts from (server/chainIndex.js).
// Every version keeps the v1 getBatch layout and event signatures, so the
// current ABI reads all of them; calls an old version lacks (getLotInfo,
// getStatus) are optional on the verify page.
export const BEEF_SUPPLY_CHAINS = Object.freeze([
  { version: 4, address: "0x7b9D401F1D62193b59e7b3d1C6dC6A5b7c7A4a49", deployBlock: 7649714 },
  { version: 3, address: "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0", deployBlock: 7384345 },
  { version: 2, address: "0x903359014d55A25ED1d4a8DCA6740dd30A90448a", deployBlock: 7269167 },
  { version: 1, address: "0x20bA1c398CD59b05dA4427162bdA7F26d5AB802e", deployBlock: 6223544 }
]);
export const beefSupplyChainAddress = BEEF_SUPPLY_CHAINS[0].address;
export const BEEF_SUPPLY_CHAIN_DEPLOY_BLOCK = BEEF_SUPPLY_CHAINS[0].deployBlock;
export const credentialRegistryAddress = "0x9ef5cb328aE86C968dDcb1Fd60887bd021D7AB2E";

export const chain = {
  id: REQUIRED_CHAIN_ID,
  name: "DIDLab Blockchain",
  nativeCurrency: {
    name: "TRUST",
    symbol: "TRUST",
    decimals: 18
  },
  rpcUrls: {
    default: { http: ["https://eth.didlab.org"] }
  }
};

export const publicClient = createPublicClient({
  chain,
  transport: http()
});

export function isUserRejection(error) {
  let current = error;
  while (current) {
    if (
      current.code === 4001 ||
      current.name === "UserRejectedRequestError"
    ) {
      return true;
    }
    current = current.cause;
  }
  const text = `${error?.shortMessage || ""} ${error?.message || ""}`;
  return /user rejected the request/i.test(text);
}
