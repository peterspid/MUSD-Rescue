"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Download, KeyRound } from "lucide-react";
import { api } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Button, EmptyState, ExplorerLink, SectionHeading, Segmented, Skeleton, SourceTag } from "@/components/ui";
import { formatAmount, formatBtc, formatRatioPct, shortAddress } from "@/lib/risk/format";
import { useEvents } from "@/lib/client/api";

interface Ev {
  id: string;
  trove_owner: string | null;
  category: "onchain" | "offchain";
  kind: string;
  title: string;
  tx_hash: string | null;
  created_at: string;
}
interface Tx {
  tx_hash: string;
  action: string;
  repay_amount: string;
  coll_amount: string;
  status: string;
  block_number: string;
  gas_used: string | null;
  icr_before: string | null;
  icr_after: string | null;
  verified_at: string;
  trove_owner: string;
}

const KIND_LABEL: Record<string, string> = {
  position_discovered: "Position discovered",
  threshold_crossed: "Risk threshold crossed",
  alert_triggered: "Alert triggered",
  simulation_completed: "Simulation completed",
  tx_prepared: "Transaction prepared",
  tx_submitted: "Transaction submitted",
  tx_confirmed: "Transaction confirmed",
  tx_failed: "Transaction failed",
  tx_rejected: "Transaction rejected",
};

function csv(rows: Tx[]) {
  const head = "tx_hash,action,repay_musd_wei,coll_btc_wei,status,block,icr_before_wad,icr_after_wad,verified_at";
  const body = rows.map((t) => [t.tx_hash, t.action, t.repay_amount, t.coll_amount, t.status, t.block_number, t.icr_before ?? "", t.icr_after ?? "", t.verified_at].join(","));
  return [head, ...body].join("\n");
}

export default function ActivityPage() {
  const session = useSession();
  const { address } = useAccount();
  const [filter, setFilter] = useState<"all" | "onchain" | "offchain">("all");
  const q = useQuery({ queryKey: ["activity"], queryFn: () => api<{ events: Ev[]; transactions: Tx[] }>("/api/activity"), enabled: !!session.address, refetchInterval: 30_000 });
  const chainEvents = useEvents(address ?? null);
  const events = (q.data?.events ?? []).filter((e) => filter === "all" || e.category === filter);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        as="h1"
        title="Activity"
        desc="On-chain events are verified from transaction receipts or read from protocol logs. App events (simulations, prepared transactions, alerts) are recorded by MUSD Rescue and labelled separately."
        right={<Segmented label="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "onchain", label: "On-chain" }, { value: "offchain", label: "App events" }]} />}
      />
      {!session.address && (
        <EmptyState icon={<KeyRound className="size-7" />} title="Sign in to see your history" action={<Button variant="primary" loading={session.signingIn} onClick={() => session.signIn()} disabled={!address}>{address ? "Sign in with wallet" : "Connect a wallet first"}</Button>}>
          <p>Your verified rescue transactions and app events are stored per wallet. Signing in is a free signature; no transaction is sent.</p>
        </EmptyState>
      )}

      {session.address && (
        <section className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[16px] font-semibold">Verified rescue transactions</h2>
            {!!q.data?.transactions.length && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const blob = new Blob([csv(q.data!.transactions)], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = "musd-rescue-transactions.csv";
                  a.click();
                }}
              >
                <Download className="size-4" /> CSV
              </Button>
            )}
          </div>
          {q.isLoading && <Skeleton className="mt-4 h-20" />}
          {q.data && q.data.transactions.length === 0 && <p className="mt-3 text-[14px] text-muted">No verified rescues yet.</p>}
          <div className="mt-3 overflow-x-auto">
            {!!q.data?.transactions.length && (
              <table className="w-full min-w-[640px] text-left text-[14px]">
                <thead>
                  <tr className="text-[13px] text-muted">
                    <th className="py-2 font-normal">Action</th>
                    <th className="py-2 font-normal">Amount</th>
                    <th className="py-2 font-normal">Status</th>
                    <th className="py-2 font-normal">ICR before → after</th>
                    <th className="py-2 font-normal">Block</th>
                    <th className="py-2 font-normal">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.transactions.map((t) => (
                    <tr key={t.tx_hash} className="border-t border-line">
                      <td className="py-2.5">{t.action === "repay" ? "Repay MUSD" : t.action === "add_collateral" ? "Add BTC" : "Repay + add BTC"}</td>
                      <td className="num py-2.5">
                        {BigInt(t.repay_amount) > 0n && <div>{formatAmount(BigInt(t.repay_amount), 4)} MUSD</div>}
                        {BigInt(t.coll_amount) > 0n && <div>{formatBtc(BigInt(t.coll_amount))} BTC</div>}
                      </td>
                      <td className="py-2.5">
                        <span className={t.status === "confirmed" ? "text-blue" : "font-semibold text-ink"}>{t.status}</span> <SourceTag kind="onchain" className="ml-1" />
                      </td>
                      <td className="num py-2.5">{formatRatioPct(t.icr_before ? BigInt(t.icr_before) : undefined, 2)} → {formatRatioPct(t.icr_after ? BigInt(t.icr_after) : undefined, 2)}</td>
                      <td className="num py-2.5">{Number(t.block_number).toLocaleString("en-US")}</td>
                      <td className="py-2.5"><ExplorerLink hash={t.tx_hash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {session.address && (
        <section className="panel p-5 sm:p-6">
          <h2 className="text-[16px] font-semibold">Event log</h2>
          {q.isLoading && <Skeleton className="mt-4 h-24" />}
          {q.data && events.length === 0 && <p className="mt-3 text-[14px] text-muted">Nothing here yet.</p>}
          <ol className="mt-3 divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[14px]">
                <SourceTag kind={e.category === "onchain" ? "onchain" : "offchain"} />
                <span className="min-w-[160px] text-muted">{KIND_LABEL[e.kind] ?? e.kind}</span>
                <span className="flex-1 text-ink">{e.title}</span>
                {e.trove_owner && <span className="addr text-muted">{shortAddress(e.trove_owner)}</span>}
                {e.tx_hash && <ExplorerLink hash={e.tx_hash} />}
                <span className="num text-[12px] text-muted">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {address && (
        <section className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Protocol log for your trove</h2>
            <SourceTag kind="onchain" />
          </div>
          {chainEvents.data?.events.length === 0 && <p className="mt-3 text-[14px] text-muted">No MUSD trove events for {shortAddress(address)}.</p>}
          <ol className="mt-3 divide-y divide-line">
            {chainEvents.data?.events.map((e) => (
              <li key={e.txHash + e.operation} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[14px]">
                <span className="min-w-[200px] font-medium">{e.operation}</span>
                <span className="num text-muted">{e.timestamp ? new Date(e.timestamp * 1000).toLocaleString() : `block ${e.blockNumber}`}</span>
                <ExplorerLink hash={e.txHash} className="ml-auto" />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
