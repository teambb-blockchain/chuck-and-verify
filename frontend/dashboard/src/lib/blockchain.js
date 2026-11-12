import { JsonRpcProvider } from "ethers";

export const DIDLAB_RPC = "https://eth.didlab.org";
export const DIDLAB_CHAIN_ID = 252501;

export const provider = new JsonRpcProvider(
  DIDLAB_RPC,
  DIDLAB_CHAIN_ID
);