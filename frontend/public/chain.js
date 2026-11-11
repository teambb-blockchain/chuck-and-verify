// Shared DIDLab chain config, contract addresses and a read-only client.
// app.js uses BeefSupplyChain; admin.js uses CredentialRegistry.

import { createPublicClient, http } from "https://esm.sh/viem@2";

export const EXPLORER_BASE = "https://explorer.didlab.org";
export const REQUIRED_CHAIN_ID = 252501;
export const beefSupplyChainAddress = "0x35c56b125da5d3e8CBFbB0e3f87cEC8CCD96b3e0";
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
