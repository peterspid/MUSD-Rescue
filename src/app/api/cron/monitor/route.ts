import { runMonitor } from "@/lib/server/monitor";
import { listAllTroves } from "@/lib/server/musd-adapter";
import { json } from "@/lib/server/http";
import { runKeeper } from "@/lib/server/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily Vercel Cron (see vercel.json). Protected by CRON_SECRET (Vercel sends it as a Bearer token). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, { status: 401 });
  const [result, keeper] = await Promise.all([
    runMonitor({ source: "cron" }),
    runKeeper("cron").catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
  ]);
  // Warm the radar cache for the first visitor of the day.
  listAllTroves(true).catch(() => {});
  return json({ ...result, keeper }, { status: result.ok ? 200 : 207 });
}
