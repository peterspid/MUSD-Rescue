import { readPosition } from "@/lib/server/musd-adapter";
import { recordTroveSnapshot, logActivity } from "@/lib/server/records";
import { errorResponse, json, HttpError, rateLimit, clientKey } from "@/lib/server/http";
import { getSession } from "@/lib/server/auth";
import { parsePositionId } from "@/lib/positions/id";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ owner: string }> }) {
  try {
    rateLimit(`pos:${clientKey(req)}`, 60, 2);
    const id = parsePositionId((await params).owner);
    if (id.kind === "demo") throw new HttpError(404, "Demo positions are fictional and only exist on /demo.", "demo-id");
    if (id.kind === "invalid") throw new HttpError(400, id.reason, "invalid-id");
    const p = await readPosition(id.owner);
    if (p.active) {
      recordTroveSnapshot(p, "visit").catch(() => {});
      const session = await getSession(req);
      if (session) {
        logActivity({
          user: session.address,
          owner: p.owner,
          category: "offchain",
          kind: "position_discovered",
          title: session.address.toLowerCase() === p.owner.toLowerCase() ? "Your MUSD trove was discovered" : "Started watching an MUSD trove",
          details: { coll: p.coll, debt: p.debt, icr: p.risk?.icr ?? null },
          idempotencyKey: `discovered:${session.address.toLowerCase()}:${p.owner.toLowerCase()}`,
        }).catch(() => {});
      }
    }
    return json(p);
  } catch (e) {
    return errorResponse(e);
  }
}
