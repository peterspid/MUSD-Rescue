import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { flowReducer, initialFlow, isSuccess, isBusy, classifyWalletError, isPreparedExpired, riskWorsened, type FlowState, type PreparedTx } from "@/lib/rescue/flow";
import { verifyRescueReceipt, decodeRescueCall } from "@/lib/rescue/receipt";
import { approvalRequirement } from "@/lib/rescue/approval";
import { borrowerOperationsAbi, mUSDAbi } from "@/config/abis";
import { MUSD_CONTRACTS } from "@/config/contracts";

const BO = MUSD_CONTRACTS.testnet.BorrowerOperations;
const MUSD = MUSD_CONTRACTS.testnet.MUSD;
const OWNER = "0x10ac9924a78051BdD770978740C5084205cdB628" as Address;
const OTHER = "0xf0bAa8365c7B8132B3dbfE7D0294Fc7042E72668" as Address;
const HASH = ("0x" + "ab".repeat(32)) as Hex;
const WAD = 10n ** 18n;

const prepared = (over: Partial<PreparedTx> = {}): PreparedTx => ({
  to: BO,
  data: "0x",
  value: "0",
  gas: "450000",
  chainId: 31611,
  preparedAt: 1_000,
  blockNumber: "1",
  icrBefore: "1553132086801858663",
  icrAfter: "1556510000000000000",
  action: "repay",
  needsApproval: false,
  ...over,
});

function run(events: Parameters<typeof flowReducer>[1][], start: FlowState = initialFlow) {
  return events.reduce(flowReducer, start);
}

describe("rescue flow: successful repayment and post-transaction refresh", () => {
  it("only reaches 'verified' after receipt success AND server verification", () => {
    const steps: Parameters<typeof flowReducer>[1][] = [{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "SUBMITTED", hash: HASH }];
    const pending = run(steps);
    expect(pending.s).toBe("pending");
    expect(isSuccess(pending)).toBe(false);
    const confirmed = flowReducer(pending, { type: "RECEIPT", status: "success", blockNumber: "10" });
    expect(confirmed.s).toBe("confirmed");
    expect(isSuccess(confirmed)).toBe(false); // receipt seen, refresh not yet done
    expect(isBusy(confirmed)).toBe(true);
    const verified = flowReducer(confirmed, { type: "VERIFIED", icrAfter: "1556510000000000000" });
    expect(verified.s).toBe("verified");
    expect(isSuccess(verified)).toBe(true);
  });
  it("cannot jump to verified from pending (no fake success)", () => {
    const pending = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "SUBMITTED", hash: HASH }]);
    expect(flowReducer(pending, { type: "VERIFIED", icrAfter: null }).s).toBe("pending");
  });
  it("verification delayed (RPC lag) can still complete later", () => {
    const s = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "SUBMITTED", hash: HASH }, { type: "RECEIPT", status: "success", blockNumber: "5" }, { type: "VERIFY_DELAYED", message: "rpc" }]);
    expect(s.s).toBe("verification-delayed");
    expect(flowReducer(s, { type: "VERIFIED", icrAfter: null }).s).toBe("verified");
  });
});

describe("rescue flow: failures", () => {
  it("failed (reverted) transactions are reported as reverted, never success", () => {
    const s = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "SUBMITTED", hash: HASH }, { type: "RECEIPT", status: "reverted", blockNumber: "7" }]);
    expect(s.s).toBe("reverted");
    expect(isSuccess(s)).toBe(false);
  });
  it("wallet rejection → rejected, nothing sent", () => {
    const s = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "WALLET_REJECTED" }]);
    expect(s.s).toBe("rejected");
  });
  it("prepare failure and send failure", () => {
    expect(run([{ type: "PREPARE" }, { type: "PREPARE_FAILED", message: "sim reverted" }]).s).toBe("failed");
    expect(run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "SEND_FAILED", message: "gas" }]).s).toBe("failed");
  });
  it("rejected approvals stop the flow before any repayment is signed", () => {
    const s = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared({ needsApproval: true }) }, { type: "SIGN" }]);
    expect(s.s).toBe("review"); // cannot sign while approval is outstanding
    const rejected = run([{ type: "APPROVE" }, { type: "APPROVAL_REJECTED", message: "denied" }], s);
    expect(rejected.s).toBe("approval-rejected");
    expect(flowReducer(rejected, { type: "SUBMITTED", hash: HASH }).s).toBe("approval-rejected");
    const approved = run([{ type: "APPROVE" }, { type: "APPROVED" }, { type: "SIGN" }], s);
    expect(approved.s).toBe("awaiting-signature");
  });
  it("classifies wallet errors", () => {
    expect(classifyWalletError({ name: "UserRejectedRequestError", message: "User rejected the request." }).kind).toBe("rejected");
    expect(classifyWalletError({ code: 4001, message: "denied" }).kind).toBe("rejected");
    expect(classifyWalletError({ message: "x", cause: { code: 4001 } }).kind).toBe("rejected");
    expect(classifyWalletError({ shortMessage: "gas limit below EIP-7623 floor" })).toEqual({ kind: "failed", message: "gas limit below EIP-7623 floor" });
  });
});

describe("rescue flow: wallet disconnection and network changes", () => {
  it("disconnecting before broadcast aborts the flow", () => {
    expect(run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "DISCONNECTED" }]).s).toBe("disconnected");
    expect(run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "DISCONNECTED" }]).s).toBe("disconnected");
  });
  it("disconnecting after broadcast keeps tracking the receipt", () => {
    const s = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "SIGN" }, { type: "SUBMITTED", hash: HASH }, { type: "DISCONNECTED" }]);
    expect(s.s).toBe("pending");
    expect(s.s === "pending" && s.walletDisconnected).toBe(true);
    expect(flowReducer(s, { type: "RECEIPT", status: "success", blockNumber: "3" }).s).toBe("confirmed");
  });
  it("switching to an unsupported network before signing blocks the flow", () => {
    const s = run([{ type: "PREPARE" }, { type: "PREPARED", tx: prepared() }, { type: "NETWORK_CHANGED", writable: false, label: "Ethereum" }]);
    expect(s.s).toBe("blocked");
  });
  it("prepared transactions expire after 60s", () => {
    expect(isPreparedExpired(prepared({ preparedAt: 0 }), 59_000)).toBe(false);
    expect(isPreparedExpired(prepared({ preparedAt: 0 }), 61_000)).toBe(true);
  });
  it("detects a position that worsened since the simulator opened", () => {
    expect(riskWorsened(1553n * WAD / 1000n, 1500n * WAD / 1000n).worsened).toBe(true);
    expect(riskWorsened(1500n * WAD / 1000n, 1553n * WAD / 1000n).worsened).toBe(false);
    expect(riskWorsened(null, 1n).worsened).toBe(false);
  });
});

describe("approvals", () => {
  it("MUSD repayments never need an approval (BorrowerOperations burns via burnList)", () => {
    const r = approvalRequirement("burn-by-protocol", 0n, 5n * WAD, BO);
    expect(r.needed).toBe(false);
    expect(r.explanation).toMatch(/burns/);
  });
  it("transferFrom-style protocols request an exact (never unlimited) approval", () => {
    const r = approvalRequirement("transfer-from", 1n, 5n * WAD, BO);
    expect(r.needed).toBe(true);
    expect(r.amount).toBe(5n * WAD);
    expect(approvalRequirement("transfer-from", 5n * WAD, 5n * WAD, BO).needed).toBe(false);
  });
});

// ---- receipt verification fixtures ----
function troveUpdatedLog(borrower: Address, op = 2) {
  const topics = encodeEventTopics({ abi: borrowerOperationsAbi, eventName: "TroveUpdated", args: { _borrower: borrower } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint256" }, { type: "uint8" }],
    [2297n * WAD, 0n, 45n * 10n ** 15n, 45n * 10n ** 15n, 100, 1n, op],
  );
  return { address: BO, topics: topics as [Hex, ...Hex[]], data };
}
function burnLog(from: Address, value: bigint) {
  const topics = encodeEventTopics({ abi: mUSDAbi, eventName: "Transfer", args: { from, to: zeroAddress } });
  return { address: MUSD, topics: topics as [Hex, ...Hex[]], data: encodeAbiParameters([{ type: "uint256" }], [value]) };
}
const repayInput = encodeFunctionData({ abi: borrowerOperationsAbi, functionName: "repayMUSD", args: [5n * WAD, OWNER, OWNER] });
const addCollInput = encodeFunctionData({ abi: borrowerOperationsAbi, functionName: "addColl", args: [OWNER, OWNER] });

describe("on-chain receipt verification", () => {
  const base = { borrowerOperations: BO, musd: MUSD, latestBlock: 101n };
  it("accepts a real-shaped repayMUSD receipt (burn + TroveUpdated)", () => {
    const r = verifyRescueReceipt({
      ...base,
      tx: { hash: HASH, from: OWNER, to: BO, input: repayInput, value: 0n },
      receipt: { status: "success", blockNumber: 100n, gasUsed: 300_000n, logs: [burnLog(OWNER, 5n * WAD), troveUpdatedLog(OWNER)] },
      expectedSender: OWNER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("repay");
      expect(r.repayAmount).toBe(5n * WAD);
      expect(r.troveAfter?.principal).toBe(2297n * WAD);
    }
  });
  it("accepts addColl with the attached value", () => {
    const r = verifyRescueReceipt({ ...base, tx: { hash: HASH, from: OWNER, to: BO, input: addCollInput, value: 10n ** 13n }, receipt: { status: "success", blockNumber: 100n, gasUsed: 1n, logs: [troveUpdatedLog(OWNER)] } });
    expect(r.ok && r.action === "add_collateral" && r.collAmount === 10n ** 13n).toBe(true);
  });
  it("rejects reverted receipts, wrong contract, wrong sender, wrong amount and missing events", () => {
    const tx = { hash: HASH, from: OWNER, to: BO, input: repayInput, value: 0n };
    const ok = { status: "success" as const, blockNumber: 100n, gasUsed: 1n, logs: [burnLog(OWNER, 5n * WAD), troveUpdatedLog(OWNER)] };
    expect(verifyRescueReceipt({ ...base, tx, receipt: { ...ok, status: "reverted" } })).toMatchObject({ ok: false, code: "reverted" });
    expect(verifyRescueReceipt({ ...base, tx: { ...tx, to: MUSD }, receipt: ok })).toMatchObject({ ok: false, code: "wrong-contract" });
    expect(verifyRescueReceipt({ ...base, tx, receipt: ok, expectedSender: OTHER })).toMatchObject({ ok: false, code: "wrong-sender" });
    expect(verifyRescueReceipt({ ...base, tx, receipt: { ...ok, logs: [burnLog(OWNER, 4n * WAD), troveUpdatedLog(OWNER)] } })).toMatchObject({ ok: false, code: "burn-mismatch" });
    expect(verifyRescueReceipt({ ...base, tx, receipt: { ...ok, logs: [burnLog(OWNER, 5n * WAD)] } })).toMatchObject({ ok: false, code: "missing-event" });
    expect(verifyRescueReceipt({ ...base, tx, receipt: { ...ok, logs: [burnLog(OWNER, 5n * WAD), troveUpdatedLog(OTHER)] } })).toMatchObject({ ok: false, code: "missing-event" });
    expect(verifyRescueReceipt({ ...base, latestBlock: 99n, tx, receipt: ok })).toMatchObject({ ok: false, code: "unconfirmed" });
  });
  it("refuses non-rescue calls (borrowing, withdrawing)", () => {
    const withdraw = encodeFunctionData({ abi: borrowerOperationsAbi, functionName: "withdrawMUSD", args: [1n, OWNER, OWNER] });
    expect(decodeRescueCall(withdraw, 0n)).toHaveProperty("error");
    const borrowAdjust = encodeFunctionData({ abi: borrowerOperationsAbi, functionName: "adjustTrove", args: [0n, 1n, true, OWNER, OWNER] });
    expect(decodeRescueCall(borrowAdjust, 0n)).toHaveProperty("error");
    const combo = encodeFunctionData({ abi: borrowerOperationsAbi, functionName: "adjustTrove", args: [0n, 7n, false, OWNER, OWNER] });
    expect(decodeRescueCall(combo, 3n)).toEqual({ action: "repay_and_add", repayAmount: 7n, collAmount: 3n });
    expect(decodeRescueCall("0xdeadbeef", 0n)).toHaveProperty("error");
  });
});

import { computeGasLimit } from "@/lib/rescue/gas";
describe("explicit gas limits (EIP-7623 floor gotcha)", () => {
  it("pads estimates by 30% and never goes below the floor", () => {
    expect(computeGasLimit(380_000n, 450_000n)).toEqual({ limit: 494_000n, floorApplied: false });
    expect(computeGasLimit(200_000n, 450_000n)).toEqual({ limit: 450_000n, floorApplied: true });
  });
  it("treats bogus tiny estimates and failures as invalid", () => {
    expect(computeGasLimit(21_644n, 450_000n).limit).toBe(450_000n);
    expect(computeGasLimit(null, 450_000n).floorApplied).toBe(true);
  });
});
