"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-[60dvh] place-items-center px-4">
      <div className="max-w-lg rounded-[var(--radius-panel)] border-2 border-ink p-6">
        <h1 className="text-[25px] font-semibold leading-tight">This view failed to load</h1>
        <p className="mt-2 text-ink-soft">No numbers are shown rather than possibly wrong ones. Rescue actions stay unavailable until the page loads cleanly.</p>
        <p className="mt-2 text-[13px] text-muted">{error.digest ? <>Reference <span className="addr">{error.digest}</span></> : error.message}</p>
        <Button variant="primary" className="mt-4" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
