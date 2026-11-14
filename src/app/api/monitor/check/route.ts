import { z } from "zod";
import { runMonitor } from "@/lib/server/monitor";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, assertSameOrigin, rateLimit, clientKey } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ source: z.enum(["visit", "check_now"]).default("visit") });

/** Evaluate the signed-in user's alert rules now ("on every visit" — throttled to 1/min — and "Check now"). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const { source } = await parseBody(req, Body);
    if (source === "check_now") rateLimit(`check:${s.address}:${clientKey(req)}`, 6, 0.1);
    const result = await runMonitor({ source, user: s.address });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
