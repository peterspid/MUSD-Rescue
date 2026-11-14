"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Crosshair, Info, Lock, Target, TriangleAlert, OctagonAlert } from "lucide-react";
import {
  WAD,
  applyBpsChange,
  assessPosition,
  assessSystem,
  compareRescueOptions,
  interestPerDay,
  repayToReachICR,
  collToReachICR,
  simulateAdjustment,
  targetICRFromHF,
  liquidationThreshold,
  type PositionAmounts,
  type ProtocolParams,
  type RiskThresholds,
} from "@/lib/risk";
import { formatAmount, formatBps, formatBtc, formatHF, formatRatioPct, formatUsd, parseAmount, toInputString } from "@/lib/risk/format";
import type { ActionGate } from "@/lib/risk/freshness";
import { Button, CATEGORY_COLOR, Callout, Field, RiskBadge, Segmented, SourceTag, Stat, cn, inputCls } from "./ui";
import { ClearanceGauge } from "./clearance";

export interface SimulatorProps {
  mode: "live" | "fictional";
  position: PositionAmounts;
  basePrice: bigint;
  params: ProtocolParams;
  system: { totalColl: bigint; totalDebt: bigint };
  wallet?: { musd?: bigint; btc?: bigint };
  interestRateBps: number;
  thresholds: RiskThresholds;
  active: boolean;
  defaultTargetHF?: number;
  gate?: ActionGate;
  onPrepare?: (input: { repay: bigint; addColl: bigint }) => void;
  preparing?: boolean;
  onSimulated?: (s: { repay: string; addColl: string; hfAfter: string | null; priceChangeBps: number }) => void;
  /** Report the scenario price upward (e.g. to drive a 3D scene). */
  onScenarioPrice?: (p: bigint) => void;
}

const PRESETS = [0, -500, -1000, -2000, -3000];
type Tab = "repay" | "collateral" | "combined";

export function Simulator(props: SimulatorProps) {
  const { position: p, basePrice, params, system, wallet, thresholds, mode } = props;
  const [changeBps, setChangeBps] = useState(0);
  const [tab, setTab] = useState<Tab>("repay");
  const [repayStr, setRepayStr] = useState("");
  const [collStr, setCollStr] = useState("");
  const [borrowStr, setBorrowStr] = useState("");
  const [targetStr, setTargetStr] = useState(String(props.defaultTargetHF ?? 1.5));
  const fictional = mode === "fictional";

  const price = applyBpsChange(basePrice, changeBps);
  useEffect(() => props.onScenarioPrice?.(price), [price]); // eslint-disable-line react-hooks/exhaustive-deps

  const sysAt = assessSystem({ ...system, price }, params);
  const threshold = liquidationThreshold(params, sysAt.recoveryMode);
  const now = assessPosition(p, basePrice, params, assessSystem({ ...system, price: basePrice }, params).recoveryMode, thresholds);
  const scen = assessPosition(p, price, params, sysAt.recoveryMode, thresholds);

  const repay = repayStr ? parseAmount(repayStr) : null;
  const coll = collStr ? parseAmount(collStr) : null;
  const borrow = borrowStr ? parseAmount(borrowStr) : null;
  const repayVal = tab !== "collateral" && repay?.ok ? repay.value : 0n;
  const collVal = tab !== "repay" && coll?.ok ? coll.value : 0n;

  const sim = useMemo(
    () =>
      simulateAdjustment(
        { position: p, price, params, system, active: props.active, wallet: fictional ? wallet : wallet, thresholds },
        { repay: repayVal, addColl: collVal },
      ),
    [p, price, params, system, props.active, wallet, thresholds, repayVal, collVal, fictional],
  );
  const borrowSim = useMemo(
    () => (borrow?.ok ? simulateAdjustment({ position: p, price, params, system, active: props.active, thresholds }, { borrow: borrow.value }) : null),
    [borrow, p, price, params, system, props.active, thresholds],
  );

  const targetHF = Number(targetStr);
  const targetValid = Number.isFinite(targetHF) && targetHF > 1 && targetHF <= 10;
  const targetICR = targetValid ? targetICRFromHF(BigInt(Math.round(targetHF * 10_000)) * (WAD / 10_000n), threshold) : null;
  const options = targetICR ? compareRescueOptions({ position: p, price, targetICR, threshold, params, walletMusd: wallet?.musd }) : [];
  const rSol = targetICR ? repayToReachICR(p, price, targetICR, params) : null;
  const cSol = targetICR ? collToReachICR(p, price, targetICR) : null;

  // Report completed simulations (debounced) — used for the activity log in live mode.
  const lastReport = useRef("");
  useEffect(() => {
    if (!props.onSimulated || (!repayVal && !collVal) || !sim.ok) return;
    const key = `${repayVal}|${collVal}|${changeBps}`;
    const t = setTimeout(() => {
      if (lastReport.current === key) return;
      lastReport.current = key;
      props.onSimulated?.({ repay: repayVal.toString(), addColl: collVal.toString(), hfAfter: sim.after?.hf?.toString() ?? null, priceChangeBps: changeBps });
    }, 2500);
    return () => clearTimeout(t);
  }, [repayVal, collVal, changeBps, sim.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const perDay = interestPerDay(p.principal, props.interestRateBps);
  const blocks = sim.checks.filter((c) => c.level === "block");
  const warns = sim.checks.filter((c) => c.level !== "block");
  const hasInput = repayVal > 0n || collVal > 0n;
  const scenarioDiffers = changeBps !== 0;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* ---------------- Scenario ---------------- */}
      <section className={cn("panel min-w-0 p-5 sm:p-6", fictional && "example")} aria-labelledby="scenario-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="scenario-h" className="text-[20px] font-semibold">
            Price scenario
          </h2>
          <SourceTag kind={fictional ? "fictional" : "simulated"} />
        </div>
        <p className="mt-1 text-[14px] text-ink-soft">Hypothetical BTC moves, not predictions. {fictional ? "The base price is example data." : "Starts from the live on-chain oracle price."}</p>
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Price change presets">
          {PRESETS.map((b) => (
            <button
              key={b}
              onClick={() => setChangeBps(b)}
              aria-pressed={changeBps === b}
              type="button"
              className={cn("num rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px] transition-colors", changeBps === b ? "border-ink bg-ink text-paper" : "border-line-strong text-ink hover:border-ink")}
            >
              {b === 0 ? "No change" : `${b / 100}%`}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <label htmlFor="price-scrub" className="flex items-baseline justify-between text-[14px]">
            <span className="font-medium text-ink">Move the BTC price</span>
            <span className="num text-ink">
              {formatUsd(price, 0)} <span className="text-muted">({formatBps(changeBps, 1, true)})</span>
            </span>
          </label>
          <input id="price-scrub" type="range" className="scrub mt-1" min={-7000} max={5000} step={50} value={changeBps} onChange={(e) => setChangeBps(Number(e.target.value))} aria-valuetext={`${changeBps / 100}% change, ${formatUsd(price, 0)}`} />
          <div className="num flex justify-between text-[13px] text-muted">
            <span>−70%</span>
            <span>0</span>
            <span>+50%</span>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <RiskBadge category={scen.category} size="lg" />
          {scen.category === "liquidatable" && <span className="text-[14px] font-semibold text-ink">At this price anyone could liquidate the trove.</span>}
        </div>
        <ClearanceGauge className="mt-4" icr={scen.icr} simulatedIcr={hasInput && sim.after ? sim.after.icr : undefined} mcr={params.mcr} ccr={params.ccr} thresholds={thresholds} />
        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <Stat label="Health factor" value={formatHF(scen.hf)} tone={CATEGORY_COLOR[scen.category]} simulated={scenarioDiffers} sub={`now ${formatHF(now.hf)}`} />
          <Stat label="Collateral ratio" value={formatRatioPct(scen.icr)} simulated={scenarioDiffers} sub="liquidation below 110%" />
          <Stat label="Liquidation price" value={formatUsd(scen.liquidationPrice, 0)} sub="BTC/USD" />
          <Stat label="Room to liquidation" value={scen.dropToLiquidationBps == null ? "—" : `−${formatBps(scen.dropToLiquidationBps)}`} sub="further BTC drop" simulated={scenarioDiffers} />
          <Stat label="Collateral value" value={formatUsd(scen.collValue, 0)} simulated={scenarioDiffers} sub={`${formatBtc(p.coll)} BTC`} />
          <Stat label="Debt" value={formatAmount(p.debt)} sub={`+${formatAmount(perDay, 3)} MUSD/day interest`} />
        </dl>
        {sysAt.recoveryMode && (
          <Callout tone="watch" className="mt-4" title="Recovery Mode at this price">
            The {fictional ? "example " : ""}system collateral ratio ({formatRatioPct(sysAt.tcr)}) would be below 150%. MUSD still liquidates only below 110%, but borrowing needs a ratio of at least 150%, the borrowing fee is waived and closing troves is blocked.
          </Callout>
        )}

        <details className="mt-5 rounded-[var(--radius-control)] border border-line px-3 py-2">
          <summary className="cursor-pointer text-[14px] text-ink">What if I borrowed more? (calculator only)</summary>
          <div className="mt-3">
            <Field label="Extra MUSD borrowed" hint="MUSD Rescue never prepares borrowing transactions. This shows how new debt (plus the 0.1% fee) would move your risk." htmlFor="borrow">
              <input id="borrow" inputMode="decimal" className={inputCls} value={borrowStr} onChange={(e) => setBorrowStr(e.target.value)} placeholder="0.00" />
            </Field>
            {borrow && !borrow.ok && <p className="mt-1 text-[13px] font-medium text-ink">{borrow.error}</p>}
            {borrowSim?.after && (
              <p className="mt-2 text-[14px] text-ink-soft">
                Health factor would fall to <span className="num simulated text-ink">{formatHF(borrowSim.after.hf)}</span> ({formatRatioPct(borrowSim.after.icr)}), fee {formatAmount(borrowSim.borrowingFee)} MUSD.
                {borrowSim.checks.filter((c) => c.level === "block").map((c) => (
                  <span key={c.id} className="mt-1 block font-medium text-ink">{c.message}</span>
                ))}
              </p>
            )}
          </div>
        </details>
      </section>

      {/* ---------------- Rescue simulator ---------------- */}
      <section className={cn("panel min-w-0 p-5 sm:p-6", fictional && "example")} aria-labelledby="rescue-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="rescue-h" className="text-[20px] font-semibold">
            Rescue simulator
          </h2>
          <Segmented<Tab>
            label="Rescue action"
            value={tab}
            onChange={setTab}
            options={[
              { value: "repay", label: "Repay MUSD" },
              { value: "collateral", label: "Add BTC" },
              { value: "combined", label: "Both" },
            ]}
          />
        </div>
        <p className="mt-1 text-[14px] text-ink-soft">
          Validated against the same rules BorrowerOperations enforces: 110% minimum ratio, the {formatAmount(params.minNetDebt, 0)} MUSD minimum net debt, wallet balances.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {tab !== "collateral" && (
            <Field
              label="Repay (MUSD)"
              htmlFor="repay"
              error={repay && !repay.ok ? repay.error : null}
              hint={
                <>
                  Max without closing: <button type="button" className="num text-blue underline-offset-4 hover:underline" onClick={() => setRepayStr(toInputString(sim.maxRepay))}>{formatAmount(sim.maxRepay)}</button>
                  {wallet?.musd !== undefined && (
                    <>
                      {" "}| Wallet: <button type="button" className="num text-blue underline-offset-4 hover:underline" onClick={() => setRepayStr(toInputString(wallet.musd! < sim.maxRepay ? wallet.musd! : sim.maxRepay))}>{formatAmount(wallet.musd)}</button>
                    </>
                  )}
                </>
              }
            >
              <input id="repay" inputMode="decimal" autoComplete="off" className={inputCls} value={repayStr} onChange={(e) => setRepayStr(e.target.value)} placeholder="0.00" />
            </Field>
          )}
          {tab !== "repay" && (
            <Field
              label="Add collateral (BTC)"
              htmlFor="coll"
              error={coll && !coll.ok ? coll.error : null}
              hint={wallet?.btc !== undefined ? <>Wallet: <span className="num">{formatBtc(wallet.btc)}</span> BTC (keep some for gas)</> : "Native BTC on Mezo"}
            >
              <input id="coll" inputMode="decimal" autoComplete="off" className={inputCls} value={collStr} onChange={(e) => setCollStr(e.target.value)} placeholder="0.0000" />
            </Field>
          )}
        </div>

        {/* Before → after */}
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[var(--radius-control)] bg-surface p-4">
          <div>
            <div className="text-[13px] text-muted">{scenarioDiffers ? "At scenario price" : "Current"}</div>
            <div className="num text-[25px] font-medium" style={{ color: CATEGORY_COLOR[scen.category] }}>{formatHF(scen.hf)}</div>
            <div className="num text-[13px] text-muted">ICR {formatRatioPct(scen.icr)}</div>
          </div>
          <ArrowRight className="size-5 text-muted" aria-hidden />
          <div>
            <div className="text-[13px] text-muted">After rescue</div>
            <div className="num simulated text-[25px] font-medium" style={{ color: hasInput && sim.after ? CATEGORY_COLOR[sim.after.category] : undefined }}>
              {hasInput && sim.after ? formatHF(sim.after.hf) : "—"}
            </div>
            <div className="num text-[13px] text-muted">ICR {hasInput && sim.after ? formatRatioPct(sim.after.icr) : "—"}</div>
          </div>
        </div>
        {hasInput && sim.after && sim.newPosition && (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <div><dt className="text-muted">Debt after</dt><dd className="num simulated">{formatAmount(sim.newPosition.debt)}</dd></div>
            <div><dt className="text-muted">Collateral after</dt><dd className="num simulated">{formatBtc(sim.newPosition.coll)}</dd></div>
            <div><dt className="text-muted">Liquidation price</dt><dd className="num simulated">{formatUsd(sim.after.liquidationPrice, 0)}</dd></div>
            <div><dt className="text-muted">Paid to interest</dt><dd className="num">{formatAmount(sim.interestPaid, 4)}</dd></div>
          </dl>
        )}

        {(blocks.length > 0 || warns.length > 0) && hasInput && (
          <ul className="mt-4 flex flex-col gap-1.5">
            {blocks.map((c) => (
              <li key={c.id} className="flex gap-2 rounded-[var(--radius-control)] border-2 border-ink px-3 py-2 text-[14px] font-medium text-ink">
                <OctagonAlert className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
                <span><span className="sr-only">Blocked: </span>{c.message}</span>
              </li>
            ))}
            {warns.map((c) => (
              <li key={c.id} className="flex gap-2 rounded-[var(--radius-control)] border border-ink px-3 py-2 text-[14px] text-ink-soft">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Target solver */}
        <div className="mt-6 border-t border-line pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Target health factor" htmlFor="target" error={!targetValid ? "Enter a value between 1.01 and 10" : null}>
              <input id="target" inputMode="decimal" className={cn(inputCls, "w-32")} value={targetStr} onChange={(e) => setTargetStr(e.target.value)} />
            </Field>
            <p className="pb-2 text-[13px] text-muted">
              <Target className="mr-1 inline size-3.5" />= ICR <span className="num">{targetICR ? formatRatioPct(targetICR) : "—"}</span> at {scenarioDiffers ? "the scenario" : "the current"} price
            </p>
          </div>
          {targetICR && rSol && cSol && (
            <div className="mt-4">
              <h3 className="sr-only">Ways to reach the target health factor</h3>
              <div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto] gap-x-3 pb-2 text-[13px] text-muted sm:grid" aria-hidden>
                <span>Option</span>
                <span>Amount</span>
                <span>Cost (USD)</span>
                <span>HF after</span>
                <span className="w-[68px]" />
              </div>
              <ul className="text-[14px]">
                {options.map((o) => (
                  <li key={o.id} className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line py-3 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_auto] sm:items-start">
                    <div className="col-span-3 sm:col-span-1">
                      <div className="font-medium text-ink">{o.label}</div>
                      <div className="max-w-[40ch] text-[13px] text-muted">{o.tradeoff}</div>
                    </div>
                    <div className="num min-w-0">
                      <div className="text-[13px] text-muted sm:hidden">Amount</div>
                      {o.repay > 0n && <div>{formatAmount(o.repay)} MUSD</div>}
                      {o.addColl > 0n && <div>{formatBtc(o.addColl)} BTC</div>}
                      {o.repay === 0n && o.addColl === 0n && <div className="text-muted">nothing</div>}
                    </div>
                    <div className="num min-w-0">
                      <div className="text-[13px] text-muted sm:hidden">Cost (USD)</div>
                      {formatUsd(o.usdCommitted)}
                    </div>
                    <div className="num min-w-0">
                      <div className="text-[13px] text-muted sm:hidden">HF after</div>
                      <span className={cn(!o.feasible && "font-semibold text-ink")}>{formatHF(o.hfAfter)}</span>
                    </div>
                    {!o.feasible && <div className="col-span-3 text-[13px] text-ink sm:col-span-3 sm:col-start-2 sm:row-start-2">{o.note}</div>}
                    <div className="col-span-3 sm:col-span-1 sm:row-start-1 sm:col-start-5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setTab(o.id === "repay" ? "repay" : o.id === "collateral" ? "collateral" : "combined");
                          setRepayStr(o.repay > 0n ? toInputString(o.repay, 18, 6) : "");
                          setCollStr(o.addColl > 0n ? toInputString(o.addColl, 18, 8) : "");
                        }}
                        aria-label={`Use ${o.label}`}
                      >
                        <Crosshair className="size-3.5" aria-hidden /> Use
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex gap-1.5 text-[13px] text-muted">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                No option is picked for you. Prices, accrued interest, oracle updates and transaction timing can change the result; amounts are rounded up to reach the target.
              </p>
            </div>
          )}
        </div>

        {/* Execution */}
        <div className="mt-6 border-t border-line pt-5">
          {fictional ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-dotted border-ink px-3 py-2.5 text-[14px] text-ink-soft">
              <Lock className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />
              Example position: simulations here are never sent on-chain. Connect a wallet with a real MUSD trove to rescue it.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                size="lg"
                disabled={!props.gate?.allowed || !hasInput || !sim.ok || (repay != null && !repay.ok) || (coll != null && !coll.ok)}
                loading={props.preparing}
                onClick={() => props.onPrepare?.({ repay: repayVal, addColl: collVal })}
              >
                Review transaction
              </Button>
              <p className="max-w-[52ch] text-[13px] text-muted">
                {!props.gate?.allowed
                  ? props.gate?.reason
                  : scenarioDiffers
                    ? "The transaction is prepared and checked at the current on-chain price, not the scenario price."
                    : "Nothing is sent until you confirm on the next screen and approve in your wallet."}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
