"use client";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { wagmiConfig } from "@/config/wagmi";
import { SessionProvider } from "./session";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 2 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <SessionProvider>{children}</SessionProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ style: { background: "#1b2025", border: "1px solid #2c343c", color: "#e8ecef", fontFamily: "var(--font-barlow)" } }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
