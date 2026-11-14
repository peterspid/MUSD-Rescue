"use client";
import { WAD } from "@/lib/risk/math";
import type { RiskThresholds } from "@/lib/risk/health";
import { DEFAULT_THRESHOLDS } from "@/lib/risk/health";
import { formatRatioPct } from "@/lib/risk/format";
import { cn } from "./ui";

const MIN = 100; // ICR % at the left of the scale
const MAX = 350;

function pct(icr: bigint | null): number | null {
  if (icr == null) return null;
  return Number((icr * 10_000n) / WAD) / 100; // ICR as a % number for drawing only
}
function pos(p: number) {
  return Math.min(1, Math.max(0, (p - MIN) / (MAX - MIN)));
}

/**
 * Where the trove's ICR sits relative to the 110% liquidation line. The risk bands get lighter as the ratio
 * rises (ink density = risk); the zone below 110% is hatched. A dashed blue box marks a simulated ICR.
 */
export function ClearanceGauge({
  icr,
  simulatedIcr,
  mcr,
  ccr,
  thresholds = DEFAULT_THRESHOLDS,
  className,
  label = "Collateral ratio relative to the liquidation line",
}: {
  icr: bigint | null;
  simulatedIcr?: bigint | null;
  mcr: bigint;
  ccr: bigint;
  thresholds?: RiskThresholds;
  className?: string;
  label?: string;
}) {
  const mcrP = pct(mcr)!;
  const ccrP = pct(ccr)!;
  const band = (hf: bigint) => pct((hf * mcr) / WAD)!;
  const bands = [
    { from: band(thresholds.criticalAtOrBelow), to: band(thresholds.cautionFrom), cls: "bg-line-strong", name: "High risk" },
    { from: mcrP, to: band(thresholds.criticalAtOrBelow), cls: "bg-muted", name: "Critical" },
    { from: band(thresholds.cautionFrom), to: band(thresholds.healthyAbove), cls: "bg-line", name: "Caution" },
    { from: band(thresholds.healthyAbove), to: MAX, cls: "bg-blue-tint", name: "Healthy" },
  ];
  const cur = pct(icr);
  const sim = simulatedIcr === undefined ? undefined : pct(simulatedIcr);
  const left = (p: number) => ({ left: `${pos(p) * 100}%` });
  const span = (a: number, b: number) => ({ left: `${pos(a) * 100}%`, width: `${Math.max(0, pos(b) - pos(a)) * 100}%` });
  const ariaText = `${label}: current ${cur == null ? "no debt" : formatRatioPct(icr ?? null)}${sim != null ? `, simulated ${formatRatioPct(simulatedIcr ?? null)}` : ""}; liquidation below ${mcrP}%`;
  return (
    <div className={cn("relative h-[50px] w-full select-none", className)} role="img" aria-label={ariaText}>
      <div className="absolute inset-x-0 top-[14px] h-[14px] overflow-hidden rounded-[3px] border border-ink bg-paper">
        <div className="hatch absolute inset-y-0" style={span(MIN, mcrP)} title="Liquidation zone" />
        {bands.map((b) => (
          <div key={b.name} className={cn("absolute inset-y-0", b.cls)} style={span(b.from, b.to)} title={b.name} />
        ))}
      </div>
      {/* Liquidation line */}
      <div className="absolute top-[8px] h-[26px] w-[2px] -translate-x-1/2 bg-ink" style={left(mcrP)} />
      <span className="num absolute top-[32px] -translate-x-1/2 text-[12px] font-semibold text-ink" style={left(mcrP)}>
        {mcrP}%
      </span>
      {/* Recovery Mode line (system-level) */}
      <div className="absolute top-[10px] h-[22px] -translate-x-1/2 border-l border-dashed border-ink" style={left(ccrP)} title="150%: Recovery Mode line (system TCR, not your liquidation line)" />
      <span className="num absolute top-[32px] -translate-x-1/2 text-[12px] text-muted" style={left(ccrP)}>
        {ccrP}%
      </span>
      {/* Current ICR */}
      {cur != null && (
        <div className="absolute top-0 -translate-x-1/2" style={left(Math.min(cur, MAX))}>
          <span className="block h-0 w-0 border-x-[7px] border-t-[10px] border-x-transparent border-t-ink" />
        </div>
      )}
      {sim != null && (
        <div className="absolute top-[11px] -translate-x-1/2" style={left(Math.min(sim, MAX))}>
          <span className="block h-[20px] w-[10px] rounded-[2px] border-2 border-dashed border-blue bg-paper" title="Simulated" />
        </div>
      )}
    </div>
  );
}
