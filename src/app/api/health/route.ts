import { chainClient } from "@/lib/server/chain";
import { dbHealthy } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const [db, rpc] = await Promise.all([
    dbHealthy(),
    (async () => {
      try {
        const c = chainClient();
        const [chainId, blockNumber] = await Promise.all([c.getChainId(), c.getBlockNumber()]);
        return { ok: true as const, chainId, blockNumber: blockNumber.toString() };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
      }
    })(),
  ]);
  const body = {
    db: db ? "ok" : "error",
    rpc: rpc.ok ? "ok" : "error",
    chainId: rpc.ok ? rpc.chainId : null,
    blockNumber: rpc.ok ? rpc.blockNumber : null,
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
  return json(body, { status: db && rpc.ok ? 200 : 503 });
}
