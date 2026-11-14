import { errorResponse, json, HttpError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * External reference series: CoinGecko BTC/USD. Shown only as a clearly labelled comparison line — it is
 * NOT the MUSD oracle and is never used in any risk calculation.
 */
let cache: { at: number; days: string; data: unknown } | null = null;

export async function GET(req: Request) {
  try {
    const days = new URL(req.url).searchParams.get("days") ?? "7";
    if (!["1", "7", "30"].includes(days)) throw new HttpError(400, "days must be 1, 7 or 30");
    if (cache && cache.days === days && Date.now() - cache.at < 15 * 60_000) return json(cache.data, { cache: "public, s-maxage=900" });
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new HttpError(502, `CoinGecko returned ${res.status}`, "reference-unavailable");
    const j = (await res.json()) as { prices: [number, number][] };
    const data = { source: "CoinGecko public API (bitcoin/usd market_chart)", note: "External reference only — not the MUSD oracle.", prices: j.prices.map(([t, p]) => ({ t: Math.round(t / 1000), p })) };
    cache = { at: Date.now(), days, data };
    return json(data, { cache: "public, s-maxage=900" });
  } catch (e) {
    return errorResponse(e);
  }
}
