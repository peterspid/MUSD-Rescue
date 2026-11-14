/**
 * Server-side verification of a rescue transaction from its on-chain receipt. Pure: takes the tx and
 * receipt objects (as returned by viem) so it can be unit tested with fixtures. The client's claim of
 * success is never trusted — only this function decides whether a rescue is recorded as confirmed.
 */
import { decodeEventLog, decodeFunctionData, getAddress, isAddressEqual, zeroAddress, type Address, type Hex, type Log } from "viem";
import { borrowerOperationsAbi, mUSDAbi } from "@/config/abis";

export type RescueAction = "repay" | "add_collateral" | "repay_and_add";

export interface VerifyTx {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
  value: bigint;
}

export interface VerifyReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
  logs: Pick<Log, "address" | "data" | "topics">[];
}

export type VerifyResult =
  | {
      ok: true;
      action: RescueAction;
      borrower: Address;
      repayAmount: bigint;
      collAmount: bigint;
      blockNumber: bigint;
      gasUsed: bigint;
      troveAfter: { principal: bigint; interest: bigint; coll: bigint } | null;
    }
  | {
      ok: false;
      code: "reverted" | "wrong-contract" | "wrong-function" | "wrong-sender" | "missing-event" | "burn-mismatch" | "value-mismatch" | "unconfirmed";
      message: string;
      action?: RescueAction;
      borrower?: Address;
      repayAmount?: bigint;
      collAmount?: bigint;
    };

/** BorrowerOperation enum in BorrowerOperations.sol: openTrove=0, closeTrove=1, adjustTrove=2, refinanceTrove=3. */
const OP_ADJUST = 2;

export function decodeRescueCall(input: Hex, value: bigint): { action: RescueAction; repayAmount: bigint; collAmount: bigint } | { error: string } {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: borrowerOperationsAbi, data: input });
  } catch {
    return { error: "Calldata is not a BorrowerOperations call." };
  }
  switch (decoded.functionName) {
    case "repayMUSD": {
      const [amount] = decoded.args as readonly [bigint, Address, Address];
      if (value !== 0n) return { error: "repayMUSD must not carry BTC." };
      return { action: "repay", repayAmount: amount, collAmount: 0n };
    }
    case "addColl":
      if (value === 0n) return { error: "addColl without BTC attached." };
      return { action: "add_collateral", repayAmount: 0n, collAmount: value };
    case "adjustTrove": {
      const [collWithdrawal, debtChange, isDebtIncrease] = decoded.args as readonly [bigint, bigint, boolean, Address, Address];
      if (collWithdrawal !== 0n || isDebtIncrease) return { error: "Only debt repayments and collateral top-ups count as rescues." };
      if (debtChange === 0n && value === 0n) return { error: "Empty adjustment." };
      if (value === 0n) return { action: "repay", repayAmount: debtChange, collAmount: 0n };
      if (debtChange === 0n) return { action: "add_collateral", repayAmount: 0n, collAmount: value };
      return { action: "repay_and_add", repayAmount: debtChange, collAmount: value };
    }
    default:
      return { error: `${decoded.functionName} is not a rescue action.` };
  }
}

export function verifyRescueReceipt(args: {
  tx: VerifyTx;
  receipt: VerifyReceipt;
  borrowerOperations: Address;
  musd: Address;
  /** If set, tx.from must equal it (e.g. the signed-in user). */
  expectedSender?: Address;
  latestBlock: bigint;
  minConfirmations?: bigint;
}): VerifyResult {
  const { tx, receipt } = args;
  if (!tx.to || !isAddressEqual(tx.to, args.borrowerOperations)) {
    return { ok: false, code: "wrong-contract", message: "The transaction was not sent to MUSD BorrowerOperations." };
  }
  const call = decodeRescueCall(tx.input, tx.value);
  if ("error" in call) return { ok: false, code: "wrong-function", message: call.error };
  const borrower = getAddress(tx.from);
  if (args.expectedSender && !isAddressEqual(args.expectedSender, borrower)) {
    return { ok: false, code: "wrong-sender", message: "This transaction was sent by a different wallet than the one signed in." };
  }
  const confirmations = args.latestBlock - receipt.blockNumber + 1n;
  if (confirmations < (args.minConfirmations ?? 1n)) {
    return { ok: false, code: "unconfirmed", message: "Waiting for confirmation." };
  }
  if (receipt.status !== "success") {
    return { ok: false, code: "reverted", message: "The transaction reverted on-chain.", action: call.action, borrower, repayAmount: call.repayAmount, collAmount: call.collAmount };
  }

  let troveAfter: { principal: bigint; interest: bigint; coll: bigint } | null = null;
  let burned = 0n;
  for (const log of receipt.logs) {
    if (isAddressEqual(log.address, args.borrowerOperations)) {
      try {
        const ev = decodeEventLog({ abi: borrowerOperationsAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "TroveUpdated" && isAddressEqual(ev.args._borrower, borrower) && Number(ev.args._operation) === OP_ADJUST) {
          troveAfter = { principal: ev.args._principal, interest: ev.args._interest, coll: ev.args._coll };
        }
      } catch {
        /* not an event we know */
      }
    } else if (isAddressEqual(log.address, args.musd)) {
      try {
        const ev = decodeEventLog({ abi: mUSDAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (ev.eventName === "Transfer" && isAddressEqual(ev.args.from, borrower) && isAddressEqual(ev.args.to, zeroAddress)) {
          burned += ev.args.value;
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!troveAfter) {
    return { ok: false, code: "missing-event", message: "No TroveUpdated(adjustTrove) event for this borrower was found in the receipt." };
  }
  if (call.repayAmount > 0n && burned !== call.repayAmount) {
    return { ok: false, code: "burn-mismatch", message: `Expected ${call.repayAmount} MUSD burned from the borrower, found ${burned}.` };
  }
  if (call.collAmount > 0n && tx.value !== call.collAmount) {
    return { ok: false, code: "value-mismatch", message: "Collateral amount does not match the BTC attached to the transaction." };
  }
  return {
    ok: true,
    action: call.action,
    borrower,
    repayAmount: call.repayAmount,
    collAmount: call.collAmount,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    troveAfter,
  };
}
