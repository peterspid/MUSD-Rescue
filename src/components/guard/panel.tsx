"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { BellRing, CircleSlash, PlayCircle, ShieldCheck, ShieldOff, Wallet } from "lucide-react";
import { classifyChain } from "@/config/chains";
import { RESCUE_GUARD } from "@/config/guard";
import { usePosition } from "@/lib/client/api";
import { askKeeper, fetchExecuteHints, useGuard } from "@/lib/client/guard";
import { disarmPlan, executeRescue, exitGuard } from "@/lib/client/guard-actions";
import { priceAtICR, STATUS_COPY, type GuardStatus } from "@/lib/guard/plan";
import { amountsFromDTO } from "@/lib/convert";
import { formatAmount, formatBtc, formatRatioPct, formatUsd, shortAddress } from "@/lib/risk/format";
import { ClearanceGauge } from "../clearance";
import { TxSteps, useTxRunner } from "../tx-steps";
import { Button, Callout, EmptyState, ErrorState, ExplorerLink, Skeleton, Stat, cn } from "../ui";
import { GuardSetup } from "./setup";
import { OpenTroveDialog } from "../open-trove-dialog";

/** Status as ink density: armed = blue outline, ready = solid black, problems = heavy black outline. */
export function GuardStatusBadge({ status, className }: { status: GuardStatus; className?: string }) {
  const cls =
    status === "waiting"
      ? "border-blue text-blue"
      : status === "ready"
        ? "border-ink bg-ink text-paper"
        : status === "none"
          ? "border-line-strong text-muted"
          : "border-2 border-ink text-ink";
  const Icon = status === "waiting" ? ShieldCheck : status === "ready" ? BellRing : status === "none" ? ShieldOff : CircleSlash;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border px-2 py-0.5 text-[13px] font-medium", cls, className)}>
      <Icon className="size-3.5" aria-hidden />
      {STATUS_COPY[status].label}
    </span>
  );
}

export function GuardPanel({ owner }: { owner: `0x${string}` }) {
  const { address, chainId } = useAccount();
  const writable = classifyChain(chainId).writes;
  const isOwner = !!address && address.toLowerCase() === owner.toLowerCase();
  const g = useGuard(owner);
  const pos = usePosition(owner);
  const [editing, setEditing] = useState(false);
  const [openTrove, setOpenTrove] = useState(false);
  const tx = useTxRunner();

  if (g.isLoading || pos.isLoading) {
    return (
      <div className="panel flex flex-col gap-3 p-5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-12" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (g.error) return <ErrorState title="Could not read RescueGuard" error={g.error} onRetry={() => g.refetch()} />;
  if (pos.error) return <ErrorState title="Could not read the trove" error={pos.error} onRetry={() => pos.refetch()} />;
  const guard = g.data!;
  const p = pos.data!;
  if (!guard.deployed) return <Callout tone="watch">RescueGuard is not deployed on this network yet.</Callout>;

  if (!p.active) {
    return (
      <EmptyState icon={<Wallet className="size-7" />} title={isOwner ? "This wallet has no open trove to protect" : `${shortAddress(owner)} has no open trove`}>
        <p>Rescue Guard protects an open MUSD trove.{isOwner ? " Open one with testnet BTC, then store a rescue plan here." : ""}</p>
        {isOwner && (
          <div className="mt-3">
            <Button variant="primary" onClick={() => setOpenTrove(true)}>
              Open a trove
            </Button>
            <OpenTroveDialog open={openTrove} onOpenChange={setOpenTrove} />
          </div>
        )}
        {(BigInt(guard.reserves.musd) > 0n || BigInt(guard.reserves.btc) > 0n) && isOwner && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-[14px]">
              You still have a reserve: {formatAmount(BigInt(guard.reserves.musd))} MUSD and {formatBtc(BigInt(guard.reserves.btc))} BTC.
            </span>
            <Button size="sm" variant="secondary" loading={tx.busy} onClick={() => tx.run(() => exitGuard(owner), { title: "Reserve withdrawn" })}>
              Withdraw everything
            </Button>
          </div>
        )}
        <TxSteps steps={tx.steps} error={tx.error} className="mt-3" />
      </EmptyState>
    );
  }

  const plan = guard.plan;
  const icrNow = p.risk?.icr ? BigInt(p.risk.icr) : null;
  const amounts = amountsFromDTO(p);
  const triggerPrice = plan ? priceAtICR(amounts.coll, amounts.debt, BigInt(plan.triggerIcr)) : null;
  const fmt = (v: string) => (plan?.kind === "addColl" ? `${formatBtc(BigInt(v))} BTC` : `${formatAmount(BigInt(v))} MUSD`);
  const showSetup = isOwner && (editing || guard.status === "none");

  async function runNow() {
    await tx.run(
      async (onStep) => {
        onStep("Reading fresh list hints for the trove");
        const h = await fetchExecuteHints(owner);
        if (!h.hints) throw new Error("No plan to run.");
        onStep("Confirm the rescue transaction in your wallet");
        return executeRescue(address!, owner, h.hints);
      },
      { title: "Rescue executed", description: isOwner ? "Your trove was rescued from your reserve." : "You ran the rescue and earned the keeper tip." },
    );
  }

  return (
    <section className="panel flex flex-col gap-5 p-5 sm:p-6" aria-label="Rescue Guard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold">{isOwner ? "Your Rescue Guard" : `Rescue Guard for ${shortAddress(owner)}`}</h2>
            <GuardStatusBadge status={guard.status} />
          </div>
          <p className="mt-1 max-w-[70ch] text-[14px] text-ink-soft">{STATUS_COPY[guard.status].detail}</p>
        </div>
        <ExplorerLink address={RESCUE_GUARD.address} className="text-[13px]">
          RescueGuard contract
        </ExplorerLink>
      </div>

      <div>
        <ClearanceGauge icr={icrNow} triggerIcr={plan ? BigInt(plan.triggerIcr) : null} mcr={BigInt(p.system.params.mcr)} ccr={BigInt(p.system.params.ccr)} />
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
          <span>Triangle: collateral ratio now ({formatRatioPct(icrNow)})</span>
          {plan && (
            <span className="text-blue">
              Blue line: rescue trigger ({formatRatioPct(BigInt(plan.triggerIcr))})
            </span>
          )}
          <span>Hatched: liquidation below 110%</span>
        </p>
      </div>

      {plan && !editing && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-4 md:grid-cols-5">
          <Stat label="Rescue" value={`${plan.kind === "repay" ? "Repay" : "Add"} ${fmt(plan.amount)}`} />
          <Stat label="Runs below" value={formatRatioPct(BigInt(plan.triggerIcr))} sub={triggerPrice ? `BTC ≈ ${formatUsd(triggerPrice, 0)}` : undefined} />
          <Stat label="Keeper tip" value={fmt(plan.keeperTip)} />
          <Stat label="Valid until" value={new Date(plan.deadline * 1000).toLocaleDateString()} />
          <Stat label="Reserve" value={plan.kind === "repay" ? `${formatAmount(BigInt(guard.reserves.musd))} MUSD` : `${formatBtc(BigInt(guard.reserves.btc))} BTC`} />
        </div>
      )}

      {guard.status === "ready" && !editing && (
        <Callout tone="urgent" title="This rescue can run now">
          <div className="flex flex-col gap-2">
            <span>The collateral ratio is below the trigger. Anyone can run it{isOwner ? "" : " and earn the keeper tip"}; the contract checks the trigger again on-chain.</span>
            <div className="flex flex-wrap gap-2">
              {address && (
                <Button size="sm" variant="primary" onClick={runNow} loading={tx.busy} disabled={!writable}>
                  <PlayCircle className="size-4" /> Run rescue now
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="border-paper bg-ink text-paper hover:bg-ink-soft"
                onClick={async () => {
                  try {
                    const r = await askKeeper();
                    if (r.skipped) toast(r.skipped);
                    else if (r.executed.length) toast.success("The keeper ran the rescue", { description: `${r.executed.length} rescue(s) executed.` });
                    else if (r.failed.length) toast.error("The keeper could not run it", { description: r.failed[0].error });
                    else toast("Nothing was ready when the keeper checked.");
                    g.refetch();
                  } catch (e) {
                    toast.error("Keeper request failed", { description: (e as Error).message });
                  }
                }}
              >
                Ask the app keeper
              </Button>
            </div>
          </div>
        </Callout>
      )}

      {isOwner && plan && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={tx.busy}>
            Change plan
          </Button>
          <Button variant="ghost" loading={tx.busy} disabled={!writable} onClick={() => tx.run(() => disarmPlan(owner), { title: "Plan cancelled", description: "Your reserve stays deposited until you withdraw it." })}>
            Cancel plan
          </Button>
          <Button variant="ghost" loading={tx.busy} disabled={!writable} onClick={() => tx.run(() => exitGuard(owner), { title: "Plan cancelled and reserve withdrawn" })}>
            Cancel and withdraw everything
          </Button>
        </div>
      )}
      {isOwner && !plan && (BigInt(guard.reserves.musd) > 0n || BigInt(guard.reserves.btc) > 0n) && (
        <div className="flex flex-wrap items-center gap-3 text-[14px]">
          <span>
            Reserve without a plan: {formatAmount(BigInt(guard.reserves.musd))} MUSD, {formatBtc(BigInt(guard.reserves.btc))} BTC.
          </span>
          <Button size="sm" variant="ghost" loading={tx.busy} disabled={!writable} onClick={() => tx.run(() => exitGuard(owner), { title: "Reserve withdrawn" })}>
            Withdraw everything
          </Button>
        </div>
      )}
      <TxSteps steps={tx.steps} error={tx.error} />

      {showSetup && (
        <div className="border-t border-line pt-5">
          <h3 className="mb-3 text-[16px] font-semibold">{plan ? "Replace the plan" : "Set up a rescue plan"}</h3>
          <GuardSetup position={p} guard={guard} onDone={() => setEditing(false)} onCancel={plan ? () => setEditing(false) : undefined} />
        </div>
      )}
    </section>
  );
}
