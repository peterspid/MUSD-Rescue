import { readHistory } from "@/lib/server/musd-adapter";
import { sql } from "@/lib/server/db";
import { errorResponse, json, HttpError, rateLimit, clientKey } from "@/lib/server/http";
import { parsePositionId } from "@/lib/positions/id";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = { "24h": 86_400, "7d": 7 * 86_400, "30d": 30 * 86_400 };

/**
 * Real history, two sources:
 *  - archive: PriceFeed.fetchPrice() and TroveManager.getEntireDebtAndColl() evaluated at past blocks
 *    (Mezo testnet RPC serves historical state), sampled evenly over the range.
 *  - recorded: observations MUSD Rescue stored itself (visits, daily cron, verified transactions).
 */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string }> }) {
  try {
    rateLimit(`hist:${clientKey(req)}`, 20, 0.3);
    const raw = (await params).owner;
    const url = new URL(req.url);
    const range = url.searchParams.get("range") ?? "7d";
    const rangeSec = RANGES[range];
    if (!rangeSec) throw new HttpError(400, "range must be 24h, 7d or 30d");
    let owner: `0x${string}` | null = null;
    if (raw !== "system") {
      const id = parsePositionId(raw);
      if (id.kind !== "live") throw new HttpError(400, "A live trove owner address is required", "invalid-id");
      owner = id.owner;
    }
    const since = new Date(Date.now() - rangeSec * 1000).toISOString();
    const points = await readHistory(owner, rangeSec, range === "24h" ? 36 : 48);
    const recorded = owner
      ? await sql()`SELECT block_number, extract(epoch from block_time)::bigint AS t, price, icr, coll, principal, interest, source FROM rescue.trove_snapshots
          WHERE network = 'testnet' AND trove_owner = ${owner.toLowerCase()} AND block_time > ${since} ORDER BY block_time ASC LIMIT 500`
      : await sql()`SELECT block_number, extract(epoch from block_time)::bigint AS t, price, tcr, source FROM rescue.oracle_snapshots
          WHERE network = 'testnet' AND block_time > ${since} ORDER BY block_time ASC LIMIT 500`;
    return json(
      {
        range,
        archive: points,
        recorded: recorded.map((r) => ({ ...r, block_number: String(r.block_number), t: Number(r.t) })),
        method: "archive eth_call at sampled block heights + MUSD Rescue observations",
      },
      { cache: "public, s-maxage=300, stale-while-revalidate=600" },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
