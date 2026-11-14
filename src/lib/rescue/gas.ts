/**
 * Explicit gas limits for every write. Mezo testnet enforces the EIP-7623 calldata floor and the public RPC
 * has returned bogus low estimates (21,644 for a ~51,700-gas transfer), which the node then rejects.
 * Rule: gas = max(estimate × 13/10, floor); estimates below 30,000 for a contract call are treated as invalid.
 */
export const MIN_VALID_ESTIMATE = 30_000n;

export function computeGasLimit(estimate: bigint | null | undefined, floor: bigint): { limit: bigint; floorApplied: boolean } {
  if (estimate == null || estimate < MIN_VALID_ESTIMATE) return { limit: floor, floorApplied: true };
  const padded = (estimate * 13n) / 10n;
  return padded >= floor ? { limit: padded, floorApplied: false } : { limit: floor, floorApplied: true };
}
