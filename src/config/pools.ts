import { parseAbi } from "viem";
import { MUSD_CONTRACTS } from "./contracts";

/**
 * Mezo Pools (Aerodrome/Velodrome-style AMM) on Mezo testnet, used for the in-app BTC → MUSD swap so a borrower
 * can fund a repayment or a RescueGuard reserve without leaving the app. Verified on-chain 2026-11-14:
 * router.getAmountsOut quotes the volatile BTC/MUSD pool through the default factory.
 *
 * BTC is Mezo's native gas token and also an ERC-20 precompile at 0x7b7C…0000 that shares the same balance.
 * Swapping it needs a normal `approve` to the router, and the wallet must keep some BTC back for gas.
 */
export const MEZO_POOLS = {
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9" as const,
  factory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A" as const,
  btcToken: "0x7b7C000000000000000000000000000000000000" as const,
  musd: MUSD_CONTRACTS.testnet.MUSD,
};

/** BTC kept back for gas when swapping "max" (Mezo gas is ~150 wei, so this covers hundreds of transactions). */
export const SWAP_BTC_GAS_RESERVE = 20_000_000_000_000n; // 0.00002 BTC

export const SWAP_ROUTE_BTC_TO_MUSD = [{ from: MEZO_POOLS.btcToken, to: MEZO_POOLS.musd, stable: false, factory: MEZO_POOLS.factory }] as const;

export const mezoRouterAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** MUSD's EIP-2612 surface (domain name "Mezo USD"). */
export const musdPermitAbi = parseAbi([
  "function nonces(address owner) view returns (uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

/** BorrowerOperationsSignatures: the EIP-712 entry point RescueGuard executes through. */
export const borrowerOperationsSignaturesAbi = parseAbi([
  "function getNonce(address user) view returns (uint256)",
  "function addCollWithSignature(address _upperHint, address _lowerHint, address _borrower, bytes _signature, uint256 _deadline) payable",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);

/** Gas floors for the new write paths (gas = max(estimate × 1.3, floor)); see GAS_FLOORS in contracts.ts. */
export const GUARD_GAS_FLOORS = {
  swap: 450_000n,
  approve: 90_000n,
  armRepayWithPermit: 400_000n,
  armAddColl: 350_000n,
  deposit: 200_000n,
  withdraw: 150_000n,
  disarm: 80_000n,
  /** 1-wei signed top-up through BorrowerOperationsSignatures that moves the nonce on */
  retire: 1_000_000n,
  exit: 250_000n,
  /** execute = guard checks + BorrowerOperationsSignatures + a full trove adjustment and re-sort */
  execute: 1_200_000n,
} as const;
