"use client";
import { WAD } from "@/lib/risk/math";
import type { RiskThresholds } from "@/lib/risk/health";
import { DEFAULT_THRESHOLDS } from "@/lib/risk/health";
import { formatRatioPct } from "@/lib/risk/format";
import { cn } from "./ui";

const MIN = 100; // ICR % at the bottom/left of the scale
const MAX = 350;

function pct(icr: bigint | null): number | null {
  if (icr == null) return null;
  return Number((icr * 10_000n) / WAD) / 100; // ICR as a % number for drawing only
}
function pos(p: number) {
  return Math.min(1, Math.max(0, (p - MIN) / (MAX - MIN)));
}

/**
 * The clearance instrument: where the trove's ICR sits relative to the 110% liquidation floor, the risk bands
 * (health-factor thresholds × MCR) and the 150% Recovery Mode line. A dashed marker shows a simulated ICR.
 */
export function ClearanceGauge({
  icr,
  simulatedIcr,
  mcr,
  ccr,
  thresholds = DEFAULT_THRESHOLDS,
  orientation = "horizontal",
  className,
  label = "Collateral ratio relative to the liquidation line",
}: {
  icr: bigint | null;
  simulatedIcr?: bigint | null;
  mcr: bigint;
  ccr: bigint;
  thresholds?: RiskThresholds;
  orientation?: "horizontal" | "vertical";
  className?: string;
  label?: string;
}) {
  const mcrP = pct(mcr)!;
  const ccrP = pct(ccr)!;
  const band = (hf: bigint) => pct((hf * mcr) / WAD)!;
  const bands = [
    { from: MIN, to: mcrP, color: "var(--color-critical)", o: 0.55, name: "Liquidatable" },
    { from: mcrP, to: band(thresholds.criticalAtOrBelow), color: "var(--color-critical)", o: 0.28, name: "Critical" },
    { from: band(thresholds.criticalAtOrBelow), to: band(thresholds.cautionFrom), color: "var(--color-high)", o: 0.26, name: "High risk" },
    { from: band(thresholds.cautionFrom), to: band(thresholds.healthyAbove), color: "var(--color-caution)", o: 0.22, name: "Caution" },
    { from: band(thresholds.healthyAbove), to: MAX, color: "var(--color-safe)", o: 0.2, name: "Healthy" },
  ];
  const cur = pct(icr);
  const sim = simulatedIcr === undefined ? undefined : pct(simulatedIcr);
  const vertical = orientation === "vertical";
  const at = (p: number) => (vertical ? { bottom: `${pos(p) * 100}%` } : { left: `${pos(p) * 100}%` });
  const spanStyle = (a: number, b: number) =>
    vertical ? { bottom: `${pos(a) * 100}%`, height: `${(pos(b) - pos(a)) * 100}%` } : { left: `${pos(a) * 100}%`, width: `${(pos(b) - pos(a)) * 100}%` };
  const ariaText = `${label}: current ${cur == null ? "no debt" : formatRatioPct(icr ?? null)}${sim != null ? `, simulated ${formatRatioPct(simulatedIcr ?? null)}` : ""}; liquidation below ${mcrP}%`;
  return (
    <div className={cn("relative select-none", vertical ? "h-full min-h-[280px] w-[86px]" : "h-[46px] w-full", className)} role="img" aria-label={ariaText}>
      <div className={cn("absolute overflow-hidden rounded-md border border-ink-4 bg-ink-1", vertical ? "inset-y-0 left-[38px] w-[16px]" : "inset-x-0 top-[14px] h-[12px]")}>
        {bands.map((b) => (
          <div key={b.name} className="absolute" style={{ ...spanStyle(b.from, b.to), ...(vertical ? { left: 0, right: 0 } : { top: 0, bottom: 0 }), background: b.color, opacity: b.o }} title={b.name} />
        ))}
      </div>
      {/* Liquidation floor */}
      <div className={cn("absolute bg-critical", vertical ? "left-[30px] h-[2px] w-[32px]" : "top-[8px] h-[24px] w-[2px]")} style={{ ...at(mcrP), boxShadow: "0 0 10px var(--color-critical)" }} />
      <span className={cn("num absolute text-[11px] text-critical", vertical ? "left-[64px] -translate-y-1/2" : "top-[30px] -translate-x-1/2")} style={at(mcrP)}>
        {mcrP}%
      </span>
      {/* Recovery Mode line (system-level) */}
      <div className={cn("absolute border-caution/70", vertical ? "left-[34px] w-[24px] border-t border-dashed" : "top-[10px] h-[20px] border-l border-dashed")} style={at(ccrP)} title="150%: Recovery Mode line (system TCR, not your liquidation line)" />
      <span className={cn("num absolute text-[11px] text-caution/80", vertical ? "left-[64px] -translate-y-1/2" : "top-[30px] -translate-x-1/2")} style={at(ccrP)}>
        {ccrP}%
      </span>
      {/* Current ICR */}
      {cur != null && (
        <div className={cn("absolute", vertical ? "left-0 -translate-y-1/2" : "top-0 -translate-x-1/2")} style={at(Math.min(cur, MAX))}>
          {vertical ? (
            <div className="flex items-center gap-1">
              <span className="num w-[34px] text-right text-[11.5px] font-semibold text-fg">{cur > MAX ? ">350" : Math.round(cur)}</span>
              <span className="block h-0 w-0 border-y-[6px] border-l-[8px] border-y-transparent border-l-fg" />
            </div>
          ) : (
            <span className="block h-0 w-0 border-x-[7px] border-t-[10px] border-x-transparent border-t-fg" />
          )}
        </div>
      )}
      {sim != null && (
        <div className={cn("absolute", vertical ? "left-[34px] -translate-y-1/2" : "top-[11px] -translate-x-1/2")} style={at(Math.min(sim, MAX))}>
          <span className={cn("block border-2 border-dashed border-teal-strong", vertical ? "h-[10px] w-[24px] rounded-sm" : "h-[18px] w-[10px] rounded-sm")} title="Simulated" />
        </div>
      )}
    </div>
  );
}
