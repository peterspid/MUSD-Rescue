/**
 * JSON transport types shared by API routes and the client. All token quantities are decimal strings of
 * base units (18 decimals) so no precision is lost in transit; the client converts back with BigInt().
 */
import type { RiskCategory } from "./risk/health";

export interface ParamsDTO {
  mcr: string;
  ccr: string;
  gasCompensation: string;
  minNetDebt: string;
  borrowingRate: string;
  redemptionRate: string;
  interestRateBps: number;
}

export interface SystemDTO {
  network: "testnet";
  blockNumber: string;
  blockTime: number; // unix seconds (chain)
  price: string | null; // PriceFeed.fetchPrice(); null if it reverted (stale oracle)
  priceError: string | null;
  oracleUpdatedAt: number | null;
  oracleAgeSec: number | null;
  tcr: string | null;
  recoveryMode: boolean | null;
  recoveryPrice: string | null;
  dropToRecoveryBps: string | null;
  totalColl: string;
  totalDebt: string;
  troveCount: number;
  stabilityPoolMusd: string;
  params: ParamsDTO;
  fetchedAt: number; // server ms
}

export interface PositionDTO {
  source: "onchain";
  owner: string;
  network: "testnet";
  status: number;
  statusLabel: string;
  active: boolean;
  coll: string;
  principal: string;
  interest: string;
  debt: string;
  netDebt: string;
  breakdown: {
    storedColl: string;
    pendingColl: string;
    storedPrincipal: string;
    pendingPrincipal: string;
    gasCompensation: string;
    storedInterest: string;
    accruedInterest: string;
    pendingInterest: string;
  };
  interestRateBps: number;
  interestPerDay: string;
  lastInterestUpdateTime: number;
  maxBorrowingCapacity: string;
  risk: {
    icr: string | null;
    hf: string | null;
    category: RiskCategory;
    threshold: string;
    liquidationPrice: string | null;
    dropToLiquidationBps: string | null;
    collValue: string;
    debtValue: string;
    maxRepayWithoutClosing: string;
    closeCost: string;
  } | null;
  wallet: { musd: string; btc: string };
  system: SystemDTO;
  fetchedAt: number;
}

export interface RadarTroveDTO {
  owner: string;
  coll: string;
  debt: string;
  icr: string | null;
  liquidationPrice: string | null;
  dropToLiquidationBps: string | null;
}

export interface RadarDTO {
  system: SystemDTO;
  troves: RadarTroveDTO[]; // sorted by ICR ascending (riskiest first)
  method: "multicall3";
  fetchedAt: number;
}

export interface HistoryPointDTO {
  blockNumber: string;
  blockTime: number;
  price: string | null;
  tcr: string | null;
  status: number | null;
  coll: string | null;
  debt: string | null;
  icr: string | null;
}

export interface TroveEventDTO {
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
  contract: "BorrowerOperations" | "TroveManager";
  operation: string;
  principal: string;
  interest: string;
  coll: string;
}

export interface PreparedRescueDTO {
  tx: { to: `0x${string}`; data: `0x${string}`; value: string; gas: string; chainId: number };
  action: "repay" | "add_collateral" | "repay_and_add";
  functionName: "repayMUSD" | "addColl" | "adjustTrove";
  amounts: { repay: string; coll: string };
  hints: { upper: string; lower: string; nicr: string | null; numTrials: number };
  approval: { needed: boolean; explanation: string };
  gas: { estimate: string | null; limit: string; floorApplied: boolean; gasPrice: string; maxFeeWei: string };
  before: { icr: string | null; hf: string | null; category: RiskCategory; debt: string; coll: string };
  after: { icr: string | null; hf: string | null; category: RiskCategory; debt: string; coll: string };
  checks: { id: string; level: string; message: string }[];
  chainSimulation: { ok: true };
  blockNumber: string;
  price: string;
  preparedAt: number;
  contract: { name: "BorrowerOperations"; address: string };
  network: { name: string; chainId: number };
}

export type ApiError = { error: string; code?: string; details?: unknown };

/** JSON.stringify replacer for bigint. */
export function bigintReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}
