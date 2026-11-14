import { z } from "zod";
import { sql } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, assertSameOrigin, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Prefs = z.object({
  thresholds: z
    .object({ healthyAbove: z.number().min(1.05).max(20), cautionFrom: z.number().min(1.03).max(20), criticalAtOrBelow: z.number().min(1.01).max(20) })
    .optional(),
  defaultTargetHF: z.number().min(1.05).max(10).optional(),
  browserNotifications: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    const rows = await sql()`SELECT prefs FROM rescue.users WHERE address = ${s.address.toLowerCase()}`;
    return json({ prefs: rows[0]?.prefs ?? {} });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const prefs = await parseBody(req, Prefs);
    const t = prefs.thresholds;
    if (t && !(t.healthyAbove > t.cautionFrom && t.cautionFrom > t.criticalAtOrBelow && t.criticalAtOrBelow > 1)) {
      throw new HttpError(400, "Thresholds must satisfy healthy > caution > critical > 1.00", "thresholds");
    }
    await sql()`INSERT INTO rescue.users (address, prefs) VALUES (${s.address.toLowerCase()}, ${JSON.stringify(prefs)})
      ON CONFLICT (address) DO UPDATE SET prefs = rescue.users.prefs || EXCLUDED.prefs, last_seen_at = now()`;
    return json({ ok: true, prefs });
  } catch (e) {
    return errorResponse(e);
  }
}
