"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { Eye } from "lucide-react";
import { Button, inputCls, cn } from "./ui";

/** Read-only "watch any address" — no wallet needed. */
export function WatchInput({ className, compact }: { className?: string; compact?: boolean }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className={cn("flex flex-col gap-1.5", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const a = v.trim();
        if (!isAddress(a, { strict: false })) {
          setErr("Enter a 0x address (40 hex characters).");
          return;
        }
        router.push(`/positions/${a}`);
      }}
    >
      <div className="flex gap-2">
        <label htmlFor="watch" className="sr-only">
          Trove owner address
        </label>
        <input id="watch" value={v} onChange={(e) => (setV(e.target.value), setErr(null))} placeholder="0x… trove owner address" className={cn(inputCls, compact && "h-10")} spellCheck={false} autoComplete="off" />
        <Button type="submit" variant="secondary" className={compact ? "h-10" : "h-11"}>
          <Eye className="size-4" /> Watch
        </Button>
      </div>
      {err && <p role="alert" className="text-[13px] font-medium text-ink">{err}</p>}
    </form>
  );
}
