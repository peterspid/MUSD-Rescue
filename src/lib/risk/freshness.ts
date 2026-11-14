/**
 * Data freshness rules. Two different clocks matter:
 *  1. The protocol's own oracle: PriceFeed.fetchPrice() reverts if the oracle answer is > 60 s old
 *     (MAX_PRICE_DELAY). On Mezo testnet the oracle updates every block (~4 s).
 *  2. Our copy of the data: how long ago MUSD Rescue last read the chain successfully.
 */
export type Freshness = "fresh" | "aging" | "stale" | "missing";

export interface FreshnessPolicy {
  agingAfterMs: number;
  staleAfterMs: number;
}

/** Live reads in the browser: refreshed every 15 s; aging after 45 s, stale after 2 min. */
export const LIVE_POLICY: FreshnessPolicy = { agingAfterMs: 45_000, staleAfterMs: 120_000 };
/** Scheduled monitoring: the daily cron. Stale once a run is more than 26 h old. */
export const MONITOR_POLICY: FreshnessPolicy = { agingAfterMs: 25 * 3_600_000, staleAfterMs: 26 * 3_600_000 };

export function assessFreshness(observedAtMs: number | null | undefined, nowMs: number, policy: FreshnessPolicy = LIVE_POLICY): Freshness {
  if (observedAtMs == null || !Number.isFinite(observedAtMs)) return "missing";
  const age = nowMs - observedAtMs;
  if (age > policy.staleAfterMs) return "stale";
  if (age > policy.agingAfterMs) return "aging";
  return "fresh";
}

/** Mirrors the PriceFeed staleness require: block.timestamp - updatedAt <= 60. */
export function isOracleStale(updatedAt: bigint, blockTimestamp: bigint, maxAgeSec = 60n): boolean {
  return blockTimestamp - updatedAt > maxAgeSec;
}

export interface ActionGate {
  allowed: boolean;
  reason: string | null;
}

/**
 * Decide whether rescue transactions may be prepared. Unsafe actions are disabled whenever the inputs
 * that the transaction depends on cannot be trusted.
 */
export function gateRescueActions(args: {
  freshness: Freshness;
  priceAvailable: boolean;
  networkWritable: boolean;
  isOwner: boolean;
  troveActive: boolean;
}): ActionGate {
  if (!args.priceAvailable) return { allowed: false, reason: "The protocol oracle price is unavailable, so the contract would reject any trove operation." };
  if (args.freshness === "stale" || args.freshness === "missing") return { allowed: false, reason: "Position data is stale. Refresh before preparing a transaction." };
  if (!args.troveActive) return { allowed: false, reason: "This address has no active trove." };
  if (!args.isOwner) return { allowed: false, reason: "Only the trove owner's wallet can repay or add collateral to this trove (msg.sender must be the borrower)." };
  if (!args.networkWritable) return { allowed: false, reason: "Switch your wallet to Mezo Testnet to prepare a rescue transaction." };
  return { allowed: true, reason: null };
}
