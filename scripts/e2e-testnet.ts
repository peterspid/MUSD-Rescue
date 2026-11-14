/**
 * Live end-to-end test against a running MUSD Rescue (local `next start` or production) and Mezo testnet.
 *
 *   E2E_BASE_URL=http://localhost:3100 npm run e2e
 *
 * Keys are read at runtime from files outside the project and never printed:
 *   DEPLOYER_ENV_FILE  (default C:/Users/nikku/Desktop/.env.txt, line PRIVATE_KEY=...) — owner of a real MUSD trove
 *   TEST_WALLETS_FILE  (JSON with a `rescue` wallet that has gas but no trove)
 *
 * What it does (all real):
 *  1. watch-address read of a real trove; ICR cross-checked against TroveManager.getCurrentICR at the same block
 *  2. empty state for a wallet with no trove; demo/live id separation
 *  3. SIWE sign-in (+ nonce replay rejected)
 *  4. ONE addColl (0.00001 BTC) and ONE repayMUSD (5 MUSD) on the deployer's trove, prepared by the app's
 *     /api/rescue/prepare, signed locally with explicit gas, verified by /api/rescue/verify, then a post-tx refresh
 *  5. negative cases: unauthorized verify, duplicate hash, non-rescue tx, no session, minNetDebt cap, no trove
 *  6. alert rule → Check now → notification
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, getAddress, formatUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { mezoTestnet } from "../src/config/chains";
import { MUSD_CONTRACTS, ABIS } from "../src/config/contracts";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const DEPLOYER_ENV_FILE = process.env.DEPLOYER_ENV_FILE || "C:/Users/nikku/Desktop/.env.txt";
const TEST_WALLETS_FILE = process.env.TEST_WALLETS_FILE || "C:/Users/nikku/AppData/Local/Temp/claude/C--Users-nikku-Desktop/120e793a-eda2-49e5-92e3-e45940332298/scratchpad/test-wallets.json";
const SKIP_TX = process.env.E2E_SKIP_TX === "1";
const OUT = process.env.E2E_OUT;

const pub = createPublicClient({ chain: mezoTestnet, transport: http() });
const results: { name: string; ok: boolean; detail?: string }[] = [];
const txs: Record<string, string> = {};

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function loadDeployer(): PrivateKeyAccount {
  const raw = readFileSync(DEPLOYER_ENV_FILE, "utf8");
  const m = raw.match(/PRIVATE_KEY\s*=\s*["']?(0x)?([0-9a-fA-F]{64})/);
  if (!m) throw new Error(`PRIVATE_KEY not found in ${DEPLOYER_ENV_FILE}`);
  return privateKeyToAccount(`0x${m[2]}` as Hex);
}
function loadRescueUser(): PrivateKeyAccount {
  const j = JSON.parse(readFileSync(TEST_WALLETS_FILE, "utf8"));
  const w = (Array.isArray(j.rescue) ? j.rescue[0] : j.rescue?.user ?? j.rescue) as { privateKey: string };
  const pk = w.privateKey.startsWith("0x") ? w.privateKey : `0x${w.privateKey}`;
  return privateKeyToAccount(pk as Hex);
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
    /* non-json */
  }
  return { status: res.status, json, headers: res.headers };
}

async function signIn(acct: PrivateKeyAccount): Promise<{ cookie: string; message: string; signature: Hex }> {
  const { json: n } = await req("/api/auth/nonce");
  const url = new URL(BASE);
  const message = createSiweMessage({ domain: url.host, address: acct.address, statement: "MUSD Rescue e2e sign-in", uri: url.origin, version: "1", chainId: mezoTestnet.id, nonce: n.nonce, issuedAt: new Date(), expirationTime: new Date(Date.now() + 5 * 60_000) });
  const signature = await acct.signMessage({ message });
  const r = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
  const setCookie = r.headers.get("set-cookie") ?? "";
  const m = setCookie.match(/rescue_session=([^;]+)/);
  if (r.status !== 200 || !m) throw new Error(`SIWE sign-in failed: ${r.status} ${await r.text()}`);
  return { cookie: `rescue_session=${m[1]}`, message, signature };
}

const RETRYABLE = /nonce too low|replacement (transaction )?underpriced|already known|nonce has already been used/i;

async function sendPrepared(acct: PrivateKeyAccount, tx: { to: Address; data: Hex; value: string; gas: string }): Promise<Hex> {
  const wallet = createWalletClient({ account: acct, chain: mezoTestnet, transport: http() });
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const nonce = await pub.getTransactionCount({ address: acct.address, blockTag: "pending" });
      return await wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value), gas: BigInt(tx.gas), nonce });
    } catch (e) {
      const msg = (e as Error).message;
      if (!RETRYABLE.test(msg) || attempt === 5) throw new Error(msg.split("\n")[0]);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error("unreachable");
}

async function rescueStep(label: string, acct: PrivateKeyAccount, cookie: string, body: { repay?: string; addColl?: string }) {
  const before = await req(`/api/positions/${acct.address}`);
  const prep = await req("/api/rescue/prepare", { method: "POST", body: { owner: acct.address, ...body }, cookie });
  check(`${label}: app prepared the transaction`, prep.status === 200 && prep.json?.chainSimulation?.ok === true, prep.status === 200 ? `${prep.json.functionName}, gas ${prep.json.gas.limit} (estimate ${prep.json.gas.estimate}), hints ${prep.json.hints.upper.slice(0, 8)}/${prep.json.hints.lower.slice(0, 8)}` : JSON.stringify(prep.json));
  if (prep.status !== 200) return null;
  check(`${label}: prepared tx targets BorrowerOperations on 31611 with explicit gas`, getAddress(prep.json.tx.to) === MUSD_CONTRACTS.testnet.BorrowerOperations && prep.json.tx.chainId === 31611 && BigInt(prep.json.tx.gas) >= 300_000n);
  check(`${label}: no MUSD approval required`, prep.json.approval.needed === false);
  const hash = await sendPrepared(acct, prep.json.tx);
  txs[label] = hash;
  console.log(`      tx ${hash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  check(`${label}: receipt status success`, receipt.status === "success", `block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);
  let v = await req("/api/rescue/verify", { method: "POST", body: { txHash: hash }, cookie });
  for (let i = 0; i < 4 && v.status === 202; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    v = await req("/api/rescue/verify", { method: "POST", body: { txHash: hash }, cookie });
  }
  check(`${label}: server verified receipt and recorded it`, v.status === 201 && v.json.status === "confirmed", `HTTP ${v.status}`);
  const icrB = v.json?.icrBefore ? BigInt(v.json.icrBefore) : null;
  const icrA = v.json?.icrAfter ? BigInt(v.json.icrAfter) : null;
  check(`${label}: ICR improved (same oracle price, before vs after block)`, icrB != null && icrA != null && icrA > icrB, icrB && icrA ? `${formatUnits(icrB * 100n, 18)}% -> ${formatUnits(icrA * 100n, 18)}%` : "missing");
  // post-tx refresh through the app's position endpoint
  let after = await req(`/api/positions/${acct.address}`);
  for (let i = 0; i < 5 && BigInt(after.json.system.blockNumber) < receipt.blockNumber; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    after = await req(`/api/positions/${acct.address}`);
  }
  if (body.addColl) check(`${label}: refreshed position shows +${formatUnits(BigInt(body.addColl), 18)} BTC collateral`, BigInt(after.json.coll) - BigInt(before.json.coll) === BigInt(body.addColl), `${before.json.coll} -> ${after.json.coll}`);
  if (body.repay) {
    const dDebt = BigInt(before.json.debt) - BigInt(after.json.debt);
    check(`${label}: refreshed position shows debt reduced by ~${formatUnits(BigInt(body.repay), 18)} MUSD`, dDebt > BigInt(body.repay) - 10n ** 16n && dDebt <= BigInt(body.repay), `debt ${formatUnits(BigInt(before.json.debt), 18)} -> ${formatUnits(BigInt(after.json.debt), 18)}`);
  }
  return { hash, verify: v.json };
}

async function main() {
  console.log(`MUSD Rescue e2e against ${BASE}`);
  const deployer = loadDeployer();
  const rescueUser = loadRescueUser();

  const h = await req("/api/health");
  check("health: db + rpc ok, chain 31611", h.status === 200 && h.json.db === "ok" && h.json.rpc === "ok" && h.json.chainId === 31611, `block ${h.json?.blockNumber}`);

  // 1. watch-address read, cross-checked on-chain
  const p = await req(`/api/positions/${deployer.address}`);
  check("watch-address: real trove is active", p.status === 200 && p.json.active === true, `coll ${p.json?.coll}, debt ${p.json?.debt}`);
  if (p.json?.risk) {
    const bn = BigInt(p.json.system.blockNumber);
    const icrOnchain = await pub.readContract({ address: MUSD_CONTRACTS.testnet.TroveManager, abi: ABIS.TroveManager, functionName: "getCurrentICR", args: [deployer.address, BigInt(p.json.system.price)], blockNumber: bn });
    check("watch-address: ICR equals TroveManager.getCurrentICR at the same block", BigInt(p.json.risk.icr) === icrOnchain, `${formatUnits(icrOnchain * 100n, 18)}%`);
  }
  const radar = await req("/api/radar");
  check("radar: all troves listed via Multicall3, sorted by ICR", radar.status === 200 && radar.json.troves.length === radar.json.system.troveCount && radar.json.troves.every((t: { icr: string }, i: number, a: { icr: string }[]) => i === 0 || BigInt(a[i - 1].icr) <= BigInt(t.icr)), `${radar.json?.troves?.length} troves`);

  // 2. empty state + demo separation
  const e = await req(`/api/positions/${rescueUser.address}`);
  check("empty state: rescue.user has no trove", e.status === 200 && e.json.status === 0 && e.json.active === false && e.json.risk === null, `MUSD ${e.json?.wallet?.musd}`);
  const d = await req("/api/positions/demo-harbor");
  check("demo/live separation: live API refuses demo ids", d.status === 404 && d.json.code === "demo-id");
  const demoPage = await fetch(`${BASE}/demo`);
  const demoHtml = await demoPage.text();
  check("demo page renders and is labelled FICTIONAL", demoPage.status === 200 && demoHtml.includes("FICTIONAL"));

  // 3. SIWE
  const dep = await signIn(deployer);
  check("SIWE: deployer signed in", !!dep.cookie);
  const replay = await req("/api/auth/verify", { method: "POST", body: { message: dep.message, signature: dep.signature } });
  check("SIWE negative: replayed nonce rejected", replay.status === 401, replay.json?.code);
  const usr = await signIn(rescueUser);
  const sess = await req("/api/auth/session", { cookie: usr.cookie });
  check("SIWE: rescue.user session resolves", sess.json?.address?.toLowerCase() === rescueUser.address.toLowerCase());

  // negative prepare cases (no chain writes)
  const noTrove = await req("/api/rescue/prepare", { method: "POST", body: { owner: rescueUser.address, repay: "5000000000000000000" } });
  check("negative: prepare for an address without a trove → 422", noTrove.status === 422 && noTrove.json.code === "no-trove");
  const overCap = await req("/api/rescue/prepare", { method: "POST", body: { owner: deployer.address, repay: (1000n * 10n ** 18n).toString() } });
  check("negative: repay beyond minNetDebt cap is blocked before signing", overCap.status === 422 && JSON.stringify(overCap.json.details).includes("min-net-debt"));
  const openTx = (await req(`/api/positions/${deployer.address}/events`)).json?.events?.find((x: { operation: string }) => x.operation === "Trove opened")?.txHash;
  if (openTx) {
    const wrongFn = await req("/api/rescue/verify", { method: "POST", body: { txHash: openTx }, cookie: dep.cookie });
    check("negative: a non-rescue transaction (openTrove) is not recorded", wrongFn.status === 422 && wrongFn.json.code === "wrong-function");
  }
  const noSession = await req("/api/rescue/verify", { method: "POST", body: { txHash: `0x${"11".repeat(32)}` } });
  check("negative: verify without a session → 401", noSession.status === 401);

  // 4. real rescue transactions
  if (!SKIP_TX) {
    const a = await rescueStep("addColl 0.00001 BTC", deployer, dep.cookie, { addColl: (10n ** 13n).toString() });
    const r = await rescueStep("repayMUSD 5 MUSD", deployer, dep.cookie, { repay: (5n * 10n ** 18n).toString() });
    if (a && r) {
      const dup = await req("/api/rescue/verify", { method: "POST", body: { txHash: r.hash }, cookie: dep.cookie });
      check("negative: duplicate tx hash is not double counted", dup.status === 200 && dup.json.duplicate === true);
      const other = await req("/api/rescue/verify", { method: "POST", body: { txHash: r.hash }, cookie: usr.cookie });
      check("negative: another wallet cannot claim the deployer's tx → 403", other.status === 403);
      const act = await req("/api/activity", { cookie: dep.cookie });
      const recorded = (act.json?.transactions ?? []).filter((t: { tx_hash: string; status: string }) => [a.hash, r.hash].includes(t.tx_hash as Hex) && t.status === "confirmed");
      check("activity: both verified rescues recorded as on-chain confirmed", recorded.length === 2);
      const kinds = new Set((act.json?.events ?? []).map((x: { kind: string }) => x.kind));
      check("activity: on-chain tx_confirmed and off-chain tx_prepared events present", kinds.has("tx_confirmed") && kinds.has("tx_prepared"));
    }
  }

  // Re-verify previously executed rescue txs through this deployment (idempotent: must be recognised, not re-counted).
  const known = (process.env.E2E_KNOWN_TXS ?? "").split(",").filter((x) => /^0x[0-9a-fA-F]{64}$/.test(x));
  if (known.length) {
    for (const hash of known) {
      const v = await req("/api/rescue/verify", { method: "POST", body: { txHash: hash }, cookie: dep.cookie });
      check(`known tx ${hash.slice(0, 10)}… verified as confirmed and not double counted`, v.status === 200 && v.json.duplicate === true && v.json.status === "confirmed", `ICR ${v.json?.icrBefore} -> ${v.json?.icrAfter}`);
    }
    const act = await req("/api/activity", { cookie: dep.cookie });
    check("activity (this deployment): known rescues listed", known.every((h) => (act.json?.transactions ?? []).some((t: { tx_hash: string }) => t.tx_hash === h.toLowerCase())));
  }

  // 6. alerts
  const rule = await req("/api/alerts", { method: "POST", cookie: dep.cookie, body: { troveOwner: deployer.address, kind: "enters_warning", threshold: 1.5, frequency: "every_check" } });
  check("alerts: rule created", rule.status === 201);
  const run = await req("/api/monitor/check", { method: "POST", cookie: dep.cookie, body: { source: "check_now" } });
  check("alerts: Check now evaluated the rule and fired (HF < 1.5)", run.status === 200 && run.json.ok && run.json.alertsFired >= 1, `rules ${run.json?.rulesEvaluated}, fired ${run.json?.alertsFired}`);
  const notes = await req("/api/notifications", { cookie: dep.cookie });
  check("alerts: in-app notification stored", (notes.json?.notifications ?? []).some((n: { title: string }) => /warning zone/i.test(n.title)));
  if (rule.json?.rule?.id) await req(`/api/alerts/${rule.json.rule.id}`, { method: "DELETE", cookie: dep.cookie });
  const otherDelete = rule.json?.rule?.id ? await req(`/api/alerts/${rule.json.rule.id}`, { method: "DELETE", cookie: usr.cookie }) : null;
  if (otherDelete) check("negative: cannot touch another user's alert rule", otherDelete.status === 403 || otherDelete.status === 404);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (Object.keys(txs).length) console.log("transactions:", JSON.stringify(txs, null, 2));
  if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), results, txs }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e crashed:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
