import { issueNonce } from "@/lib/server/auth";
import { errorResponse, json, rateLimit, clientKey } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    rateLimit(`nonce:${clientKey(req)}`, 20, 0.3);
    return json({ nonce: await issueNonce() });
  } catch (e) {
    return errorResponse(e);
  }
}
