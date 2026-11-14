import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { sql } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, assertSameOrigin, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    const rows = await sql()`SELECT trove_owner, label, created_at FROM rescue.watchlist WHERE user_address = ${s.address.toLowerCase()} ORDER BY created_at ASC`;
    return json({ items: rows.map((r) => ({ ...r, trove_owner: getAddress(r.trove_owner) })) });
  } catch (e) {
    return errorResponse(e);
  }
}

const Body = z.object({ troveOwner: z.string().refine((a) => isAddress(a, { strict: false })), label: z.string().max(40).optional() });

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const b = await parseBody(req, Body);
    const me = s.address.toLowerCase();
    const n = await sql()`SELECT count(*)::int AS n FROM rescue.watchlist WHERE user_address = ${me}`;
    if (n[0].n >= 25) throw new HttpError(400, "You can watch up to 25 troves", "limit");
    await sql()`INSERT INTO rescue.watchlist (user_address, trove_owner, label) VALUES (${me}, ${b.troveOwner.toLowerCase()}, ${b.label ?? null})
      ON CONFLICT (user_address, trove_owner) DO UPDATE SET label = EXCLUDED.label`;
    return json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    assertSameOrigin(req);
    const s = await requireSession(req);
    const owner = new URL(req.url).searchParams.get("owner");
    if (!owner || !isAddress(owner, { strict: false })) throw new HttpError(400, "owner query parameter required");
    await sql()`DELETE FROM rescue.watchlist WHERE user_address = ${s.address.toLowerCase()} AND trove_owner = ${owner.toLowerCase()}`;
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
