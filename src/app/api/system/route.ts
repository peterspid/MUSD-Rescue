import { readSystem } from "@/lib/server/musd-adapter";
import { recordOracleSnapshot } from "@/lib/server/records";
import { errorResponse, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const system = await readSystem();
    // Oracle history: PriceFeed keeps none, so every visit (throttled to 1 per 5 min) records an observation.
    recordOracleSnapshot(system, "visit").catch(() => {});
    return json(system, { cache: "public, s-maxage=5, stale-while-revalidate=20" });
  } catch (e) {
    return errorResponse(e);
  }
}
