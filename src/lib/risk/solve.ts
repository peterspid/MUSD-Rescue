import { WAD, ceilDiv, computeCR, min } from "./math";
import type { ProtocolParams } from "./params";
import type { PositionAmounts } from "./position";
import { healthFactor, maxRepayWithoutClosing } from "./health";

/** Convert a target health factor (WAD) into a target ICR (WAD) for a given liquidation threshold. */
export function targetICRFromHF(hf: bigint, threshold: bigint): bigint {
  return ceilDiv(hf * threshold, WAD);
}

export type SolveFailure = "no-price" | "no-collateral" | "no-debt" | "min-net-debt" | "invalid-target";

export interface RepaySolution {
  /** MUSD needed to reach the target (before applying the minNetDebt cap). */
  required: bigint;
  /** required, capped at the largest repayment allowed without closing. */
  capped: bigint;
  feasible: boolean;
  alreadyMet: boolean;
  reason?: SolveFailure;
  /** ICR reached if `capped` is repaid. */
  icrAtCapped: bigint | null;
}

/**
 * Smallest repayment R such that coll × price / (debt − R) ≥ targetICR.
 * targetDebt = floor(coll × price / target) guarantees floor(coll × price / targetDebt) ≥ target.
 */
export function repayToReachICR(p: PositionAmounts, price: bigint, targetICR: bigint, params: ProtocolParams): RepaySolution {
  const maxRepay = maxRepayWithoutClosing(p, params);
  const fail = (reason: SolveFailure): RepaySolution => ({ required: 0n, capped: 0n, feasible: false, alreadyMet: false, reason, icrAtCapped: null });
  if (targetICR <= 0n) return fail("invalid-target");
  if (p.debt === 0n) return { required: 0n, capped: 0n, feasible: true, alreadyMet: true, icrAtCapped: null };
  if (price === 0n) return fail("no-price");
  if (p.coll === 0n) return fail("no-collateral");
  const current = computeCR(p.coll, p.debt, price)!;
  if (current >= targetICR) return { required: 0n, capped: 0n, feasible: true, alreadyMet: true, icrAtCapped: current };
  const targetDebt = (p.coll * price) / targetICR;
  const required = p.debt - targetDebt;
  const capped = min(required, maxRepay);
  const feasible = required <= maxRepay;
  return {
    required,
    capped,
    feasible,
    alreadyMet: false,
    reason: feasible ? undefined : "min-net-debt",
    icrAtCapped: computeCR(p.coll, p.debt - capped, price),
  };
}

export interface CollSolution {
  required: bigint;
  feasible: boolean;
  alreadyMet: boolean;
  reason?: SolveFailure;
}

/** Smallest BTC deposit A such that (coll + A) × price / debt ≥ targetICR: newColl = ceil(target × debt / price). */
export function collToReachICR(p: PositionAmounts, price: bigint, targetICR: bigint): CollSolution {
  if (targetICR <= 0n) return { required: 0n, feasible: false, alreadyMet: false, reason: "invalid-target" };
  if (p.debt === 0n) return { required: 0n, feasible: true, alreadyMet: true };
  if (price === 0n) return { required: 0n, feasible: false, alreadyMet: false, reason: "no-price" };
  const current = computeCR(p.coll, p.debt, price)!;
  if (current >= targetICR) return { required: 0n, feasible: true, alreadyMet: true };
  const newColl = ceilDiv(targetICR * p.debt, price);
  return { required: newColl - p.coll, feasible: true, alreadyMet: false };
}

/** With a fixed repayment, how much BTC is still needed to reach the target. */
export function collAfterRepayToReachICR(p: PositionAmounts, price: bigint, targetICR: bigint, repay: bigint, params: ProtocolParams): CollSolution & { repay: bigint } {
  const r = min(repay, maxRepayWithoutClosing(p, params));
  const after: PositionAmounts = { ...p, debt: p.debt - r, interest: p.interest - min(r, p.interest), principal: p.principal - (r > p.interest ? r - p.interest : 0n), netDebt: p.netDebt - r };
  return { ...collToReachICR(after, price, targetICR), repay: r };
}

export interface RescueOption {
  id: "repay" | "collateral" | "combined";
  label: string;
  repay: bigint;
  addColl: bigint;
  /** USD value committed: repay (MUSD at $1) + addColl × price. */
  usdCommitted: bigint;
  icrAfter: bigint | null;
  hfAfter: bigint | null;
  feasible: boolean;
  note: string;
  tradeoff: string;
}

/**
 * Compare the three rescue shapes for reaching a target ICR. No option is auto-selected: the UI shows
 * all three with their trade-offs (liquidity used, BTC exposure kept, minNetDebt limits, wallet balance).
 */
export function compareRescueOptions(args: {
  position: PositionAmounts;
  price: bigint;
  targetICR: bigint;
  threshold: bigint;
  params: ProtocolParams;
  walletMusd?: bigint;
}): RescueOption[] {
  const { position: p, price, targetICR, threshold, params } = args;
  const options: RescueOption[] = [];
  const hfOf = (coll: bigint, debt: bigint) => healthFactor(computeCR(coll, debt, price), threshold);

  const r = repayToReachICR(p, price, targetICR, params);
  const repayAmt = r.capped;
  options.push({
    id: "repay",
    label: "Repay MUSD",
    repay: repayAmt,
    addColl: 0n,
    usdCommitted: repayAmt,
    icrAfter: computeCR(p.coll, p.debt - repayAmt, price),
    hfAfter: hfOf(p.coll, p.debt - repayAmt),
    feasible: r.feasible && (args.walletMusd === undefined || args.walletMusd >= repayAmt),
    note: r.alreadyMet
      ? "Target already met."
      : r.feasible
        ? args.walletMusd !== undefined && args.walletMusd < repayAmt
          ? "Wallet MUSD balance is too low for this amount."
          : "Burns MUSD from your wallet; no approval needed."
        : "Capped by the 1,800 MUSD minimum net debt — repayment alone cannot reach the target without closing.",
    tradeoff: "Reduces debt and interest cost permanently; uses stablecoin liquidity you may need elsewhere. BTC exposure unchanged.",
  });

  const c = collToReachICR(p, price, targetICR);
  options.push({
    id: "collateral",
    label: "Add BTC collateral",
    repay: 0n,
    addColl: c.required,
    usdCommitted: (c.required * price) / WAD,
    icrAfter: computeCR(p.coll + c.required, p.debt, price),
    hfAfter: hfOf(p.coll + c.required, p.debt),
    feasible: c.feasible,
    note: c.alreadyMet ? "Target already met." : "Sends BTC to the ActivePool with addColl().",
    tradeoff: "Keeps your MUSD; locks more BTC, which raises your exposure to a further BTC fall. Interest keeps accruing on the same debt.",
  });

  // Combined: put the wallet's MUSD (or half the required repayment) to work, cover the rest with BTC.
  const halfRepay = r.required / 2n;
  const repayPart = min(args.walletMusd !== undefined ? min(args.walletMusd, halfRepay) : halfRepay, maxRepayWithoutClosing(p, params));
  const mix = collAfterRepayToReachICR(p, price, targetICR, repayPart, params);
  const mixDebt = p.debt - mix.repay;
  options.push({
    id: "combined",
    label: "Repay part + add BTC",
    repay: mix.repay,
    addColl: mix.required,
    usdCommitted: mix.repay + (mix.required * price) / WAD,
    icrAfter: computeCR(p.coll + mix.required, mixDebt, price),
    hfAfter: hfOf(p.coll + mix.required, mixDebt),
    feasible: mix.feasible,
    note: "Executed as one adjustTrove() call with BTC attached.",
    tradeoff: "Splits the cost between stablecoin and BTC. Useful when your MUSD balance alone is not enough.",
  });
  return options;
}
