import { getSession } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await getSession(req);
  return json({ address: s?.address ?? null });
}
