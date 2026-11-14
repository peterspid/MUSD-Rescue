import { listAllTroves } from "@/lib/server/musd-adapter";
import { errorResponse, json, rateLimit, clientKey } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    rateLimit(`radar:${clientKey(req)}`, 15, 0.2);
    const data = await listAllTroves();
    return json(data, { cache: "public, s-maxage=60, stale-while-revalidate=300" });
  } catch (e) {
    return errorResponse(e);
  }
}
