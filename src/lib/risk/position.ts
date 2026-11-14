import { calculateInterestOwed, max } from "./math";
import type { ProtocolParams } from "./params";
import { TroveStatus } from "./params";

/** Raw trove state as stored in TroveManager.Troves(owner) plus pending redistribution rewards. */
export interface TroveRaw {
  status: number;
  coll: bigint;
  /** Stored principal. Includes the 200 MUSD gas compensation and borrowing fees. */
  principal: bigint;
  /** Interest recorded at lastInterestUpdateTime (not including interest accrued since). */
  interestOwed: bigint;
  interestRateBps: number;
  lastInterestUpdateTime: bigint;
  maxBorrowingCapacity: bigint;
  pendingColl: bigint;
  pendingPrincipal: bigint;
  pendingInterest: bigint;
}

/** Entire position, mirroring TroveManager.getEntireDebtAndColl at a given timestamp. */
export interface PositionAmounts {
  coll: bigint;
  principal: bigint;
  interest: bigint;
  /** principal + interest — the debt used for ICR and liquidation. */
  debt: bigint;
  /** debt − gas compensation (what the borrower must actually repay to close). */
  netDebt: bigint;
}

/**
 * Mirrors TroveManager.getEntireDebtAndColl: interest accrues (simple interest) on the *stored* principal
 * from lastInterestUpdateTime to `nowSec`; pending redistribution rewards are added on top.
 */
export function entirePosition(t: TroveRaw, nowSec: bigint, params: ProtocolParams): PositionAmounts {
  const accrued = calculateInterestOwed(t.principal, t.interestRateBps, t.lastInterestUpdateTime, nowSec);
  const coll = t.coll + t.pendingColl;
  const principal = t.principal + t.pendingPrincipal;
  const interest = t.interestOwed + accrued + t.pendingInterest;
  const debt = principal + interest;
  return { coll, principal, interest, debt, netDebt: max(0n, debt - params.gasCompensation) };
}

/** Build PositionAmounts from the (coll, principal, interest) triple returned by getEntireDebtAndColl. */
export function positionFromEntire(coll: bigint, principal: bigint, interest: bigint, params: ProtocolParams): PositionAmounts {
  const debt = principal + interest;
  return { coll, principal, interest, debt, netDebt: max(0n, debt - params.gasCompensation) };
}

/**
 * Project a position forward by `seconds` of interest accrual on its principal (no price change).
 * Used to show how much debt grows between now and a later time.
 */
export function projectInterest(p: PositionAmounts, rateBps: number, seconds: bigint, params: ProtocolParams): PositionAmounts {
  const extra = calculateInterestOwed(p.principal, rateBps, 0n, seconds);
  return positionFromEntire(p.coll, p.principal, p.interest + extra, params);
}

/** Interest accruing per day (MUSD, 18 decimals) at the trove's fixed rate. */
export function interestPerDay(principal: bigint, rateBps: number): bigint {
  return calculateInterestOwed(principal, rateBps, 0n, 86_400n);
}

export function isActive(status: number): boolean {
  return status === TroveStatus.Active;
}
