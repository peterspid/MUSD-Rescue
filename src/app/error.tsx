"use client";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-[60dvh] place-items-center px-4">
      <div className="panel max-w-lg p-6">
        <h1 className="font-display text-2xl font-semibold">This view failed to render</h1>
        <p className="mt-2 text-fg-2">No numbers are shown rather than possibly wrong ones. Rescue actions are unavailable until the page reloads cleanly.</p>
        <p className="num mt-2 text-[12.5px] text-fg-3">{error.digest ? `Reference ${error.digest}` : error.message}</p>
        <button onClick={reset} className="mt-4 rounded-lg bg-teal px-4 py-2 font-semibold text-ink-0">Try again</button>
      </div>
    </main>
  );
}
