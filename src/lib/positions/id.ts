import { getAddress, isAddress, type Address } from "viem";

/**
 * Live position ids are trove owner addresses (MUSD allows one trove per address).
 * Demo ids (`demo-*`) are explicitly rejected here so fictional data can never be routed into a live page.
 */
export type ParsedPositionId =
  | { kind: "live"; owner: Address }
  | { kind: "demo"; id: string }
  | { kind: "invalid"; reason: string };

export function parsePositionId(raw: string | null | undefined): ParsedPositionId {
  const id = decodeURIComponent((raw ?? "").trim());
  if (id.toLowerCase().startsWith("demo-")) return { kind: "demo", id };
  if (!isAddress(id, { strict: false })) return { kind: "invalid", reason: "A position id is the trove owner's 0x address." };
  return { kind: "live", owner: getAddress(id) };
}
