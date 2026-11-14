/**
 * Integer math that mirrors the MUSD contracts exactly (Solidity floor division, 18-decimal fixed point).
 * Source: mezo-org/musd → solidity/contracts/dependencies/{LiquityMath,InterestRateMath}.sol
 * No floating point is used for any token quantity in this module.
 */

/** 1e18 — DECIMAL_PRECISION in the contracts. */
export const WAD = 10n ** 18n;
/** NICR_PRECISION in LiquityMath (nominal collateral ratio used by SortedTroves). */
export const NICR_PRECISION = 10n ** 20n;
export const BPS = 10_000n;
/** InterestRateMath.SECONDS_IN_A_YEAR (365.2425 days). */
export const SECONDS_IN_A_YEAR = 31_556_952n;
export const UINT256_MAX = (1n << 256n) - 1n;

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/** ceil(a / b) for a >= 0, b > 0. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new RangeError("ceilDiv: divisor must be positive");
  if (a < 0n) throw new RangeError("ceilDiv: dividend must be non-negative");
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

/**
 * LiquityMath._computeCR: coll * price / debt (floor). The contract returns uint256.max for zero debt;
 * we return `null` ("infinite") so callers cannot accidentally do arithmetic with it.
 */
export function computeCR(coll: bigint, debt: bigint, price: bigint): bigint | null {
  if (coll < 0n || debt < 0n || price < 0n) throw new RangeError("computeCR: negative input");
  if (debt === 0n) return null;
  return (coll * price) / debt;
}

/** LiquityMath._computeNominalCR: coll * 1e20 / principal (floor), null for zero principal. */
export function computeNominalCR(coll: bigint, principal: bigint): bigint | null {
  if (coll < 0n || principal < 0n) throw new RangeError("computeNominalCR: negative input");
  if (principal === 0n) return null;
  return (coll * NICR_PRECISION) / principal;
}

/**
 * InterestRateMath.calculateInterestOwed — simple (non-compounding) interest:
 * principal * rateBps * elapsed / (10_000 * SECONDS_IN_A_YEAR).
 */
export function calculateInterestOwed(principal: bigint, rateBps: number | bigint, startTime: bigint, endTime: bigint): bigint {
  const rate = BigInt(rateBps);
  if (principal < 0n || rate < 0n) throw new RangeError("calculateInterestOwed: negative input");
  if (endTime <= startTime) return 0n;
  return (principal * rate * (endTime - startTime)) / (BPS * SECONDS_IN_A_YEAR);
}

/** Apply a percentage change in basis points (e.g. -1000 = -10%) to a price. Never returns < 0. */
export function applyBpsChange(value: bigint, changeBps: number | bigint): bigint {
  const change = BigInt(changeBps);
  const factor = BPS + change;
  if (factor <= 0n) return 0n;
  return (value * factor) / BPS;
}

/** a / b expressed in basis points (floor), with b > 0. */
export function ratioBps(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("ratioBps: zero denominator");
  return (a * BPS) / b;
}
