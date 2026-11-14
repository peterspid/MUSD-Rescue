"use client";
import Link from "next/link";
import { X } from "lucide-react";
import type { PositionDTO } from "@/lib/dto";
import { assessPosition, recommend } from "@/lib/risk";
import { amountsFromDTO, paramsFromDTO } from "@/lib/convert";
import type { RiskThresholds } from "@/lib/risk/health";
import { formatAmount, formatBps, formatBtc, formatHF, formatRatioPct, formatUsd, shortAddress } from "@/lib/risk/format";
import { ButtonLink, CATEGORY_COLOR, Recommendation, RiskBadge, SourceTag } from "./ui";
import { ClearanceGauge } from "./clearance";

export function derivedRisk(p: PositionDTO, thresholds: RiskThresholds) {
  if (!p.active || !p.system.price) return null;
  return assessPosition(amountsFromDTO(p), BigInt(p.system.price), paramsFromDTO(p.system.params), !!p.system.recoveryMode, thresholds);
}

export function PositionCard({ p, thresholds, mine, onRemove }: { p: PositionDTO; thresholds: RiskThresholds; mine?: boolean; onRemove?: () => void }) {
  const r = derivedRisk(p, thresholds);
  const params = paramsFromDTO(p.system.params);
  const rec = r ? recommend(r.category, { recoveryMode: !!p.system.recoveryMode, dropBps: r.dropToLiquidationBps }) : null;
  return (
    <article className="panel flex flex-col gap-4 p-5" aria-label={`Trove ${p.owner}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span>Mezo MUSD trove</span>
            <SourceTag kind="onchain" />
            {mine && <span className="rounded-[var(--radius-badge)] bg-blue px-1.5 py-0.5 text-[12px] leading-none font-medium text-paper">Your wallet</span>}
          </div>
          <Link href={`/positions/${p.owner}`} className="addr mt-1 block text-[15px] text-ink underline-offset-4 hover:text-blue hover:underline">
            {shortAddress(p.owner, 6)}
          </Link>
        </div>
        <div className="flex items-center gap-1">
          {r ? <RiskBadge category={r.category} /> : <span className="text-[13px] text-muted">{p.statusLabel}</span>}
          {onRemove && (
            <button type="button" onClick={onRemove} className="rounded p-1 text-muted hover:text-ink" aria-label={`Stop watching ${p.owner}`}>
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>
      {r ? (
        <>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[13px] text-muted">Health factor</div>
              <div className="num text-[40px] font-medium leading-none" style={{ color: CATEGORY_COLOR[r.category] }}>{formatHF(r.hf)}</div>
            </div>
            <div className="text-right">
              <div className="text-[13px] text-muted">Collateral ratio</div>
              <div className="num text-[20px] font-medium">{formatRatioPct(r.icr)}</div>
            </div>
          </div>
          <ClearanceGauge icr={r.icr} mcr={params.mcr} ccr={params.ccr} thresholds={thresholds} />
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
            <div><dt className="text-muted">Collateral</dt><dd className="num">{formatBtc(BigInt(p.coll))} BTC <span className="text-muted">({formatUsd(r.collValue, 0)})</span></dd></div>
            <div><dt className="text-muted">Debt</dt><dd className="num">{formatAmount(BigInt(p.debt))} MUSD</dd></div>
            <div><dt className="text-muted">Liquidation price</dt><dd className="num">{formatUsd(r.liquidationPrice, 0)}</dd></div>
            <div><dt className="text-muted">Room to liquidation</dt><dd className="num">BTC −{formatBps(r.dropToLiquidationBps)}</dd></div>
            <div><dt className="text-muted">Liquidation threshold</dt><dd className="num">ICR &lt; {formatRatioPct(r.threshold, 0)}</dd></div>
            <div><dt className="text-muted">Updated</dt><dd className="num">block {Number(p.system.blockNumber).toLocaleString("en-US")}</dd></div>
          </dl>
          {rec && (
            <Recommendation rec={rec} />
          )}
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/rescue/${p.owner}`} size="sm" variant={r.category === "healthy" ? "secondary" : "primary"}>Rescue simulator</ButtonLink>
            <ButtonLink href={`/positions/${p.owner}`} size="sm" variant="ghost">Details</ButtonLink>
          </div>
        </>
      ) : (
        <p className="text-[14px] text-ink-soft">{p.active ? "The oracle price is unavailable, so risk cannot be computed right now." : `No active trove (${p.statusLabel.toLowerCase()}).`}</p>
      )}
    </article>
  );
}
