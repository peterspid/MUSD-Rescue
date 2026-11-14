import { sql } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, assertSameOrigin, HttpError } from "@/lib/server/http";
import { RulePatchSchema, validateThreshold } from "@/lib/server/alert-schema";

export const dynamic = "force-dynamic";

const Patch = RulePatchSchema;

async function ownedRule(id: string, me: string) {
  if (!/^\d+$/.test(id)) throw new HttpError(400, "Invalid rule id");
  const rows = await sql()`SELECT * FROM rescue.alert_rules WHERE id = ${id}`;
  if (!rows.length) throw new HttpError(404, "Alert rule not found");
  if (rows[0].user_address !== me) throw new HttpError(403, "Not your alert rule", "forbidden");
  return rows[0];
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const { id } = await params;
    const cur = await ownedRule(id, s.address.toLowerCase());
    const b = await parseBody(req, Patch);
    const kind = b.kind ?? cur.kind;
    const threshold = b.threshold !== undefined ? b.threshold : cur.threshold == null ? null : Number(cur.threshold);
    validateThreshold(kind, threshold);
    const [row] = await sql()`UPDATE rescue.alert_rules SET
        kind = ${kind},
        threshold = ${threshold},
        frequency = ${b.frequency ?? cur.frequency},
        channel = ${b.channel ?? cur.channel},
        quiet_start = ${b.quietStart !== undefined ? b.quietStart : cur.quiet_start},
        quiet_end = ${b.quietEnd !== undefined ? b.quietEnd : cur.quiet_end},
        tz_offset_min = ${b.tzOffsetMin ?? cur.tz_offset_min},
        enabled = ${b.enabled ?? cur.enabled},
        baseline = CASE WHEN ${b.kind != null && b.kind !== cur.kind} THEN '{}'::jsonb ELSE baseline END,
        updated_at = now()
      WHERE id = ${id} RETURNING *`;
    return json({ rule: { ...row, id: String(row.id), threshold: row.threshold == null ? null : Number(row.threshold) } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const { id } = await params;
    await ownedRule(id, s.address.toLowerCase());
    await sql()`DELETE FROM rescue.alert_rules WHERE id = ${id}`;
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
