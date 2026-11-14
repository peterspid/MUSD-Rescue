"use client";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Coins, ShieldCheck } from "lucide-react";
import { classifyChain } from "@/config/chains";
import type { PositionDTO } from "@/lib/dto";
import type { GuardDTO } from "@/lib/guard/dto";
import { amountsFromDTO, paramsFromDTO } from "@/lib/convert";
import { armPlan, retireAuthorization, waitForSuccess } from "@/lib/client/guard-actions";
import { DEFAULT_TARGET_ICR, DEFAULT_TRIGGER_ICR, DEFAULT_VALIDITY_DAYS, checkPlan, suggestPlan, type GuardKind } from "@/lib/guard/plan";
import { formatAmount, formatBtc, formatRatioPct, formatUsd, parseAmount, toInputString } from "@/lib/risk/format";
import { WAD } from "@/lib/risk/math";
import { SWAP_BTC_GAS_RESERVE } from "@/config/pools";
import { SwapDialog } from "../swap-dialog";
import { TxSteps, useTxRunner } from "../tx-steps";
import { Button, Callout, Field, Segmented, inputCls } from "../ui";

const pctToWad = (s: string): bigint | null => {
  const r = parseAmount(s, 16, { allowZero: false });
  return r.ok ? r.value : null; // "130" -> 1.30e18
};

export function GuardSetup({ position, guard, onDone, onCancel }: { position: PositionDTO; guard: GuardDTO; onDone?: () => void; onCancel?: () => void }) {
  const { address, chainId } = useAccount();
  const writable = classifyChain(chainId).writes;
  const [kind, setKind] = useState<GuardKind>(guard.plan?.kind ?? "repay");
  const [triggerStr, setTriggerStr] = useState(guard.plan ? toInputString(BigInt(guard.plan.triggerIcr), 16, 1) : toInputString(DEFAULT_TRIGGER_ICR, 16, 1));
  const [targetStr, setTargetStr] = useState(toInputString(DEFAULT_TARGET_ICR, 16, 1));
  const [amountStr, setAmountStr] = useState<string | null>(null); // null = follow the suggestion
  const [tipStr, setTipStr] = useState("1");
  const [daysStr, setDaysStr] = useState(String(DEFAULT_VALIDITY_DAYS));
  const [swapOpen, setSwapOpen] = useState(false);
  const tx = useTxRunner();

  const params = paramsFromDTO(position.system.params);
  const amounts = amountsFromDTO(position);
  const price = position.system.price ? BigInt(position.system.price) : null;
  const triggerIcr = pctToWad(triggerStr);
  const targetIcr = pctToWad(targetStr);
  const suggestion = useMemo(
    () => (triggerIcr && targetIcr ? suggestPlan({ kind, position: amounts, params, triggerIcr, targetIcr }) : null),
    [kind, triggerIcr, targetIcr, amounts.coll, amounts.debt], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const parsedAmount = amountStr != null && amountStr !== "" ? parseAmount(amountStr) : null;
  const amount = parsedAmount ? (parsedAmount.ok ? parsedAmount.value : 0n) : suggestion?.amount ?? 0n;
  const tipBps = (() => {
    const r = parseAmount(tipStr || "0", 2, { allowZero: true });
    return r.ok ? r.value : -1n; // "1" -> 100 bps
  })();
  const keeperTip = tipBps >= 0n ? (amount * tipBps) / 10_000n : 0n;
  const days = Number(daysStr);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const deadline = nowSec + BigInt(Math.max(0, Math.round((Number.isFinite(days) ? days : 0) * 86_400)));
  const reserve = BigInt(kind === "repay" ? guard.reserves.musd : guard.reserves.btc);
  const walletRaw = BigInt(kind === "repay" ? position.wallet.musd : position.wallet.btc);
  const wallet = kind === "addColl" ? (walletRaw > SWAP_BTC_GAS_RESERVE ? walletRaw - SWAP_BTC_GAS_RESERVE : 0n) : walletRaw;
  const cost = amount + keeperTip;
  const deposit = cost > reserve ? cost - reserve : 0n;
  const unit = kind === "repay" ? "MUSD" : "BTC";
  const fmt = (v: bigint) => (kind === "repay" ? `${formatAmount(v)} MUSD` : `${formatBtc(v)} BTC`);

  const checks = checkPlan(
    { kind, amount, keeperTip, triggerIcr: triggerIcr ?? 0n, deadline },
    { nowSec, active: position.active, position: amounts, price, params, walletBalance: wallet, reserve },
  );
  const inputErrors = [
    !triggerIcr ? "Enter a trigger such as 130." : null,
    !targetIcr ? "Enter a target such as 160." : null,
    parsedAmount && !parsedAmount.ok ? parsedAmount.error : null,
    tipBps < 0n || tipBps > 1_000n ? "The keeper tip must be between 0% and 10%." : null,
    !Number.isFinite(days) || days < 1 || days > 365 ? "Choose between 1 and 365 days." : null,
  ].filter(Boolean) as string[];
  const blocks = checks.filter((c) => c.level === "block");
  const warns = checks.filter((c) => c.level === "warn");
  const shortMusd = kind === "repay" && deposit > wallet ? deposit - wallet : 0n;
  const canSubmit = writable && !!address && inputErrors.length === 0 && blocks.length === 0 && amount > 0n && !!price;
  const needRetire = guard.outstanding.live;
  const afterIcr = suggestion?.triggerPrice
    ? kind === "repay"
      ? amount < amounts.debt
        ? (amounts.coll * suggestion.triggerPrice) / (amounts.debt - amount)
        : null
      : ((amounts.coll + amount) * suggestion.triggerPrice) / amounts.debt
    : null;

  async function submit() {
    await tx.run(
      async (onStep) => {
        if (needRetire) {
          const h = await retireAuthorization(address!, onStep);
          onStep("Waiting for the old authorization to be retired");
          await waitForSuccess(h);
        }
        return armPlan({ owner: address!, kind, amount, keeperTip, triggerIcr: triggerIcr!, validityDays: days, deposit, onStep });
      },
      { title: "Rescue plan stored on-chain", description: `Runs when the collateral ratio falls below ${formatRatioPct(triggerIcr)}.` },
    );
  }

  if (tx.result) {
    return (
      <div className="flex flex-col gap-3">
        <TxSteps steps={tx.steps} error={null} />
        <Callout tone="info" title="Your trove is protected" icon={<ShieldCheck className="size-4" />}>
          The plan is stored in RescueGuard. If the collateral ratio falls below {formatRatioPct(triggerIcr)}, the keeper or anyone else can run it, and the contract checks the trigger again before any funds move.
        </Callout>
        <div>
          <Button variant="primary" onClick={() => onDone?.()}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label="Rescue type"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setAmountStr(null);
        }}
        options={[
          { value: "repay", label: "Repay MUSD" },
          { value: "addColl", label: "Add BTC" },
        ]}
      />
      <p className="-mt-2 max-w-[68ch] text-[14px] text-ink-soft">
        {kind === "repay"
          ? "Keep an MUSD reserve in RescueGuard. When the trigger is hit, it repays part of your debt. The deposit uses an MUSD permit, so there is no separate approve."
          : "Keep a BTC reserve in RescueGuard. When the trigger is hit, it adds that BTC to your trove as collateral."}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Run the rescue below (%)" htmlFor="g-trigger" hint={suggestion?.triggerPrice ? <>That is BTC at about {formatUsd(suggestion.triggerPrice, 0)}. Now {formatRatioPct(position.risk?.icr ? BigInt(position.risk.icr) : null)}.</> : "Collateral ratio that starts the rescue. 112% to 400%."}>
          <input id="g-trigger" inputMode="decimal" className={inputCls} value={triggerStr} onChange={(e) => setTriggerStr(e.target.value)} disabled={tx.busy} />
        </Field>
        <Field label="Lift it back to (%)" htmlFor="g-target" hint="Used to suggest the rescue amount.">
          <input id="g-target" inputMode="decimal" className={inputCls} value={targetStr} onChange={(e) => setTargetStr(e.target.value)} disabled={tx.busy} />
        </Field>
        <Field
          label={`Rescue amount (${unit})`}
          htmlFor="g-amount"
          hint={
            suggestion && suggestion.amount > 0n ? (
              <>
                Suggested {fmt(suggestion.amount)}.{" "}
                {amountStr != null && (
                  <button type="button" className="text-blue underline-offset-4 hover:underline" onClick={() => setAmountStr(null)}>
                    Use it
                  </button>
                )}
              </>
            ) : (
              suggestion?.note
            )
          }
        >
          <input
            id="g-amount"
            inputMode="decimal"
            className={inputCls}
            value={amountStr ?? (suggestion ? toInputString(suggestion.amount, 18, kind === "repay" ? 2 : 6) : "")}
            onChange={(e) => setAmountStr(e.target.value)}
            disabled={tx.busy}
          />
        </Field>
        <Field label="Keeper tip (% of the rescue)" htmlFor="g-tip" hint={`Paid to whoever runs it: ${fmt(keeperTip)}. 0% to 10%.`}>
          <input id="g-tip" inputMode="decimal" className={inputCls} value={tipStr} onChange={(e) => setTipStr(e.target.value)} disabled={tx.busy} />
        </Field>
        <Field label="Valid for (days)" htmlFor="g-days" hint="The signed authorization expires after this.">
          <input id="g-days" inputMode="numeric" className={inputCls} value={daysStr} onChange={(e) => setDaysStr(e.target.value)} disabled={tx.busy} />
        </Field>
      </div>

      {suggestion?.note && kind === "repay" && !suggestion.reachesTarget && <Callout tone="watch">{suggestion.note}</Callout>}

      <div className="well grid gap-3 p-4 text-[14px] sm:grid-cols-[1fr_auto]">
        <p className="max-w-[70ch]">
          If BTC falls to about <span className="num font-semibold">{suggestion?.triggerPrice ? formatUsd(suggestion.triggerPrice, 0) : "—"}</span>, anyone can run your rescue. It {kind === "repay" ? "repays" : "adds"} <span className="num font-semibold">{fmt(amount)}</span>, lifting the collateral ratio to about <span className="num font-semibold">{formatRatioPct(afterIcr)}</span> at that price. The keeper earns <span className="num">{fmt(keeperTip)}</span>.
        </p>
        <div className="text-[13px] text-ink-soft sm:text-right">
          <div>
            Reserve now <span className="num text-ink">{fmt(reserve)}</span>
          </div>
          <div>
            Deposit in this step <span className="num font-semibold text-ink">{fmt(deposit)}</span>
          </div>
          <div>
            In your wallet <span className="num text-ink">{fmt(walletRaw)}</span>
          </div>
        </div>
      </div>

      {inputErrors.map((m) => (
        <Callout key={m} tone="act">
          {m}
        </Callout>
      ))}
      {blocks.map((c) => (
        <Callout key={c.id} tone="act">
          {c.message}
        </Callout>
      ))}
      {warns.map((c) => (
        <Callout key={c.id} tone="watch">
          {c.message}
        </Callout>
      ))}
      {shortMusd > 0n && (
        <Callout tone="info" title={`You need ${formatAmount(shortMusd)} more MUSD`}>
          <div className="flex flex-wrap items-center gap-3">
            <span>Swap BTC for MUSD through Mezo Pools without leaving the app.</span>
            <Button size="sm" variant="secondary" onClick={() => setSwapOpen(true)}>
              <Coins className="size-3.5" /> Get MUSD with BTC
            </Button>
          </div>
        </Callout>
      )}
      {needRetire && (
        <Callout tone="neutral" title="One extra step first">
          Your previous authorization is still valid at the protocol until {new Date(guard.outstanding.deadline * 1000).toLocaleDateString()}. Storing a new plan first retires it with a 1-wei collateral top-up, so the old signature can never be used against the new plan.
        </Callout>
      )}
      {!writable && address && <Callout tone="watch">Switch your wallet to Mezo Testnet to store a plan.</Callout>}

      <TxSteps steps={tx.steps} error={tx.error} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="lg" onClick={submit} loading={tx.busy} disabled={!canSubmit}>
          <ShieldCheck className="size-4" /> {guard.plan ? "Sign and replace plan" : "Sign and store plan"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={tx.busy}>
            Cancel
          </Button>
        )}
        <span className="text-[13px] text-muted">
          {kind === "repay" ? (deposit > 0n ? "Two free signatures, then one transaction." : "One free signature, then one transaction.") : "One free signature, then one transaction."}
          {needRetire ? " Plus the retirement step." : ""}
        </span>
      </div>
      <SwapDialog open={swapOpen} onOpenChange={setSwapOpen} needMusd={shortMusd > 0n ? shortMusd + WAD / 100n : undefined} />
    </div>
  );
}
