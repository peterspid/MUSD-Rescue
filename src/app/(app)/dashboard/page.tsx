"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQueries } from "@tanstack/react-query";
import { FlaskConical, Wallet, RefreshCw, ExternalLink } from "lucide-react";
import { api, useSystem } from "@/lib/client/api";
import type { PositionDTO } from "@/lib/dto";
import { summarizePortfolio, sortBySeverity, type PortfolioEntry } from "@/lib/positions/portfolio";
import { formatAmount, formatHF, formatUsd, shortAddress } from "@/lib/risk/format";
import { PositionCard, derivedRisk } from "@/components/position-card";
import { useSession } from "@/components/session";
import { ConnectButton, WalletHelpers } from "@/components/wallet";
import { WatchInput } from "@/components/watch-input";
import { Button, EmptyState, ErrorState, SectionHeading, Skeleton, Stat, CATEGORY_COLOR, FreshnessPill, ButtonLink } from "@/components/ui";
import { assessFreshness } from "@/lib/risk/freshness";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const session = useSession();
  const sys = useSystem();
  const owners = useMemo(() => {
    const list = [...(address ? [address] : []), ...session.watchlist];
    return list.filter((a, i) => list.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
  }, [address, session.watchlist]);
  const results = useQueries({
    queries: owners.map((o) => ({ queryKey: ["position", o.toLowerCase()], queryFn: () => api<PositionDTO>(`/api/positions/${o}`), refetchInterval: 15_000, staleTime: 5_000 })),
  });
  const loaded = results.map((r, i) => ({ owner: owners[i], q: r }));
  const positions = loaded.filter((x) => x.q.data).map((x) => x.q.data!);
  const active = positions.filter((p) => p.active);
  const entries: PortfolioEntry[] = active.map((p) => {
    const r = derivedRisk(p, session.thresholds);
    return { source: "onchain", owner: p.owner, protocol: "Mezo MUSD", category: r?.category ?? "unknown", collValue: r?.collValue ?? 0n, debt: BigInt(p.debt), hf: r?.hf ?? null };
  });
  const summary = summarizePortfolio(entries);
  const lastRefresh = Math.max(0, ...results.map((r) => r.dataUpdatedAt || 0));
  const own = address ? positions.find((p) => p.owner.toLowerCase() === address.toLowerCase()) : undefined;
  const sorted = sortBySeverity(active.map((p) => ({ p, category: derivedRisk(p, session.thresholds)?.category ?? "unknown", hf: derivedRisk(p, session.thresholds)?.hf ?? null })));

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        as="h1"
        title="Portfolio risk"
        desc="Every MUSD trove you own or watch, read live from Mezo testnet. Liquidation happens per trove, so the summary reports the weakest position rather than a blended health factor."
        right={
          <div className="flex items-center gap-3">
            <FreshnessPill freshness={assessFreshness(lastRefresh || null, Date.now())} ageLabel={lastRefresh ? new Date(lastRefresh).toLocaleTimeString() : undefined} />
            <Button size="sm" variant="ghost" onClick={() => results.forEach((r) => r.refetch())}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      {owners.length === 0 && (
        <EmptyState icon={<Wallet className="size-7" />} title="Connect a wallet or watch a trove" action={<div className="flex flex-wrap gap-2"><ConnectButton /><ButtonLink href="/demo" variant="secondary"><FlaskConical className="size-4" /> Explore the demo</ButtonLink></div>}>
          <p>MUSD Rescue reads MUSD troves directly from the protocol contracts on Mezo testnet. Connect the wallet that owns a trove, or watch any address read-only.</p>
          <WatchInput className="mt-4 max-w-[560px]" />
        </EmptyState>
      )}

      {owners.length > 0 && (
        <section className="panel grid grid-cols-2 gap-5 p-5 md:grid-cols-4 xl:grid-cols-7" aria-label="Portfolio summary">
          <Stat label="Collateral value" value={formatUsd(summary.totalCollValue, 0)} sub="at oracle price" />
          <Stat label="Outstanding debt" value={`${formatAmount(summary.totalDebt, 0)}`} sub="MUSD incl. interest" />
          <Stat label="Weakest health factor" value={summary.weakest ? formatHF(summary.weakest.hf) : "—"} tone={summary.weakest ? CATEGORY_COLOR[summary.weakest.category] : undefined} sub={summary.weakest ? shortAddress(summary.weakest.owner) : "no debt"} />
          <Stat label="Healthy" value={summary.healthy} tone="var(--color-blue)" />
          <Stat label="Needs attention" value={summary.attention} tone="var(--color-ink)" />
          <Stat label="Critical" value={summary.critical} tone="var(--color-ink)" />
          <div className="min-w-0">
            <div className="text-[13px] text-muted">Data source</div>
            <div className="mt-1 text-[14px] text-ink">TroveManager + PriceFeed</div>
            <div className="text-[13px] text-muted">{sys.data ? `Mezo Testnet, block ${Number(sys.data.blockNumber).toLocaleString("en-US")}` : sys.error ? "RPC unavailable" : "connecting…"}</div>
          </div>
        </section>
      )}

      {isConnected && address && own && !own.active && (
        <EmptyState icon={<Wallet className="size-7" />} title={`No open MUSD trove for ${shortAddress(address)}`}>
          <p>This wallet has no active trove on Mezo testnet ({own.statusLabel.toLowerCase()}), so there is nothing to liquidate or rescue. Next steps:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            <li>Open a trove (borrow MUSD against BTC) in the official Mezo app, then come back. <a href="https://mezo.org" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue hover:underline">mezo.org <ExternalLink className="size-3" /></a></li>
            <li>Get testnet BTC for gas from the <a href="https://faucet.test.mezo.org/" target="_blank" rel="noreferrer" className="text-blue hover:underline">Mezo faucet</a>.</li>
            <li>Watch another trove read-only, or try the fictional <Link href="/demo" className="text-blue hover:underline">demo</Link>.</li>
          </ul>
          <div className="mt-4 flex flex-col gap-3">
            <WatchInput className="max-w-[560px]" />
            <WalletHelpers />
          </div>
        </EmptyState>
      )}

      {loaded.some((x) => x.q.isLoading) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {loaded.filter((x) => x.q.isLoading).map((x) => (
            <div key={x.owner} className="panel flex flex-col gap-3 p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-6" />
              <Skeleton className="h-20" />
            </div>
          ))}
        </div>
      )}
      {loaded.filter((x) => x.q.error).map((x) => (
        <ErrorState key={x.owner} title={`Could not read ${shortAddress(x.owner)}`} error={x.q.error} onRetry={() => x.q.refetch()} />
      ))}

      {sorted.length > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {sorted.map(({ p }) => (
            <PositionCard key={p.owner} p={p} thresholds={session.thresholds} mine={!!address && p.owner.toLowerCase() === address.toLowerCase()} onRemove={session.watchlist.some((w) => w.toLowerCase() === p.owner.toLowerCase()) ? () => session.removeWatch(p.owner) : undefined} />
          ))}
        </div>
      )}
      {positions.filter((p) => !p.active && p.owner.toLowerCase() !== address?.toLowerCase()).map((p) => (
        <div key={p.owner} className="panel flex items-center justify-between p-4 text-[14px] text-ink-soft">
          <span><span className="num">{shortAddress(p.owner)}</span>: no active trove ({p.statusLabel.toLowerCase()}).</span>
          <Button size="sm" variant="ghost" onClick={() => session.removeWatch(p.owner)}>Remove</Button>
        </div>
      ))}

      {owners.length > 0 && (
        <section className="panel p-5">
          <h2 className="font-medium">Watch another trove</h2>
          <p className="mt-1 text-[14px] text-muted">Open any address read-only, then use “Watch” on its page to keep it on this dashboard.</p>
          <WatchInput className="mt-3 max-w-[560px]" compact />
        </section>
      )}
    </div>
  );
}
