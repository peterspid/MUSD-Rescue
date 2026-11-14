import { sql } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, assertSameOrigin, HttpError } from "@/lib/server/http";
import { RuleSchema, validateThreshold } from "@/lib/server/alert-schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    const rows = await sql()`SELECT * FROM rescue.alert_rules WHERE user_address = ${s.address.toLowerCase()} ORDER BY created_at DESC`;
    return json({ rules: rows.map((r) => ({ ...r, id: String(r.id), threshold: r.threshold == null ? null : Number(r.threshold) })) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const b = await parseBody(req, RuleSchema);
    validateThreshold(b.kind, b.threshold);
    const me = s.address.toLowerCase();
    const count = await sql()`SELECT count(*)::int AS n FROM rescue.alert_rules WHERE user_address = ${me}`;
    if (count[0].n >= 50) throw new HttpError(400, "Limit of 50 alert rules reached", "limit");
    const [row] = await sql()`INSERT INTO rescue.alert_rules (user_address, trove_owner, kind, threshold, frequency, channel, quiet_start, quiet_end, tz_offset_min, enabled)
      VALUES (${me}, ${b.troveOwner.toLowerCase()}, ${b.kind}, ${b.threshold ?? null}, ${b.frequency}, ${b.channel}, ${b.quietStart ?? null}, ${b.quietEnd ?? null}, ${b.tzOffsetMin}, ${b.enabled})
      RETURNING *`;
    return json({ rule: { ...row, id: String(row.id), threshold: row.threshold == null ? null : Number(row.threshold) } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
