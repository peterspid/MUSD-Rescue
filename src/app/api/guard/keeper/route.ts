import { runKeeper } from "@/lib/server/guard";
import { assertSameOrigin, clientKey, errorResponse, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ask the app's keeper to run every rescue that is ready right now. Safe to expose: RescueGuard re-checks every
 * condition on-chain, the keeper only spends gas (it earns the owner-chosen tips) and runs at most every 20 s.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    rateLimit(`keeper:${clientKey(req)}`, 4, 0.1);
    return json(await runKeeper("check_now"));
  } catch (e) {
    return errorResponse(e);
  }
}
