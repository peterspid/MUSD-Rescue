import { describe, expect, it } from "vitest";
import { encodeAbiParameters, hashTypedData, keccak256, toHex, encodePacked, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MUSD_SOURCE_DEFAULTS, positionFromEntire, computeCR, WAD } from "@/lib/risk";
import {
  checkPlan,
  explainGuardError,
  authorizationTypedData,
  permitTypedData,
  kindFromId,
  nicrAfterRescue,
  priceAtICR,
  statusFromId,
  suggestPlan,
  STATUS_COPY,
  GUARD_STATUSES,
  MIN_TRIGGER_ICR,
  type PlanInput,
} from "@/lib/guard/plan";

const E = (n: number | string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 12n;
const params = MUSD_SOURCE_DEFAULTS;
// 0.05 BTC against 2,300 MUSD at $60,000 -> ICR 130.43%
const pos = positionFromEntire(E("0.05"), E(2_250), E(50), params);
const PRICE = E(60_000);
const NOW = 1_800_000_000n;

describe("guard plan sizing", () => {
  it("computes the trigger price where ICR crosses the trigger", () => {
    const p = priceAtICR(pos.coll, pos.debt, E("1.25"))!;
    expect(computeCR(pos.coll, pos.debt, p)! >= E("1.25")).toBe(true);
    expect(computeCR(pos.coll, pos.debt, p - 1n)! < E("1.25")).toBe(true);
    expect(priceAtICR(0n, pos.debt, E("1.25"))).toBeNull();
  });

  it("sizes a repay plan that lifts the trove back to target at the trigger price, capped by minimum net debt", () => {
    const s = suggestPlan({ kind: "repay", position: pos, params, triggerIcr: E("1.25"), targetIcr: E("1.35") });
    expect(s.amount > 0n).toBe(true);
    expect(s.icrAfterAtTrigger! >= E("1.35")).toBe(true);
    expect(s.reachesTarget).toBe(true);
    // target 200% would need far more than debt - 2,000 = 300 MUSD
    const big = suggestPlan({ kind: "repay", position: pos, params, triggerIcr: E("1.25"), targetIcr: E("2") });
    expect(big.reachesTarget).toBe(false);
    expect(big.amount).toBe(pos.debt - params.gasCompensation - params.minNetDebt);
    expect(big.note).toMatch(/1,800 MUSD/);
  });

  it("sizes a BTC top-up plan", () => {
    const s = suggestPlan({ kind: "addColl", position: pos, params, triggerIcr: E("1.25"), targetIcr: E("1.6") });
    expect(s.icrAfterAtTrigger! >= E("1.6")).toBe(true);
    expect(s.reachesTarget).toBe(true);
  });

  it("refuses a target at or below the trigger", () => {
    expect(suggestPlan({ kind: "repay", position: pos, params, triggerIcr: E("1.3"), targetIcr: E("1.3") }).amount).toBe(0n);
  });
});

describe("guard plan checks", () => {
  const ctx = { nowSec: NOW, active: true, position: pos, price: PRICE, params, walletBalance: E(500), reserve: 0n };
  const ok: PlanInput = { kind: "repay", amount: E(150), keeperTip: E(1), triggerIcr: E("1.25"), deadline: NOW + 86_400n };
  const ids = (i: PlanInput, c = ctx) => checkPlan(i, c).filter((x) => x.level === "block").map((x) => x.id);

  it("accepts a valid plan", () => {
    expect(ids(ok)).toEqual([]);
  });
  it("mirrors the contract's limits", () => {
    expect(ids({ ...ok, amount: 0n })).toContain("amount");
    expect(ids({ ...ok, triggerIcr: MIN_TRIGGER_ICR - 1n })).toContain("trigger-low");
    expect(ids({ ...ok, triggerIcr: 5n * WAD })).toContain("trigger-high");
    expect(ids({ ...ok, keeperTip: E(16) })).toContain("tip");
    expect(ids({ ...ok, deadline: NOW })).toContain("deadline");
    expect(ids(ok, { ...ctx, active: false, position: null })).toContain("no-trove");
  });
  it("blocks a repayment that breaks minimum net debt", () => {
    expect(ids({ ...ok, amount: E(301) })).toContain("min-net-debt");
  });
  it("warns when a rescue is small or could not save a trove that already gapped under 110%", () => {
    const warns = checkPlan({ ...ok, amount: E(1), keeperTip: 0n }, ctx).filter((c) => c.level === "warn").map((c) => c.id);
    expect(warns).toEqual(expect.arrayContaining(["small", "late"]));
    const big = checkPlan({ ...ok, amount: E(250) }, ctx).filter((c) => c.level === "warn").map((c) => c.id);
    expect(big).not.toContain("late");
  });
  it("counts the existing reserve before asking the wallet", () => {
    expect(ids(ok, { ...ctx, walletBalance: 0n })).toContain("balance");
    expect(ids(ok, { ...ctx, walletBalance: 0n, reserve: E(151) })).toEqual([]);
  });
  it("warns when the trove is already below the trigger", () => {
    const w = checkPlan({ ...ok, triggerIcr: E("1.4") }, ctx).find((c) => c.id === "fires-now");
    expect(w?.level).toBe("warn");
  });
});

describe("guard EIP-712 payloads", () => {
  const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const bos = { name: "BorrowerOperationsSignatures", version: "1", chainId: 31611, verifyingContract: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e" as const };

  it("hashes exactly like BorrowerOperationsSignatures._verifySignature", async () => {
    const m = { amount: E(100), borrower: acct.address, nonce: 3n, deadline: NOW };
    const td = authorizationTypedData("repay", bos, m);
    const digest = hashTypedData(td);
    // Reimplement the contract: keccak256(abi.encodePacked(typeHash, abi.encode(amount, borrower), nonce, deadline))
    const typeHash = keccak256(toHex("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)"));
    const structHash = keccak256(encodePacked(["bytes32", "bytes", "uint256", "uint256"], [typeHash, encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [m.amount, m.borrower]), m.nonce, m.deadline]));
    const domainSep = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")), keccak256(toHex(bos.name)), keccak256(toHex(bos.version)), 31611n, bos.verifyingContract],
      ),
    );
    expect(digest).toBe(keccak256(encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSep, structHash])));
    const sig = await acct.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature: sig })).toBe(acct.address);
  });

  it("uses the AddColl field name the contract hashes (assetAmount)", () => {
    const td = authorizationTypedData("addColl", bos, { amount: E("0.01"), borrower: acct.address, nonce: 0n, deadline: NOW });
    expect(td.primaryType).toBe("AddColl");
    expect(td.message).toHaveProperty("assetAmount", E("0.01"));
  });

  it("builds a standard EIP-2612 permit", () => {
    const td = permitTypedData({ name: "Mezo USD", version: "1", chainId: 31611, verifyingContract: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" }, { owner: acct.address, spender: acct.address, value: 1n, nonce: 0n, deadline: NOW });
    expect(td.types.Permit.map((f) => f.name)).toEqual(["owner", "spender", "value", "nonce", "deadline"]);
  });
});

describe("guard helpers", () => {
  it("maps contract enums", () => {
    expect(kindFromId(1)).toBe("repay");
    expect(kindFromId(2)).toBe("addColl");
    expect(kindFromId(0)).toBeNull();
    expect(GUARD_STATUSES.map((_, i) => statusFromId(i))).toEqual([...GUARD_STATUSES]);
    expect(statusFromId(99)).toBe("none");
    for (const s of GUARD_STATUSES) expect(STATUS_COPY[s].label.length).toBeGreaterThan(0);
  });

  it("computes the post-rescue NICR (interest is repaid before principal)", () => {
    expect(nicrAfterRescue("repay", E(50), E(1), E(1000), E(80))).toBe((E(1) * 10n ** 20n) / E(1000));
    expect(nicrAfterRescue("repay", E(100), E(1), E(1000), E(80))).toBe((E(1) * 10n ** 20n) / E(980));
    expect(nicrAfterRescue("addColl", E(1), E(1), E(1000), 0n)).toBe((E(2) * 10n ** 20n) / E(1000));
  });

  it("explains contract errors in plain English", () => {
    expect(explainGuardError({ data: { errorName: "TriggerNotReached" } })).toMatch(/still above the trigger/);
    expect(explainGuardError({ shortMessage: "x", cause: { data: { errorName: "StaleAuthorization" } } })).toMatch(/sign the plan again/i);
    expect(explainGuardError(new Error("User rejected the request."))).toMatch(/cancelled/);
    expect(explainGuardError(new Error("execution reverted: BorrowerOps: Trove's net debt must be greater than minimum"))).toMatch(/1,800/);
  });
});
