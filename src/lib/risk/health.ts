import { BPS, WAD, ceilDiv, computeCR } from "./math";
import type { ProtocolParams } from "./params";
import type { PositionAmounts } from "./position";

/**
 * Health factor definition used throughout MUSD Rescue:
 *
 *   HF = ICR / liquidationThreshold
 *
 * where ICR = coll × price / entireDebt (TroveManager.getCurrentICR) and the liquidation threshold is
 * MCR (110%). HF = 1.00 is the exact liquidation line; below it the trove can be liquidated by anyone.
 * For MUSD the threshold is MCR in both Normal and Recovery Mode (no recovery-mode liquidations), but
 * the engine accepts a protocol-specific recovery threshold so other adapters can differ.
 */
export function liquidationThreshold(params: ProtocolParams, recoveryMode: boolean): bigint {
  if (recoveryMode && params.recoveryModeLiquidationThreshold != null) return params.recoveryModeLiquidationThreshold;
  return params.mcr;
}

/** HF in WAD (1e18 = 1.00). null = no debt (infinite health). */
export function healthFactor(icr: bigint | null, threshold: bigint): bigint | null {
  if (icr == null) return null;
  if (threshold <= 0n) throw new RangeError("threshold must be positive");
  return (icr * WAD) / threshold;
}

/**
 * Collateral price at which ICR falls to the threshold: debt × threshold / coll (rounded up, so at any
 * price strictly below the returned value the position is liquidatable). null when there is no debt,
 * or when there is no collateral (then no price can save it; assessPosition reports a 0% distance).
 */
export function liquidationPrice(coll: bigint, debt: bigint, threshold: bigint): bigint | null {
  if (debt === 0n) return null;
  if (coll === 0n) return null;
  return ceilDiv(debt * threshold, coll);
}

/** How far (in bps of the current price) the collateral price can fall before liquidation. 0 if already at/below. */
export function priceDropToLiquidationBps(price: bigint, liqPrice: bigint | null): bigint | null {
  if (liqPrice == null) return null;
  if (price === 0n || liqPrice >= price) return 0n;
  return ((price - liqPrice) * BPS) / price;
}

export type RiskCategory = "no-debt" | "healthy" | "caution" | "high" | "critical" | "liquidatable" | "unknown";

/**
 * Configurable risk bands, expressed as health-factor boundaries (WAD). Product defaults from the spec:
 *   Healthy  HF > 2.0
 *   Caution  1.5 ≤ HF ≤ 2.0
 *   High     1.2 < HF < 1.5
 *   Critical 1.0 ≤ HF ≤ 1.2
 *   Liquidatable HF < 1.0 (ICR < MCR) — this one is the protocol rule, not a preference.
 */
export interface RiskThresholds {
  healthyAbove: bigint;
  cautionFrom: bigint;
  criticalAtOrBelow: bigint;
}

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  healthyAbove: 2n * WAD,
  cautionFrom: (15n * WAD) / 10n,
  criticalAtOrBelow: (12n * WAD) / 10n,
};

export function validateThresholds(t: RiskThresholds): string | null {
  if (!(t.criticalAtOrBelow > WAD)) return "Critical boundary must be above 1.00 (the liquidation line).";
  if (!(t.cautionFrom > t.criticalAtOrBelow)) return "Caution boundary must be above the critical boundary.";
  if (!(t.healthyAbove > t.cautionFrom)) return "Healthy boundary must be above the caution boundary.";
  if (t.healthyAbove > 20n * WAD) return "Healthy boundary must be 20.00 or lower.";
  return null;
}

export function classifyRisk(hf: bigint | null | undefined, t: RiskThresholds = DEFAULT_THRESHOLDS): RiskCategory {
  if (hf === undefined) return "unknown";
  if (hf === null) return "no-debt";
  if (hf < WAD) return "liquidatable";
  if (hf <= t.criticalAtOrBelow) return "critical";
  if (hf < t.cautionFrom) return "high";
  if (hf <= t.healthyAbove) return "caution";
  return "healthy";
}

export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  "no-debt": "No debt",
  healthy: "Healthy",
  caution: "Caution",
  high: "High risk",
  critical: "Critical",
  liquidatable: "Liquidatable",
  unknown: "Unknown",
};

/** Ordering used for sorting / counting (higher = more dangerous). */
export const CATEGORY_SEVERITY: Record<RiskCategory, number> = {
  "no-debt": 0,
  healthy: 1,
  caution: 2,
  high: 3,
  critical: 4,
  liquidatable: 5,
  unknown: 6,
};

export function needsAttention(c: RiskCategory): boolean {
  return c === "caution" || c === "high";
}
export function isCritical(c: RiskCategory): boolean {
  return c === "critical" || c === "liquidatable";
}

export interface SystemInput {
  totalColl: bigint;
  totalDebt: bigint;
  price: bigint;
}

export interface SystemRisk {
  tcr: bigint | null;
  recoveryMode: boolean;
  /** Oracle price at which TCR would cross CCR (Recovery Mode boundary). */
  recoveryPrice: bigint | null;
  /** bps price drop until Recovery Mode; 0 if already in it. */
  dropToRecoveryBps: bigint | null;
}

/** LiquityBase._getTCR / _checkRecoveryMode, plus the distance to Recovery Mode. */
export function assessSystem(s: SystemInput, params: ProtocolParams): SystemRisk {
  const tcr = computeCR(s.totalColl, s.totalDebt, s.price);
  const recoveryMode = tcr != null && tcr < params.ccr;
  const recoveryPrice = s.totalDebt === 0n || s.totalColl === 0n ? null : ceilDiv(s.totalDebt * params.ccr, s.totalColl);
  return { tcr, recoveryMode, recoveryPrice, dropToRecoveryBps: priceDropToLiquidationBps(s.price, recoveryPrice) };
}

export interface PositionRisk {
  icr: bigint | null;
  hf: bigint | null;
  category: RiskCategory;
  threshold: bigint;
  liquidationPrice: bigint | null;
  dropToLiquidationBps: bigint | null;
  /** coll × price (USD, 18 decimals). */
  collValue: bigint;
  /** MUSD debt; valued 1:1 in USD, the protocol's own accounting assumption. */
  debtValue: bigint;
  /** Largest repayment allowed without closing (net debt must stay ≥ minNetDebt). */
  maxRepayWithoutClosing: bigint;
  /** MUSD needed to close the trove (debt − gas compensation, which the gas pool covers). */
  closeCost: bigint;
}

export function assessPosition(
  p: PositionAmounts,
  price: bigint,
  params: ProtocolParams,
  recoveryMode: boolean,
  thresholds: RiskThresholds = DEFAULT_THRESHOLDS,
): PositionRisk {
  const threshold = liquidationThreshold(params, recoveryMode);
  const icr = computeCR(p.coll, p.debt, price);
  const hf = healthFactor(icr, threshold);
  const liq = liquidationPrice(p.coll, p.debt, threshold);
  let drop = priceDropToLiquidationBps(price, liq);
  if (p.debt > 0n && p.coll === 0n) drop = 0n;
  return {
    icr,
    hf,
    category: classifyRisk(hf, thresholds),
    threshold,
    liquidationPrice: liq,
    dropToLiquidationBps: drop,
    collValue: (p.coll * price) / WAD,
    debtValue: p.debt,
    maxRepayWithoutClosing: maxRepayWithoutClosing(p, params),
    closeCost: p.debt > params.gasCompensation ? p.debt - params.gasCompensation : 0n,
  };
}

/** BorrowerOperations: repayment must leave (debt − gasComp − repay) ≥ minNetDebt. */
export function maxRepayWithoutClosing(p: PositionAmounts, params: ProtocolParams): bigint {
  const floor = params.gasCompensation + params.minNetDebt;
  return p.debt > floor ? p.debt - floor : 0n;
}

export interface Recommendation {
  tone: "ok" | "watch" | "act" | "urgent" | "neutral";
  title: string;
  body: string;
}

export function recommend(category: RiskCategory, ctx: { recoveryMode: boolean; dropBps: bigint | null }): Recommendation {
  const drop = ctx.dropBps == null ? null : `${(Number(ctx.dropBps) / 100).toFixed(1)}%`;
  switch (category) {
    case "no-debt":
      return { tone: "neutral", title: "Nothing to rescue", body: "This trove has no outstanding debt, so it cannot be liquidated." };
    case "healthy":
      return { tone: "ok", title: "No action needed", body: `BTC would have to fall ${drop} before this trove reaches the 110% line. Keep an alert on it.` };
    case "caution":
      return { tone: "watch", title: "Set an alert and plan a buffer", body: `A ${drop} BTC drop reaches liquidation. Decide now which rescue you would use, while it is cheap to act.` };
    case "high":
      return { tone: "act", title: "Consider a rescue", body: `Only a ${drop} BTC drop separates this trove from liquidation. Repaying MUSD or adding BTC now restores headroom.` };
    case "critical":
      return { tone: "urgent", title: "Rescue now", body: `A ${drop} price move would make this trove liquidatable. Add collateral or repay as soon as possible.` };
    case "liquidatable":
      return {
        tone: "urgent",
        title: "Liquidatable now",
        body: ctx.recoveryMode
          ? "ICR is below 110%. Anyone can liquidate this trove. In Recovery Mode the contract still accepts pure repayments and collateral top-ups."
          : "ICR is below 110%. Anyone can liquidate this trove. In Normal Mode a rescue must lift ICR back to at least 110% in one transaction, or it reverts.",
      };
    default:
      return { tone: "neutral", title: "Data unavailable", body: "Live protocol data could not be read. Rescue actions stay disabled until fresh data arrives." };
  }
}
