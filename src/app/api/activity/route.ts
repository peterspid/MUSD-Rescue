import { z } from "zod";
import { isAddress } from "viem";
import { sql } from "@/lib/server/db";
import { requireSession } from "@/lib/server/auth";
import { logActivity } from "@/lib/server/records";
import { errorResponse, json, parseBody, assertSameOrigin, rateLimit, clientKey } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Activity for the signed-in wallet: its own events plus verified on-chain records for troves it owns. */
export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner");
    const category = url.searchParams.get("category");
    const me = session.address.toLowerCase();
    if (owner && !isAddress(owner, { strict: false })) return json({ error: "owner must be an address" }, { status: 400 });
    const o = owner?.toLowerCase() ?? null;
    const rows = await sql()`
      SELECT id, user_address, trove_owner, category, kind, title, tx_hash, details, created_at FROM rescue.activity
      WHERE (user_address = ${me} OR (category = 'onchain' AND trove_owner = ${me}))
        AND (${o}::text IS NULL OR trove_owner = ${o})
        AND (${category}::text IS NULL OR category = ${category})
      ORDER BY created_at DESC, id DESC LIMIT 200`;
    const txs = await sql()`SELECT tx_hash, action, repay_amount, coll_amount, status, block_number, gas_used, icr_before, icr_after, verified_at, trove_owner
      FROM rescue.rescue_txs WHERE user_address = ${me} ORDER BY verified_at DESC LIMIT 100`;
    return json({
      events: rows.map((r) => ({ ...r, id: String(r.id) })),
      transactions: txs.map((t) => ({ ...t, repay_amount: String(t.repay_amount), coll_amount: String(t.coll_amount), block_number: String(t.block_number), gas_used: t.gas_used == null ? null : String(t.gas_used), icr_before: t.icr_before == null ? null : String(t.icr_before), icr_after: t.icr_after == null ? null : String(t.icr_after) })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const Post = z.object({
  kind: z.enum(["simulation_completed", "tx_submitted", "tx_rejected", "tx_failed"]),
  owner: z.string().refine((a) => isAddress(a, { strict: false })),
  title: z.string().min(3).max(200),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Off-chain application events reported by the client (simulation run, tx submitted / rejected in wallet).
 * They are always stored with category 'offchain'; only /api/rescue/verify can create on-chain records.
 */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    rateLimit(`act:${clientKey(req)}`, 30, 1);
    const session = await requireSession(req);
    const b = await parseBody(req, Post);
    await logActivity({
      user: session.address,
      owner: b.owner,
      category: "offchain",
      kind: b.kind,
      title: b.title,
      txHash: b.txHash ?? null,
      details: { ...(b.details ?? {}), reportedBy: "client" },
      idempotencyKey: b.txHash ? `${b.kind}:${b.txHash.toLowerCase()}` : null,
    });
    return json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
