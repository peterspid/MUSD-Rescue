/**
 * Pure alert evaluation. The scheduler (daily cron), page visits and "Check now" all call this with a fresh
 * observation; it decides whether to notify and returns the new baseline to persist.
 */
import { BPS, WAD, calculateInterestOwed } from "../risk/math";
import { formatAmount, formatBps, formatHF } from "../risk/format";

export type AlertKind = "enters_warning" | "enters_critical" | "hf_drop" | "price_drop" | "debt_increase" | "data_stale" | "recovery_mode";
export type AlertFrequency = "every_check" | "once_per_hour" | "once_per_day";

export const ALERT_KINDS: Record<AlertKind, { label: string; thresholdLabel: string | null; defaultThreshold: number | null; unit: string; describe: (t: number | null) => string }> = {
  enters_warning: { label: "Enters warning zone", thresholdLabel: "Health factor at or below", defaultThreshold: 1.5, unit: "HF", describe: (t) => `Health factor falls to ${t?.toFixed(2)} or lower` },
  enters_critical: { label: "Enters critical zone", thresholdLabel: "Health factor at or below", defaultThreshold: 1.2, unit: "HF", describe: (t) => `Health factor falls to ${t?.toFixed(2)} or lower` },
  hf_drop: { label: "Health factor drops", thresholdLabel: "Drop of at least", defaultThreshold: 0.1, unit: "HF", describe: (t) => `Health factor drops by ${t?.toFixed(2)} or more` },
  price_drop: { label: "BTC oracle price drops", thresholdLabel: "Drop of at least (%)", defaultThreshold: 5, unit: "%", describe: (t) => `Oracle BTC price falls ${t}% from its recent high` },
  debt_increase: { label: "Debt rises unexpectedly", thresholdLabel: "More than (MUSD) beyond accrued interest", defaultThreshold: 1, unit: "MUSD", describe: (t) => `Debt grows by more than ${t} MUSD beyond normal interest` },
  data_stale: { label: "Data unavailable or stale", thresholdLabel: "Older than (minutes)", defaultThreshold: 10, unit: "min", describe: (t) => `Protocol data cannot be read or is older than ${t} min` },
  recovery_mode: { label: "System enters Recovery Mode", thresholdLabel: null, defaultThreshold: null, unit: "", describe: () => "MUSD system TCR drops below 150%" },
};

export const FREQUENCY_MS: Record<AlertFrequency, number> = {
  every_check: 0,
  once_per_hour: 3_600_000,
  once_per_day: 86_400_000,
};

export interface Baseline {
  hf?: string | null; // WAD string, null = no debt
  price?: string; // peak price since last trigger
  debt?: string;
  observedAt?: number;
  holds?: boolean; // whether the level condition held at the previous evaluation
}

export interface AlertRuleInput {
  kind: AlertKind;
  threshold: number | null;
  frequency: AlertFrequency;
  quietStart: number | null;
  quietEnd: number | null;
  tzOffsetMin: number;
  lastTriggeredAt: number | null;
  baseline: Baseline;
}

export interface Observation {
  ok: boolean;
  error?: string;
  active: boolean;
  hf: bigint | null;
  price: bigint;
  debt: bigint;
  principal: bigint;
  rateBps: number;
  /** Chain timestamp of the observation (ms). */
  blockTimeMs: number;
  recoveryMode: boolean;
}

export interface Evaluation {
  fire: boolean;
  holds: boolean;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  quiet: boolean;
  baseline: Baseline;
}

/** Quiet hours [start, end) in the user's local time; wraps midnight (e.g. 22 → 7). */
export function inQuietHours(nowMs: number, start: number | null, end: number | null, tzOffsetMin: number): boolean {
  if (start == null || end == null || start === end) return false;
  const local = new Date(nowMs + tzOffsetMin * 60_000);
  const h = local.getUTCHours();
  return start < end ? h >= start && h < end : h >= start || h < end;
}

function hfWad(n: number): bigint {
  return (BigInt(Math.round(n * 10_000)) * WAD) / 10_000n;
}

export function evaluateRule(rule: AlertRuleInput, obs: Observation, nowMs: number): Evaluation {
  const quiet = inQuietHours(nowMs, rule.quietStart, rule.quietEnd, rule.tzOffsetMin);
  const cooldown = FREQUENCY_MS[rule.frequency];
  const cooledDown = rule.lastTriggeredAt == null || nowMs - rule.lastTriggeredAt >= cooldown;
  const prev = rule.baseline ?? {};
  const t = rule.threshold ?? ALERT_KINDS[rule.kind].defaultThreshold;
  const none = (holds: boolean, baseline: Baseline): Evaluation => ({ fire: false, holds, severity: "info", title: "", body: "", quiet, baseline });

  // Level-triggered: notify on the transition into the condition, then at most once per frequency while it persists.
  const level = (holds: boolean, severity: Evaluation["severity"], title: string, body: string, baseline: Baseline): Evaluation => {
    const transition = holds && !prev.holds;
    const fire = holds && (transition || (cooldown > 0 ? cooledDown : true));
    return { fire, holds, severity, title, body, quiet, baseline: { ...baseline, holds } };
  };

  if (rule.kind === "data_stale") {
    const maxAgeMs = (t ?? 10) * 60_000;
    const stale = !obs.ok || nowMs - obs.blockTimeMs > maxAgeMs;
    return level(stale, "warning", "Protocol data unavailable", obs.ok ? "The latest on-chain data is older than your limit. Rescue actions are disabled until it refreshes." : `MUSD Rescue could not read the protocol: ${obs.error ?? "RPC error"}.`, { ...prev, observedAt: nowMs });
  }
  if (!obs.ok) return none(prev.holds ?? false, prev);

  if (rule.kind === "recovery_mode") {
    return level(obs.recoveryMode, "warning", "MUSD system entered Recovery Mode", "System TCR is below 150%. Collateral withdrawals and closing troves are blocked; new debt needs ICR ≥ 150%. Liquidation still happens only below 110% ICR.", prev);
  }
  if (!obs.active) return none(false, prev);

  if (rule.kind === "enters_warning" || rule.kind === "enters_critical") {
    const limit = hfWad(t ?? 1.5);
    const holds = obs.hf != null && obs.hf <= limit;
    const sev = rule.kind === "enters_critical" ? "critical" : "warning";
    return level(holds, sev, rule.kind === "enters_critical" ? "Position is critical" : "Position entered the warning zone", `Health factor is ${formatHF(obs.hf)} (limit ${t?.toFixed(2)}). Open the rescue simulator to compare repay and add-collateral options.`, { ...prev, hf: obs.hf?.toString() ?? null, observedAt: nowMs });
  }

  if (rule.kind === "hf_drop") {
    const base = prev.hf != null ? BigInt(prev.hf) : null;
    if (base == null || obs.hf == null) return none(false, { ...prev, hf: obs.hf?.toString() ?? null, observedAt: nowMs });
    const drop = base - obs.hf;
    const holds = drop >= hfWad(t ?? 0.1);
    if (holds && cooledDown) {
      return { fire: true, holds, severity: "warning", title: "Health factor dropped", body: `Health factor fell from ${formatHF(base)} to ${formatHF(obs.hf)}.`, quiet, baseline: { ...prev, hf: obs.hf.toString(), observedAt: nowMs } };
    }
    // Track recoveries upward so a later fall is measured from the new high.
    return none(holds, { ...prev, hf: obs.hf > base ? obs.hf.toString() : prev.hf, observedAt: nowMs });
  }

  if (rule.kind === "price_drop") {
    const peak = prev.price ? BigInt(prev.price) : obs.price;
    const newPeak = obs.price > peak ? obs.price : peak;
    const dropBps = newPeak === 0n ? 0n : ((newPeak - obs.price) * BPS) / newPeak;
    const holds = dropBps >= BigInt(Math.round((t ?? 5) * 100));
    if (holds && cooledDown) {
      return { fire: true, holds, severity: "warning", title: "BTC oracle price dropped", body: `The MUSD oracle price is down ${formatBps(dropBps)} from its recent high ($${formatAmount(newPeak)} → $${formatAmount(obs.price)}).`, quiet, baseline: { ...prev, price: obs.price.toString(), observedAt: nowMs } };
    }
    return none(holds, { ...prev, price: newPeak.toString(), observedAt: nowMs });
  }

  if (rule.kind === "debt_increase") {
    const baseDebt = prev.debt ? BigInt(prev.debt) : null;
    const baseAt = prev.observedAt ?? null;
    const next: Baseline = { ...prev, debt: obs.debt.toString(), observedAt: obs.blockTimeMs };
    if (baseDebt == null || baseAt == null) return none(false, next);
    const elapsed = BigInt(Math.max(0, Math.floor((obs.blockTimeMs - baseAt) / 1000)));
    const expected = calculateInterestOwed(obs.principal, obs.rateBps, 0n, elapsed);
    const unexpected = obs.debt - baseDebt - expected;
    const holds = unexpected > BigInt(Math.round((t ?? 1) * 100)) * (WAD / 100n);
    if (holds && cooledDown) {
      return { fire: true, holds, severity: "warning", title: "Debt increased unexpectedly", body: `Debt rose by ${formatAmount(obs.debt - baseDebt)} MUSD since the last check, ${formatAmount(unexpected)} MUSD more than interest explains (e.g. redistributed debt from a liquidation, or new borrowing).`, quiet, baseline: next };
    }
    return none(holds, next);
  }
  return none(false, prev);
}
