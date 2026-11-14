import type { ParamsDTO, PositionDTO, SystemDTO } from "./dto";
import type { ProtocolParams } from "./risk/params";
import { positionFromEntire, type PositionAmounts } from "./risk/position";
import { DEFAULT_THRESHOLDS, type RiskThresholds } from "./risk/health";
import { WAD } from "./risk/math";

export function paramsFromDTO(p: ParamsDTO): ProtocolParams {
  return {
    mcr: BigInt(p.mcr),
    ccr: BigInt(p.ccr),
    gasCompensation: BigInt(p.gasCompensation),
    minNetDebt: BigInt(p.minNetDebt),
    borrowingRate: BigInt(p.borrowingRate),
    // MUSD: no special recovery-mode liquidations (TroveManager only liquidates ICR < MCR).
    recoveryModeLiquidationThreshold: null,
    oracleMaxAgeSec: 60n,
  };
}

export function amountsFromDTO(p: PositionDTO): PositionAmounts {
  return positionFromEntire(BigInt(p.coll), BigInt(p.principal), BigInt(p.interest), paramsFromDTO(p.system.params));
}

export function systemTotals(s: SystemDTO) {
  return { totalColl: BigInt(s.totalColl), totalDebt: BigInt(s.totalDebt) };
}

export function big(v: string | null | undefined): bigint | null {
  return v == null ? null : BigInt(v);
}

export interface ThresholdPrefs {
  healthyAbove: number;
  cautionFrom: number;
  criticalAtOrBelow: number;
}

export const DEFAULT_THRESHOLD_PREFS: ThresholdPrefs = { healthyAbove: 2, cautionFrom: 1.5, criticalAtOrBelow: 1.2 };

function toWad(n: number): bigint {
  return (BigInt(Math.round(n * 10_000)) * WAD) / 10_000n;
}

export function thresholdsFromPrefs(p?: Partial<ThresholdPrefs> | null): RiskThresholds {
  if (!p || p.healthyAbove == null || p.cautionFrom == null || p.criticalAtOrBelow == null) return DEFAULT_THRESHOLDS;
  return { healthyAbove: toWad(p.healthyAbove), cautionFrom: toWad(p.cautionFrom), criticalAtOrBelow: toWad(p.criticalAtOrBelow) };
}
