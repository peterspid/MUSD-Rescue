import { WAD } from "./math";

/**
 * Protocol parameters the risk engine needs. The app reads them live from BorrowerOperations
 * (MCR, CCR, MUSD_GAS_COMPENSATION, minNetDebt, borrowingRate); the defaults below are the values
 * hard-coded / initialised in the MUSD source and are used only as a fallback and in tests.
 */
export interface ProtocolParams {
  /** Minimum collateral ratio (WAD). Liquidation happens when ICR < MCR. MUSD: 110%. */
  mcr: bigint;
  /** Critical collateral ratio (WAD). Recovery Mode when TCR < CCR. MUSD: 150%. */
  ccr: bigint;
  /** MUSD minted to the gas pool on open and counted as debt. MUSD: 200 MUSD. */
  gasCompensation: bigint;
  /** Net debt (debt − gas compensation) must stay ≥ this after any repayment. MUSD: 1,800 MUSD (governable). */
  minNetDebt: bigint;
  /** One-off fee on newly issued debt (WAD fraction). MUSD testnet: 0.1%. Waived in Recovery Mode. */
  borrowingRate: bigint;
  /**
   * Liquidation threshold while the system is in Recovery Mode.
   * `null` means "same as MCR". This is the MUSD rule: TroveManager._getTotalsFromBatchLiquidate only
   * liquidates troves with ICR < MCR and the MUSD CHANGELOG states "Liquidations are now the same in
   * recovery mode and normal mode". A Liquity-v1-style adapter would set this to CCR instead.
   */
  recoveryModeLiquidationThreshold: bigint | null;
  /** PriceFeed.fetchPrice() reverts when the oracle answer is older than this (seconds). MUSD: 60. */
  oracleMaxAgeSec: bigint;
}

export const MUSD_SOURCE_DEFAULTS: ProtocolParams = {
  mcr: (110n * WAD) / 100n,
  ccr: (150n * WAD) / 100n,
  gasCompensation: 200n * WAD,
  minNetDebt: 1800n * WAD,
  borrowingRate: WAD / 1000n,
  recoveryModeLiquidationThreshold: null,
  oracleMaxAgeSec: 60n,
};

/** Liquity v1 semantics, used only in tests to show the engine is protocol-configurable. */
export const LIQUITY_V1_STYLE: ProtocolParams = {
  ...MUSD_SOURCE_DEFAULTS,
  recoveryModeLiquidationThreshold: (150n * WAD) / 100n,
};

export enum TroveStatus {
  NonExistent = 0,
  Active = 1,
  ClosedByOwner = 2,
  ClosedByLiquidation = 3,
  ClosedByRedemption = 4,
}

export const TROVE_STATUS_LABEL: Record<number, string> = {
  0: "No trove",
  1: "Active",
  2: "Closed by owner",
  3: "Closed by liquidation",
  4: "Closed by redemption",
};
