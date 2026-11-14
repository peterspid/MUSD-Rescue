import { z } from "zod";
import type { Hex } from "viem";
import { verifyAndRecord } from "@/lib/server/verify";
import { requireSession } from "@/lib/server/auth";
import { errorResponse, json, parseBody, rateLimit, clientKey, assertSameOrigin } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const Body = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "txHash must be a 32-byte hex hash") });

/** Verify a rescue transaction from its receipt and record it (idempotent; tx hash is unique). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    rateLimit(`verify:${clientKey(req)}`, 20, 0.5);
    const session = await requireSession(req);
    const { txHash } = await parseBody(req, Body);
    const record = await verifyAndRecord(txHash as Hex, session.address);
    return json(record, { status: record.duplicate ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
