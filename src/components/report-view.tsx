"use client";
import { Printer } from "lucide-react";
import { usePosition } from "@/lib/client/api";
import { amountsFromDTO, paramsFromDTO } from "@/lib/convert";
import { applyBpsChange, assessPosition, collToReachICR, repayToReachICR, targetICRFromHF, WAD } from "@/lib/risk";
import { formatAmount, formatBps, formatBtc, formatHF, formatRatioPct, formatUsd } from "@/lib/risk/format";
import { Button, ErrorState, Skeleton, CATEGORY_COLOR } from "./ui";
import { CATEGORY_LABEL } from "@/lib/risk/health";
import { useSession } from "./session";

export function ReportView({ owner }: { owner: string }) {
  const q = usePosition(owner);
  const session = useSession();
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error ?? "No data"} />;
  const p = q.data;
  if (!p.active || !p.system.price) return <ErrorState title="No report available" error={p.active ? "Oracle price unavailable" : "This address has no active trove."} />;
  const params = paramsFromDTO(p.system.params);
  const a = amountsFromDTO(p);
  const price = BigInt(p.system.price);
  const rm = !!p.system.recoveryMode;
  const now = assessPosition(a, price, params, rm, session.thresholds);
  const scen = [0, -500, -1000, -2000, -3000].map((b) => ({ b, r: assessPosition(a, applyBpsChange(price, b), params, rm, session.thresholds) }));
  const targets = [1.25, 1.5, 2].map((hf) => {
    const t = targetICRFromHF(BigInt(Math.round(hf * 100)) * (WAD / 100n), params.mcr);
    return { hf, repay: repayToReachICR(a, price, t, params), coll: collToReachICR(a, price, t) };
  });
  return (
    <article className="print-dark-text mx-auto max-w-[860px]">
      <div className="no-print mb-4 flex justify-end">
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" /> Print or save as PDF
        </Button>
      </div>
      <div className="panel p-6 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-4 pb-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">MUSD trove risk report</h1>
            <p className="num mt-1 text-[13px] text-fg-2">{p.owner}</p>
            <p className="text-[13px] text-fg-3">Mezo Testnet, block {Number(p.system.blockNumber).toLocaleString("en-US")}, {new Date(p.system.blockTime * 1000).toUTCString()}</p>
          </div>
          <div className="text-right">
            <div className="num text-4xl" style={{ color: CATEGORY_COLOR[now.category] }}>{formatHF(now.hf)}</div>
            <div className="text-[13px] text-fg-3">health factor, {CATEGORY_LABEL[now.category].toLowerCase()}</div>
          </div>
        </header>
        <section className="mt-5 grid grid-cols-2 gap-4 text-[14px] sm:grid-cols-4">
          <div><div className="text-fg-3">Collateral</div><div className="num">{formatBtc(a.coll)} BTC</div></div>
          <div><div className="text-fg-3">Debt</div><div className="num">{formatAmount(a.debt)} MUSD</div></div>
          <div><div className="text-fg-3">Collateral ratio</div><div className="num">{formatRatioPct(now.icr, 2)}</div></div>
          <div><div className="text-fg-3">Liquidation price</div><div className="num">{formatUsd(now.liquidationPrice, 0)}</div></div>
          <div><div className="text-fg-3">Oracle price</div><div className="num">{formatUsd(price, 0)}</div></div>
          <div><div className="text-fg-3">Room to liquidation</div><div className="num">−{formatBps(now.dropToLiquidationBps)}</div></div>
          <div><div className="text-fg-3">System TCR</div><div className="num">{formatRatioPct(p.system.tcr ? BigInt(p.system.tcr) : null)}</div></div>
          <div><div className="text-fg-3">Recovery Mode</div><div>{rm ? "Active" : "No"}</div></div>
        </section>
        <h2 className="mt-7 font-display text-lg font-semibold">Price scenarios (hypothetical)</h2>
        <table className="mt-2 w-full text-left text-[13.5px]">
          <thead><tr className="text-fg-3"><th className="py-1 font-normal">BTC move</th><th className="py-1 font-normal">BTC price</th><th className="py-1 font-normal">ICR</th><th className="py-1 font-normal">Health factor</th><th className="py-1 font-normal">Status</th></tr></thead>
          <tbody>
            {scen.map(({ b, r }) => (
              <tr key={b} className="border-t border-ink-4">
                <td className="num py-1.5">{b === 0 ? "now" : `${b / 100}%`}</td>
                <td className="num py-1.5">{formatUsd(applyBpsChange(price, b), 0)}</td>
                <td className="num py-1.5">{formatRatioPct(r.icr)}</td>
                <td className="num py-1.5">{formatHF(r.hf)}</td>
                <td className="py-1.5">{CATEGORY_LABEL[r.category]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="mt-7 font-display text-lg font-semibold">What it would take</h2>
        <table className="mt-2 w-full text-left text-[13.5px]">
          <thead><tr className="text-fg-3"><th className="py-1 font-normal">Target HF</th><th className="py-1 font-normal">Repay MUSD</th><th className="py-1 font-normal">or add BTC</th></tr></thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.hf} className="border-t border-ink-4">
                <td className="num py-1.5">{t.hf.toFixed(2)}</td>
                <td className="num py-1.5">{t.repay.alreadyMet ? "met" : t.repay.feasible ? formatAmount(t.repay.required) : `> ${formatAmount(t.repay.capped)} cap (minNetDebt)`}</td>
                <td className="num py-1.5">{t.coll.alreadyMet ? "met" : formatBtc(t.coll.required)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-[12px] leading-relaxed text-fg-3">
          Health factor = ICR ÷ 110% (MUSD MCR). MUSD liquidates troves with ICR below 110% in both Normal and Recovery Mode. Repayments must leave net debt at or above {formatAmount(params.minNetDebt, 0)} MUSD. Interest accrues at {(p.interestRateBps / 100).toFixed(2)}% simple APR. Scenarios are hypothetical, not predictions. MUSD Rescue cannot guarantee that liquidation will be prevented. Generated by MUSD Rescue from on-chain reads.
        </p>
      </div>
    </article>
  );
}
