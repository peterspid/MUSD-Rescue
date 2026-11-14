import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { bigintReplacer } from "../dto";
import { AdapterError } from "./musd-adapter";

export function json(data: unknown, init: ResponseInit & { cache?: string } = {}) {
  const body = JSON.stringify(data, bigintReplacer);
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", init.cache ?? "no-store");
  return new NextResponse(body, { ...init, headers });
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
  if (e instanceof AdapterError) return json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
  if (e instanceof ZodError) return json({ error: "Invalid request", code: "validation", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[api]", msg);
  const rpcish = /fetch failed|timeout|ECONN|HTTP request failed|rpc/i.test(msg);
  return json({ error: rpcish ? "Mezo testnet RPC is not responding. Try again shortly." : "Unexpected server error.", code: rpcish ? "rpc" : "internal" }, { status: rpcish ? 503 : 500 });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON", "bad-json");
  }
  return schema.parse(raw);
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (scripts) send no Origin; cookies are SameSite=Lax anyway
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request rejected", "origin");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Bad Origin header", "origin");
  }
}

/** Tiny in-memory rate limiter (per lambda instance) — cheap protection for RPC-heavy endpoints. */
const buckets = new Map<string, { tokens: number; at: number }>();
export function rateLimit(key: string, capacity = 20, refillPerSec = 0.5) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
  b.at = now;
  if (b.tokens < 1) throw new HttpError(429, "Too many requests. Slow down a little.", "rate-limit");
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
}

export function clientKey(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
