import "server-only";
import { sql } from "./db";
import type { PositionDTO, SystemDTO } from "../dto";

export type SnapshotSource = "cron" | "visit" | "check_now" | "tx";

/** Record an oracle/system observation (throttled to one per 5 minutes unless forced). */
export async function recordOracleSnapshot(s: SystemDTO, source: SnapshotSource, force = false) {
  if (!s.price || s.tcr == null) return false;
  const blockTime = new Date(s.blockTime * 1000).toISOString();
  const rows = force
    ? await sql()`INSERT INTO rescue.oracle_snapshots (network, block_number, block_time, price, tcr, recovery_mode, system_coll, system_debt, trove_count, source)
        VALUES ('testnet', ${s.blockNumber}, ${blockTime}, ${s.price}, ${s.tcr}, ${!!s.recoveryMode}, ${s.totalColl}, ${s.totalDebt}, ${s.troveCount}, ${source})
        ON CONFLICT (network, block_number) DO NOTHING RETURNING id`
    : await sql()`INSERT INTO rescue.oracle_snapshots (network, block_number, block_time, price, tcr, recovery_mode, system_coll, system_debt, trove_count, source)
        SELECT 'testnet', ${s.blockNumber}, ${blockTime}, ${s.price}, ${s.tcr}, ${!!s.recoveryMode}, ${s.totalColl}, ${s.totalDebt}, ${s.troveCount}, ${source}
        WHERE NOT EXISTS (SELECT 1 FROM rescue.oracle_snapshots WHERE network = 'testnet' AND observed_at > now() - interval '5 minutes')
        ON CONFLICT (network, block_number) DO NOTHING RETURNING id`;
  return rows.length > 0;
}

/** Record a trove observation (throttled per owner to one per 5 minutes unless forced). */
export async function recordTroveSnapshot(p: PositionDTO, source: SnapshotSource, force = false) {
  if (!p.system.price) return false;
  const owner = p.owner.toLowerCase();
  const blockTime = new Date(p.system.blockTime * 1000).toISOString();
  const icr = p.risk?.icr ?? null;
  const rows = force
    ? await sql()`INSERT INTO rescue.trove_snapshots (network, trove_owner, block_number, block_time, status, coll, principal, interest, price, icr, source)
        VALUES ('testnet', ${owner}, ${p.system.blockNumber}, ${blockTime}, ${p.status}, ${p.coll}, ${p.principal}, ${p.interest}, ${p.system.price}, ${icr}, ${source})
        ON CONFLICT (network, trove_owner, block_number) DO NOTHING RETURNING id`
    : await sql()`INSERT INTO rescue.trove_snapshots (network, trove_owner, block_number, block_time, status, coll, principal, interest, price, icr, source)
        SELECT 'testnet', ${owner}, ${p.system.blockNumber}, ${blockTime}, ${p.status}, ${p.coll}, ${p.principal}, ${p.interest}, ${p.system.price}, ${icr}, ${source}
        WHERE NOT EXISTS (SELECT 1 FROM rescue.trove_snapshots WHERE network = 'testnet' AND trove_owner = ${owner} AND observed_at > now() - interval '5 minutes')
        ON CONFLICT (network, trove_owner, block_number) DO NOTHING RETURNING id`;
  return rows.length > 0;
}

export type ActivityKind =
  | "position_discovered"
  | "threshold_crossed"
  | "alert_triggered"
  | "simulation_completed"
  | "tx_prepared"
  | "tx_submitted"
  | "tx_confirmed"
  | "tx_failed"
  | "tx_rejected";

export async function logActivity(a: {
  user: string | null;
  owner: string | null;
  category: "onchain" | "offchain";
  kind: ActivityKind;
  title: string;
  txHash?: string | null;
  details?: Record<string, unknown>;
  idempotencyKey?: string | null;
}) {
  await sql()`INSERT INTO rescue.activity (user_address, trove_owner, category, kind, title, tx_hash, details, idempotency_key)
    VALUES (${a.user?.toLowerCase() ?? null}, ${a.owner?.toLowerCase() ?? null}, ${a.category}, ${a.kind}, ${a.title}, ${a.txHash?.toLowerCase() ?? null}, ${JSON.stringify(a.details ?? {})}, ${a.idempotencyKey ?? null})
    ON CONFLICT (idempotency_key) DO NOTHING`;
}

export async function lastMonitorRuns() {
  const rows = await sql()`
    SELECT
      (SELECT row_to_json(r) FROM (SELECT id, source, started_at, finished_at, ok, troves_checked, rules_evaluated, alerts_fired, block_number, error FROM rescue.monitor_runs WHERE source = 'cron' ORDER BY started_at DESC LIMIT 1) r) AS last_cron,
      (SELECT row_to_json(r) FROM (SELECT id, source, started_at, finished_at, ok, troves_checked, rules_evaluated, alerts_fired, block_number FROM rescue.monitor_runs WHERE source = 'cron' AND ok ORDER BY started_at DESC LIMIT 1) r) AS last_cron_ok,
      (SELECT row_to_json(r) FROM (SELECT id, source, started_at, finished_at, ok, troves_checked, rules_evaluated, alerts_fired, block_number FROM rescue.monitor_runs WHERE ok ORDER BY started_at DESC LIMIT 1) r) AS last_ok`;
  return rows[0] as { last_cron: unknown; last_cron_ok: unknown; last_ok: unknown };
}
