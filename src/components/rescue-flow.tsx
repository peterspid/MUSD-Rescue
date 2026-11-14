"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAccount, usePublicClient, useSendTransaction } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { isAddressEqual, type Hex } from "viem";
import { CircleCheck, CircleX, LoaderCircle, ShieldAlert, TriangleAlert, X, ArrowRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { flowReducer, initialFlow, classifyWalletError, isBusy, riskWorsened, PREPARED_TTL_MS, type PreparedTx } from "@/lib/rescue/flow";
import { decodeRescueCall } from "@/lib/rescue/receipt";
import { api, ApiError } from "@/lib/client/api";
import { MUSD_CONTRACTS } from "@/config/contracts";
import { mezoTestnet, classifyChain } from "@/config/chains";
import type { PreparedRescueDTO, PositionDTO } from "@/lib/dto";
import { formatAmount, formatBtc, formatHF, formatRatioPct, shortAddress } from "@/lib/risk/format";
import { Button, ExplorerLink, RiskBadge, cn } from "./ui";
import { useSession } from "./session";

export interface RescueRequestInput {
  repay: bigint;
  addColl: bigint;
}

/**
 * prepare (server, fresh state) → confirmation screen → wallet signature → receipt → server verification → refresh.
 * Success is only shown in the `verified` state.
 */
export function useRescueFlow(owner: `0x${string}`, icrAtOpen: bigint | null) {
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const [prepared, setPrepared] = useState<PreparedRescueDTO | null>(null);
  const [result, setResult] = useState<{ icrBefore: string | null; icrAfter: string | null; recorded: boolean; position?: PositionDTO } | null>(null);
  const { status, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: mezoTestnet.id });
  const { sendTransactionAsync } = useSendTransaction();
  const qc = useQueryClient();
  const session = useSession();

  useEffect(() => {
    if (status === "disconnected") dispatch({ type: "DISCONNECTED" });
  }, [status]);
  useEffect(() => {
    if (chainId === undefined) return;
    const s = classifyChain(chainId);
    dispatch({ type: "NETWORK_CHANGED", writable: s.writes, label: s.label });
  }, [chainId]);

  const log = (kind: "tx_submitted" | "tx_rejected" | "tx_failed", title: string, txHash?: string, details?: Record<string, unknown>) => {
    if (!session.address) return;
    api("/api/activity", { method: "POST", json: { kind, owner, title, txHash, details } }).catch(() => {});
  };

  async function prepare(input: RescueRequestInput) {
    dispatch({ type: "PREPARE" });
    setResult(null);
    try {
      const p = await api<PreparedRescueDTO>("/api/rescue/prepare", { method: "POST", json: { owner, repay: input.repay.toString(), addColl: input.addColl.toString() } });
      // Independent client-side checks on what the server returned before showing it for signature.
      const decoded = decodeRescueCall(p.tx.data, BigInt(p.tx.value));
      if (!isAddressEqual(p.tx.to, MUSD_CONTRACTS.testnet.BorrowerOperations)) throw new Error("Prepared transaction targets an unexpected contract.");
      if (p.tx.chainId !== mezoTestnet.id) throw new Error("Prepared transaction is for the wrong network.");
      if ("error" in decoded || decoded.repayAmount !== input.repay || decoded.collAmount !== input.addColl) throw new Error("Prepared calldata does not match the amounts you entered.");
      setPrepared(p);
      const tx: PreparedTx = {
        to: p.tx.to,
        data: p.tx.data,
        value: p.tx.value,
        gas: p.tx.gas,
        chainId: p.tx.chainId,
        preparedAt: Date.now(),
        blockNumber: p.blockNumber,
        icrBefore: p.before.icr,
        icrAfter: p.after.icr,
        action: p.action,
        needsApproval: p.approval.needed,
      };
      dispatch({ type: "PREPARED", tx });
    } catch (e) {
      dispatch({ type: "PREPARE_FAILED", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function confirm() {
    if (state.s !== "review") return;
    const tx = state.tx;
    if (Date.now() - tx.preparedAt > PREPARED_TTL_MS) {
      toast("Quote expired", { description: "Prices move every block. Preparing a fresh transaction." });
      dispatch({ type: "RESET" });
      return;
    }
    dispatch({ type: "SIGN" });
    let hash: Hex;
    try {
      hash = await sendTransactionAsync({ to: tx.to, data: tx.data, value: BigInt(tx.value), gas: BigInt(tx.gas), chainId: mezoTestnet.id });
    } catch (e) {
      const c = classifyWalletError(e);
      if (c.kind === "rejected") {
        dispatch({ type: "WALLET_REJECTED", message: c.message });
        log("tx_rejected", "Rescue transaction rejected in wallet");
      } else {
        dispatch({ type: "SEND_FAILED", message: c.message });
        log("tx_failed", `Wallet could not send the transaction: ${c.message.slice(0, 120)}`);
      }
      return;
    }
    dispatch({ type: "SUBMITTED", hash });
    log("tx_submitted", `Submitted ${prepared?.functionName ?? "rescue"} — waiting for confirmation`, hash);
    try {
      const receipt = await publicClient!.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
      dispatch({ type: "RECEIPT", status: receipt.status, blockNumber: receipt.blockNumber.toString() });
      await verify(hash, receipt.status === "success");
    } catch (e) {
      dispatch({ type: "VERIFY_DELAYED", message: `Still waiting for the receipt: ${(e as Error).message.split("\n")[0]}` });
    }
  }

  async function verify(hash: Hex, success: boolean) {
    if (session.address && session.matchesWallet) {
      for (let i = 0; i < 4; i++) {
        try {
          const r = await api<{ status: string; icrBefore: string | null; icrAfter: string | null; position?: PositionDTO }>("/api/rescue/verify", { method: "POST", json: { txHash: hash } });
          if (success) {
            setResult({ icrBefore: r.icrBefore, icrAfter: r.icrAfter, recorded: true, position: r.position });
            dispatch({ type: "VERIFIED", icrAfter: r.icrAfter });
          }
          qc.invalidateQueries();
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status !== 202 && e.status < 500) {
            dispatch({ type: "VERIFY_DELAYED", message: e.message });
            return;
          }
          await new Promise((r) => setTimeout(r, 2500));
        }
      }
      dispatch({ type: "VERIFY_DELAYED", message: "The server could not verify the receipt yet (RPC lag). Refresh in a moment." });
      return;
    }
    // Not signed in: confirm via a fresh server-side read of the trove instead of recording.
    if (!success) return;
    try {
      const p = await api<PositionDTO>(`/api/positions/${owner}`);
      setResult({ icrBefore: state.s === "pending" ? state.tx.icrBefore : null, icrAfter: p.risk?.icr ?? null, recorded: false, position: p });
      dispatch({ type: "VERIFIED", icrAfter: p.risk?.icr ?? null });
      qc.invalidateQueries();
    } catch (e) {
      dispatch({ type: "VERIFY_DELAYED", message: (e as Error).message });
    }
  }

  const worsened = state.s === "review" ? riskWorsened(icrAtOpen, state.tx.icrBefore ? BigInt(state.tx.icrBefore) : null) : null;
  return { state, prepared, result, prepare, confirm, reset: () => dispatch({ type: "RESET" }), worsened, busy: isBusy(state) };
}

export function RescueDialog({ flow, onClose }: { flow: ReturnType<typeof useRescueFlow>; onClose: () => void }) {
  const { state, prepared: p, result, worsened } = flow;
  const open = state.s !== "idle" && state.s !== "preparing";
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer.current);
  }, []);
  const secondsLeft = state.s === "review" ? Math.max(0, Math.round((state.tx.preparedAt + PREPARED_TTL_MS - now) / 1000)) : null;
  const canClose = !flow.busy;
  const repay = p ? BigInt(p.amounts.repay) : 0n;
  const coll = p ? BigInt(p.amounts.coll) : 0n;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && canClose && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-paper " />
        <Dialog.Content
          className="panel fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[min(620px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 sm:p-6"
          onEscapeKeyDown={(e) => !canClose && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-xl font-semibold">
              {state.s === "review" ? "Confirm rescue transaction" : state.s === "verified" ? "Rescue verified" : "Rescue transaction"}
            </Dialog.Title>
            {canClose && (
              <Dialog.Close className="rounded p-1 text-muted hover:text-ink" aria-label="Close">
                <X className="size-5" />
              </Dialog.Close>
            )}
          </div>
          <Dialog.Description className="sr-only">Review the contract, network, asset, amount and expected effect before signing.</Dialog.Description>

          {p && (state.s === "review" || state.s === "awaiting-signature") && (
            <div className="mt-4 flex flex-col gap-4">
              {worsened?.worsened && (
                <div role="alert" className="flex gap-2 rounded-md border border-ink bg-surface px-3 py-2.5 text-[14px]">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-ink" />
                  <span>
                    Your position got riskier since you opened the simulator (collateral ratio {formatRatioPct(BigInt(state.tx.icrBefore!))}, change {Number(worsened.deltaBps) / 100}%). The amounts below were re-checked at the latest block.
                  </span>
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
                <dt className="text-muted">Network</dt>
                <dd>
                  {p.network.name} <span className="num text-muted">(chain {p.network.chainId})</span>
                </dd>
                <dt className="text-muted">Contract</dt>
                <dd>
                  {p.contract.name} <ExplorerLink address={p.contract.address}>{shortAddress(p.contract.address, 6)}</ExplorerLink>
                </dd>
                <dt className="text-muted">Function</dt>
                <dd className="num">{p.functionName}()</dd>
                {repay > 0n && (
                  <>
                    <dt className="text-muted">Repay</dt>
                    <dd className="num">
                      {formatAmount(repay, 6)} MUSD <span className="text-muted">burned from your wallet</span>
                    </dd>
                  </>
                )}
                {coll > 0n && (
                  <>
                    <dt className="text-muted">Deposit</dt>
                    <dd className="num">
                      {formatBtc(coll)} BTC <span className="text-muted">sent as collateral</span>
                    </dd>
                  </>
                )}
                <dt className="text-muted">Approval</dt>
                <dd className="text-[13px] text-ink-soft">{p.approval.explanation}</dd>
                <dt className="text-muted">Gas</dt>
                <dd className="num text-[13px]">
                  limit {Number(p.gas.limit).toLocaleString("en-US")}
                  {p.gas.floorApplied ? " (safety floor)" : ""}, max fee ≈ {formatBtc(BigInt(p.gas.maxFeeWei))} BTC
                </dd>
                <dt className="text-muted">Checked at</dt>
                <dd className="num text-[13px]">
                  block {Number(p.blockNumber).toLocaleString("en-US")}, oracle ${formatAmount(BigInt(p.price))}; eth_call simulation passed
                </dd>
              </dl>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[var(--radius-control)] border border-line bg-surface p-4">
                <div>
                  <div className="text-[12px] text-muted">Before</div>
                  <div className="num text-xl">{formatRatioPct(p.before.icr ? BigInt(p.before.icr) : null)}</div>
                  <div className="mt-1 flex items-center gap-2 text-[13px] text-muted">
                    HF <span className="num">{formatHF(p.before.hf ? BigInt(p.before.hf) : null)}</span> <RiskBadge category={p.before.category} size="sm" />
                  </div>
                </div>
                <ArrowRight className="size-5 text-muted" />
                <div>
                  <div className="text-[12px] text-muted">Expected after</div>
                  <div className="num simulated text-xl">{formatRatioPct(p.after.icr ? BigInt(p.after.icr) : null)}</div>
                  <div className="mt-1 flex items-center gap-2 text-[13px] text-muted">
                    HF <span className="num">{formatHF(p.after.hf ? BigInt(p.after.hf) : null)}</span> <RiskBadge category={p.after.category} size="sm" />
                  </div>
                </div>
              </div>
              {p.checks.filter((c) => c.level === "warn").map((c) => (
                <p key={c.id} className="flex gap-2 text-[13px] text-ink">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {c.message}
                </p>
              ))}
              <p className="text-[13px] text-muted">
                Expected values assume the price stays at the checked oracle price. Interest accrues every second and the oracle updates every block, so the final result can differ slightly. MUSD Rescue cannot guarantee that liquidation will be prevented.
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {secondsLeft != null && (
                  <span className={cn("num mr-auto flex items-center gap-1 text-[13px]", secondsLeft < 15 ? "text-ink" : "text-muted")}>
                    <Clock className="size-3.5" /> quote valid {secondsLeft}s
                  </span>
                )}
                <Button variant="ghost" onClick={onClose} disabled={state.s === "awaiting-signature"}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={flow.confirm} loading={state.s === "awaiting-signature"} disabled={secondsLeft === 0}>
                  {state.s === "awaiting-signature" ? "Confirm in your wallet…" : `Sign ${p.functionName}`}
                </Button>
              </div>
            </div>
          )}

          {(state.s === "pending" || state.s === "confirmed" || state.s === "verification-delayed") && (
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                {state.s === "verification-delayed" ? <TriangleAlert className="size-6 text-ink" /> : <LoaderCircle className="size-6 animate-spin text-blue" />}
                <div>
                  <div className="font-medium">
                    {state.s === "pending" ? "Pending — waiting for the receipt" : state.s === "confirmed" ? "Receipt confirmed — verifying and refreshing your trove" : "Verification delayed"}
                  </div>
                  <div className="text-[13px] text-muted">{state.s === "verification-delayed" ? state.message : "Do not resubmit. Mezo blocks take about 4 seconds."}</div>
                </div>
              </div>
              <ExplorerLink hash={state.hash}>View transaction on the Mezo explorer</ExplorerLink>
              {state.s === "pending" && state.walletDisconnected && <p className="text-[13px] text-ink">Wallet disconnected — the transaction was already broadcast, tracking continues.</p>}
            </div>
          )}

          {state.s === "verified" && (
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <CircleCheck className="size-7 text-blue" />
                <div>
                  <div className="font-medium">Confirmed on-chain and re-read from the protocol</div>
                  <div className="text-[13px] text-muted">{result?.recorded ? "Verified by the server from the receipt and saved to your activity log." : "Sign in to keep a verified history of your rescues."}</div>
                </div>
              </div>
              {result && (
                <div className="rounded-[var(--radius-control)] border border-blue bg-blue-tint p-4 text-[14px]">
                  Collateral ratio <span className="num">{formatRatioPct(result.icrBefore ? BigInt(result.icrBefore) : null)}</span> →{" "}
                  <span className="num text-blue">{formatRatioPct(result.icrAfter ? BigInt(result.icrAfter) : null)}</span>
                  {result.recorded && <span className="text-muted"> (both measured at the same oracle price, block {state.blockNumber})</span>}
                </div>
              )}
              <ExplorerLink hash={state.hash}>View transaction on the Mezo explorer</ExplorerLink>
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          )}

          {(state.s === "rejected" || state.s === "failed" || state.s === "reverted" || state.s === "disconnected" || state.s === "blocked" || state.s === "approval-rejected") && (
            <div className="mt-5 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <CircleX className="size-7 shrink-0 text-ink" />
                <div>
                  <div className="font-medium">
                    {state.s === "rejected" ? "Rejected in wallet" : state.s === "reverted" ? "Transaction reverted" : state.s === "disconnected" ? "Wallet disconnected" : state.s === "blocked" ? "Wrong network" : state.s === "approval-rejected" ? "Approval rejected" : "Could not complete"}
                  </div>
                  <p className="text-[14px] text-ink-soft">
                    {"message" in state ? state.message : state.s === "disconnected" ? "Nothing was sent. Reconnect your wallet to try again." : ""}
                  </p>
                </div>
              </div>
              {state.s === "reverted" && <ExplorerLink hash={state.hash}>Inspect on the explorer</ExplorerLink>}
              <div className="flex justify-end">
                <Button onClick={onClose}>Close</Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
