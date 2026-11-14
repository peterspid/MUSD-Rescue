import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Compile/test/verify only. Deployment to Mezo testnet is done by ../scripts/deploy-guard.ts (viem, explicit gas,
// key read at runtime from a file outside the repo).
// Mezo notes: evmVersion london (no mcopy/push0 surprises) and OpenZeppelin 5.0.2.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "london",
    },
  },
  networks: {
    mezotestnet: { url: "https://rpc.test.mezo.org", chainId: 31611 },
  },
  etherscan: {
    apiKey: { mezotestnet: "blockscout" },
    customChains: [
      {
        network: "mezotestnet",
        chainId: 31611,
        urls: { apiURL: "https://api.explorer.test.mezo.org/api", browserURL: "https://explorer.test.mezo.org" },
      },
    ],
  },
  sourcify: { enabled: false },
  mocha: { timeout: 120000 },
};

export default config;
