/**
 * RescueGuard plan logic shared by the UI, the server keeper and the tests. Pure (no I/O): every rule the
 * contract enforces is mirrored here so the UI can explain a problem before the wallet is ever opened,
 * plus the protocol rules RescueGuard leaves to BorrowerOperations (minimum net debt, MCR after the rescue).
 */
import { WAD, ceilDiv, computeCR, computeNominalCR, NICR_PRECISION } from "../risk/math";
import type { ProtocolParams } from "../risk/params";
import type { PositionAmounts } from "../risk/position";
import { maxRepayWithoutClosing } from "../risk/health";
import { collToReachICR, repayToReachICR } from "../risk/solve";

/** Mirrors RescueGuard constants. */
export const MIN_TRIGGER_ICR = 112n * 10n ** 16n; // 112%
export const MAX_TRIGGER_ICR = 4n * WAD; // 400%
export const MAX_TIP_BPS = 1_000n; // 10% of the rescue amount
export const DEFAULT_TRIGGER_ICR = 130n * 10n ** 16n;
export const DEFAULT_TARGET_ICR = 160n * 10n ** 16n;
export const DEFAULT_VALIDITY_DAYS = 30;

export type GuardKind = "repay" | "addColl";
export const KIND_ID: Record<GuardKind, 1 | 2> = { repay: 1, addColl: 2 };
export function kindFromId(id: number): GuardKind | null {
  return id === 1 ? "repay" : id === 2 ? "addColl" : null;
}

/** RescueGuard.Status, in contract order. */
export const GUARD_STATUSES = ["none", "waiting", "ready", "expired", "stale", "underfunded", "trove-inactive", "oracle-unavailable"] as const;
export type GuardStatus = (typeof GUARD_STATUSES)[number];
export function statusFromId(id: number): GuardStatus {
  return GUARD_STATUSES[id] ?? "none";
}

export const STATUS_COPY: Record<GuardStatus, { label: string; detail: string }> = {
  none: { label: "Not set up", detail: "No rescue plan is stored for this trove." },
  waiting: { label: "Armed", detail: "The plan is funded and valid. It will run as soon as the collateral ratio falls below the trigger." },
  ready: { label: "Ready to run", detail: "The collateral ratio is below the trigger. Anyone can run the rescue now, and the keeper will run it on its next check." },
  expired: { label: "Expired", detail: "The signed authorization has passed its deadline. Sign a new one to keep the trove protected." },
  stale: { label: "Needs a new signature", detail: "Your signature nonce changed after you signed (another signed trove operation used it). Sign the plan again." },
  underfunded: { label: "Reserve too small", detail: "The reserve no longer covers the rescue amount plus the keeper tip. Top it up or arm a smaller plan." },
  "trove-inactive": { label: "No open trove", detail: "The trove is closed or was liquidated, so there is nothing to rescue. Withdraw the reserve." },
  "oracle-unavailable": { label: "Oracle unavailable", detail: "The MUSD price feed is stale. Every trove operation reverts until it updates, including rescues." },
};

/** BTC price at which a trove's ICR reaches `icr`: price = icr × debt / coll (rounded up). */
export function priceAtICR(coll: bigint, debt: bigint, icr: bigint): bigint | null {
  if (coll === 0n || debt === 0n) return null;
  return ceilDiv(icr * debt, coll);
}

export interface PlanSuggestion {
  kind: GuardKind;
  /** Rescue amount (MUSD for repay, BTC for addColl), 18 decimals. */
  amount: bigint;
  /** Oracle price at which the plan fires. */
  triggerPrice: bigint | null;
  /** ICR right after the rescue if it fires exactly at the trigger price. */
  icrAfterAtTrigger: bigint | null;
  /** False when the target cannot be reached without closing the trove (repay is capped by minimum net debt). */
  reachesTarget: boolean;
  note?: string;
}

/**
 * Size a plan so that, if it fires exactly at the trigger, it lifts the trove back to `targetIcr` at that price.
 * Adds a 1% buffer for interest that accrues before the rescue runs.
 */
export function suggestPlan(args: { kind: GuardKind; position: PositionAmounts; params: ProtocolParams; triggerIcr: bigint; targetIcr: bigint }): PlanSuggestion {
  const { kind, position: p, params, triggerIcr, targetIcr } = args;
  const triggerPrice = priceAtICR(p.coll, p.debt, triggerIcr);
  if (triggerPrice == null) return { kind, amount: 0n, triggerPrice: null, icrAfterAtTrigger: null, reachesTarget: false, note: "This trove has no debt or collateral to protect." };
  if (targetIcr <= triggerIcr) return { kind, amount: 0n, triggerPrice, icrAfterAtTrigger: null, reachesTarget: false, note: "The target must be above the trigger." };
  if (kind === "repay") {
    const s = repayToReachICR(p, triggerPrice, targetIcr, params);
    const maxRepay = maxRepayWithoutClosing(p, params);
    let amount = (s.required * 101n) / 100n;
    if (amount > maxRepay) amount = maxRepay;
    return {
      kind,
      amount,
      triggerPrice,
      icrAfterAtTrigger: computeCR(p.coll, p.debt - amount, triggerPrice),
      reachesTarget: s.feasible,
      note: s.feasible ? undefined : "MUSD keeps at least 1,800 MUSD of net debt in an open trove, so a repayment alone cannot reach this target. The plan uses the largest repayment allowed; consider a BTC top-up plan instead.",
    };
  }
  const s = collToReachICR(p, triggerPrice, targetIcr);
  const amount = (s.required * 101n) / 100n;
  return { kind, amount, triggerPrice, icrAfterAtTrigger: computeCR(p.coll + amount, p.debt, triggerPrice), reachesTarget: s.feasible };
}

export interface PlanInput {
  kind: GuardKind;
  amount: bigint;
  keeperTip: bigint;
  triggerIcr: bigint;
  deadline: bigint; // unix seconds
}

export interface PlanCheck {
  id: string;
  level: "block" | "warn";
  message: string;
}

/** Every reason the contract or the protocol would reject this plan, in plain English. */
export function checkPlan(input: PlanInput, ctx: { nowSec: bigint; active: boolean; position: PositionAmounts | null; price: bigint | null; params: ProtocolParams; walletBalance: bigint; reserve: bigint }): PlanCheck[] {
  const out: PlanCheck[] = [];
  const block = (id: string, message: string) => out.push({ id, level: "block", message });
  const warn = (id: string, message: string) => out.push({ id, level: "warn", message });
  const unit = input.kind === "repay" ? "MUSD" : "BTC";
  if (!ctx.active || !ctx.position) block("no-trove", "This wallet has no open MUSD trove to protect.");
  if (input.amount <= 0n) block("amount", `Enter a rescue amount in ${unit}.`);
  if (input.triggerIcr < MIN_TRIGGER_ICR) block("trigger-low", "The trigger must be at least 112%. Liquidation starts at 110%, and a rescue needs room to land first.");
  if (input.triggerIcr > MAX_TRIGGER_ICR) block("trigger-high", "The trigger can be at most 400%.");
  if (input.keeperTip * 10_000n > input.amount * MAX_TIP_BPS) block("tip", "The keeper tip can be at most 10% of the rescue amount.");
  if (input.deadline <= ctx.nowSec) block("deadline", "The authorization deadline must be in the future.");
  const cost = input.amount + input.keeperTip;
  const fromWallet = cost > ctx.reserve ? cost - ctx.reserve : 0n;
  if (fromWallet > ctx.walletBalance) block("balance", `You need ${unit === "MUSD" ? "more MUSD" : "more BTC"} in your wallet to fund this plan.`);

  if (ctx.position && ctx.price && input.amount > 0n) {
    const p = ctx.position;
    const icrNow = computeCR(p.coll, p.debt, ctx.price);
    if (icrNow != null && icrNow < input.triggerIcr) warn("fires-now", "The trove is already below this trigger, so the rescue can run as soon as the plan is stored.");
    if (input.kind === "repay") {
      const maxRepay = maxRepayWithoutClosing(p, ctx.params);
      if (input.amount > maxRepay) block("min-net-debt", `MUSD requires at least 1,800 MUSD of net debt to stay in the trove. The largest repayment allowed right now is ${fmt(maxRepay)} MUSD.`);
    }
    const after = (atPrice: bigint) =>
      input.kind === "repay" ? computeCR(p.coll, p.debt - (input.amount > p.debt ? p.debt : input.amount), atPrice) : computeCR(p.coll + input.amount, p.debt, atPrice);
    // Fired on time (exactly at the trigger), a rescue always lands above 110%. Check the useful margin, and the
    // case where the price gaps down and the rescue runs late, with the trove already just under 110%.
    const triggerPrice = priceAtICR(p.coll, p.debt, input.triggerIcr);
    const onTime = triggerPrice ? after(triggerPrice) : null;
    if (onTime != null && onTime - input.triggerIcr < 3n * 10n ** 16n) warn("small", "This rescue moves the collateral ratio by less than 3 points at the trigger. It helps, but you may need to act again soon after.");
    const edgePrice = priceAtICR(p.coll, p.debt, ctx.params.mcr - 10n ** 16n);
    const late = edgePrice ? after(edgePrice) : null;
    if (late != null && late < ctx.params.mcr) warn("late", "If the price gaps below 110% before the rescue runs, this amount would not be enough to lift the trove back over 110%, and the protocol would reject it. A larger amount or a higher trigger gives more margin.");
  }
  return out;
}

function fmt(v: bigint) {
  const whole = v / WAD;
  const frac = ((v % WAD) * 100n) / WAD;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`;
}

/** SortedTroves NICR after the rescue (principal only, interest is repaid first). */
export function nicrAfterRescue(kind: GuardKind, amount: bigint, coll: bigint, principal: bigint, interest: bigint): bigint | null {
  if (kind === "addColl") return computeNominalCR(coll + amount, principal);
  const toPrincipal = amount > interest ? amount - interest : 0n;
  const newPrincipal = principal - (toPrincipal > principal ? principal : toPrincipal);
  return newPrincipal === 0n ? null : (coll * NICR_PRECISION) / newPrincipal;
}

// ---------------------------------------------------------------------------------------------
// EIP-712 payloads. The domain is always read live from BorrowerOperationsSignatures / MUSD (eip712Domain()).

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}

export const REPAY_MUSD_TYPES = {
  RepayMUSD: [
    { name: "amount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const ADD_COLL_TYPES = {
  AddColl: [
    { name: "assetAmount", type: "uint256" },
    { name: "borrower", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

type AuthMessage = { amount: bigint; borrower: `0x${string}`; nonce: bigint; deadline: bigint };

export function repayAuthorizationTypedData(domain: Eip712Domain, m: AuthMessage) {
  return { domain, types: REPAY_MUSD_TYPES, primaryType: "RepayMUSD" as const, message: { amount: m.amount, borrower: m.borrower, nonce: m.nonce, deadline: m.deadline } };
}

export function addCollAuthorizationTypedData(domain: Eip712Domain, m: AuthMessage) {
  return { domain, types: ADD_COLL_TYPES, primaryType: "AddColl" as const, message: { assetAmount: m.amount, borrower: m.borrower, nonce: m.nonce, deadline: m.deadline } };
}

export function authorizationTypedData(kind: "repay", domain: Eip712Domain, m: AuthMessage): ReturnType<typeof repayAuthorizationTypedData>;
export function authorizationTypedData(kind: "addColl", domain: Eip712Domain, m: AuthMessage): ReturnType<typeof addCollAuthorizationTypedData>;
export function authorizationTypedData(kind: GuardKind, domain: Eip712Domain, m: AuthMessage) {
  return kind === "repay" ? repayAuthorizationTypedData(domain, m) : addCollAuthorizationTypedData(domain, m);
}

export function permitTypedData(domain: Eip712Domain, m: { owner: `0x${string}`; spender: `0x${string}`; value: bigint; nonce: bigint; deadline: bigint }) {
  return { domain, types: PERMIT_TYPES, primaryType: "Permit" as const, message: m };
}

// ---------------------------------------------------------------------------------------------
// Human-readable contract errors.

const GUARD_ERRORS: Record<string, string> = {
  ZeroAddress: "A required contract address is missing.",
  ZeroAmount: "The amount must be greater than zero.",
  TriggerOutOfRange: "The trigger must be between 112% and 400%.",
  TipTooHigh: "The keeper tip can be at most 10% of the rescue amount.",
  DeadlineInPast: "The authorization deadline has already passed. Sign again.",
  TroveNotActive: "This address has no open trove.",
  InvalidAuthorization: "The signed authorization does not match this plan. Sign again with the same wallet.",
  InsufficientReserve: "The reserve does not cover this amount.",
  NoPlan: "There is no rescue plan for this trove.",
  AuthorizationExpired: "The signed authorization has expired.",
  StaleAuthorization: "The signature was made for an old nonce. The owner must sign the plan again.",
  TriggerNotReached: "The collateral ratio is still above the trigger, so the rescue cannot run yet.",
  UnexpectedBurn: "The protocol burned a different MUSD amount than authorized, so the rescue was stopped.",
  RescueDidNotImprove: "The rescue would not improve the collateral ratio, so it was stopped.",
  BTCTransferFailed: "Sending BTC failed.",
  ERC20InsufficientAllowance: "The MUSD permit was not accepted. Sign it again.",
  ERC20InsufficientBalance: "Not enough MUSD in the wallet.",
  ECDSAInvalidSignature: "The signature is invalid.",
  ECDSAInvalidSignatureLength: "The signature is malformed.",
  ReentrancyGuardReentrantCall: "Re-entrant call blocked.",
};

export function explainGuardError(e: unknown): string {
  const seen = new Set<unknown>();
  let cur = e as { name?: string; data?: { errorName?: string }; shortMessage?: string; message?: string; reason?: string; cause?: unknown } | undefined;
  for (let i = 0; cur && i < 6 && !seen.has(cur); i++) {
    seen.add(cur);
    const name = cur.data?.errorName;
    if (name && GUARD_ERRORS[name]) return GUARD_ERRORS[name];
    const text = `${cur.reason ?? ""} ${cur.shortMessage ?? ""} ${cur.message ?? ""}`;
    for (const k of Object.keys(GUARD_ERRORS)) if (text.includes(k)) return GUARD_ERRORS[k];
    if (/user (rejected|denied)|rejected the request/i.test(text)) return "You cancelled the request in your wallet. Nothing was sent.";
    if (/net debt must be greater than minimum/i.test(text)) return "The repayment would take net debt below the 1,800 MUSD minimum. Use a smaller amount.";
    if (/ICR < MCR/i.test(text)) return "The rescue is too small to lift the trove above 110%, so the protocol rejected it.";
    if (/Oracle is stale/i.test(text)) return "The MUSD price feed is stale. Try again in a minute.";
    if (/insufficient funds/i.test(text)) return "Not enough BTC to pay for this transaction.";
    cur = cur.cause as typeof cur;
  }
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  return m.split("\n")[0].slice(0, 220);
}
