import { defineChain } from "viem";

/**
 * Mezo network definitions. Values verified live on 2026-10-26
 * (eth_chainId on both RPCs, Blockscout explorers reachable).
 */
export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.test.mezo.org"],
      webSocket: ["wss://rpc-ws.test.mezo.org"],
    },
  },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org", apiUrl: "https://api.explorer.test.mezo.org/api" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const mezoMainnet = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mezo.drpc.org", "https://mainnet.mezo.public.validationcloud.io"] },
  },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.mezo.org", apiUrl: "https://api.explorer.mezo.org/api" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export type NetworkKey = "testnet" | "mainnet";

export const NETWORKS = {
  testnet: {
    key: "testnet" as const,
    chain: mezoTestnet,
    label: "Mezo Testnet",
    explorer: "https://explorer.test.mezo.org",
    explorerApi: "https://api.explorer.test.mezo.org/api/v2",
    rpc: process.env.NEXT_PUBLIC_MEZO_TESTNET_RPC || "https://rpc.test.mezo.org",
    faucet: "https://faucet.test.mezo.org/",
    /** Rescue transactions are only ever prepared on the testnet. */
    writesEnabled: true,
  },
  mainnet: {
    key: "mainnet" as const,
    chain: mezoMainnet,
    label: "Mezo Mainnet",
    explorer: "https://explorer.mezo.org",
    explorerApi: "https://api.explorer.mezo.org/api/v2",
    rpc: process.env.NEXT_PUBLIC_MEZO_MAINNET_RPC || "https://mezo.drpc.org",
    faucet: null,
    /** Mainnet is read-only analytics in MUSD Rescue — no write path exists. */
    writesEnabled: false,
  },
} as const;

export const PRIMARY_CHAIN_ID = mezoTestnet.id;

export type NetworkSupport =
  | { kind: "supported"; network: NetworkKey; label: string; writes: true }
  | { kind: "read-only"; network: NetworkKey; label: string; writes: false }
  | { kind: "unsupported"; chainId: number | undefined; label: string; writes: false };

/**
 * Classify a wallet chain id. Pure so it can be unit tested.
 * - 31611 (Mezo testnet): full support, rescue transactions allowed.
 * - 31612 (Mezo mainnet): positions are readable, but this build never prepares mainnet transactions.
 * - anything else / undefined: unsupported, the user must switch through their wallet.
 */
export function classifyChain(chainId: number | undefined | null): NetworkSupport {
  if (chainId === mezoTestnet.id) return { kind: "supported", network: "testnet", label: "Mezo Testnet", writes: true };
  if (chainId === mezoMainnet.id) return { kind: "read-only", network: "mainnet", label: "Mezo Mainnet (read-only)", writes: false };
  return {
    kind: "unsupported",
    chainId: chainId ?? undefined,
    label: chainId == null ? "No network" : `Unsupported network (chain ${chainId})`,
    writes: false,
  };
}

export function explorerTx(hash: string, network: NetworkKey = "testnet") {
  return `${NETWORKS[network].explorer}/tx/${hash}`;
}
export function explorerAddress(addr: string, network: NetworkKey = "testnet") {
  return `${NETWORKS[network].explorer}/address/${addr}`;
}
export function explorerBlock(n: bigint | number, network: NetworkKey = "testnet") {
  return `${NETWORKS[network].explorer}/block/${n.toString()}`;
}
