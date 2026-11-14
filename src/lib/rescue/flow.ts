/**
 * Rescue transaction lifecycle as a pure reducer, so every transition (including the unhappy ones:
 * wallet rejection, revert, disconnect, wrong network) is unit tested and the UI can never show
 * "success" before a verified receipt.
 */
import type { Hex } from "viem";

export interface PreparedTx {
  to: `0x${string}`;
  data: Hex;
  value: string; // wei as decimal string (JSON safe)
  gas: string;
  chainId: number;
  preparedAt: number; // ms
  blockNumber: string;
  icrBefore: string | null;
  icrAfter: string | null;
  action: "repay" | "add_collateral" | "repay_and_add";
  needsApproval: boolean;
}

export type FlowState =
  | { s: "idle" }
  | { s: "preparing" }
  | { s: "review"; tx: PreparedTx }
  | { s: "approving"; tx: PreparedTx }
  | { s: "approval-rejected"; tx: PreparedTx; message: string }
  | { s: "awaiting-signature"; tx: PreparedTx }
  | { s: "pending"; tx: PreparedTx; hash: Hex; walletDisconnected?: boolean }
  | { s: "confirmed"; tx: PreparedTx; hash: Hex; blockNumber: string }
  | { s: "verified"; tx: PreparedTx; hash: Hex; blockNumber: string; icrAfter: string | null }
  | { s: "verification-delayed"; tx: PreparedTx; hash: Hex; blockNumber: string; message: string }
  | { s: "rejected"; message: string }
  | { s: "reverted"; tx: PreparedTx; hash: Hex; message: string }
  | { s: "failed"; message: string }
  | { s: "disconnected" }
  | { s: "blocked"; message: string };

export type FlowEvent =
  | { type: "PREPARE" }
  | { type: "PREPARED"; tx: PreparedTx }
  | { type: "PREPARE_FAILED"; message: string }
  | { type: "APPROVE" }
  | { type: "APPROVAL_REJECTED"; message: string }
  | { type: "APPROVED" }
  | { type: "SIGN" }
  | { type: "WALLET_REJECTED"; message?: string }
  | { type: "SEND_FAILED"; message: string }
  | { type: "SUBMITTED"; hash: Hex }
  | { type: "RECEIPT"; status: "success" | "reverted"; blockNumber: string; message?: string }
  | { type: "VERIFIED"; icrAfter: string | null }
  | { type: "VERIFY_DELAYED"; message: string }
  | { type: "DISCONNECTED" }
  | { type: "NETWORK_CHANGED"; writable: boolean; label: string }
  | { type: "RESET" };

export const initialFlow: FlowState = { s: "idle" };

const BEFORE_BROADCAST = new Set(["preparing", "review", "approving", "approval-rejected", "awaiting-signature"]);

export function flowReducer(state: FlowState, ev: FlowEvent): FlowState {
  switch (ev.type) {
    case "RESET":
      return initialFlow;
    case "DISCONNECTED":
      // Once broadcast, the tx lives on without the wallet: keep tracking the receipt.
      if (state.s === "pending") return { ...state, walletDisconnected: true };
      if (BEFORE_BROADCAST.has(state.s)) return { s: "disconnected" };
      return state;
    case "NETWORK_CHANGED":
      if (!ev.writable && BEFORE_BROADCAST.has(state.s)) return { s: "blocked", message: `Wallet switched to ${ev.label}. Rescue transactions are only prepared on Mezo Testnet.` };
      return state;
    case "PREPARE":
      if (state.s === "pending" || state.s === "awaiting-signature" || state.s === "approving") return state;
      return { s: "preparing" };
    case "PREPARED":
      return state.s === "preparing" ? { s: "review", tx: ev.tx } : state;
    case "PREPARE_FAILED":
      return state.s === "preparing" ? { s: "failed", message: ev.message } : state;
    case "APPROVE":
      return state.s === "review" && state.tx.needsApproval ? { s: "approving", tx: state.tx } : state;
    case "APPROVAL_REJECTED":
      return state.s === "approving" ? { s: "approval-rejected", tx: state.tx, message: ev.message } : state;
    case "APPROVED":
      return state.s === "approving" ? { s: "review", tx: { ...state.tx, needsApproval: false } } : state;
    case "SIGN":
      if (state.s === "review" && !state.tx.needsApproval) return { s: "awaiting-signature", tx: state.tx };
      return state;
    case "WALLET_REJECTED":
      return state.s === "awaiting-signature" ? { s: "rejected", message: ev.message ?? "You rejected the transaction in your wallet. Nothing was sent." } : state;
    case "SEND_FAILED":
      return state.s === "awaiting-signature" ? { s: "failed", message: ev.message } : state;
    case "SUBMITTED":
      return state.s === "awaiting-signature" ? { s: "pending", tx: state.tx, hash: ev.hash } : state;
    case "RECEIPT":
      if (state.s !== "pending") return state;
      if (ev.status === "success") return { s: "confirmed", tx: state.tx, hash: state.hash, blockNumber: ev.blockNumber };
      return { s: "reverted", tx: state.tx, hash: state.hash, message: ev.message ?? "The transaction was mined but reverted. Your trove is unchanged; only gas was spent." };
    case "VERIFIED":
      if (state.s === "confirmed" || state.s === "verification-delayed") return { s: "verified", tx: state.tx, hash: state.hash, blockNumber: state.blockNumber, icrAfter: ev.icrAfter };
      return state;
    case "VERIFY_DELAYED":
      return state.s === "confirmed" ? { s: "verification-delayed", tx: state.tx, hash: state.hash, blockNumber: state.blockNumber, message: ev.message } : state;
    default:
      return state;
  }
}

/** Only these states may be presented as a successful rescue. */
export function isSuccess(state: FlowState): boolean {
  return state.s === "verified";
}

export function isBusy(state: FlowState): boolean {
  return state.s === "preparing" || state.s === "approving" || state.s === "awaiting-signature" || state.s === "pending" || state.s === "confirmed";
}

/** A prepared transaction expires after 60 s — the oracle moves every block and hints go stale. */
export const PREPARED_TTL_MS = 60_000;
export function isPreparedExpired(tx: PreparedTx, nowMs: number, ttl = PREPARED_TTL_MS): boolean {
  return nowMs - tx.preparedAt > ttl;
}

/** Classify a wallet / RPC error into a user rejection or a genuine failure. */
export function classifyWalletError(err: unknown): { kind: "rejected" | "failed"; message: string } {
  const e = err as { name?: string; code?: number; shortMessage?: string; message?: string; cause?: unknown } | undefined;
  const chain: Array<typeof e> = [];
  let cur: typeof e = e;
  for (let i = 0; cur && i < 5; i++) {
    chain.push(cur);
    cur = cur.cause as typeof e;
  }
  for (const c of chain) {
    if (!c) continue;
    if (c.name === "UserRejectedRequestError" || c.code === 4001 || /user (rejected|denied)|rejected the request|request rejected/i.test(c.message ?? "")) {
      return { kind: "rejected", message: "You rejected the request in your wallet. Nothing was sent." };
    }
  }
  const msg = e?.shortMessage || e?.message || "The wallet returned an unknown error.";
  return { kind: "failed", message: msg.split("\n")[0].slice(0, 280) };
}

/** Compare the ICR when the simulator opened with the ICR now. */
export function riskWorsened(icrAtOpen: bigint | null, icrNow: bigint | null): { worsened: boolean; deltaBps: bigint } {
  if (icrAtOpen == null || icrNow == null) return { worsened: false, deltaBps: 0n };
  if (icrAtOpen === 0n) return { worsened: false, deltaBps: 0n };
  const deltaBps = ((icrNow - icrAtOpen) * 10_000n) / icrAtOpen;
  return { worsened: icrNow < icrAtOpen, deltaBps };
}
