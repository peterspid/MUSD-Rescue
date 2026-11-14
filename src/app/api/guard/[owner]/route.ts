import { isAddress, getAddress } from "viem";
import { executeHints, readGuard } from "@/lib/server/guard";
import { clientKey, errorResponse, HttpError, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One owner's guard. `?hints=1` adds SortedTroves hints for running the rescue from any wallet. */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string }> }) {
  try {
    rateLimit(`guard1:${clientKey(req)}`, 60, 2);
    const raw = (await params).owner;
    if (!isAddress(raw, { strict: false })) throw new HttpError(400, "Not a valid address.", "invalid-id");
    const owner = getAddress(raw);
    const g = await readGuard(owner);
    const wantHints = new URL(req.url).searchParams.get("hints") === "1";
    const hints = wantHints && g.plan ? await executeHints(owner, { kind: g.plan.kind, amount: BigInt(g.plan.amount) }) : null;
    return json({ ...g, hints });
  } catch (e) {
    return errorResponse(e);
  }
}
