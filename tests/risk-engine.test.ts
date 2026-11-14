import { describe, expect, it } from "vitest";
import {
  WAD,
  BPS,
  MUSD_SOURCE_DEFAULTS as P,
  LIQUITY_V1_STYLE,
  computeCR,
  computeNominalCR,
  calculateInterestOwed,
  applyBpsChange,
  ceilDiv,
  entirePosition,
  positionFromEntire,
  projectInterest,
  interestPerDay,
  liquidationThreshold,
  healthFactor,
  liquidationPrice,
  priceDropToLiquidationBps,
  classifyRisk,
  validateThresholds,
  DEFAULT_THRESHOLDS,
  assessPosition,
  assessSystem,
  maxRepayWithoutClosing,
  recommend,
  type TroveRaw,
} from "@/lib/risk";

const w = (n: string) => {
  const [i, f = ""] = n.split(".");
  return BigInt(i) * WAD + BigInt(f.padEnd(18, "0"));
};

// The owner's real testnet trove at the time of writing (block 16372538): 0.045 BTC, 2302.1 MUSD principal.
const PRICE = w("79454.82979");
const deployer = positionFromEntire(w("0.045"), w("2302.1"), w("0.001264234676403475"), P);

describe("contract math mirrors LiquityMath / InterestRateMath", () => {
  it("computeCR is coll*price/debt with floor division and null (∞) for zero debt", () => {
    expect(computeCR(w("1"), w("50000"), w("100000"))).toBe(2n * WAD);
    expect(computeCR(7n, 3n, 1n)).toBe(2n); // floor
    expect(computeCR(w("1"), 0n, w("100000"))).toBeNull();
  });
  it("matches the live getCurrentICR for the deployer trove", () => {
    // TroveManager.getCurrentICR returned 1.553132086801858663 at this price.
    expect(computeCR(deployer.coll, deployer.debt, PRICE)).toBe(1553132086801858663n);
  });
  it("NICR uses the 1e20 precision and principal only", () => {
    expect(computeNominalCR(w("1"), w("100"))).toBe(10n ** 18n);
    expect(computeNominalCR(w("1"), 0n)).toBeNull();
  });
  it("simple interest: 1% on 10,000 MUSD for one year is 100 MUSD (no compounding)", () => {
    expect(calculateInterestOwed(w("10000"), 100, 0n, 31_556_952n)).toBe(w("100"));
    expect(calculateInterestOwed(w("10000"), 100, 0n, 2n * 31_556_952n)).toBe(w("200"));
    expect(calculateInterestOwed(w("10000"), 100, 100n, 50n)).toBe(0n);
  });
  it("ceilDiv rounds up and rejects bad input", () => {
    expect(ceilDiv(10n, 3n)).toBe(4n);
    expect(ceilDiv(9n, 3n)).toBe(3n);
    expect(ceilDiv(0n, 3n)).toBe(0n);
    expect(() => ceilDiv(1n, 0n)).toThrow();
  });
});

describe("interest accrual and entire debt", () => {
  const raw: TroveRaw = {
    status: 1,
    coll: w("1"),
    principal: w("10000"),
    interestOwed: w("5"),
    interestRateBps: 100,
    lastInterestUpdateTime: 1_000n,
    maxBorrowingCapacity: w("70000"),
    pendingColl: w("0.01"),
    pendingPrincipal: w("50"),
    pendingInterest: w("1"),
  };
  it("adds accrued simple interest on stored principal plus pending redistribution rewards", () => {
    const p = entirePosition(raw, 1_000n + 31_556_952n / 2n, P);
    expect(p.coll).toBe(w("1.01"));
    expect(p.principal).toBe(w("10050"));
    // 5 stored + 50 accrued (half a year at 1% on 10,000) + 1 pending
    expect(p.interest).toBe(w("56"));
    expect(p.debt).toBe(w("10106"));
    expect(p.netDebt).toBe(w("9906"));
  });
  it("no time elapsed → no new interest", () => {
    expect(entirePosition(raw, 1_000n, P).interest).toBe(w("6"));
  });
  it("projects interest forward and reports per-day accrual", () => {
    const p = positionFromEntire(w("1"), w("36524.25"), 0n, P);
    expect(interestPerDay(p.principal, 100)).toBe(w("1")); // 36,524.25 × 1% / 365.2425
    expect(projectInterest(p, 100, 86_400n, P).debt).toBe(w("36525.25"));
  });
});

describe("health factor & collateral thresholds", () => {
  it("HF = ICR / MCR; 1.00 is the liquidation line", () => {
    expect(healthFactor((110n * WAD) / 100n, P.mcr)).toBe(WAD);
    expect(healthFactor(2n * WAD, P.mcr)).toBe((2n * WAD * WAD) / P.mcr);
    expect(healthFactor(null, P.mcr)).toBeNull();
  });
  it("liquidation price = debt × MCR / coll (rounded up)", () => {
    // 1 BTC, 50,000 debt → liquidatable below 55,000
    expect(liquidationPrice(w("1"), w("50000"), P.mcr)).toBe(w("55000"));
    expect(liquidationPrice(w("1"), 0n, P.mcr)).toBeNull();
    const liq = liquidationPrice(deployer.coll, deployer.debt, P.mcr)!;
    expect(computeCR(deployer.coll, deployer.debt, liq)! >= P.mcr).toBe(true);
    expect(computeCR(deployer.coll, deployer.debt, liq - 1n)! < P.mcr).toBe(true);
  });
  it("distance to liquidation in bps", () => {
    expect(priceDropToLiquidationBps(w("100000"), w("55000"))).toBe(4500n);
    expect(priceDropToLiquidationBps(w("50000"), w("55000"))).toBe(0n);
    expect(priceDropToLiquidationBps(w("1"), null)).toBeNull();
  });
  it("classifies with the spec defaults (2.0 / 1.5 / 1.2) and the 1.0 protocol line", () => {
    const hf = (n: string) => w(n);
    expect(classifyRisk(hf("2.01"))).toBe("healthy");
    expect(classifyRisk(hf("2.0"))).toBe("caution");
    expect(classifyRisk(hf("1.5"))).toBe("caution");
    expect(classifyRisk(hf("1.49"))).toBe("high");
    expect(classifyRisk(hf("1.2"))).toBe("critical");
    expect(classifyRisk(hf("1.0"))).toBe("critical");
    expect(classifyRisk(hf("0.99"))).toBe("liquidatable");
    expect(classifyRisk(null)).toBe("no-debt");
    expect(classifyRisk(undefined)).toBe("unknown");
  });
  it("custom thresholds are validated", () => {
    expect(validateThresholds(DEFAULT_THRESHOLDS)).toBeNull();
    expect(validateThresholds({ ...DEFAULT_THRESHOLDS, criticalAtOrBelow: WAD })).toMatch(/above 1.00/);
    expect(validateThresholds({ ...DEFAULT_THRESHOLDS, cautionFrom: w("1.1") })).toMatch(/caution/i);
    const custom = { healthyAbove: w("3"), cautionFrom: w("2"), criticalAtOrBelow: w("1.3") };
    expect(classifyRisk(w("2.5"), custom)).toBe("caution");
  });
  it("assesses the real deployer trove: ICR ≈ 155.3%, HF ≈ 1.41 → high risk", () => {
    const r = assessPosition(deployer, PRICE, P, false);
    expect(r.icr).toBe(1553132086801858663n);
    expect(r.hf! / 10n ** 16n).toBe(141n);
    expect(r.category).toBe("high");
    expect(r.maxRepayWithoutClosing).toBe(deployer.debt - w("2000"));
    expect(r.closeCost).toBe(deployer.debt - w("200"));
    expect(recommend(r.category, { recoveryMode: false, dropBps: r.dropToLiquidationBps }).title).toBe("Consider a rescue");
  });
});

describe("recovery mode", () => {
  const sys = { totalColl: w("100"), totalDebt: w("6000000") };
  it("TCR < CCR → recovery mode, with the price that triggers it", () => {
    const normal = assessSystem({ ...sys, price: w("100000") }, P);
    expect(normal.tcr).toBe((100n * w("100000")) / 6_000_000n);
    expect(normal.recoveryMode).toBe(false);
    expect(normal.recoveryPrice).toBe(w("90000"));
    expect(normal.dropToRecoveryBps).toBe(1000n);
    const rm = assessSystem({ ...sys, price: w("89999") }, P);
    expect(rm.recoveryMode).toBe(true);
    expect(rm.dropToRecoveryBps).toBe(0n);
  });
  it("MUSD: liquidation threshold stays at MCR (110%) even in recovery mode", () => {
    expect(liquidationThreshold(P, true)).toBe(P.mcr);
    const p = positionFromEntire(w("1"), w("70000"), 0n, P); // ICR 130% at 91k
    const r = assessPosition(p, w("91000"), P, true);
    expect(r.category).not.toBe("liquidatable");
  });
  it("a Liquity-v1-style adapter would liquidate below CCR in recovery mode (engine is protocol-configurable)", () => {
    expect(liquidationThreshold(LIQUITY_V1_STYLE, true)).toBe(LIQUITY_V1_STYLE.ccr);
    const p = positionFromEntire(w("1"), w("70000"), 0n, LIQUITY_V1_STYLE);
    expect(assessPosition(p, w("91000"), LIQUITY_V1_STYLE, true).category).toBe("liquidatable");
  });
});

describe("extreme price moves", () => {
  it("-100% → ICR 0, liquidatable; never negative", () => {
    const price = applyBpsChange(PRICE, -10_000);
    expect(price).toBe(0n);
    const r = assessPosition(deployer, price, P, false);
    expect(r.icr).toBe(0n);
    expect(r.category).toBe("liquidatable");
    expect(r.dropToLiquidationBps).toBe(0n);
    expect(applyBpsChange(PRICE, -20_000)).toBe(0n);
  });
  it("+1000% and absurd prices do not overflow (bigint)", () => {
    const r = assessPosition(deployer, applyBpsChange(PRICE, 100_000), P, false);
    expect(r.category).toBe("healthy");
    const huge = 10n ** 40n * WAD;
    expect(assessPosition(deployer, huge, P, false).icr! > 0n).toBe(true);
  });
  it("scenario presets 5/10/20/30% drops give monotonically falling HF", () => {
    const hfs = [0, -500, -1000, -2000, -3000].map((b) => assessPosition(deployer, applyBpsChange(PRICE, b), P, false).hf!);
    for (let i = 1; i < hfs.length; i++) expect(hfs[i] < hfs[i - 1]).toBe(true);
    // 30% drop takes the real trove below 110%
    expect(assessPosition(deployer, applyBpsChange(PRICE, -3000), P, false).category).toBe("liquidatable");
  });
  it("1 wei of collateral and dust debt are handled", () => {
    const p = positionFromEntire(1n, 1n, 0n, P);
    expect(computeCR(p.coll, p.debt, PRICE)).toBe(PRICE);
  });
});

describe("zero-debt and empty positions", () => {
  it("zero debt = infinite health, no liquidation price, nothing to repay", () => {
    const p = positionFromEntire(w("1"), 0n, 0n, P);
    const r = assessPosition(p, PRICE, P, false);
    expect(r.icr).toBeNull();
    expect(r.hf).toBeNull();
    expect(r.category).toBe("no-debt");
    expect(r.liquidationPrice).toBeNull();
    expect(r.dropToLiquidationBps).toBeNull();
    expect(maxRepayWithoutClosing(p, P)).toBe(0n);
  });
  it("debt with zero collateral is liquidatable at any price", () => {
    const p = positionFromEntire(0n, w("2000"), 0n, P);
    const r = assessPosition(p, PRICE, P, false);
    expect(r.category).toBe("liquidatable");
    expect(r.dropToLiquidationBps).toBe(0n);
  });
});

describe("bps helper", () => {
  it("applies signed basis-point changes", () => {
    expect(applyBpsChange(w("100"), -500)).toBe(w("95"));
    expect(applyBpsChange(w("100"), 2500)).toBe(w("125"));
    expect(BPS).toBe(10_000n);
  });
});
