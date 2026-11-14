import { listGuards } from "@/lib/server/guard";
import { clientKey, errorResponse, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public registry of RescueGuard plans (from Armed events + live planStatus) and recent executions. */
export async function GET(req: Request) {
  try {
    rateLimit(`guard:${clientKey(req)}`, 30, 1);
    return json(await listGuards());
  } catch (e) {
    return errorResponse(e);
  }
}
