"use client";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Hex } from "viem";
import { Check, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { waitForSuccess } from "@/lib/client/guard-actions";
import { explainGuardError } from "@/lib/guard/plan";
import { Callout, ExplorerLink, cn } from "./ui";

export interface TxStep {
  label: string;
  state: "active" | "done" | "error";
  hash?: Hex;
}

/**
 * Runs a wallet flow made of several prompts (signatures, approvals, the transaction itself), shows each step as it
 * happens, waits for the receipt, and refreshes every query afterwards. Success is only reported after a
 * successful receipt.
 */
export function useTxRunner() {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Hex | null>(null);

  const reset = useCallback(() => {
    setSteps([]);
    setError(null);
    setResult(null);
  }, []);

  const run = useCallback(
    async (fn: (onStep: (label: string) => void) => Promise<Hex>, done: { title: string; description?: string }) => {
      setBusy(true);
      setError(null);
      setResult(null);
      setSteps([]);
      const onStep = (label: string) => setSteps((prev) => [...prev.map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s)), { label, state: "active" }]);
      try {
        const hash = await fn(onStep);
        setSteps((prev) => [...prev.map((s) => (s.state === "active" ? { ...s, state: "done" as const } : s)), { label: "Waiting for confirmation on Mezo testnet", state: "active", hash }]);
        await waitForSuccess(hash);
        setSteps((prev) => [...prev.map((s) => ({ ...s, state: "done" as const })), { label: done.title, state: "done", hash }]);
        setResult(hash);
        toast.success(done.title, { description: done.description });
        qc.invalidateQueries();
        return hash;
      } catch (e) {
        const msg = explainGuardError(e);
        setError(msg);
        setSteps((prev) => prev.map((s) => (s.state === "active" ? { ...s, state: "error" as const } : s)));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  return { steps, busy, error, result, run, reset };
}

export function TxSteps({ steps, error, className }: { steps: TxStep[]; error: string | null; className?: string }) {
  if (!steps.length && !error) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-live="polite">
      {steps.length > 0 && (
        <ol className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-line p-3 text-[14px]">
          {steps.map((s, i) => (
            <li key={`${i}-${s.label}`} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {s.state === "active" ? <LoaderCircle className="size-4 animate-spin text-blue" /> : s.state === "done" ? <Check className="size-4 text-blue" /> : <X className="size-4 text-ink" />}
              </span>
              <span className={cn("min-w-0 flex-1", s.state === "error" && "font-semibold")}>
                {s.label}
                {s.hash && (
                  <>
                    {" "}
                    <ExplorerLink hash={s.hash} className="text-[13px]" />
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <Callout tone="act" title="Not completed" role="alert">
          {error}
        </Callout>
      )}
    </div>
  );
}
