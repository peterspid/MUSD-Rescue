"use client";
import { useState } from "react";
import Link from "next/link";
import { useRadar } from "@/lib/client/api";
import { formatAmount, formatBps, formatBtc, formatRatioPct, formatUsd, shortAddress } from "@/lib/risk/format";
import { classifyRisk, healthFactor } from "@/lib/risk/health";
import { LiquidationCurve, RadarHistogram } from "@/components/charts";
import { ErrorState, RiskBadge, SectionHeading, Skeleton, SourceTag, Stat, Segmented } from "@/components/ui";
import { useSession } from "@/components/session";

export default function RadarPage() {
  const { data, error, isLoading, refetch } = useRadar();
  const session = useSession();
  const [show, setShow] = useState<"25" | "100" | "all">("25");
  if (isLoading)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  if (error || !data) return <ErrorState error={error ?? "No data"} onRetry={() => refetch()} />;
  const mcr = BigInt(data.system.params.mcr);
  const within = (bps: number) => data.troves.filter((t) => t.dropToLiquidationBps != null && Number(t.dropToLiquidationBps) <= bps);
  const liqNow = data.troves.filter((t) => t.icr && BigInt(t.icr) < mcr);
  const list = show === "all" ? data.troves : data.troves.slice(0, Number(show));
  const debtWithin = (bps: number) => within(bps).reduce((s, t) => s + BigInt(t.debt), 0n);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        as="h1"
        title="Liquidation radar"
        desc={`Every open MUSD trove on Mezo testnet, read through Multicall3 at block ${Number(data.system.blockNumber).toLocaleString("en-US")} and sorted by collateral ratio. Lowest ratios are first in line for liquidation (below 110%) and for redemptions.`}
        right={<SourceTag kind="onchain" />}
      />
      <section className="panel grid grid-cols-2 gap-5 p-5 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Open troves" value={data.troves.length} />
        <Stat label="Oracle BTC" value={data.system.price ? formatUsd(BigInt(data.system.price), 0) : "—"} />
        <Stat label="System TCR" value={formatRatioPct(data.system.tcr ? BigInt(data.system.tcr) : null)} sub={data.system.recoveryMode ? "Recovery Mode active" : `Recovery Mode after BTC −${data.system.dropToRecoveryBps ? formatBps(BigInt(data.system.dropToRecoveryBps)) : "—"}`} />
        <Stat label="Liquidatable now" value={liqNow.length} tone={liqNow.length ? "var(--color-critical)" : undefined} sub="ICR below 110%" />
        <Stat label="Within a 10% drop" value={within(1000).length} tone="var(--color-high)" sub={`${formatAmount(debtWithin(1000), 0)} MUSD debt`} />
        <Stat label="Within a 20% drop" value={within(2000).length} tone="var(--color-caution)" sub={`${formatAmount(debtWithin(2000), 0)} MUSD debt`} />
      </section>
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Troves by collateral ratio</h2>
          <div className="mt-3">
            <RadarHistogram troves={data.troves} />
          </div>
        </div>
        <div className="panel p-5">
          <h2 className="font-display text-lg font-semibold">Debt that becomes liquidatable as BTC falls</h2>
          <div className="mt-3">{data.system.price && <LiquidationCurve troves={data.troves} price={BigInt(data.system.price)} />}</div>
        </div>
      </section>
      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Riskiest troves</h2>
          <Segmented label="Rows" value={show} onChange={setShow} options={[{ value: "25", label: "25" }, { value: "100", label: "100" }, { value: "all", label: "All" }]} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13.5px]">
            <thead>
              <tr className="text-[12px] text-fg-3">
                <th className="py-2 font-normal">#</th>
                <th className="py-2 font-normal">Owner</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">ICR</th>
                <th className="py-2 font-normal">Collateral</th>
                <th className="py-2 font-normal">Debt (MUSD)</th>
                <th className="py-2 font-normal">Liquidation price</th>
                <th className="py-2 font-normal">Room</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t, i) => {
                const hf = t.icr ? healthFactor(BigInt(t.icr), mcr) : null;
                return (
                  <tr key={t.owner} className="border-t border-ink-4">
                    <td className="num py-2 text-fg-3">{i + 1}</td>
                    <td className="py-2"><Link className="num text-teal hover:underline" href={`/positions/${t.owner}`}>{shortAddress(t.owner, 5)}</Link></td>
                    <td className="py-2"><RiskBadge category={classifyRisk(hf, session.thresholds)} size="sm" /></td>
                    <td className="num py-2">{formatRatioPct(t.icr ? BigInt(t.icr) : null)}</td>
                    <td className="num py-2">{formatBtc(BigInt(t.coll))}</td>
                    <td className="num py-2">{formatAmount(BigInt(t.debt), 0)}</td>
                    <td className="num py-2">{formatUsd(t.liquidationPrice ? BigInt(t.liquidationPrice) : null, 0)}</td>
                    <td className="num py-2">{t.dropToLiquidationBps != null ? `−${formatBps(BigInt(t.dropToLiquidationBps))}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] text-fg-3">Testnet troves include test and scale-test positions; amounts are testnet MUSD. Cached for 60 seconds. One trove per address, so the owner address is the trove id.</p>
      </section>
    </div>
  );
}
