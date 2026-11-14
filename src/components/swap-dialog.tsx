"use client";
import { useEffect, useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, Coins } from "lucide-react";
import { mezoTestnet, classifyChain } from "@/config/chains";
import { MUSD_CONTRACTS, ABIS } from "@/config/contracts";
import { SWAP_BTC_GAS_RESERVE } from "@/config/pools";
import { quoteBtcForMusd, quoteBtcToMusd, swapBtcToMusd } from "@/lib/client/guard-actions";
import { formatAmount, formatBtc, parseAmount, toInputString } from "@/lib/risk/format";
import { Modal } from "./modal";
import { TxSteps, useTxRunner } from "./tx-steps";
import { Button, Callout, Field, inputCls } from "./ui";
import { ConnectButton } from "./wallet";

const SLIPPAGE_BPS = 100n; // 1%

/**
 * Swap BTC for MUSD through Mezo Pools without leaving the app, so a borrower can fund a repayment or a Rescue Guard
 * reserve. `needMusd` pre-fills the BTC needed to receive that much MUSD.
 */
export function SwapDialog({ open, onOpenChange, needMusd }: { open: boolean; onOpenChange: (o: boolean) => void; needMusd?: bigint }) {
  const { address, chainId, isConnected } = useAccount();
  const writable = classifyChain(chainId).writes;
  const btc = useBalance({ address, chainId: mezoTestnet.id, query: { enabled: !!address && open } });
  const musd = useReadContract({ address: MUSD_CONTRACTS.testnet.MUSD, abi: ABIS.MUSD, functionName: "balanceOf", args: address ? [address] : undefined, chainId: mezoTestnet.id, query: { enabled: !!address && open } });
  const [btcStr, setBtcStr] = useState("");
  const tx = useTxRunner();
  const parsed = btcStr ? parseAmount(btcStr) : null;
  const amountIn = parsed?.ok ? parsed.value : 0n;
  const maxIn = btc.data ? (btc.data.value > SWAP_BTC_GAS_RESERVE ? btc.data.value - SWAP_BTC_GAS_RESERVE : 0n) : 0n;

  // Pre-fill from the MUSD the caller needs.
  useEffect(() => {
    if (!open || !needMusd || needMusd <= 0n) return;
    let live = true;
    quoteBtcForMusd(needMusd)
      .then((v) => live && setBtcStr(toInputString(v, 18, 8)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, needMusd]);
  useEffect(() => {
    if (!open) tx.reset();
  }, [open, tx.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const quote = useQuery({ queryKey: ["swap-quote", amountIn.toString()], queryFn: () => quoteBtcToMusd(amountIn), enabled: open && amountIn > 0n, refetchInterval: 15_000 });
  const out = quote.data ?? 0n;
  const minOut = (out * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const pricePerBtc = amountIn > 0n && out > 0n ? (out * 10n ** 18n) / amountIn : null;
  const inputError = parsed && !parsed.ok ? parsed.error : amountIn > maxIn && btc.data ? `You can swap at most ${formatBtc(maxIn)} BTC and keep a little for gas.` : null;

  return (
    <Modal open={open} onOpenChange={onOpenChange} locked={tx.busy} title="Get MUSD with BTC" description="Swaps through Mezo Pools, the protocol's own exchange, at the pool price. Nothing goes through MUSD Rescue.">
      {!isConnected ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[14px] text-ink-soft">Connect a wallet on Mezo testnet to swap.</p>
          <ConnectButton />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="You pay (BTC)" htmlFor="swap-in" error={inputError} hint={<>Balance {btc.data ? formatBtc(btc.data.value) : "…"} BTC. <button type="button" className="text-blue underline-offset-4 hover:underline" onClick={() => setBtcStr(toInputString(maxIn, 18, 8))}>Use max</button> (keeps 0.00002 BTC for gas).</>}>
            <input id="swap-in" inputMode="decimal" autoComplete="off" placeholder="0.001" className={inputCls} value={btcStr} onChange={(e) => setBtcStr(e.target.value)} disabled={tx.busy} />
          </Field>
          <ArrowDown className="size-4 text-muted" aria-hidden />
          <div className="well flex flex-col gap-1 p-3">
            <div className="text-[13px] text-muted">You receive about</div>
            <div className="num text-[24px] font-semibold">{amountIn > 0n ? (quote.isLoading ? "…" : `${formatAmount(out)} MUSD`) : "—"}</div>
            <div className="text-[13px] text-muted">
              {pricePerBtc ? <>Pool price {formatAmount(pricePerBtc, 0)} MUSD per BTC. At least {formatAmount(minOut)} MUSD (1% slippage limit).</> : "Enter an amount for a live quote."}
              {needMusd ? <> You need {formatAmount(needMusd)} MUSD.</> : null}
            </div>
            <div className="text-[13px] text-muted">Wallet MUSD now: {musd.data !== undefined ? formatAmount(musd.data as bigint) : "…"}</div>
          </div>
          {quote.error && <Callout tone="watch">Could not get a quote: {(quote.error as Error).message.split("\n")[0]}</Callout>}
          {!writable && <Callout tone="watch">Switch your wallet to Mezo Testnet to swap.</Callout>}
          <TxSteps steps={tx.steps} error={tx.error} />
          <div className="flex flex-wrap justify-end gap-2">
            {tx.result ? (
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={tx.busy}
                disabled={!writable || amountIn <= 0n || !!inputError || out === 0n}
                onClick={() =>
                  tx.run((onStep) => swapBtcToMusd({ owner: address!, amountIn, minOut, onStep }), { title: "Swap confirmed", description: `About ${formatAmount(out)} MUSD received.` })
                }
              >
                <Coins className="size-4" /> Swap BTC for MUSD
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
