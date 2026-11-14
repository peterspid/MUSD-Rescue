"use client";
import Link from "next/link";
import { useGuardRegistry } from "@/lib/client/guard";
import { formatAmount, formatBtc, formatRatioPct, shortAddress } from "@/lib/risk/format";
import { EmptyState, ErrorState, ExplorerLink, Skeleton } from "../ui";
import { GuardStatusBadge } from "./panel";

export function GuardRegistry() {
  const reg = useGuardRegistry();
  if (reg.isLoading) return <Skeleton className="h-40" />;
  if (reg.error) return <ErrorState title="Could not read the guard registry" error={reg.error} onRetry={() => reg.refetch()} />;
  const r = reg.data!;
  const amount = (kind: "repay" | "addColl", v: string) => (kind === "addColl" ? `${formatBtc(BigInt(v))} BTC` : `${formatAmount(BigInt(v))} MUSD`);
  const plans = r.plans.filter((p) => p.plan || BigInt(p.reserves.musd) > 0n || BigInt(p.reserves.btc) > 0n);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="armed">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="armed" className="text-[20px] font-semibold">
            Protected troves
          </h2>
          <span className="text-[13px] text-muted">
            {r.keeper.configured ? <>App keeper <span className="addr">{shortAddress(r.keeper.address)}</span> checks daily and on request.</> : "No app keeper configured."} Anyone can run a ready rescue.
          </span>
        </div>
        {plans.length === 0 ? (
          <EmptyState title="No plans stored yet">Be the first: connect the wallet that owns a trove and store a rescue plan above.</EmptyState>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-[var(--radius-panel)] border border-line">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <thead className="border-b border-line bg-surface text-[13px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Trove</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Ratio now</th>
                  <th className="px-3 py-2 font-medium">Runs below</th>
                  <th className="px-3 py-2 font-medium">Rescue</th>
                  <th className="px-3 py-2 font-medium">Tip</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.owner} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/guard?owner=${p.owner}`} className="addr text-blue underline-offset-4 hover:underline">
                        {shortAddress(p.owner)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <GuardStatusBadge status={p.status} />
                    </td>
                    <td className="num px-3 py-2">{formatRatioPct(p.icr ? BigInt(p.icr) : null)}</td>
                    <td className="num px-3 py-2">{p.plan ? formatRatioPct(BigInt(p.plan.triggerIcr)) : "—"}</td>
                    <td className="num px-3 py-2">{p.plan ? `${p.plan.kind === "repay" ? "Repay" : "Add"} ${amount(p.plan.kind, p.plan.amount)}` : "—"}</td>
                    <td className="num px-3 py-2">{p.plan ? amount(p.plan.kind, p.plan.keeperTip) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="rescues">
        <h2 id="rescues" className="text-[20px] font-semibold">
          Rescues run on-chain
        </h2>
        {r.executions.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-soft">No rescue has run yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line rounded-[var(--radius-panel)] border border-line">
            {r.executions.map((e) => (
              <li key={e.txHash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-[14px]">
                <span>
                  <span className="addr">{shortAddress(e.owner)}</span>: {e.kind === "repay" ? "repaid" : "added"} <span className="num">{amount(e.kind, e.amount)}</span>, ratio{" "}
                  <span className="num">{formatRatioPct(BigInt(e.icrBefore))}</span> to <span className="num font-semibold">{formatRatioPct(BigInt(e.icrAfter))}</span>
                </span>
                <span className="flex items-center gap-3 text-[13px] text-muted">
                  <span>
                    run by <span className="addr">{shortAddress(e.keeper)}</span>, block <span className="num">{e.blockNumber.toLocaleString("en-US")}</span>
                  </span>
                  <ExplorerLink hash={e.txHash} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
