import "server-only";
import { getAddress, type Address } from "viem";
import { sql } from "./db";
import { mapLimit } from "./chain";
import { readPosition, readSystem } from "./musd-adapter";
import { evaluateRule, ALERT_KINDS, type AlertFrequency, type AlertKind, type Baseline, type Observation } from "../alerts/evaluate";
import { logActivity, recordOracleSnapshot, recordTroveSnapshot } from "./records";
import type { PositionDTO, SystemDTO } from "../dto";

export type MonitorSource = "cron" | "visit" | "check_now";

interface RuleRow {
  id: string;
  user_address: string;
  trove_owner: string;
  kind: AlertKind;
  threshold: string | null;
  frequency: AlertFrequency;
  quiet_start: number | null;
  quiet_end: number | null;
  tz_offset_min: number;
  baseline: Baseline;
  last_triggered_at: string | null;
}

function toObservation(p: PositionDTO | null, system: SystemDTO | null, error?: string): Observation {
  if (!p || !system) {
    return { ok: false, error: error ?? "unavailable", active: false, hf: null, price: 0n, debt: 0n, principal: 0n, rateBps: 0, blockTimeMs: 0, recoveryMode: false };
  }
  if (!system.price) {
    return { ok: false, error: system.priceError ?? "oracle price unavailable", active: p.active, hf: null, price: 0n, debt: BigInt(p.debt), principal: BigInt(p.principal), rateBps: p.interestRateBps, blockTimeMs: system.blockTime * 1000, recoveryMode: !!system.recoveryMode };
  }
  return {
    ok: true,
    active: p.active,
    hf: p.risk?.hf != null ? BigInt(p.risk.hf) : null,
    price: BigInt(system.price),
    debt: BigInt(p.debt),
    principal: BigInt(p.principal),
    rateBps: p.interestRateBps,
    blockTimeMs: system.blockTime * 1000,
    recoveryMode: !!system.recoveryMode,
  };
}

export interface MonitorResult {
  runId: string;
  skipped?: boolean;
  ok: boolean;
  trovesChecked: number;
  rulesEvaluated: number;
  alertsFired: number;
  blockNumber: string | null;
  notifications: { id: string; title: string; severity: string; quiet: boolean }[];
  error?: string;
}

export async function runMonitor(opts: { source: MonitorSource; user?: Address }): Promise<MonitorResult> {
  const user = opts.user?.toLowerCase() ?? null;
  if (opts.source === "visit" && user) {
    const recent = await sql()`SELECT id FROM rescue.monitor_runs WHERE user_address = ${user} AND started_at > now() - interval '60 seconds' ORDER BY started_at DESC LIMIT 1`;
    if (recent.length) return { runId: String(recent[0].id), skipped: true, ok: true, trovesChecked: 0, rulesEvaluated: 0, alertsFired: 0, blockNumber: null, notifications: [] };
  }
  const [run] = await sql()`INSERT INTO rescue.monitor_runs (source, user_address) VALUES (${opts.source}, ${user}) RETURNING id`;
  const runId = String(run.id);
  try {
    const rules = (user
      ? await sql()`SELECT * FROM rescue.alert_rules WHERE enabled AND user_address = ${user}`
      : await sql()`SELECT * FROM rescue.alert_rules WHERE enabled`) as unknown as RuleRow[];

    let system: SystemDTO | null = null;
    let systemError: string | undefined;
    try {
      system = await readSystem();
      await recordOracleSnapshot(system, opts.source, opts.source !== "visit");
    } catch (e) {
      systemError = e instanceof Error ? e.message.split("\n")[0] : String(e);
    }

    const owners = [...new Set(rules.map((r) => r.trove_owner))];
    const positions = new Map<string, { p: PositionDTO | null; err?: string }>();
    await mapLimit(owners, 6, async (o) => {
      try {
        const p = await readPosition(getAddress(o));
        positions.set(o, { p });
        if (p.active) await recordTroveSnapshot(p, opts.source, opts.source !== "visit");
      } catch (e) {
        positions.set(o, { p: null, err: e instanceof Error ? e.message.split("\n")[0] : String(e) });
      }
    });

    const now = Date.now();
    const fired: MonitorResult["notifications"] = [];
    for (const r of rules) {
      const pos = positions.get(r.trove_owner);
      const obs = toObservation(pos?.p ?? null, pos?.p?.system ?? system, pos?.err ?? systemError);
      const ev = evaluateRule(
        {
          kind: r.kind,
          threshold: r.threshold == null ? null : Number(r.threshold),
          frequency: r.frequency,
          quietStart: r.quiet_start,
          quietEnd: r.quiet_end,
          tzOffsetMin: r.tz_offset_min,
          lastTriggeredAt: r.last_triggered_at ? new Date(r.last_triggered_at).getTime() : null,
          baseline: r.baseline ?? {},
        },
        obs,
        now,
      );
      if (ev.fire) {
        const [n] = await sql()`INSERT INTO rescue.notifications (user_address, rule_id, trove_owner, severity, title, body, quiet, source)
          VALUES (${r.user_address}, ${r.id}, ${r.trove_owner}, ${ev.severity}, ${ev.title}, ${ev.body}, ${ev.quiet}, ${opts.source}) RETURNING id`;
        await sql()`UPDATE rescue.alert_rules SET baseline = ${JSON.stringify(ev.baseline)}, last_evaluated_at = now(), last_triggered_at = now() WHERE id = ${r.id}`;
        fired.push({ id: String(n.id), title: ev.title, severity: ev.severity, quiet: ev.quiet });
        await logActivity({ user: r.user_address, owner: r.trove_owner, category: "offchain", kind: "alert_triggered", title: `${ev.title} (${ALERT_KINDS[r.kind].label})`, details: { ruleId: r.id, severity: ev.severity, body: ev.body, quiet: ev.quiet, source: opts.source } });
        if (r.kind === "enters_warning" || r.kind === "enters_critical") {
          await logActivity({ user: r.user_address, owner: r.trove_owner, category: "offchain", kind: "threshold_crossed", title: `Risk threshold crossed: ${ev.title.toLowerCase()}`, details: { ruleId: r.id } });
        }
      } else {
        await sql()`UPDATE rescue.alert_rules SET baseline = ${JSON.stringify(ev.baseline)}, last_evaluated_at = now() WHERE id = ${r.id}`;
      }
    }
    const allOk = !systemError && [...positions.values()].every((v) => v.p);
    await sql()`UPDATE rescue.monitor_runs SET finished_at = now(), ok = ${allOk}, troves_checked = ${owners.length}, rules_evaluated = ${rules.length}, alerts_fired = ${fired.length}, block_number = ${system?.blockNumber ?? null}, error = ${systemError ?? null} WHERE id = ${runId}`;
    return { runId, ok: allOk, trovesChecked: owners.length, rulesEvaluated: rules.length, alertsFired: fired.length, blockNumber: system?.blockNumber ?? null, notifications: fired, error: systemError };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql()`UPDATE rescue.monitor_runs SET finished_at = now(), ok = false, error = ${msg.slice(0, 500)} WHERE id = ${runId}`;
    return { runId, ok: false, trovesChecked: 0, rulesEvaluated: 0, alertsFired: 0, blockNumber: null, notifications: [], error: msg };
  }
}
