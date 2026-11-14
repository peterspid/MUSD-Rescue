import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mezoTestnet, NETWORKS } from "./chains";

/**
 * wagmi: injected connector + EIP-6963 multi-injected discovery (MetaMask, Rabby, OKX… appear automatically).
 * Only Mezo testnet is configured for writes; mainnet is read-only analytics and never used for transactions.
 */
export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [mezoTestnet.id]: http(NETWORKS.testnet.rpc) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
