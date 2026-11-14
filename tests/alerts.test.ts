import { describe, expect, it } from "vitest";
import { evaluateRule, inQuietHours, type AlertRuleInput, type Observation } from "@/lib/alerts/evaluate";

const WAD = 10n ** 18n;
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const obs = (over: Partial<Observation> = {}): Observation => ({
  ok: true,
  active: true,
  hf: (141n * WAD) / 100n,
  price: 79_454n * WAD,
  debt: 2302n * WAD,
  principal: 2302n * WAD,
  rateBps: 100,
  blockTimeMs: NOW,
  recoveryMode: false,
  ...over,
});
const rule = (over: Partial<AlertRuleInput>): AlertRuleInput => ({
  kind: "enters_warning",
  threshold: 1.5,
  frequency: "once_per_day",
  quietStart: null,
  quietEnd: null,
  tzOffsetMin: 0,
  lastTriggeredAt: null,
  baseline: {},
  ...over,
});

describe("threshold alerts", () => {
  it("fires on entering the warning zone, then respects the frequency while it persists", () => {
    const first = evaluateRule(rule({}), obs(), NOW);
    expect(first.fire).toBe(true);
    expect(first.severity).toBe("warning");
    const again = evaluateRule(rule({ baseline: first.baseline, lastTriggeredAt: NOW }), obs(), NOW + 60_000);
    expect(again.fire).toBe(false);
    const nextDay = evaluateRule(rule({ baseline: first.baseline, lastTriggeredAt: NOW }), obs(), NOW + 86_400_001);
    expect(nextDay.fire).toBe(true);
  });
  it("does not fire above the threshold; critical has critical severity", () => {
    expect(evaluateRule(rule({}), obs({ hf: 2n * WAD }), NOW).fire).toBe(false);
    const c = evaluateRule(rule({ kind: "enters_critical", threshold: 1.2 }), obs({ hf: (115n * WAD) / 100n }), NOW);
    expect(c.fire && c.severity === "critical").toBe(true);
  });
  it("re-arms after the position recovers", () => {
    const fired = evaluateRule(rule({}), obs(), NOW);
    const recovered = evaluateRule(rule({ baseline: fired.baseline, lastTriggeredAt: NOW }), obs({ hf: 2n * WAD }), NOW + 1000);
    expect(recovered.holds).toBe(false);
    const fallsAgain = evaluateRule(rule({ baseline: recovered.baseline, lastTriggeredAt: NOW }), obs(), NOW + 2000);
    expect(fallsAgain.fire).toBe(true); // transition fires even inside the cooldown
  });
});

describe("delta alerts", () => {
  it("health factor drop", () => {
    const base = { hf: (16n * WAD / 10n).toString() };
    expect(evaluateRule(rule({ kind: "hf_drop", threshold: 0.1, baseline: base }), obs({ hf: (155n * WAD) / 100n }), NOW).fire).toBe(false);
    const r = evaluateRule(rule({ kind: "hf_drop", threshold: 0.1, baseline: base }), obs({ hf: (149n * WAD) / 100n }), NOW);
    expect(r.fire).toBe(true);
    expect(r.baseline.hf).toBe(((149n * WAD) / 100n).toString());
  });
  it("collateral price drop from the recent high", () => {
    const b = { price: (80_000n * WAD).toString() };
    expect(evaluateRule(rule({ kind: "price_drop", threshold: 5, baseline: b }), obs({ price: 77_000n * WAD }), NOW).fire).toBe(false);
    const r = evaluateRule(rule({ kind: "price_drop", threshold: 5, baseline: b }), obs({ price: 75_000n * WAD }), NOW);
    expect(r.fire).toBe(true);
    expect(r.body).toMatch(/6\.3%/); // 6.25% rounded half-up
    // new highs move the reference up
    expect(evaluateRule(rule({ kind: "price_drop", threshold: 5, baseline: b }), obs({ price: 90_000n * WAD }), NOW).baseline.price).toBe((90_000n * WAD).toString());
  });
  it("debt increase beyond expected interest (e.g. redistribution)", () => {
    const day = 86_400_000;
    const b = { debt: (2302n * WAD).toString(), observedAt: NOW - day };
    // one day of 1% interest on 2302 ≈ 0.063 MUSD → not unexpected
    expect(evaluateRule(rule({ kind: "debt_increase", threshold: 1, baseline: b }), obs({ debt: 2302n * WAD + 63n * 10n ** 15n }), NOW).fire).toBe(false);
    const jump = evaluateRule(rule({ kind: "debt_increase", threshold: 1, baseline: b }), obs({ debt: 2350n * WAD }), NOW);
    expect(jump.fire).toBe(true);
  });
});

describe("system and data-health alerts", () => {
  it("protocol unavailable / stale data", () => {
    expect(evaluateRule(rule({ kind: "data_stale", threshold: 10 }), obs({ ok: false, error: "timeout" }), NOW).fire).toBe(true);
    expect(evaluateRule(rule({ kind: "data_stale", threshold: 10 }), obs({ blockTimeMs: NOW - 11 * 60_000 }), NOW).fire).toBe(true);
    expect(evaluateRule(rule({ kind: "data_stale", threshold: 10 }), obs(), NOW).fire).toBe(false);
  });
  it("recovery mode entry", () => {
    expect(evaluateRule(rule({ kind: "recovery_mode" }), obs({ recoveryMode: true }), NOW).fire).toBe(true);
    expect(evaluateRule(rule({ kind: "recovery_mode" }), obs(), NOW).fire).toBe(false);
  });
  it("an unreadable position never fires position alerts (no fabricated values)", () => {
    expect(evaluateRule(rule({}), obs({ ok: false }), NOW).fire).toBe(false);
  });
});

describe("quiet hours", () => {
  it("wraps midnight and honours the timezone offset", () => {
    expect(inQuietHours(NOW, 22, 7, 0)).toBe(false); // 12:00 UTC
    expect(inQuietHours(NOW, 11, 13, 0)).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 9, 26, 23), 22, 7, 0)).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 9, 26, 3), 22, 7, 0)).toBe(true);
    expect(inQuietHours(NOW, 17, 18, 330)).toBe(true); // 12:00 UTC = 17:30 IST
  });
  it("alerts during quiet hours are still recorded but marked quiet", () => {
    const r = evaluateRule(rule({ quietStart: 11, quietEnd: 13 }), obs(), NOW);
    expect(r.fire).toBe(true);
    expect(r.quiet).toBe(true);
  });
});
