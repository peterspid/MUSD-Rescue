import type { Address } from "viem";
import type { NetworkKey } from "./chains";
import {
  borrowerOperationsAbi,
  hintHelpersAbi,
  interestRateManagerAbi,
  mUSDAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  stabilityPoolAbi,
  troveManagerAbi,
} from "./abis";

/**
 * Mezo MUSD protocol contracts.
 *
 * Source of truth: github.com/mezo-org/musd → solidity/artifacts/deployments/{matsnet,mainnet}/*.json
 * (matsnet = Mezo testnet; its MUSD.json address matches https://mezo.org/docs/users/resources/contracts-reference).
 * Every address below was checked live for deployed bytecode by `npm run probe` (scripts/probe-chain.ts).
 * No other file in this app may hard-code a contract address.
 */
export const MUSD_CONTRACTS: Record<NetworkKey, {
  BorrowerOperations: Address;
  TroveManager: Address;
  PriceFeed: Address;
  SortedTroves: Address;
  HintHelpers: Address;
  InterestRateManager: Address;
  StabilityPool: Address;
  MUSD: Address;
  Multicall3: Address;
}> = {
  testnet: {
    BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
    TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
    PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    SortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
    HintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
    InterestRateManager: "0xD4D6c36A592A2c5e86035A6bca1d57747a567f37",
    StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
    MUSD: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
    Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
  mainnet: {
    BorrowerOperations: "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
    TroveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
    PriceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
    SortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
    HintHelpers: "0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3",
    InterestRateManager: "0x4a453700d157717Fe02fB62E7700ED7845048285",
    StabilityPool: "0x73245Eff485aB3AAc1158B3c4d8f4b23797B0e32",
    MUSD: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
    Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
};

export const ABIS = {
  BorrowerOperations: borrowerOperationsAbi,
  TroveManager: troveManagerAbi,
  PriceFeed: priceFeedAbi,
  SortedTroves: sortedTrovesAbi,
  HintHelpers: hintHelpersAbi,
  InterestRateManager: interestRateManagerAbi,
  StabilityPool: stabilityPoolAbi,
  MUSD: mUSDAbi,
} as const;

export const MUSD_TOKEN = {
  symbol: "MUSD",
  name: "Mezo USD",
  decimals: 18,
} as const;

export const BTC_COLLATERAL = {
  symbol: "BTC",
  name: "Bitcoin (native gas token on Mezo)",
  decimals: 18,
} as const;

export const CONTRACT_SOURCES = {
  repo: "https://github.com/mezo-org/musd",
  testnetArtifacts: "https://github.com/mezo-org/musd/tree/main/solidity/artifacts/deployments/matsnet",
  mainnetArtifacts: "https://github.com/mezo-org/musd/tree/main/solidity/artifacts/deployments/mainnet",
  docs: "https://mezo.org/docs/users/resources/contracts-reference",
} as const;

/**
 * Per-function gas floors. Mezo testnet enforces the EIP-7623 calldata floor and the public RPC has been
 * observed returning bogus (too-low) estimates, so every write carries an explicit gas limit:
 * gas = max(estimate * 13 / 10, floor), and any estimate < 30k is treated as invalid.
 */
export const GAS_FLOORS = {
  repayMUSD: 450_000n,
  addColl: 450_000n,
  adjustTrove: 550_000n,
  closeTrove: 450_000n,
} as const;
