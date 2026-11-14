import { CATEGORY_SEVERITY, isCritical, needsAttention, type RiskCategory } from "../risk/health";

export interface PortfolioEntry {
  source: "onchain" | "fictional";
  owner: string;
  protocol: string;
  category: RiskCategory;
  collValue: bigint;
  debt: bigint;
  hf: bigint | null;
}

export interface PortfolioSummary {
  count: number;
  totalCollValue: bigint;
  totalDebt: bigint;
  healthy: number;
  attention: number;
  critical: number;
  noDebt: number;
  unknown: number;
  /**
   * Liquidations are per trove, so an aggregate "portfolio health factor" would be misleading
   * (a healthy trove cannot cover a failing one). We report the weakest position instead.
   */
  weakest: PortfolioEntry | null;
}

export class FictionalDataError extends Error {
  constructor() {
    super("Fictional demo positions cannot be included in the live portfolio.");
  }
}

export function summarizePortfolio(entries: PortfolioEntry[]): PortfolioSummary {
  if (entries.some((e) => e.source !== "onchain")) throw new FictionalDataError();
  let weakest: PortfolioEntry | null = null;
  const s: PortfolioSummary = { count: entries.length, totalCollValue: 0n, totalDebt: 0n, healthy: 0, attention: 0, critical: 0, noDebt: 0, unknown: 0, weakest: null };
  for (const e of entries) {
    s.totalCollValue += e.collValue;
    s.totalDebt += e.debt;
    if (e.category === "healthy") s.healthy++;
    else if (needsAttention(e.category)) s.attention++;
    else if (isCritical(e.category)) s.critical++;
    else if (e.category === "no-debt") s.noDebt++;
    else s.unknown++;
    if (e.category !== "no-debt" && e.category !== "unknown") {
      if (!weakest || (e.hf != null && (weakest.hf == null || e.hf < weakest.hf))) weakest = e;
    }
  }
  s.weakest = weakest;
  return s;
}

export function sortBySeverity<T extends { category: RiskCategory; hf: bigint | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const d = CATEGORY_SEVERITY[b.category] - CATEGORY_SEVERITY[a.category];
    if (d !== 0) return d;
    if (a.hf == null) return 1;
    if (b.hf == null) return -1;
    return a.hf < b.hf ? -1 : a.hf > b.hf ? 1 : 0;
  });
}
