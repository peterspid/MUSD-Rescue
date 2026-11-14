"use client";
import { useState } from "react";
import Link from "next/link";
import { useAccount, useBalance } from "wagmi";
import { Landmark } from "lucide-react";
import { mezoTestnet, classifyChain, NETWORKS } from "@/config/chains";
import { useSystem } from "@/lib/client/api";
import { openTrove } from "@/lib/client/guard-actions";
import { paramsFromDTO } from "@/lib/convert";
import { assessPosition, positionFromEntire, computeCR } from "@/lib/risk";
import { formatAmount, formatBtc, formatRatioPct, formatUsd, parseAmount, toInputString } from "@/lib/risk/format";
import { Modal } from "./modal";
import { TxSteps, useTxRunner } from "./tx-steps";
import { Button, Callout, Field, RiskBadge, inputCls } from "./ui";

const GAS_KEEP = 500_000_000_000_000n; // keep 0.0005 BTC for gas and later rescues

/** Testnet onboarding: open an MUSD trove from faucet BTC without leaving the app. */
export function OpenTroveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { address, chainId } = useAccount();
  const writable = classifyChain(chainId).writes;
  const sys = useSystem();
  const btc = useBalance({ address, chainId: mezoTestnet.id, query: { enabled: !!address && open } });
  const [collStr, setCollStr] = useState("");
  const [debtStr, setDebtStr] = useState("1800");
  const tx = useTxRunner();

  const params = sys.data ? paramsFromDTO(sys.data.params) : null;
  const price = sys.data?.price ? BigInt(sys.data.price) : null;
  const maxColl = btc.data && btc.data.value > GAS_KEEP ? btc.data.value - GAS_KEEP : 0n;
  const coll = (() => {
    if (!collStr) return maxColl;
    const r = parseAmount(collStr);
    return r.ok ? r.value : 0n;
  })();
  const debtParsed = parseAmount(debtStr);
  const debtAmount = debtParsed.ok ? debtParsed.value : 0n;
  const fee = params && !sys.data?.recoveryMode ? (debtAmount * params.borrowingRate) / 10n ** 18n : 0n;
  const totalDebt = params ? debtAmount + fee + params.gasCompensation : 0n;
  const position = params ? positionFromEntire(coll, totalDebt - 0n, 0n, params) : null;
  const risk = position && params && price ? assessPosition(position, price, params, !!sys.data?.recoveryMode) : null;
  const icr = price && totalDebt > 0n ? computeCR(coll, totalDebt, price) : null;

  const problems: string[] = [];
  if (!debtParsed.ok && debtStr) problems.push(debtParsed.error);
  if (params && debtAmount > 0n && debtAmount < params.minNetDebt) problems.push(`MUSD requires borrowing at least ${formatAmount(params.minNetDebt, 0)} MUSD.`);
  if (coll > maxColl) problems.push(`Keep at least 0.0005 BTC for gas. You can lock up to ${formatBtc(maxColl)} BTC.`);
  if (params && icr != null && icr < params.mcr) problems.push("That collateral ratio is below 110%, so the protocol would reject it. Lock more BTC or borrow less.");
  if (params && icr != null && sys.data?.recoveryMode && icr < params.ccr) problems.push("Mezo is in Recovery Mode: new troves need a collateral ratio of at least 150%.");
  if (!price) problems.push("The MUSD oracle price is unavailable right now. Try again in a minute.");
  const canSubmit = writable && !!address && problems.length === 0 && coll > 0n && debtAmount > 0n;

  return (
    <Modal open={open} onOpenChange={onOpenChange} locked={tx.busy} title="Open an MUSD trove" description="Lock BTC as collateral and borrow MUSD against it, directly with Mezo's BorrowerOperations contract. Testnet only.">
      {tx.result ? (
        <div className="flex flex-col gap-4">
          <TxSteps steps={tx.steps} error={null} />
          <p className="text-[14px]">Your trove is open. Next, protect it so a rescue runs by itself if BTC falls.</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/guard" className="inline-flex h-10 items-center rounded-[var(--radius-control)] bg-blue px-4 text-[14px] font-semibold text-paper hover:bg-blue-deep" onClick={() => onOpenChange(false)}>
              Set up Rescue Guard
            </Link>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Lock (BTC)"
              htmlFor="ot-coll"
              hint={
                <>
                  Balance {btc.data ? formatBtc(btc.data.value) : "…"} BTC.{" "}
                  <a className="text-blue underline-offset-4 hover:underline" href={NETWORKS.testnet.faucet!} target="_blank" rel="noreferrer">
                    Get testnet BTC
                  </a>
                </>
              }
            >
              <input id="ot-coll" inputMode="decimal" className={inputCls} placeholder={maxColl ? toInputString(maxColl, 18, 6) : "0.04"} value={collStr} onChange={(e) => setCollStr(e.target.value)} disabled={tx.busy} />
            </Field>
            <Field label="Borrow (MUSD)" htmlFor="ot-debt" hint={params ? `Minimum ${formatAmount(params.minNetDebt, 0)} MUSD.` : undefined}>
              <input id="ot-debt" inputMode="decimal" className={inputCls} value={debtStr} onChange={(e) => setDebtStr(e.target.value)} disabled={tx.busy} />
            </Field>
          </div>
          <div className="well grid grid-cols-2 gap-3 p-4 text-[14px] sm:grid-cols-4">
            <div>
              <div className="text-[13px] text-muted">Total debt</div>
              <div className="num font-semibold">{formatAmount(totalDebt)} MUSD</div>
              <div className="text-[12px] text-muted">incl. {formatAmount(fee)} fee + 200 gas deposit</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Collateral ratio</div>
              <div className="num font-semibold">{formatRatioPct(icr)}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Liquidated below</div>
              <div className="num font-semibold">{risk?.liquidationPrice ? formatUsd(risk.liquidationPrice, 0) : "—"}</div>
              <div className="text-[12px] text-muted">BTC now {price ? formatUsd(price, 0) : "…"}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Risk</div>
              <div className="mt-0.5">{risk ? <RiskBadge category={risk.category} size="sm" /> : "—"}</div>
            </div>
          </div>
          {problems.map((m) => (
            <Callout key={m} tone="act">
              {m}
            </Callout>
          ))}
          {problems.length === 0 && icr != null && params && icr < (params.ccr * 11n) / 10n && (
            <Callout tone="watch">Below about 165% a modest BTC drop puts this trove at risk. That is fine for trying Rescue Guard on testnet, but it is not a safe setting.</Callout>
          )}
          {!writable && address && <Callout tone="watch">Switch your wallet to Mezo Testnet first.</Callout>}
          <TxSteps steps={tx.steps} error={tx.error} />
          <div className="flex justify-end">
            <Button
              variant="primary"
              loading={tx.busy}
              disabled={!canSubmit}
              onClick={() =>
                tx.run(
                  async (onStep) => {
                    onStep("Confirm the openTrove transaction in your wallet");
                    return openTrove({ owner: address!, collateral: coll, debtAmount, borrowingRate: params!.borrowingRate, gasCompensation: params!.gasCompensation });
                  },
                  { title: "Trove opened", description: `${formatAmount(debtAmount)} MUSD borrowed against ${formatBtc(coll)} BTC.` },
                )
              }
            >
              <Landmark className="size-4" /> Open trove
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
