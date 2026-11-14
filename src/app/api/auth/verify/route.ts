import { z } from "zod";
import { NextResponse } from "next/server";
import { verifySiwe, createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { errorResponse, parseBody, assertSameOrigin, rateLimit, clientKey } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().min(50).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    rateLimit(`siwe:${clientKey(req)}`, 10, 0.2);
    const { message, signature } = await parseBody(req, Body);
    const address = await verifySiwe(req, message, signature as `0x${string}`);
    const token = await createSessionToken(address);
    const res = NextResponse.json({ address }, { headers: { "cache-control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
