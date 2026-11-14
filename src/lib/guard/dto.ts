/** JSON transport types for RescueGuard. Token amounts and ratios are decimal strings of 18-decimal base units. */
import type { GuardKind, GuardStatus } from "./plan";

export interface GuardPlanDTO {
  kind: GuardKind;
  amount: string;
  keeperTip: string;
  triggerIcr: string;
  deadline: number; // unix seconds
  nonce: string;
}

export interface GuardDTO {
  deployed: boolean;
  address: string;
  owner: string;
  status: GuardStatus;
  /** ICR and price as RescueGuard.planStatus saw them (null when no plan or oracle unavailable). */
  icr: string | null;
  price: string | null;
  plan: GuardPlanDTO | null;
  reserves: { musd: string; btc: string };
  /** BorrowerOperationsSignatures nonce the next authorization must be signed for. */
  currentNonce: string;
  blockNumber: string;
  fetchedAt: number;
}

export interface GuardRegistryRowDTO {
  owner: string;
  status: GuardStatus;
  icr: string | null;
  plan: GuardPlanDTO | null;
  reserves: { musd: string; btc: string };
}

export interface GuardExecutionDTO {
  owner: string;
  keeper: string;
  kind: GuardKind;
  amount: string;
  keeperTip: string;
  icrBefore: string;
  icrAfter: string;
  price: string;
  txHash: string;
  blockNumber: number;
}

export interface GuardRegistryDTO {
  deployed: boolean;
  address: string;
  deployBlock: number;
  scannedTo: string;
  keeper: { configured: boolean; address: string | null; btc: string | null };
  plans: GuardRegistryRowDTO[];
  executions: GuardExecutionDTO[];
  fetchedAt: number;
}

export interface KeeperRunDTO {
  ok: boolean;
  skipped?: string;
  checked: number;
  ready: number;
  executed: { owner: string; txHash: string; status: "success" | "reverted" }[];
  failed: { owner: string; error: string }[];
}
