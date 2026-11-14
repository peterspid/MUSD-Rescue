import "server-only";
import { createPublicClient, http, type PublicClient } from "viem";
import { mezoTestnet, NETWORKS } from "@/config/chains";

let client: PublicClient | null = null;

/** Server-side viem client for Mezo testnet. Multicall3 (0xcA11…CA11) is deployed there (verified by probe). */
export function chainClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: mezoTestnet,
      transport: http(process.env.MEZO_TESTNET_RPC || NETWORKS.testnet.rpc, { timeout: 12_000, retryCount: 1, retryDelay: 400 }),
      batch: { multicall: { batchSize: 32_768, wait: 0 } },
    }) as PublicClient;
  }
  return client;
}

/** Run async tasks with a concurrency cap. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Retry a read a few times (RPC reads can lag a block right after a transaction). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseDelayMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}
