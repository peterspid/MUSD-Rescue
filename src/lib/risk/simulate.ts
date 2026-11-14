import { WAD, computeCR, computeNominalCR, min } from "./math";
import type { ProtocolParams } from "./params";
import type { PositionAmounts } from "./position";
import { assessPosition, assessSystem, maxRepayWithoutClosing, type PositionRisk, type RiskThresholds, DEFAULT_THRESHOLDS } from "./health";

export interface AdjustmentInput {
  /** MUSD to repay (18 decimals). Paid against interest first, then principal (InterestRateMath.calculateDebtAdjustment). */
  repay?: bigint;
  /** BTC to add as collateral (18 decimals). */
  addColl?: bigint;
  /** MUSD to borrow — calculator only; MUSD Rescue never prepares debt-increasing transactions. */
  borrow?: bigint;
}

export interface SimulationContext {
  position: PositionAmounts;
  /** Oracle price (18 decimals). null when the price is unavailable or stale. */
  price: bigint | null;
  params: ProtocolParams;
  system: { totalColl: bigint; totalDebt: bigint };
  active: boolean;
  /** Trove's max borrowing capacity (only needed for borrow scenarios). */
  maxBorrowingCapacity?: bigint;
  /** Wallet balances if known (undefined = not connected / unknown). */
  wallet?: { musd?: bigint; btc?: bigint };
  thresholds?: RiskThresholds;
}

export type CheckLevel = "block" | "warn" | "info";
export interface Check {
  id:
    | "negative"
    | "zero"
    | "both-directions"
    | "inactive"
    | "no-price"
    | "icr-below-mcr"
    | "tcr-below-ccr"
    | "recovery-borrow"
    | "exceeds-debt"
    | "min-net-debt"
    | "musd-balance"
    | "musd-balance-unknown"
    | "btc-balance"
    | "btc-gas-reserve"
    | "borrow-capacity"
    | "still-liquidatable"
    | "worse";
  level: CheckLevel;
  message: string;
}

export interface SimulationResult {
  ok: boolean;
  checks: Check[];
  recoveryMode: boolean;
  before: PositionRisk | null;
  after: PositionRisk | null;
  newPosition: PositionAmounts | null;
  interestPaid: bigint;
  principalPaid: bigint;
  borrowingFee: bigint;
  /** NICR used to re-insert the trove into SortedTroves: coll × 1e20 / principal (principal only, no interest). */
  newNICR: bigint | null;
  newTCR: bigint | null;
  maxRepay: bigint;
  /** True when the requested repayment can only be done by closing the trove. */
  closeTroveRequired: boolean;
}

/** Leave a little BTC for gas when adding collateral (gas on Mezo testnet costs fractions of a satoshi, but never 0). */
export const BTC_GAS_RESERVE = 10n ** 12n; // 0.000001 BTC

const fmt = (v: bigint) => {
  const whole = v / WAD;
  const frac = ((v % WAD) * 100n) / WAD;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
};

/**
 * Simulate a trove adjustment exactly the way BorrowerOperations._adjustTrove validates it.
 * Every "block" check corresponds to a `require` in the contract (or a wallet-balance precondition),
 * so a simulation with ok === true is one the contract is expected to accept at this price.
 */
export function simulateAdjustment(ctx: SimulationContext, input: AdjustmentInput): SimulationResult {
  const { position: p, params } = ctx;
  const thresholds = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  const repay = input.repay ?? 0n;
  const addColl = input.addColl ?? 0n;
  const borrow = input.borrow ?? 0n;
  const checks: Check[] = [];
  const maxRepay = maxRepayWithoutClosing(p, params);
  const base: SimulationResult = {
    ok: false,
    checks,
    recoveryMode: false,
    before: null,
    after: null,
    newPosition: null,
    interestPaid: 0n,
    principalPaid: 0n,
    borrowingFee: 0n,
    newNICR: null,
    newTCR: null,
    maxRepay,
    closeTroveRequired: false,
  };

  if (repay < 0n || addColl < 0n || borrow < 0n) {
    checks.push({ id: "negative", level: "block", message: "Amounts cannot be negative." });
    return base;
  }
  if (repay > 0n && borrow > 0n) {
    checks.push({ id: "both-directions", level: "block", message: "A single adjustment either repays or borrows, not both." });
    return base;
  }
  if (repay === 0n && addColl === 0n && borrow === 0n) {
    checks.push({ id: "zero", level: "block", message: "Enter a repayment or a collateral amount." });
    return base;
  }
  if (!ctx.active) {
    checks.push({ id: "inactive", level: "block", message: "This address has no active trove. The contract rejects adjustments with \"Trove does not exist or is closed\"." });
    return base;
  }
  if (ctx.price == null || ctx.price === 0n) {
    checks.push({
      id: "no-price",
      level: "block",
      message: "No fresh oracle price. PriceFeed.fetchPrice() reverts when the oracle is more than 60 s old, so every trove operation would fail right now.",
    });
    return base;
  }
  const price = ctx.price;
  const sys = assessSystem({ totalColl: ctx.system.totalColl, totalDebt: ctx.system.totalDebt, price }, params);
  const recoveryMode = sys.recoveryMode;
  base.recoveryMode = recoveryMode;
  base.before = assessPosition(p, price, params, recoveryMode, thresholds);

  // Interest first, then principal.
  const interestPaid = min(repay, p.interest);
  const principalPaid = repay - interestPaid;
  // Borrowing fee is waived in Recovery Mode.
  const borrowingFee = borrow > 0n && !recoveryMode ? (borrow * params.borrowingRate) / WAD : 0n;
  const debtIncrease = borrow + borrowingFee;

  if (repay > 0n && repay > p.debt - min(p.debt, params.gasCompensation)) {
    checks.push({ id: "exceeds-debt", level: "block", message: `The repayment is larger than the repayable debt (${fmt(p.netDebt)} MUSD; the last 200 MUSD is covered by the gas pool).` });
  }
  if (repay > 0n && repay > maxRepay) {
    base.closeTroveRequired = true;
    checks.push({
      id: "min-net-debt",
      level: "block",
      message: `Net debt must stay at or above ${fmt(params.minNetDebt)} MUSD, so at most ${fmt(maxRepay)} MUSD can be repaid without closing. Repaying everything means closing the trove (needs ${fmt(p.netDebt)} MUSD${recoveryMode ? ", and closing is not allowed during Recovery Mode" : ""}).`,
    });
  }

  const newColl = p.coll + addColl;
  const newInterest = p.interest - interestPaid;
  const newPrincipal = p.principal - min(principalPaid, p.principal) + debtIncrease;
  const newDebt = newPrincipal + newInterest;
  const newPosition: PositionAmounts = {
    coll: newColl,
    principal: newPrincipal,
    interest: newInterest,
    debt: newDebt,
    netDebt: newDebt > params.gasCompensation ? newDebt - params.gasCompensation : 0n,
  };
  base.newPosition = newPosition;
  base.interestPaid = interestPaid;
  base.principalPaid = principalPaid;
  base.borrowingFee = borrowingFee;
  base.newNICR = computeNominalCR(newColl, newPrincipal);

  const sysCollAfter = ctx.system.totalColl + addColl;
  const sysDebtAfter = ctx.system.totalDebt + debtIncrease - min(repay, ctx.system.totalDebt);
  base.newTCR = computeCR(sysCollAfter, sysDebtAfter, price);

  const oldICR = computeCR(p.coll, p.debt, price);
  const newICR = computeCR(newColl, newDebt, price);
  base.after = assessPosition(newPosition, price, params, recoveryMode, thresholds);

  if (!recoveryMode) {
    // _requireValidAdjustmentInNormalMode: newICR >= MCR and newTCR >= CCR — applies to repayments and top-ups too.
    if (newICR != null && newICR < params.mcr) {
      checks.push({
        id: "icr-below-mcr",
        level: "block",
        message: "In Normal Mode the contract rejects any adjustment that leaves ICR below 110%. This rescue is too small and would revert — increase the amount.",
      });
    }
    if (base.newTCR != null && base.newTCR < params.ccr) {
      checks.push({ id: "tcr-below-ccr", level: "block", message: "The adjustment would pull the system TCR below 150%, which the contract does not permit." });
    }
  } else if (borrow > 0n) {
    // _requireValidAdjustmentInRecoveryMode: a debt increase needs ICR >= CCR and an improving ICR.
    if (newICR == null || newICR < params.ccr || (oldICR != null && newICR < oldICR)) {
      checks.push({ id: "recovery-borrow", level: "block", message: "In Recovery Mode new debt is only allowed if it leaves ICR ≥ 150% and improves it." });
    }
  }

  if (borrow > 0n && ctx.maxBorrowingCapacity != null && ctx.maxBorrowingCapacity < p.debt + debtIncrease) {
    checks.push({ id: "borrow-capacity", level: "block", message: "This exceeds the trove's max borrowing capacity (fixed at 110% of collateral value when it was opened)." });
  }

  if (repay > 0n) {
    if (ctx.wallet?.musd === undefined) {
      checks.push({ id: "musd-balance-unknown", level: "warn", message: "Connect the trove owner's wallet to check its MUSD balance." });
    } else if (ctx.wallet.musd < repay) {
      checks.push({ id: "musd-balance", level: "block", message: `The wallet holds ${fmt(ctx.wallet.musd)} MUSD — not enough for this repayment.` });
    }
  }
  if (addColl > 0n && ctx.wallet?.btc !== undefined) {
    if (ctx.wallet.btc < addColl) {
      checks.push({ id: "btc-balance", level: "block", message: "The wallet does not hold enough BTC for this deposit." });
    } else if (ctx.wallet.btc - addColl < BTC_GAS_RESERVE) {
      checks.push({ id: "btc-gas-reserve", level: "warn", message: "This leaves almost no BTC for gas. Keep a small amount in the wallet." });
    }
  }

  if (newICR != null && newICR < base.after.threshold && recoveryMode) {
    checks.push({ id: "still-liquidatable", level: "warn", message: "After this action the trove is still below 110% and can still be liquidated." });
  }
  if (oldICR != null && newICR != null && newICR < oldICR) {
    checks.push({ id: "worse", level: "warn", message: "This adjustment lowers the collateral ratio." });
  }

  base.ok = !checks.some((c) => c.level === "block");
  return base;
}

/** Price scenario helper: the position assessed at a hypothetical price. */
export function assessAtPrice(
  p: PositionAmounts,
  price: bigint,
  params: ProtocolParams,
  system: { totalColl: bigint; totalDebt: bigint },
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
) {
  const sys = assessSystem({ ...system, price }, params);
  return { system: sys, position: assessPosition(p, price, params, sys.recoveryMode, thresholds) };
}
