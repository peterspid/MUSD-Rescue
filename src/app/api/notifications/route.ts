import { z } from "zod";
import { sql } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, assertSameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    const me = s.address.toLowerCase();
    const rows = await sql()`SELECT id, rule_id, trove_owner, severity, title, body, quiet, source, created_at, read_at FROM rescue.notifications
      WHERE user_address = ${me} ORDER BY created_at DESC LIMIT 100`;
    const unread = await sql()`SELECT count(*)::int AS n FROM rescue.notifications WHERE user_address = ${me} AND read_at IS NULL`;
    return json({ notifications: rows.map((r) => ({ ...r, id: String(r.id), rule_id: r.rule_id == null ? null : String(r.rule_id) })), unread: unread[0].n });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(200).optional(), all: z.boolean().optional() });

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const b = await parseBody(req, Body);
    const me = s.address.toLowerCase();
    if (b.all) await sql()`UPDATE rescue.notifications SET read_at = now() WHERE user_address = ${me} AND read_at IS NULL`;
    else if (b.ids?.length) await sql()`UPDATE rescue.notifications SET read_at = now() WHERE user_address = ${me} AND id = ANY(${b.ids}::bigint[])`;
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
