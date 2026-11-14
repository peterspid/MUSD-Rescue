import { describe, expect, it } from "vitest";
import {
  WAD,
  MUSD_SOURCE_DEFAULTS as P,
  positionFromEntire,
  simulateAdjustment,
  repayToReachICR,
  collToReachICR,
  collAfterRepayToReachICR,
  targetICRFromHF,
  compareRescueOptions,
  computeCR,
  computeNominalCR,
  applyBpsChange,
  type SimulationContext,
} from "@/lib/risk";

const w = (n: string) => {
  const [i, f = ""] = n.split(".");
  return BigInt(i) * WAD + BigInt(f.padEnd(18, "0"));
};
const PRICE = w("79454.82979");
const SYSTEM = { totalColl: w("15418.6"), totalDebt: w("429243011") }; // TCR ≈ 285%
const deployer = positionFromEntire(w("0.045"), w("2302.1"), w("0.0012"), P);

function ctx(over: Partial<SimulationContext> = {}): SimulationContext {
  return { position: deployer, price: PRICE, params: P, system: SYSTEM, active: true, wallet: { musd: w("1310"), btc: w("0.0017") }, ...over };
}

describe("debt repayment simulation", () => {
  it("repays interest first, then principal, and improves ICR", () => {
    const r = simulateAdjustment(ctx(), { repay: w("5") });
    expect(r.ok).toBe(true);
    expect(r.interestPaid).toBe(w("0.0012"));
    expect(r.principalPaid).toBe(w("4.9988"));
    expect(r.newPosition!.debt).toBe(deployer.debt - w("5"));
    expect(r.newPosition!.interest).toBe(0n);
    expect(r.after!.icr! > r.before!.icr!).toBe(true);
    // NICR for SortedTroves re-insertion uses principal only
    expect(r.newNICR).toBe(computeNominalCR(deployer.coll, r.newPosition!.principal));
  });
  it("enforces the 1,800 MUSD minNetDebt cap (can't repay below it without closing)", () => {
    const max = r0().maxRepay;
    expect(max).toBe(deployer.debt - w("2000"));
    expect(simulateAdjustment(ctx(), { repay: max }).ok).toBe(true);
    const over = simulateAdjustment(ctx(), { repay: max + 1n });
    expect(over.ok).toBe(false);
    expect(over.closeTroveRequired).toBe(true);
    expect(over.checks.map((c) => c.id)).toContain("min-net-debt");
  });
  it("rejects repaying more than the repayable debt", () => {
    const r = simulateAdjustment(ctx({ wallet: { musd: w("1000000") } }), { repay: deployer.debt });
    expect(r.ok).toBe(false);
    expect(r.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["exceeds-debt", "min-net-debt"]));
  });
  it("blocks when the wallet holds too little MUSD, warns when the balance is unknown", () => {
    const poor = simulateAdjustment(ctx({ wallet: { musd: w("1"), btc: w("1") } }), { repay: w("5") });
    expect(poor.ok).toBe(false);
    expect(poor.checks.find((c) => c.id === "musd-balance")?.level).toBe("block");
    const unknown = simulateAdjustment(ctx({ wallet: undefined }), { repay: w("5") });
    expect(unknown.ok).toBe(true);
    expect(unknown.checks.find((c) => c.id === "musd-balance-unknown")?.level).toBe("warn");
  });
  it("in Normal Mode a repayment that leaves ICR < 110% reverts (contract requires newICR ≥ MCR)", () => {
    const crashed = applyBpsChange(PRICE, -4000); // ICR ≈ 93%
    const small = simulateAdjustment(ctx({ price: crashed }), { repay: w("5") });
    expect(small.ok).toBe(false);
    expect(small.checks.map((c) => c.id)).toContain("icr-below-mcr");
  });
  function r0() {
    return simulateAdjustment(ctx(), { repay: w("1") });
  }
});

describe("collateral addition simulation", () => {
  it("adds BTC and raises ICR proportionally", () => {
    const r = simulateAdjustment(ctx(), { addColl: w("0.00001") });
    expect(r.ok).toBe(true);
    expect(r.newPosition!.coll).toBe(w("0.04501"));
    expect(r.after!.icr).toBe(computeCR(w("0.04501"), deployer.debt, PRICE));
    expect(r.newTCR! > computeCR(SYSTEM.totalColl, SYSTEM.totalDebt, PRICE)!).toBe(true);
  });
  it("checks the BTC balance and the gas reserve", () => {
    expect(simulateAdjustment(ctx(), { addColl: w("0.01") }).checks.map((c) => c.id)).toContain("btc-balance");
    const tight = simulateAdjustment(ctx({ wallet: { btc: w("0.0010000001") } }), { addColl: w("0.001") });
    expect(tight.ok).toBe(true);
    expect(tight.checks.map((c) => c.id)).toContain("btc-gas-reserve");
  });
  it("combined repay + collateral (adjustTrove) is simulated as one change", () => {
    const r = simulateAdjustment(ctx(), { repay: w("10"), addColl: w("0.0001") });
    expect(r.ok).toBe(true);
    expect(r.newPosition!.coll).toBe(deployer.coll + w("0.0001"));
    expect(r.newPosition!.debt).toBe(deployer.debt - w("10"));
  });
  it("rejects empty, negative and inactive-trove adjustments", () => {
    expect(simulateAdjustment(ctx(), {}).checks[0].id).toBe("zero");
    expect(simulateAdjustment(ctx(), { repay: -1n }).checks[0].id).toBe("negative");
    expect(simulateAdjustment(ctx({ active: false }), { repay: w("1") }).checks[0].id).toBe("inactive");
    expect(simulateAdjustment(ctx(), { repay: w("1"), borrow: w("1") }).checks[0].id).toBe("both-directions");
  });
});

describe("recovery mode rules in the simulator", () => {
  const rmSystem = { totalColl: w("100"), totalDebt: w("6000000") }; // TCR < 150% at 79k
  it("pure repayments are allowed even when ICR stays below MCR", () => {
    const crashed = applyBpsChange(PRICE, -4000);
    const r = simulateAdjustment(ctx({ price: crashed, system: rmSystem }), { repay: w("5") });
    expect(r.recoveryMode).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.id)).toContain("still-liquidatable");
  });
  it("borrowing fee is waived and new debt needs ICR ≥ 150% and an improving ICR", () => {
    const r = simulateAdjustment(ctx({ system: rmSystem, maxBorrowingCapacity: w("100000") }), { borrow: w("10") });
    expect(r.borrowingFee).toBe(0n);
    expect(r.checks.map((c) => c.id)).toContain("recovery-borrow");
  });
  it("in Normal Mode borrowing charges the 0.1% fee", () => {
    const r = simulateAdjustment(ctx({ maxBorrowingCapacity: w("100000") }), { borrow: w("100") });
    expect(r.borrowingFee).toBe(w("0.1"));
    expect(r.newPosition!.debt).toBe(deployer.debt + w("100.1"));
  });
  it("max borrowing capacity is enforced", () => {
    const r = simulateAdjustment(ctx({ maxBorrowingCapacity: deployer.debt }), { borrow: w("1") });
    expect(r.checks.map((c) => c.id)).toContain("borrow-capacity");
  });
});

describe("missing / stale price", () => {
  it("no price → every action blocked, nothing computed", () => {
    const r = simulateAdjustment(ctx({ price: null }), { repay: w("5") });
    expect(r.ok).toBe(false);
    expect(r.checks[0].id).toBe("no-price");
    expect(r.after).toBeNull();
  });
});

describe("target health factor solvers", () => {
  const target = targetICRFromHF(w("1.5"), P.mcr); // 165%
  it("HF 1.5 at MCR 110% is ICR 165%", () => {
    expect(target).toBe(w("1.65"));
  });
  it("repay solver reaches the target exactly (and the cap is reported)", () => {
    const s = repayToReachICR(deployer, PRICE, target, P);
    expect(s.alreadyMet).toBe(false);
    expect(computeCR(deployer.coll, deployer.debt - s.required, PRICE)! >= target).toBe(true);
    expect(computeCR(deployer.coll, deployer.debt - s.required + w("0.01"), PRICE)! < target).toBe(true);
    expect(s.feasible).toBe(s.required <= deployer.debt - w("2000"));
  });
  it("repay solver flags infeasible targets because of minNetDebt", () => {
    const s = repayToReachICR(deployer, PRICE, w("3"), P);
    expect(s.feasible).toBe(false);
    expect(s.reason).toBe("min-net-debt");
    expect(s.capped).toBe(deployer.debt - w("2000"));
  });
  it("collateral solver reaches the target with the minimum deposit", () => {
    const s = collToReachICR(deployer, PRICE, target);
    expect(computeCR(deployer.coll + s.required, deployer.debt, PRICE)! >= target).toBe(true);
    expect(computeCR(deployer.coll + s.required - 1n, deployer.debt, PRICE)! < target).toBe(true);
  });
  it("mixed solver: after a partial repay, less BTC is needed", () => {
    const only = collToReachICR(deployer, PRICE, target).required;
    const mix = collAfterRepayToReachICR(deployer, PRICE, target, w("100"), P);
    expect(mix.required < only).toBe(true);
    expect(mix.repay).toBe(w("100"));
  });
  it("already-healthy targets need nothing", () => {
    expect(repayToReachICR(deployer, PRICE, w("1.2"), P).alreadyMet).toBe(true);
    expect(collToReachICR(deployer, PRICE, w("1.2")).required).toBe(0n);
  });
  it("compares three options without picking one", () => {
    const opts = compareRescueOptions({ position: deployer, price: PRICE, targetICR: target, threshold: P.mcr, params: P, walletMusd: w("1310") });
    expect(opts.map((o) => o.id)).toEqual(["repay", "collateral", "combined"]);
    for (const o of opts) {
      if (o.feasible) expect(o.icrAfter! >= target).toBe(true);
      expect(o.tradeoff.length).toBeGreaterThan(20);
    }
  });
});
