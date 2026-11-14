import { readTroveEvents } from "@/lib/server/musd-adapter";
import { errorResponse, json, HttpError } from "@/lib/server/http";
import { parsePositionId } from "@/lib/positions/id";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string }> }) {
  try {
    const id = parsePositionId((await params).owner);
    if (id.kind !== "live") throw new HttpError(400, "A live trove owner address is required", "invalid-id");
    const events = await readTroveEvents(id.owner);
    return json({ events, source: "Mezo testnet Blockscout logs API (TroveUpdated / TroveLiquidated)" }, { cache: "public, s-maxage=20, stale-while-revalidate=60" });
  } catch (e) {
    return errorResponse(e);
  }
}
