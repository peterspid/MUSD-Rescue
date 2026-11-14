"use client";
import { useState } from "react";
import { Eye, EyeOff, Printer, Share2, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { useEvents, useHistory, usePosition, useRadar, useReference } from "@/lib/client/api";
import { paramsFromDTO } from "@/lib/convert";
import { recommend } from "@/lib/risk";
import { formatAmount, formatBps, formatBtc, formatHF, formatRatioPct, formatUsd, shortAddress } from "@/lib/risk/format";
import { assessFreshness } from "@/lib/risk/freshness";
import { parsePositionId } from "@/lib/positions/id";
import { Button, CATEGORY_COLOR, Recommendation, EmptyState, ErrorState, ExplorerLink, FreshnessPill, RiskBadge, SectionHeading, Segmented, Skeleton, SourceTag, Stat, CopyButton, cn, ButtonLink } from "./ui";
import { ClearanceGauge } from "./clearance";
import { HealthHistoryChart, PriceHistoryChart } from "./charts";
import { derivedRisk } from "./position-card";
import { LiveRescuePanel } from "./live-rescue";
import { AlertRules } from "./alert-rules";
import { useSession } from "./session";

export function InvalidId({ raw }: { raw: string }) {
  const id = parsePositionId(raw);
  if (id.kind === "demo")
    return (
      <EmptyState title="Demo positions live on the demo page" action={<ButtonLink href="/demo" variant="secondary">Open the demo</ButtonLink>}>
        <p>“{raw}” is a fictional demo position. Live pages only show troves read from Mezo testnet, so fictional data never mixes with real positions.</p>
      </EmptyState>
    );
  return (
    <EmptyState title="That is not a trove address">
      <p>Position ids are the 0x address that owns the MUSD trove. {id.kind === "invalid" ? id.reason : ""}</p>
    </EmptyState>
  );
}

export function PositionView({ owner, focus }: { owner: string; focus: "details" | "rescue" }) {
  const session = useSession();
  const q = usePosition(owner);
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [showRef, setShowRef] = useState(false);
  const hist = useHistory(owner, range);
  const ref = useReference(range === "24h" ? "1" : range === "7d" ? "7" : "30", showRef);
  const events = useEvents(owner);
  const radar = useRadar();
  const p = q.data;
  const watched = session.watchlist.some((w) => w.toLowerCase() === owner.toLowerCase());

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  if (q.error && !p) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!p) return null;
  const r = derivedRisk(p, session.thresholds);
  const params = paramsFromDTO(p.system.params);
  const rec = r ? recommend(r.category, { recoveryMode: !!p.system.recoveryMode, dropBps: r.dropToLiquidationBps }) : null;
  const fresh = assessFreshness(q.dataUpdatedAt || null, Date.now());
  const rank = radar.data && p.active ? radar.data.troves.findIndex((t) => t.owner.toLowerCase() === p.owner.toLowerCase()) : -1;

  const header = (
    <SectionHeading
      as="h1"
      title={
        <span className="flex flex-wrap items-center gap-3">
          {focus === "rescue" ? "Rescue simulator" : "Trove"} <span className="addr text-[22px] font-normal text-ink-soft">{shortAddress(p.owner, 6)}</span>
          {r && <RiskBadge category={r.category} size="lg" />}
        </span>
      }
      desc={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Mezo MUSD on Mezo Testnet</span>
          <ExplorerLink address={p.owner}>explorer</ExplorerLink>
          <SourceTag kind="onchain" />
          <FreshnessPill freshness={fresh} ageLabel={`block ${Number(p.system.blockNumber).toLocaleString("en-US")}`} />
        </span>
      }
      right={
        <div className="no-print flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => (watched ? session.removeWatch(p.owner) : session.addWatch(p.owner).then(() => toast.success("Added to your dashboard")))}>
            {watched ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {watched ? "Unwatch" : "Watch"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const url = `${window.location.origin}/positions/${p.owner}`;
              try {
                if (navigator.share) await navigator.share({ title: "MUSD trove risk", url });
                else {
                  await navigator.clipboard.writeText(url);
                  toast.success("Read-only link copied");
                }
              } catch {
                /* cancelled */
              }
            }}
          >
            <Share2 className="size-4" /> Share
          </Button>
          <ButtonLink href={`/positions/${p.owner}/report`} size="sm" variant="ghost">
            <Printer className="size-4" /> Report
          </ButtonLink>
          {focus === "details" ? (
            <ButtonLink href={`/rescue/${p.owner}`} size="sm" variant="primary">
              <LifeBuoy className="size-4" /> Rescue simulator
            </ButtonLink>
          ) : (
            <ButtonLink href={`/positions/${p.owner}`} size="sm" variant="secondary">Position details</ButtonLink>
          )}
        </div>
      }
    />
  );

  if (!p.active)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState title="No open MUSD trove at this address">
          <p>
            <span className="addr break-all">{p.owner}</span> has no open MUSD trove on Mezo testnet (status: {p.statusLabel.toLowerCase()}), so there is no liquidation risk to monitor. Wallet holds <span className="num">{formatAmount(BigInt(p.wallet.musd))}</span> MUSD and <span className="num">{formatBtc(BigInt(p.wallet.btc))}</span> BTC.
          </p>
        </EmptyState>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {header}
      {!p.system.price && <ErrorState title="Oracle price unavailable" error={p.system.priceError ?? "PriceFeed reverted"} />}
      {r && (
        <section className="panel grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-[1.2fr_1fr]" aria-label="Current risk">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className="text-[13px] text-muted">Health factor (ICR ÷ 110%)</div>
                <div className="num text-[56px] font-medium leading-none" style={{ color: CATEGORY_COLOR[r.category] }}>{formatHF(r.hf)}</div>
              </div>
              <Stat label="Collateral ratio (ICR)" value={formatRatioPct(r.icr, 2)} sub="getCurrentICR" />
              <Stat label="Liquidation price" value={formatUsd(r.liquidationPrice, 0)} sub={`oracle now ${formatUsd(BigInt(p.system.price!), 0)}`} />
              <Stat label="Room to liquidation" value={`−${formatBps(r.dropToLiquidationBps)}`} sub="BTC price drop" />
            </div>
            <ClearanceGauge icr={r.icr} mcr={params.mcr} ccr={params.ccr} thresholds={session.thresholds} />
            {rec && (
              <Recommendation rec={rec} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 text-[14px]">
            <div className="well col-span-2 p-4 sm:col-span-1">
              <h3 className="font-medium">Collateral</h3>
              <dl className="mt-2 space-y-1.5">
                <Row k="BTC in trove" v={formatBtc(BigInt(p.breakdown.storedColl))} />
                <Row k="Pending (redistribution)" v={formatBtc(BigInt(p.breakdown.pendingColl))} />
                <Row k="Total" v={`${formatBtc(BigInt(p.coll))} BTC`} strong />
                <Row k="Value at oracle" v={formatUsd(r.collValue)} />
              </dl>
            </div>
            <div className="well col-span-2 p-4 sm:col-span-1">
              <h3 className="font-medium">Debt (MUSD)</h3>
              <dl className="mt-2 space-y-1.5">
                <Row k="Borrowed + fees" v={formatAmount(BigInt(p.breakdown.storedPrincipal) - BigInt(p.breakdown.gasCompensation))} />
                <Row k="Gas compensation" v={formatAmount(BigInt(p.breakdown.gasCompensation))} />
                <Row k="Interest (recorded + accrued)" v={formatAmount(BigInt(p.breakdown.storedInterest) + BigInt(p.breakdown.accruedInterest), 4)} />
                <Row k="Pending (redistribution)" v={formatAmount(BigInt(p.breakdown.pendingPrincipal) + BigInt(p.breakdown.pendingInterest))} />
                <Row k="Total debt" v={formatAmount(BigInt(p.debt))} strong />
              </dl>
            </div>
            <div className="well col-span-2 grid grid-cols-2 gap-3 p-4">
              <Stat label="Interest rate" value={`${(p.interestRateBps / 100).toFixed(2)}%`} sub={`simple, ≈${formatAmount(BigInt(p.interestPerDay), 3)} MUSD/day`} />
              <Stat label="Repayable without closing" value={formatAmount(r.maxRepayWithoutClosing)} sub={`net debt must stay ≥ ${formatAmount(params.minNetDebt, 0)}`} />
              <Stat label="Cost to close" value={formatAmount(r.closeCost)} sub="debt − 200 gas comp." />
              <Stat
                label="Redemption order"
                value={rank >= 0 ? `#${rank + 1} of ${radar.data!.troves.length}` : "—"}
                sub="lowest ratios are redeemed against first"
              />
            </div>
          </div>
        </section>
      )}

      {focus === "rescue" && p.system.price && <LiveRescuePanel position={p} dataUpdatedAt={q.dataUpdatedAt} />}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">BTC oracle price</h2>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[13px] text-muted">
                <input type="checkbox" checked={showRef} onChange={(e) => setShowRef(e.target.checked)} className="size-4 accent-[var(--color-blue)]" /> External reference
              </label>
              <Segmented label="Range" value={range} onChange={setRange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }, { value: "30d", label: "30d" }]} />
            </div>
          </div>
          <div className="mt-4">
            {hist.isLoading ? <Skeleton className="h-[220px]" /> : hist.error ? <ErrorState title="History unavailable" error={hist.error} /> : hist.data ? <PriceHistoryChart data={hist.data} range={range} reference={showRef ? ref.data?.prices ?? null : null} /> : null}
            {showRef && ref.error && <p className="mt-2 text-[13px] font-medium text-ink">External reference unavailable right now.</p>}
          </div>
        </div>
        <div className="panel p-5">
          <h2 className="text-[16px] font-semibold">Health factor history</h2>
          <div className="mt-4">{hist.isLoading ? <Skeleton className="h-[200px]" /> : hist.data ? <HealthHistoryChart data={hist.data} range={range} mcr={params.mcr} /> : null}</div>
        </div>
      </section>

      {focus === "details" && p.system.price && (
        <section>
          <SectionHeading title="Scenario and rescue simulator" desc="Explore price moves and rescue amounts. Execution happens on the rescue page, after a confirmation screen." right={<ButtonLink href={`/rescue/${p.owner}`} size="sm" variant="secondary">Open rescue page</ButtonLink>} />
          <div className="mt-4">
            <LiveRescuePanel position={p} dataUpdatedAt={q.dataUpdatedAt} />
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Recent on-chain activity</h2>
            <SourceTag kind="onchain" />
          </div>
          {events.isLoading && <Skeleton className="mt-4 h-24" />}
          {events.error && <p className="mt-3 text-[14px] font-medium text-ink">Explorer log API unavailable: {(events.error as Error).message}</p>}
          {events.data && events.data.events.length === 0 && <p className="mt-3 text-[14px] text-muted">No trove events found.</p>}
          <ol className="mt-3 divide-y divide-line">
            {events.data?.events.slice(0, 12).map((e) => (
              <li key={e.txHash + e.operation} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[14px]">
                <span className="min-w-[180px] font-medium">{e.operation}</span>
                <span className="num text-muted">{e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : `block ${e.blockNumber}`}</span>
                <span className="num text-ink-soft">
                  {formatBtc(BigInt(e.coll))} BTC, {formatAmount(BigInt(e.principal) + BigInt(e.interest))} MUSD
                </span>
                <ExplorerLink hash={e.txHash} className="ml-auto" />
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[13px] text-muted">{events.data?.source}</p>
        </div>
        <div className="panel p-5">
          <h2 className="text-[16px] font-semibold">Alerts for this trove</h2>
          <p className="mt-1 text-[13px] text-muted">Checked once a day by a scheduled job, on every visit, and when you press Check now. Not continuous.</p>
          <div className="mt-4">
            <AlertRules owner={p.owner} compact />
          </div>
        </div>
      </section>

      <p className="text-[13px] text-muted">
        Data source: TroveManager.getEntireDebtAndColl, Troves and PriceFeed.fetchPrice via Multicall3 on Mezo Testnet, block {Number(p.system.blockNumber).toLocaleString("en-US")} (chain time {new Date(p.system.blockTime * 1000).toLocaleString()}). Owner <span className="addr break-all">{p.owner}</span> <CopyButton value={p.owner} />
      </p>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "border-t border-line pt-1.5 font-medium")}>
      <dt className="text-muted">{k}</dt>
      <dd className="num text-ink">{v}</dd>
    </div>
  );
}
