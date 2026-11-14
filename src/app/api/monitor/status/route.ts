import { sql } from "@/lib/server/db";
import { getSession } from "@/lib/server/auth";
import { lastMonitorRuns } from "@/lib/server/records";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Honest monitoring status: when did the scheduled job and this user's checks last succeed? */
export async function GET(req: Request) {
  try {
    const s = await getSession(req);
    const runs = await lastMonitorRuns();
    let mine: unknown = null;
    if (s) {
      const rows = await sql()`SELECT id, source, started_at, finished_at, ok, troves_checked, rules_evaluated, alerts_fired, block_number FROM rescue.monitor_runs
        WHERE user_address = ${s.address.toLowerCase()} AND ok ORDER BY started_at DESC LIMIT 1`;
      mine = rows[0] ?? null;
    }
    return json({
      schedule: { cron: "0 6 * * *", description: "Once per day at 06:00 UTC (Vercel Hobby cron limit). Also on every visit while the app is open (throttled to once a minute) and on Check now." },
      lastCron: runs.last_cron,
      lastCronOk: runs.last_cron_ok,
      lastOk: runs.last_ok,
      lastUserOk: mine,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
