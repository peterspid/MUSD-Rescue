/**
 * Production database check: proves the Neon Postgres database behind the live app works end to end.
 *
 *   npx tsx scripts/check-db.ts                      # against https://musd-rescue.vercel.app
 *   E2E_BASE_URL=http://localhost:3300 npx tsx scripts/check-db.ts
 *
 * 1. Reads the database directly (read-only, DATABASE_URL from .env.local) for the schema and row counts.
 * 2. Uses every DB-backed feature of the live app with a real wallet: SIWE sign-in, session, watchlist,
 *    settings, alert rule + Check now (monitor run + notification), activity log, verified rescue record.
 * 3. Confirms the rows landed in the database. Results go to deployments/production-db-check.json.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import type { PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { mezoTestnet } from "../src/config/chains";
import { loadDeployer } from "./lib/keys";

config({ path: ".env.local", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "https://musd-rescue.vercel.app").replace(/\/$/, "");
const DEMO_TROVE = "0x10ac9924a78051BdD770978740C5084205cdB628";
/** A repayMUSD the deployer made through the app's simulator during the browser e2e. */
const RESCUE_TX = "0x9cf4f7be6dda78a77cf1b6457439e0ee5fa864bb8aa86bf60b7d9a91a845b9a0";

const results: { step: string; ok: boolean; detail?: string }[] = [];
function check(step: string, ok: boolean, detail?: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `  (${detail})` : ""}`);
}

async function req(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, json, headers: res.headers };
}

async function signIn(acct: PrivateKeyAccount) {
  const { json: n } = await req("/api/auth/nonce");
  const url = new URL(BASE);
  const message = createSiweMessage({ domain: url.host, address: acct.address, statement: "MUSD Rescue database check", uri: url.origin, version: "1", chainId: mezoTestnet.id, nonce: n.nonce, issuedAt: new Date(), expirationTime: new Date(Date.now() + 5 * 60_000) });
  const signature = await acct.signMessage({ message });
  const r = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
  const m = (r.headers.get("set-cookie") ?? "").match(/rescue_session=([^;]+)/);
  return { status: r.status, cookie: m ? `rescue_session=${m[1]}` : "", message, signature };
}

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing: run `vercel env pull .env.local`");
  const pool = new Pool({ connectionString: url });
  const user = loadDeployer();
  const u = user.address.toLowerCase();
  console.log(`Database check against ${BASE} with wallet ${user.address}`);

  // ---- 1. The database itself (read-only)
  const host = new URL(url).host.replace(/^[^.]+/, "…");
  const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'rescue' ORDER BY table_name")).rows.map((r) => r.table_name as string);
  const expected = ["activity", "alert_rules", "monitor_runs", "notifications", "oracle_snapshots", "rescue_txs", "siwe_nonces", "trove_snapshots", "users", "watchlist"];
  check("Neon schema 'rescue' has all 10 tables", expected.every((t) => tables.includes(t)), `${tables.length} tables on ${host}`);
  const counts: Record<string, number> = {};
  for (const t of expected) counts[t] = Number((await pool.query(`SELECT count(*)::int AS n FROM rescue.${t}`)).rows[0].n);
  console.log("      rows before:", JSON.stringify(counts));

  // ---- 2. The live app's DB-backed features
  const h = await req("/api/health");
  check("live /api/health reports db ok", h.status === 200 && h.json?.db === "ok", `rpc ${h.json?.rpc}, chain ${h.json?.chainId}`);

  const s = await signIn(user);
  check("SIWE sign-in (nonce stored + consumed, user row, session cookie)", s.status === 200 && !!s.cookie);
  const replay = await req("/api/auth/verify", { method: "POST", body: { message: s.message, signature: s.signature } });
  check("used nonce is rejected on replay", replay.status === 401 || replay.status === 400, `HTTP ${replay.status}`);
  const sess = await req("/api/auth/session", { cookie: s.cookie });
  check("session reads back from the database", sess.status === 200 && sess.json?.address?.toLowerCase() === u);

  const w = await req("/api/watchlist", { method: "POST", cookie: s.cookie, body: { troveOwner: DEMO_TROVE, label: "Demo trove" } });
  const wl = await req("/api/watchlist", { cookie: s.cookie });
  const watched = JSON.stringify(wl.json ?? {}).toLowerCase().includes(DEMO_TROVE.toLowerCase());
  check("watchlist: add a trove and read it back", (w.status === 200 || w.status === 201) && watched, `HTTP ${w.status}`);

  const put = await req("/api/settings", { method: "PUT", cookie: s.cookie, body: { defaultTargetHF: 1.6 } });
  const got = await req("/api/settings", { cookie: s.cookie });
  check("settings: save preferences and read them back", put.status === 200 && JSON.stringify(got.json).includes("1.6"), `HTTP ${put.status}`);

  const rule = await req("/api/alerts", { method: "POST", cookie: s.cookie, body: { troveOwner: user.address, kind: "enters_warning", threshold: 1.5, frequency: "every_check" } });
  check("alerts: create a rule", rule.status === 201 || rule.status === 200, `HTTP ${rule.status}, rule ${rule.json?.rule?.id}`);
  const run = await req("/api/monitor/check", { method: "POST", cookie: s.cookie, body: { source: "check_now" } });
  check("Check now: monitor run evaluates the rule against the live trove", run.status === 200 && run.json?.rulesEvaluated >= 1, `rules ${run.json?.rulesEvaluated}, alerts fired ${run.json?.alertsFired}, block ${run.json?.blockNumber}`);
  const notes = await req("/api/notifications", { cookie: s.cookie });
  check("notifications: read the inbox", notes.status === 200 && Array.isArray(notes.json?.notifications), `${notes.json?.notifications?.length} notification(s), ${notes.json?.unread} unread`);
  const status = await req("/api/monitor/status", { cookie: s.cookie });
  check("monitoring status: last runs come from the database", status.status === 200, JSON.stringify(status.json ?? {}).slice(0, 140));

  const v = await req("/api/rescue/verify", { method: "POST", cookie: s.cookie, body: { txHash: RESCUE_TX } });
  check("rescue record: verify an on-chain repayment and store it once", v.status === 201 || v.status === 200, `HTTP ${v.status} (${v.status === 201 ? "recorded now" : "already recorded"}), ICR ${v.json?.icrBefore ?? "?"} -> ${v.json?.icrAfter ?? "?"}`);
  const dup = await req("/api/rescue/verify", { method: "POST", cookie: s.cookie, body: { txHash: RESCUE_TX } });
  check("same tx hash is never double counted", dup.status === 200 && dup.json?.duplicate === true, `HTTP ${dup.status}`);
  const act = await req("/api/activity", { cookie: s.cookie });
  check("activity log reads back on-chain and app events", act.status === 200, `${act.json?.activity?.length ?? act.json?.events?.length ?? "?"} entries, ${act.json?.rescues?.length ?? "?"} verified rescue(s)`);

  if (rule.json?.rule?.id) {
    const del = await req(`/api/alerts/${rule.json.rule.id}`, { method: "DELETE", cookie: s.cookie });
    check("alerts: delete the test rule", del.status === 200 || del.status === 204, `HTTP ${del.status}`);
  }
  const out = await req("/api/auth/logout", { method: "POST", cookie: s.cookie });
  check("sign out", out.status === 200 || out.status === 204, `HTTP ${out.status}`);

  // ---- 3. The rows really landed in Neon
  const q = async (sql: string, p: unknown[]) => Number((await pool.query(sql, p)).rows[0].n);
  check("db row: users", (await q("SELECT count(*)::int n FROM rescue.users WHERE address = $1", [u])) === 1);
  check("db row: watchlist", (await q("SELECT count(*)::int n FROM rescue.watchlist WHERE user_address = $1 AND trove_owner = $2", [u, DEMO_TROVE.toLowerCase()])) === 1);
  check("db rows: monitor_runs for this user", (await q("SELECT count(*)::int n FROM rescue.monitor_runs WHERE user_address = $1", [u])) >= 1);
  check("db row: rescue_txs (unique tx hash)", (await q("SELECT count(*)::int n FROM rescue.rescue_txs WHERE tx_hash = $1", [RESCUE_TX])) === 1);
  check("db rows: activity for this user", (await q("SELECT count(*)::int n FROM rescue.activity WHERE user_address = $1", [u])) >= 1);
  check("db rows: oracle snapshots recorded by monitoring", (await q("SELECT count(*)::int n FROM rescue.oracle_snapshots", [])) >= 1);
  const after: Record<string, number> = {};
  for (const t of expected) after[t] = Number((await pool.query(`SELECT count(*)::int AS n FROM rescue.${t}`)).rows[0].n);
  console.log("      rows after: ", JSON.stringify(after));
  await pool.end();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  writeFileSync("deployments/production-db-check.json", JSON.stringify({ ranAt: new Date().toISOString(), baseUrl: BASE, database: `Neon Postgres (${host}), schema "rescue"`, wallet: user.address, rowsBefore: counts, rowsAfter: after, passed, total: results.length, results }, null, 2) + "\n");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
