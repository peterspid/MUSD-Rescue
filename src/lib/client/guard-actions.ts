"use client";
/**
 * Wallet-side RescueGuard and Mezo Pools actions. Every write carries an explicit gas limit
 * (max(estimate × 1.3, floor)) because the Mezo RPC has returned bogus low estimates.
 * Functions return the transaction hash; callers wait for the receipt with `waitForSuccess`.
 */
import { getAddress, type Address, type Hex } from "viem";
import { getBlock, getPublicClient, readContract, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { wagmiConfig } from "@/config/wagmi";
import { mezoTestnet } from "@/config/chains";
import { MUSD_CONTRACTS } from "@/config/contracts";
import { RESCUE_GUARD, rescueGuardAbi } from "@/config/guard";
import { GUARD_GAS_FLOORS, MEZO_POOLS, SWAP_ROUTE_BTC_TO_MUSD, borrowerOperationsSignaturesAbi, erc20Abi, mezoRouterAbi, musdPermitAbi } from "@/config/pools";
import { computeGasLimit } from "../rescue/gas";
import { addCollAuthorizationTypedData, permitTypedData, repayAuthorizationTypedData, type Eip712Domain, type GuardKind } from "../guard/plan";

const CHAIN_ID = mezoTestnet.id;
const G = { address: RESCUE_GUARD.address, abi: rescueGuardAbi, chainId: CHAIN_ID } as const;
const pc = () => getPublicClient(wagmiConfig, { chainId: CHAIN_ID })!;

async function gasFor(params: Record<string, unknown>, floor: bigint): Promise<bigint> {
  let estimate: bigint | null = null;
  try {
    estimate = await pc().estimateContractGas(params as never);
  } catch {
    estimate = null; // a revert here surfaces again (decoded) from simulate/write below
  }
  return computeGasLimit(estimate, floor).limit;
}

/** Simulate first so a revert is decoded into a RescueGuard custom error before the wallet opens. */
async function simulateAndWrite(params: Record<string, unknown>, floor: bigint): Promise<Hex> {
  await pc().simulateContract(params as never);
  const gas = await gasFor(params, floor);
  return writeContract(wagmiConfig, { ...(params as object), gas } as never);
}

async function domainOf(address: Address, abi: typeof borrowerOperationsSignaturesAbi | typeof musdPermitAbi): Promise<Eip712Domain> {
  const [, name, version, chainId, verifyingContract] = (await readContract(wagmiConfig, { address, abi, functionName: "eip712Domain", chainId: CHAIN_ID })) as readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];
  return { name, version, chainId: Number(chainId), verifyingContract };
}

export async function chainNow(): Promise<bigint> {
  return (await getBlock(wagmiConfig, { chainId: CHAIN_ID })).timestamp;
}

export interface ArmArgs {
  owner: string;
  kind: GuardKind;
  amount: bigint;
  keeperTip: bigint;
  triggerIcr: bigint;
  validityDays: number;
  /** Amount to deposit in this same transaction (MUSD via permit, or BTC as value). */
  deposit: bigint;
  onStep?: (step: string) => void;
}

/**
 * Arm (or re-arm) a plan: 1) sign the RepayMUSD/AddColl authorization for BorrowerOperationsSignatures (free),
 * 2) for MUSD, sign an EIP-2612 permit for the deposit (free), 3) one transaction that deposits and stores the plan.
 */
export async function armPlan(a: ArmArgs): Promise<Hex> {
  const owner = getAddress(a.owner);
  const [bosDomain, nonce, now] = await Promise.all([
    domainOf(RESCUE_GUARD.borrowerOperationsSignatures, borrowerOperationsSignaturesAbi),
    readContract(wagmiConfig, { address: RESCUE_GUARD.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [owner], chainId: CHAIN_ID }),
    chainNow(),
  ]);
  const deadline = now + BigInt(Math.round(a.validityDays * 86_400));
  const msg = { amount: a.amount, borrower: owner, nonce, deadline };
  a.onStep?.("Sign the rescue authorization in your wallet. This is free and sends nothing.");
  const signature =
    a.kind === "repay"
      ? await signTypedData(wagmiConfig, { account: owner, ...repayAuthorizationTypedData(bosDomain, msg) })
      : await signTypedData(wagmiConfig, { account: owner, ...addCollAuthorizationTypedData(bosDomain, msg) });
  const plan = { amount: a.amount, keeperTip: a.keeperTip, triggerIcr: a.triggerIcr, deadline };

  if (a.kind === "addColl") {
    a.onStep?.("Confirm the transaction that stores the plan and deposits the BTC reserve.");
    return simulateAndWrite({ ...G, functionName: "armAddColl", args: [plan, signature], value: a.deposit, account: owner }, GUARD_GAS_FLOORS.armAddColl);
  }
  if (a.deposit === 0n) {
    a.onStep?.("Confirm the transaction that stores the plan.");
    return simulateAndWrite({ ...G, functionName: "armRepay", args: [plan, signature], account: owner }, GUARD_GAS_FLOORS.armRepayWithPermit);
  }
  const permit = await signMusdPermit(owner, a.deposit, now + 3_600n, a.onStep);
  a.onStep?.("Confirm the transaction that deposits the MUSD and stores the plan.");
  return simulateAndWrite({ ...G, functionName: "armRepayWithPermit", args: [plan, signature, permit], account: owner }, GUARD_GAS_FLOORS.armRepayWithPermit);
}

async function signMusdPermit(owner: Address, value: bigint, deadline: bigint, onStep?: (s: string) => void) {
  const [domain, nonce] = await Promise.all([
    domainOf(MUSD_CONTRACTS.testnet.MUSD, musdPermitAbi),
    readContract(wagmiConfig, { address: MUSD_CONTRACTS.testnet.MUSD, abi: musdPermitAbi, functionName: "nonces", args: [owner], chainId: CHAIN_ID }),
  ]);
  onStep?.("Sign the MUSD permit in your wallet. It replaces a separate approve transaction.");
  const sig = await signTypedData(wagmiConfig, { account: owner, ...permitTypedData(domain, { owner, spender: RESCUE_GUARD.address, value, nonce, deadline }) });
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { value, deadline, v, r, s };
}

export async function depositMusd(owner: string, value: bigint, onStep?: (s: string) => void): Promise<Hex> {
  const o = getAddress(owner);
  const permit = await signMusdPermit(o, value, (await chainNow()) + 3_600n, onStep);
  onStep?.("Confirm the deposit transaction.");
  return simulateAndWrite({ ...G, functionName: "depositMUSDWithPermit", args: [permit], account: o }, GUARD_GAS_FLOORS.deposit);
}

export async function depositBtc(owner: string, value: bigint): Promise<Hex> {
  return simulateAndWrite({ ...G, functionName: "depositBTC", value, account: getAddress(owner) }, GUARD_GAS_FLOORS.deposit);
}

export async function withdrawReserve(owner: string, asset: "musd" | "btc", amount: bigint): Promise<Hex> {
  return simulateAndWrite({ ...G, functionName: asset === "musd" ? "withdrawMUSD" : "withdrawBTC", args: [amount], account: getAddress(owner) }, GUARD_GAS_FLOORS.withdraw);
}

export async function disarmPlan(owner: string): Promise<Hex> {
  return simulateAndWrite({ ...G, functionName: "disarm", account: getAddress(owner) }, GUARD_GAS_FLOORS.disarm);
}

export async function exitGuard(owner: string): Promise<Hex> {
  return simulateAndWrite({ ...G, functionName: "exit", account: getAddress(owner) }, GUARD_GAS_FLOORS.exit);
}

/** Run someone's ready rescue from the connected wallet (anyone can be the keeper). */
export async function executeRescue(caller: string, borrower: string, hints: { upper: string; lower: string }): Promise<Hex> {
  return simulateAndWrite(
    { ...G, functionName: "execute", args: [getAddress(borrower), getAddress(hints.upper), getAddress(hints.lower)], account: getAddress(caller) },
    GUARD_GAS_FLOORS.execute,
  );
}

// ---------------------------------------------------------------------------------------------
// Mezo Pools: BTC → MUSD.

export async function quoteBtcToMusd(amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const out = await pc().readContract({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "getAmountsOut", args: [amountIn, [...SWAP_ROUTE_BTC_TO_MUSD]] });
  return out[out.length - 1];
}

/** Approximate smallest BTC input that returns at least `musdOut` (accounts for price impact). */
export async function quoteBtcForMusd(musdOut: bigint): Promise<bigint> {
  if (musdOut <= 0n) return 0n;
  const probe = 10n ** 14n; // 0.0001 BTC
  const unitOut = await quoteBtcToMusd(probe);
  if (unitOut === 0n) throw new Error("The BTC/MUSD pool has no liquidity right now.");
  let amountIn = (musdOut * probe) / unitOut + 1n;
  for (let i = 0; i < 5; i++) {
    const out = await quoteBtcToMusd(amountIn);
    if (out >= musdOut) return amountIn;
    amountIn = (amountIn * musdOut * 1005n) / (out * 1000n) + 1n;
  }
  return amountIn;
}

/** Swap BTC for MUSD through Mezo Pools: approve the exact amount on the BTC precompile if needed, then swap. */
export async function swapBtcToMusd(opts: { owner: string; amountIn: bigint; minOut: bigint; onStep?: (s: string) => void }): Promise<Hex> {
  const owner = getAddress(opts.owner);
  const allowance = await readContract(wagmiConfig, { address: MEZO_POOLS.btcToken, abi: erc20Abi, functionName: "allowance", args: [owner, MEZO_POOLS.router], chainId: CHAIN_ID });
  if (allowance < opts.amountIn) {
    opts.onStep?.("Approve BTC for Mezo Pools (exact amount). BTC on Mezo is also an ERC-20, so the router needs this once per swap.");
    const hash = await simulateAndWrite({ address: MEZO_POOLS.btcToken, abi: erc20Abi, functionName: "approve", args: [MEZO_POOLS.router, opts.amountIn], account: owner, chainId: CHAIN_ID }, GUARD_GAS_FLOORS.approve);
    opts.onStep?.("Waiting for the approval to confirm…");
    await waitForSuccess(hash);
  }
  const deadline = (await chainNow()) + 1_200n;
  opts.onStep?.("Confirm the swap in your wallet.");
  return simulateAndWrite(
    { address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "swapExactTokensForTokens", args: [opts.amountIn, opts.minOut, [...SWAP_ROUTE_BTC_TO_MUSD], owner, deadline], account: owner, chainId: CHAIN_ID },
    GUARD_GAS_FLOORS.swap,
  );
}

export async function waitForSuccess(hash: Hex) {
  const rc = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: CHAIN_ID, pollingInterval: 2_000, timeout: 180_000 });
  if (rc.status !== "success") throw new Error("The transaction reverted on-chain. Nothing changed except the gas fee.");
  return rc;
}
