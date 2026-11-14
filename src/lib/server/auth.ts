import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getAddress, isAddress, type Address } from "viem";
import { generateSiweNonce, parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { mezoTestnet } from "@/config/chains";
import { sql } from "./db";
import { chainClient } from "./chain";
import { HttpError } from "./http";

export const SESSION_COOKIE = "rescue_session";
const SESSION_TTL_SEC = 7 * 24 * 3600;
const NONCE_TTL_MS = 10 * 60_000;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export async function issueNonce(): Promise<string> {
  const nonce = generateSiweNonce();
  const expires = new Date(Date.now() + NONCE_TTL_MS);
  await sql()`INSERT INTO rescue.siwe_nonces (nonce, expires_at) VALUES (${nonce}, ${expires.toISOString()})`;
  // opportunistic cleanup
  await sql()`DELETE FROM rescue.siwe_nonces WHERE expires_at < now() - interval '1 day'`;
  return nonce;
}

export function requestHost(req: Request): string {
  return req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
}

/**
 * Verify an EIP-4361 message: domain, URI host, chain id, expiry, single-use server nonce, signature
 * (viem verifySiweMessage also supports smart-contract wallets via ERC-1271/6492).
 */
export async function verifySiwe(req: Request, message: string, signature: `0x${string}`): Promise<Address> {
  const parsed = parseSiweMessage(message);
  const host = requestHost(req);
  if (!parsed.address || !parsed.nonce || !parsed.domain || !parsed.uri) throw new HttpError(400, "Malformed sign-in message", "siwe");
  if (parsed.domain !== host) throw new HttpError(401, `Sign-in message is for ${parsed.domain}, not ${host}`, "siwe-domain");
  try {
    if (new URL(parsed.uri).host !== host) throw new Error();
  } catch {
    throw new HttpError(401, "Sign-in URI does not match this site", "siwe-uri");
  }
  if (parsed.chainId !== mezoTestnet.id) throw new HttpError(401, "Sign in on Mezo Testnet (chain 31611)", "siwe-chain");
  if (parsed.expirationTime && parsed.expirationTime.getTime() < Date.now()) throw new HttpError(401, "Sign-in message expired", "siwe-expired");
  if (parsed.issuedAt && parsed.issuedAt.getTime() > Date.now() + 5 * 60_000) throw new HttpError(401, "Sign-in message issued in the future", "siwe-time");
  // Single use: atomically consume the nonce.
  const consumed = await sql()`UPDATE rescue.siwe_nonces SET used_at = now() WHERE nonce = ${parsed.nonce} AND used_at IS NULL AND expires_at > now() RETURNING nonce`;
  if (consumed.length === 0) throw new HttpError(401, "Sign-in nonce is invalid, expired or already used", "siwe-nonce");
  const valid = await verifySiweMessage(chainClient(), { message, signature, domain: host, nonce: parsed.nonce });
  if (!valid) throw new HttpError(401, "Signature does not match the message", "siwe-signature");
  const addr = getAddress(parsed.address);
  await sql()`INSERT INTO rescue.users (address) VALUES (${addr.toLowerCase()}) ON CONFLICT (address) DO UPDATE SET last_seen_at = now()`;
  return addr;
}

export async function createSessionToken(address: Address): Promise<string> {
  return new SignJWT({ addr: address.toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setSubject(address.toLowerCase())
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .setIssuer("musd-rescue")
    .sign(secret());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SEC,
  };
}

async function tokenFromRequest(req?: Request): Promise<string | undefined> {
  if (req) {
    const header = req.headers.get("cookie") ?? "";
    const m = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export async function getSession(req?: Request): Promise<{ address: Address } | null> {
  const token = await tokenFromRequest(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: "musd-rescue", algorithms: ["HS256"] });
    const a = payload.sub;
    if (!a || !isAddress(a)) return null;
    return { address: getAddress(a) };
  } catch {
    return null;
  }
}

export async function requireSession(req?: Request): Promise<{ address: Address }> {
  const s = await getSession(req);
  if (!s) throw new HttpError(401, "Sign in with your wallet first", "auth");
  return s;
}
