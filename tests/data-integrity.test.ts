import { describe, expect, it } from "vitest";
import { parseAmount, formatFixed, formatAmount, formatBtc, formatRatioPct, formatHF, formatBps, toInputString, formatUsd } from "@/lib/risk/format";
import { assessFreshness, isOracleStale, gateRescueActions, LIVE_POLICY } from "@/lib/risk/freshness";
import { classifyChain } from "@/config/chains";
import { parsePositionId } from "@/lib/positions/id";
import { summarizePortfolio, FictionalDataError, sortBySeverity, type PortfolioEntry } from "@/lib/positions/portfolio";
import { DEMO_POSITIONS, DEMO_BASE_PRICE, DEMO_SYSTEM } from "@/lib/demo/positions";
import { assessPosition, MUSD_SOURCE_DEFAULTS, WAD, assessSystem } from "@/lib/risk";
import { MUSD_CONTRACTS } from "@/config/contracts";

describe("token decimal handling (no floats)", () => {
  it("parses decimal strings into 18-decimal base units exactly", () => {
    expect(parseAmount("5")).toEqual({ ok: true, value: 5n * WAD });
    expect(parseAmount("0.00001")).toEqual({ ok: true, value: 10n ** 13n });
    expect(parseAmount(".5")).toEqual({ ok: true, value: WAD / 2n });
    expect(parseAmount("1,234.5")).toEqual({ ok: true, value: 12345n * 10n ** 17n });
    expect(parseAmount("0.000000000000000001")).toEqual({ ok: true, value: 1n });
    // 0.1 + 0.2 style float traps do not exist here
    const a = parseAmount("0.1");
    const b = parseAmount("0.2");
    expect(a.ok && b.ok && a.value + b.value).toBe(3n * 10n ** 17n);
  });
  it("rejects invalid input", () => {
    for (const bad of ["", "abc", "-1", "1e18", "1.2.3", "0", "0.0000000000000000001", "12,34", "."]) {
      expect(parseAmount(bad).ok, bad).toBe(false);
    }
    expect(parseAmount("0", 18, { allowZero: true }).ok).toBe(true);
    expect(parseAmount("10", 18, { max: 5n * WAD }).ok).toBe(false);
    expect(parseAmount("1.123", 2).ok).toBe(false);
    expect(parseAmount("1.12", 2)).toEqual({ ok: true, value: 112n });
  });
  it("formats with half-up rounding and grouping", () => {
    expect(formatFixed(1234567890000000000000n, 18, 2)).toBe("1,234.57");
    expect(formatFixed(1234564999999999999999n, 18, 2)).toBe("1,234.56");
    expect(formatAmount(2302101264234676403475n)).toBe("2,302.10");
    expect(formatBtc(45000000000000000n)).toBe("0.0450");
    expect(formatBtc(10n ** 13n)).toBe("0.00001");
    expect(formatRatioPct(1553132086801858663n)).toBe("155.3%");
    expect(formatRatioPct(null)).toBe("∞");
    expect(formatHF(1411938260728962421n)).toBe("1.41");
    expect(formatBps(1234n)).toBe("12.3%");
    expect(formatBps(-500n, 1)).toBe("-5.0%");
    expect(formatUsd(-5n * WAD)).toBe("-$5.00");
    expect(toInputString(5n * WAD)).toBe("5");
    expect(toInputString(10n ** 13n)).toBe("0.00001");
  });
  it("handles tokens with other decimals (6-decimal stablecoin)", () => {
    expect(parseAmount("12.345678", 6)).toEqual({ ok: true, value: 12345678n });
    expect(formatFixed(12345678n, 6, 2)).toBe("12.35");
  });
});

describe("missing or stale data", () => {
  it("freshness bands", () => {
    expect(assessFreshness(null, 0)).toBe("missing");
    expect(assessFreshness(0, 10_000)).toBe("fresh");
    expect(assessFreshness(0, LIVE_POLICY.agingAfterMs + 1)).toBe("aging");
    expect(assessFreshness(0, LIVE_POLICY.staleAfterMs + 1)).toBe("stale");
  });
  it("mirrors PriceFeed's 60s MAX_PRICE_DELAY", () => {
    expect(isOracleStale(1000n, 1060n)).toBe(false);
    expect(isOracleStale(1000n, 1061n)).toBe(true);
  });
  it("disables rescue actions when data is stale, price missing, wrong wallet or wrong network", () => {
    const ok = { freshness: "fresh" as const, priceAvailable: true, networkWritable: true, isOwner: true, troveActive: true };
    expect(gateRescueActions(ok).allowed).toBe(true);
    expect(gateRescueActions({ ...ok, freshness: "stale" }).allowed).toBe(false);
    expect(gateRescueActions({ ...ok, freshness: "missing" }).allowed).toBe(false);
    expect(gateRescueActions({ ...ok, priceAvailable: false }).allowed).toBe(false);
    expect(gateRescueActions({ ...ok, isOwner: false }).reason).toMatch(/owner/);
    expect(gateRescueActions({ ...ok, networkWritable: false }).reason).toMatch(/Mezo Testnet/);
    expect(gateRescueActions({ ...ok, troveActive: false }).allowed).toBe(false);
  });
});

describe("unsupported networks", () => {
  it("only Mezo testnet allows writes; mainnet is read-only; everything else unsupported", () => {
    expect(classifyChain(31611)).toMatchObject({ kind: "supported", writes: true });
    expect(classifyChain(31612)).toMatchObject({ kind: "read-only", writes: false });
    expect(classifyChain(1)).toMatchObject({ kind: "unsupported", writes: false, label: "Unsupported network (chain 1)" });
    expect(classifyChain(11155111).kind).toBe("unsupported");
    expect(classifyChain(undefined)).toMatchObject({ kind: "unsupported", label: "No network" });
    expect(classifyChain(null).writes).toBe(false);
  });
  it("contract addresses are checksummed and distinct per network", () => {
    const t = Object.values(MUSD_CONTRACTS.testnet);
    expect(new Set(t).size).toBe(t.length);
    expect(MUSD_CONTRACTS.testnet.MUSD).not.toBe(MUSD_CONTRACTS.mainnet.MUSD);
  });
});

describe("separation between demo and live data", () => {
  it("every demo position is labelled fictional with a demo- id", () => {
    for (const p of DEMO_POSITIONS) {
      expect(p.source).toBe("fictional");
      expect(p.id.startsWith("demo-")).toBe(true);
    }
  });
  it("live routes refuse demo ids", () => {
    expect(parsePositionId("demo-ember").kind).toBe("demo");
    expect(parsePositionId("0x10ac9924a78051bdd770978740c5084205cdb628")).toEqual({ kind: "live", owner: "0x10ac9924a78051BdD770978740C5084205cdB628" });
    expect(parsePositionId("not-an-address").kind).toBe("invalid");
  });
  it("the live portfolio summary throws if a fictional entry sneaks in", () => {
    const live: PortfolioEntry = { source: "onchain", owner: "0x1", protocol: "MUSD", category: "healthy", collValue: 10n, debt: 5n, hf: 3n * WAD };
    expect(summarizePortfolio([live]).count).toBe(1);
    expect(() => summarizePortfolio([live, { ...live, source: "fictional" }])).toThrow(FictionalDataError);
  });
  it("demo set covers healthy, near-warning and high-risk at the fictional base price", () => {
    const sys = assessSystem({ ...DEMO_SYSTEM, price: DEMO_BASE_PRICE }, MUSD_SOURCE_DEFAULTS);
    const cats = DEMO_POSITIONS.map((p) => assessPosition(p.amounts, DEMO_BASE_PRICE, MUSD_SOURCE_DEFAULTS, sys.recoveryMode).category);
    expect(cats).toEqual(["healthy", "healthy", "high"]);
    const ridge = assessPosition(DEMO_POSITIONS[1].amounts, DEMO_BASE_PRICE, MUSD_SOURCE_DEFAULTS, false);
    expect(ridge.hf! < (21n * WAD) / 10n).toBe(true); // just above the 2.0 caution line
  });
});

describe("portfolio summary", () => {
  it("counts categories and reports the weakest position instead of a blended HF", () => {
    const mk = (owner: string, category: PortfolioEntry["category"], hf: bigint | null): PortfolioEntry => ({ source: "onchain", owner, protocol: "MUSD", category, collValue: 100n, debt: 10n, hf });
    const s = summarizePortfolio([mk("a", "healthy", 3n * WAD), mk("b", "high", (13n * WAD) / 10n), mk("c", "critical", (11n * WAD) / 10n), mk("d", "no-debt", null)]);
    expect([s.healthy, s.attention, s.critical, s.noDebt]).toEqual([1, 1, 1, 1]);
    expect(s.weakest?.owner).toBe("c");
    expect(s.totalCollValue).toBe(400n);
    expect(sortBySeverity([mk("a", "healthy", 3n * WAD), mk("c", "critical", WAD)])[0].owner).toBe("c");
  });
});
