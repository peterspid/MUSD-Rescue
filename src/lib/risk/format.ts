/**
 * Decimal formatting and parsing for 18-decimal fixed-point values, done with bigint only.
 * Floats are never used to hold token quantities; `toChartNumber` exists only for drawing charts.
 */
import { BPS, WAD } from "./math";

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a fixed-point bigint with `fractionDigits` decimals, rounding half-up (away from zero for negatives).
 * formatFixed(1234567890000000000000n, 18, 2) → "1,234.57"
 */
export function formatFixed(value: bigint, decimals = 18, fractionDigits = 2, opts: { grouping?: boolean; trimZeros?: boolean } = {}): string {
  const grouping = opts.grouping ?? true;
  const neg = value < 0n;
  let v = neg ? -value : value;
  if (fractionDigits > decimals) fractionDigits = decimals;
  const scale = 10n ** BigInt(decimals - fractionDigits);
  if (scale > 1n) v = (v + scale / 2n) / scale;
  const unit = 10n ** BigInt(fractionDigits);
  const intPart = (v / unit).toString();
  let frac = fractionDigits > 0 ? (v % unit).toString().padStart(fractionDigits, "0") : "";
  if (opts.trimZeros) frac = frac.replace(/0+$/, "");
  const head = grouping ? group(intPart) : intPart;
  const s = frac ? `${head}.${frac}` : head;
  return neg && s.replace(/[0.,]/g, "") !== "" ? `-${s}` : s;
}

/** MUSD / USD amount: "2,302.10" */
export function formatAmount(value: bigint | null | undefined, fractionDigits = 2): string {
  if (value == null) return "—";
  return formatFixed(value, 18, fractionDigits);
}

/** BTC amount with adaptive precision: up to 8 decimals (satoshi), trailing zeros trimmed, min 4. */
export function formatBtc(value: bigint | null | undefined): string {
  if (value == null) return "—";
  const s = formatFixed(value, 18, 8);
  const [i, f = ""] = s.split(".");
  const trimmed = f.replace(/0+$/, "").padEnd(4, "0");
  return `${i}.${trimmed}`;
}

/** USD with $ sign. */
export function formatUsd(value: bigint | null | undefined, fractionDigits = 2): string {
  if (value == null) return "—";
  const neg = value < 0n;
  return `${neg ? "-" : ""}$${formatFixed(neg ? -value : value, 18, fractionDigits)}`;
}

/** Ratio in WAD (1e18 = 100%) as a percentage: 1.553e18 → "155.3%". null → "∞". */
export function formatRatioPct(ratio: bigint | null | undefined, fractionDigits = 1): string {
  if (ratio === undefined) return "—";
  if (ratio === null) return "∞";
  return `${formatFixed(ratio * 100n, 18, fractionDigits)}%`;
}

/** Health factor (WAD) as "1.41". null → "∞" (no debt). */
export function formatHF(hf: bigint | null | undefined, fractionDigits = 2): string {
  if (hf === undefined) return "—";
  if (hf === null) return "∞";
  return formatFixed(hf, 18, fractionDigits, { grouping: true });
}

/** Basis points as a percentage: 1234n → "12.34%". */
export function formatBps(bps: bigint | number | null | undefined, fractionDigits = 1, signed = false): string {
  if (bps == null) return "—";
  const b = BigInt(bps);
  const s = formatFixed(b, 2, fractionDigits);
  return `${signed && b > 0n ? "+" : ""}${s}%`;
}

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string };

/**
 * Parse a user-typed decimal amount into base units without floats.
 * Accepts "12", "12.5", ".5", "1,234.56" (commas as thousands separators only). Rejects exponents,
 * negatives, more fractional digits than the token supports, and empty input.
 */
export function parseAmount(input: string, decimals = 18, opts: { allowZero?: boolean; max?: bigint } = {}): ParseResult {
  const raw = (input ?? "").trim();
  if (raw === "") return { ok: false, error: "Enter an amount." };
  if (raw.startsWith("-")) return { ok: false, error: "Amount cannot be negative." };
  if (!/^(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(raw) || raw === "." ) return { ok: false, error: "Use digits and an optional decimal point." };
  const clean = raw.replace(/,/g, "");
  const [intPart = "", fracPart = ""] = clean.split(".");
  if (fracPart.length > decimals) return { ok: false, error: `At most ${decimals} decimal places.` };
  const value = BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt((fracPart || "").padEnd(decimals, "0") || "0");
  if (!opts.allowZero && value === 0n) return { ok: false, error: "Amount must be greater than zero." };
  if (opts.max !== undefined && value > opts.max) return { ok: false, error: "Amount is above the allowed maximum." };
  return { ok: true, value };
}

/** Plain decimal string (no grouping) suitable for an <input> value: 5000000000000000000n → "5". */
export function toInputString(value: bigint, decimals = 18, maxFraction = 18): string {
  const s = formatFixed(value, decimals, Math.min(maxFraction, decimals), { grouping: false, trimZeros: true });
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

/** Display-only conversion for charts and the 3D scene. Never feed the result back into money math. */
export function toChartNumber(value: bigint | null | undefined, decimals = 18): number | null {
  if (value == null) return null;
  const scale = 10n ** BigInt(Math.max(0, decimals - 6));
  return Number(value / scale) / 10 ** Math.min(6, decimals);
}

export function wadFromPercent(pct: number): bigint {
  return (BigInt(Math.round(pct * 100)) * WAD) / BPS;
}

export function shortAddress(a: string | null | undefined, chars = 4): string {
  if (!a) return "—";
  return `${a.slice(0, 2 + chars)}…${a.slice(-chars)}`;
}
