import "server-only";
import { getAddress, type Address, type Hex } from "viem";
import { MUSD_CONTRACTS } from "@/config/contracts";
import { chainClient } from "./chain";
import { sql } from "./db";
import { verifyRescueReceipt } from "../rescue/receipt";
import { readPosition, paramsFromDTO } from "./musd-adapter";
import { computeCR, positionFromEntire } from "../risk";
import { logActivity, recordOracleSnapshot, recordTroveSnapshot } from "./records";
import { HttpError } from "./http";

const A = MUSD_CONTRACTS.testnet;

export interface VerifiedRecord {
  txHash: string;
  status: "confirmed" | "reverted";
  action: string;
  troveOwner: string;
  repayAmount: string;
  collAmount: string;
  blockNumber: string;
  gasUsed: string | null;
  icrBefore: string | null;
  icrAfter: string | null;
  priceAtVerification: string | null;
  duplicate: boolean;
  position?: unknown;
}

async function fetchTxAndReceipt(hash: Hex) {
  const c = chainClient();
  let lastErr: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const [tx, receipt, latest] = await Promise.all([c.getTransaction({ hash }), c.getTransactionReceipt({ hash }), c.getBlockNumber()]);
      return { tx, receipt, latest };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new HttpError(202, `Verification delayed: the transaction or its receipt is not visible on the RPC yet (${(lastErr as Error)?.message?.split("\n")[0] ?? "unknown"}). Retry in a few seconds.`, "verification-delayed");
}

/**
 * Verify a rescue transaction on-chain and record it. Never trusts client-reported status:
 * the receipt must be successful, sent to BorrowerOperations by the signed-in wallet, decode to a rescue
 * call, and contain the matching TroveUpdated event and MUSD burn. tx_hash is UNIQUE in the DB.
 */
export async function verifyAndRecord(hash: Hex, sessionAddress: Address): Promise<VerifiedRecord> {
  const lower = hash.toLowerCase();
  const existing = await sql()`SELECT * FROM rescue.rescue_txs WHERE tx_hash = ${lower}`;
  if (existing.length) {
    const r = existing[0];
    if (r.user_address !== sessionAddress.toLowerCase()) throw new HttpError(403, "This transaction belongs to another wallet.", "forbidden");
    return {
      txHash: r.tx_hash, status: r.status, action: r.action, troveOwner: r.trove_owner, repayAmount: String(r.repay_amount), collAmount: String(r.coll_amount),
      blockNumber: String(r.block_number), gasUsed: r.gas_used == null ? null : String(r.gas_used), icrBefore: r.icr_before == null ? null : String(r.icr_before),
      icrAfter: r.icr_after == null ? null : String(r.icr_after), priceAtVerification: r.details?.price ?? null, duplicate: true,
    };
  }

  const { tx, receipt, latest } = await fetchTxAndReceipt(hash);
  const result = verifyRescueReceipt({
    tx: { hash, from: tx.from, to: tx.to, input: tx.input, value: tx.value },
    receipt: { status: receipt.status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, logs: receipt.logs },
    borrowerOperations: A.BorrowerOperations,
    musd: A.MUSD,
    expectedSender: sessionAddress,
    latestBlock: latest,
  });

  if (!result.ok && result.code !== "reverted") {
    const status = result.code === "wrong-sender" ? 403 : result.code === "unconfirmed" ? 202 : 422;
    throw new HttpError(status, result.message, result.code);
  }

  const owner = getAddress(tx.from);
  const reverted = !result.ok;
  // Re-read the trove at the receipt block and just before it, then compare at the SAME oracle price
  // (the receipt block's), so the effect of the action is isolated from price movement between blocks.
  let icrBefore: bigint | null = null;
  let icrAfter: bigint | null = null;
  let priceAt: bigint | null = null;
  try {
    const [afterPos, beforePos] = await Promise.all([readPosition(owner, receipt.blockNumber), readPosition(owner, receipt.blockNumber - 1n)]);
    priceAt = afterPos.system.price ? BigInt(afterPos.system.price) : null;
    if (priceAt) {
      const params = paramsFromDTO(afterPos.system.params);
      const a = positionFromEntire(BigInt(afterPos.coll), BigInt(afterPos.principal), BigInt(afterPos.interest), params);
      const b = positionFromEntire(BigInt(beforePos.coll), BigInt(beforePos.principal), BigInt(beforePos.interest), params);
      icrAfter = afterPos.active ? computeCR(a.coll, a.debt, priceAt) : null;
      icrBefore = beforePos.active ? computeCR(b.coll, b.debt, priceAt) : null;
    }
  } catch {
    /* archive read failed: leave nulls, record still valid */
  }

  const action = result.ok ? result.action : result.action!;
  const repay = (result.ok ? result.repayAmount : result.repayAmount) ?? 0n;
  const coll = (result.ok ? result.collAmount : result.collAmount) ?? 0n;
  const inserted = await sql()`INSERT INTO rescue.rescue_txs (tx_hash, network, user_address, trove_owner, action, repay_amount, coll_amount, status, block_number, gas_used, icr_before, icr_after, details)
    VALUES (${lower}, 'testnet', ${sessionAddress.toLowerCase()}, ${owner.toLowerCase()}, ${action}, ${repay.toString()}, ${coll.toString()}, ${reverted ? "reverted" : "confirmed"},
      ${receipt.blockNumber.toString()}, ${receipt.gasUsed.toString()}, ${icrBefore?.toString() ?? null}, ${icrAfter?.toString() ?? null},
      ${JSON.stringify({ price: priceAt?.toString() ?? null, troveAfter: result.ok && result.troveAfter ? { principal: result.troveAfter.principal.toString(), interest: result.troveAfter.interest.toString(), coll: result.troveAfter.coll.toString() } : null })})
    ON CONFLICT (tx_hash) DO NOTHING RETURNING id`;
  const duplicate = inserted.length === 0;

  if (!duplicate) {
    const label = action === "repay" ? "MUSD repayment" : action === "add_collateral" ? "Collateral deposit" : "Repay + collateral";
    await logActivity({
      user: sessionAddress,
      owner,
      category: "onchain",
      kind: reverted ? "tx_failed" : "tx_confirmed",
      title: reverted ? `${label} reverted on-chain` : `${label} confirmed and verified`,
      txHash: lower,
      details: { action, repay: repay.toString(), coll: coll.toString(), blockNumber: receipt.blockNumber.toString(), icrBefore: icrBefore?.toString() ?? null, icrAfter: icrAfter?.toString() ?? null },
      idempotencyKey: `tx:${lower}:${reverted ? "failed" : "confirmed"}`,
    });
  }

  // Post-transaction refresh (latest block) for the UI + snapshot records.
  let position: unknown = undefined;
  try {
    const fresh = await readPosition(owner);
    position = fresh;
    await recordTroveSnapshot(fresh, "tx", true);
    await recordOracleSnapshot(fresh.system, "tx", true);
  } catch {
    /* refresh failure doesn't invalidate verification */
  }

  return {
    txHash: lower,
    status: reverted ? "reverted" : "confirmed",
    action,
    troveOwner: owner,
    repayAmount: repay.toString(),
    collAmount: coll.toString(),
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    icrBefore: icrBefore?.toString() ?? null,
    icrAfter: icrAfter?.toString() ?? null,
    priceAtVerification: priceAt?.toString() ?? null,
    duplicate,
    position,
  };
}
