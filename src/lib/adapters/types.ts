/**
 * Lending-protocol adapter contract (spec §18). The UI only talks to this interface through API routes,
 * so another protocol can be added by implementing it — no frontend rewrite.
 */
import type { Address } from "viem";
import type { HistoryPointDTO, PositionDTO, PreparedRescueDTO, RadarDTO, SystemDTO, TroveEventDTO } from "../dto";
import type { ProtocolParams } from "../risk/params";
import type { RepaymentTokenModel } from "../rescue/approval";

export interface AdapterMetadata {
  id: string;
  name: string;
  network: "testnet" | "mainnet";
  chainId: number;
  collateral: { symbol: string; decimals: number; native: boolean }[];
  debtToken: { symbol: string; address: Address; decimals: number };
  riskMetric: "icr";
  repaymentTokenModel: RepaymentTokenModel;
  /** Contract addresses with their provenance. */
  contracts: Record<string, Address>;
  sources: { label: string; url: string }[];
}

export interface RescueRequest {
  owner: Address;
  repay: bigint;
  addColl: bigint;
}

export interface LendingAdapter {
  metadata: AdapterMetadata;
  /** Live protocol parameters (MCR, CCR, minNetDebt, fees…). */
  getParams(): Promise<ProtocolParams>;
  getSystem(): Promise<SystemDTO>;
  /** Position discovery for a wallet: MUSD allows at most one trove per address. */
  discoverPositions(owner: Address): Promise<PositionDTO[]>;
  getPosition(owner: Address): Promise<PositionDTO>;
  /** Every open position, for the liquidation radar. */
  listPositions(): Promise<RadarDTO>;
  /** Historical state from archive reads. */
  getHistory(owner: Address, rangeSec: number, points: number): Promise<HistoryPointDTO[]>;
  getEvents(owner: Address): Promise<TroveEventDTO[]>;
  prepareRescue(req: RescueRequest): Promise<PreparedRescueDTO>;
}
