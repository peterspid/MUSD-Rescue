"use client";
import Link from "next/link";
import { useRadar, useSystem } from "@/lib/client/api";
import { formatAmount, formatRatioPct, formatUsd, formatBps } from "@/lib/risk/format";
import { SourceTag, Skeleton } from "./ui";

export function LiveNumbers() {
  const { data, error } = useSystem();
  const rows = data
    ? [
        { k: "BTC price used for liquidations", v: data.price ? formatUsd(BigInt(data.price)) : "unavailable", s: "PriceFeed.fetchPrice()" },
        { k: "System collateral ratio", v: formatRatioPct(data.tcr ? BigInt(data.tcr) : null), s: data.recoveryMode ? "Recovery Mode is active" : `Recovery Mode below 150% (BTC −${data.dropToRecoveryBps ? formatBps(BigInt(data.dropToRecoveryBps)) : "—"})` },
        { k: "Open troves", v: data.troveCount.toLocaleString("en-US"), s: "TroveManager.getTroveOwnersCount()" },
        { k: "MUSD debt outstanding", v: formatAmount(BigInt(data.totalDebt), 0), s: "ActivePool + DefaultPool" },
        { k: "BTC collateral locked", v: formatAmount(BigInt(data.totalColl), 2), s: "native BTC" },
        { k: "Stability Pool", v: `${formatAmount(BigInt(data.stabilityPoolMusd), 0)} MUSD`, s: "absorbs liquidated debt" },
      ]
    : [];
  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold">MUSD on Mezo testnet, right now</h2>
        <SourceTag kind="onchain" />
      </div>
      {error && !data && <p className="mt-4 text-sm text-critical">The Mezo testnet RPC did not respond. No numbers are shown rather than old ones.</p>}
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        {!data && !error && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}
        {rows.map((r) => (
          <div key={r.k} className="border-l-2 border-ink-4 pl-3">
            <dt className="text-[13px] text-fg-3">{r.k}</dt>
            <dd className="num mt-0.5 text-[22px] text-fg">{r.v}</dd>
            <dd className="text-[12px] text-fg-3">{r.s}</dd>
          </div>
        ))}
      </dl>
      {data && <p className="num mt-5 text-[12px] text-fg-3">Block {Number(data.blockNumber).toLocaleString("en-US")}, read {new Date(data.fetchedAt).toLocaleTimeString()}</p>}
    </div>
  );
}

export function RadarTeaser() {
  const { data } = useRadar();
  if (!data) return <Skeleton className="h-16" />;
  const within = (bps: number) => data.troves.filter((t) => t.dropToLiquidationBps != null && Number(t.dropToLiquidationBps) <= bps).length;
  return (
    <Link href="/radar" className="well block p-4 hover:border-teal/50">
      <div className="text-[13px] text-fg-3">Liquidation radar</div>
      <p className="mt-1 text-[14.5px] text-fg-2">
        <span className="num text-fg">{within(1000)}</span> of <span className="num">{data.troves.length}</span> troves would be liquidatable after a 10% BTC drop, <span className="num text-fg">{within(2000)}</span> after 20%.
      </p>
    </Link>
  );
}
