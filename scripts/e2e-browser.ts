/**
 * Browser end-to-end test on Mezo testnet: drives the real UI in Chrome with real wallets and real transactions.
 *
 *   E2E_BASE_URL=http://localhost:3300 npx tsx scripts/e2e-browser.ts
 *
 * Wallets (keys read at runtime, never printed): deployer (.env.deployer), the long-running demo trove owner,
 * and the e2e wallets in .env.e2e-wallets.json. Each wallet is an injected EIP-1193 provider whose signing runs
 * in Node (scripts/lib/injected-wallet.ts). Results and tx hashes go to deployments/e2e-wave2.json; screenshots
 * of each step to docs/screenshots/e2e/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright-core";
import { createPublicClient, http, parseAbi, formatEther, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { mezoTestnet } from "../src/config/chains";
import { MUSD_CONTRACTS } from "../src/config/contracts";
import { RESCUE_GUARD, rescueGuardAbi } from "../src/config/guard";
import { shortAddress } from "../src/lib/risk/format";
import { injectWallet } from "./lib/injected-wallet";
import { loadDeployer, loadTroveOwner, loadWallets } from "./lib/keys";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3300").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = "docs/screenshots/e2e";
const TX_TIMEOUT = 240_000;
const A = MUSD_CONTRACTS.testnet;
const pub = createPublicClient({ chain: mezoTestnet, transport: http() });
const G = { address: RESCUE_GUARD.address, abi: rescueGuardAbi } as const;
const tm = parseAbi(["function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256, uint256, uint256)", "function getTroveStatus(address) view returns (uint8)"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const results: { step: string; ok: boolean; detail?: string }[] = [];
const txs: { step: string; wallet: string; hash: string }[] = [];
function check(step: string, ok: boolean, detail?: string) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}${detail ? `  (${detail})` : ""}`);
}

async function open(browser: Browser, account: PrivateKeyAccount, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  await injectWallet(page, account);
  return { ctx, page };
}

/** Connect through the app's modal, or accept wagmi's auto-reconnect (the provider reports the account as authorized). */
async function connect(page: Page, address: string) {
  const connected = page.getByText(shortAddress(address)).first();
  // Before hydration the button is a disabled placeholder; give wagmi's auto-reconnect time to settle first.
  await connected.waitFor({ timeout: 12_000 }).catch(() => {});
  if (!(await connected.isVisible().catch(() => false))) {
    await page.locator("header").getByRole("button", { name: /connect wallet/i }).and(page.locator(":enabled")).first().click();
    await page.getByRole("button", { name: /E2E Wallet|Browser wallet/ }).first().click();
  }
  await connected.waitFor({ timeout: 30_000 });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false, timeout: 30_000 }).catch(() => {});
}

/** Wait for a TxSteps success title and return the newest explorer tx link in the step list. */
async function awaitTx(page: Page, successText: string | RegExp, step: string, wallet: string): Promise<Hex | null> {
  const ok = page.getByText(successText).first();
  const fail = page.getByText("Not completed").first();
  await Promise.race([ok.waitFor({ timeout: TX_TIMEOUT }), fail.waitFor({ timeout: TX_TIMEOUT })]).catch(() => {});
  if (await fail.isVisible().catch(() => false)) {
    const msg = await page.locator('[role="alert"]').filter({ hasText: "Not completed" }).last().innerText().catch(() => "");
    check(step, false, msg.replace(/\s+/g, " ").slice(0, 240));
    return null;
  }
  const href = await page.locator('ol a[href*="/tx/"]').last().getAttribute("href").catch(() => null);
  const hash = href?.match(/0x[0-9a-fA-F]{64}/)?.[0] as Hex | undefined;
  if (hash) txs.push({ step, wallet, hash });
  return hash ?? null;
}

/** Poll until on-chain state matches (public RPC nodes can lag a block behind the wallet's node). */
async function settled<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2_000));
    v = await read();
  }
  return v;
}

/** MUSD that can still be repaid without closing (debt - 200 gas compensation - 1,800 minimum net debt). */
async function repayRoom(owner: `0x${string}`): Promise<bigint> {
  const e = await pub.readContract({ address: A.TroveManager, abi: tm, functionName: "getEntireDebtAndColl", args: [owner] });
  const debt = e[1] + e[2];
  const floor = 2_000n * 10n ** 18n;
  return debt > floor ? debt - floor : 0n;
}

const dec2 = (v: bigint) => (Number(v / 10n ** 16n) / 100).toFixed(2);

async function plan(owner: `0x${string}`) {
  const [p, s] = await Promise.all([pub.readContract({ ...G, functionName: "getPlan", args: [owner] }), pub.readContract({ ...G, functionName: "planStatus", args: [owner] })]);
  return { plan: p as unknown as { kind: number; amount: bigint; triggerIcr: bigint }, status: Number((s as unknown as readonly [number])[0]), icr: (s as unknown as readonly [number, bigint])[1] };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const deployer = loadDeployer();
  const troveOwner = loadTroveOwner();
  const { watcher, outsider } = loadWallets();
  console.log(`Browser e2e against ${BASE}, RescueGuard ${RESCUE_GUARD.address}`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: process.env.HEADED !== "1" });

  // ---- 1. New deployer: connect, open a trove, store a plan, change it (retire step), plan becomes ready.
  {
    const { ctx, page } = await open(browser, deployer);
    await page.goto(`${BASE}/dashboard`);
    await connect(page, deployer.address);
    check("deployer: wallet connects through EIP-6963 discovery", true, deployer.address);
    const status0 = await pub.readContract({ address: A.TroveManager, abi: tm, functionName: "getTroveStatus", args: [deployer.address] });
    if (status0 !== 1) {
      await page.getByRole("button", { name: "Open a trove" }).first().click();
      await page.fill("#ot-coll", process.env.E2E_COLL || "0.047");
      await page.fill("#ot-debt", process.env.E2E_DEBT || "1900");
      await shot(page, "01-open-trove");
      await page.getByRole("button", { name: "Open trove", exact: true }).click();
      const h = await awaitTx(page, "Trove opened", "deployer: open trove in the app", "deployer");
      const st = await pub.readContract({ address: A.TroveManager, abi: tm, functionName: "getTroveStatus", args: [deployer.address] });
      check("deployer: open trove in the app", !!h && st === 1, h ?? undefined);
      await page.keyboard.press("Escape").catch(() => {});
    } else check("deployer: trove already open (skipping open)", true);

    // Plan sizes follow the trove's live repay headroom so the run can be repeated on the same trove.
    const room = await repayRoom(deployer.address);
    const a1 = room * 8n / 10n > 100n * 10n ** 18n ? 100n * 10n ** 18n : (room * 8n) / 10n;
    const a1s = dec2(a1);
    const a2s = dec2((BigInt(Math.round(Number(a1s) * 100)) * 10n ** 16n * 9n) / 10n);
    const amount1 = BigInt(Math.round(Number(a1s) * 100)) * 10n ** 16n;
    const amount2 = BigInt(Math.round(Number(a2s) * 100)) * 10n ** 16n;
    const e0 = await pub.readContract({ address: A.TroveManager, abi: tm, functionName: "getEntireDebtAndColl", args: [deployer.address] });
    const priceNow = await pub.readContract({ address: A.PriceFeed, abi: parseAbi(["function fetchPrice() view returns (uint256)"]), functionName: "fetchPrice" });
    const icrPct = Number((e0[0] * priceNow * 100n) / (e0[1] + e0[2]) / 10n ** 18n);
    console.log(`      repay headroom ${formatEther(room)} MUSD -> plans ${a1s} then ${a2s} MUSD; ICR now ~${icrPct}%`);

    // Start from a clean guard whatever an earlier run left behind: cancel + withdraw (exit) or just withdraw.
    const before0 = await plan(deployer.address);
    const leftover = await pub.readContract({ ...G, functionName: "musdReserve", args: [deployer.address] });
    if (before0.plan.kind !== 0 || leftover > 0n) {
      await page.goto(`${BASE}/guard`);
      const label = before0.plan.kind !== 0 ? "Cancel and withdraw everything" : "Withdraw everything";
      await page.getByRole("button", { name: label }).first().click();
      const wh = await awaitTx(page, before0.plan.kind !== 0 ? "Plan cancelled and reserve withdrawn" : "Reserve withdrawn", `deployer: ${label.toLowerCase()} (exit)`, "deployer");
      const after = await settled(() => Promise.all([plan(deployer.address), pub.readContract({ ...G, functionName: "musdReserve", args: [deployer.address] })]), ([pl, r]) => pl.plan.kind === 0 && r === 0n);
      check(`deployer: ${label.toLowerCase()} (exit)`, !!wh && after[0].plan.kind === 0 && after[1] === 0n, `${formatEther(leftover)} MUSD back to the wallet`);
    }
    await page.goto(`${BASE}/guard`);
    await page.locator("#g-trigger").waitFor({ timeout: 60_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2_000);
    await page.fill("#g-trigger", String(Math.max(113, icrPct - 12)));
    await page.fill("#g-amount", a1s);
    await page.fill("#g-tip", "1");
    await shot(page, "02-guard-setup");
    await page.getByRole("button", { name: /Sign and (store|replace) plan/ }).click();
    const armHash = await awaitTx(page, "Rescue plan stored on-chain", "deployer: store repay plan (authorization + permit, one tx)", "deployer");
    let p = await settled(() => plan(deployer.address), (v) => v.plan.amount === amount1 && v.status === 1);
    check("deployer: store repay plan (authorization + permit, one tx)", !!armHash && p.plan.kind === 1 && p.plan.amount === amount1 && p.status === 1, `${a1s} MUSD, status ${p.status}, ICR ${formatEther(p.icr * 100n)}%`);
    await page.getByRole("button", { name: "Done" }).click().catch(() => {});
    await page.getByText("Armed").first().waitFor({ timeout: 30_000 }).catch(() => {});
    await shot(page, "03-guard-armed");

    await page.getByRole("button", { name: "Change plan" }).click();
    await page.fill("#g-trigger", String(Math.min(399, icrPct + 8)));
    await page.fill("#g-amount", a2s);
    await page.getByText("One extra step first").first().waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: /Sign and replace plan/ }).click();
    const rearm = await awaitTx(page, "Rescue plan stored on-chain", "deployer: change plan (retires old authorization first)", "deployer");
    p = await settled(() => plan(deployer.address), (v) => v.plan.amount === amount2 && v.status === 2);
    check("deployer: change plan (retires old authorization first)", !!rearm && p.plan.amount === amount2 && p.status === 2, `${a2s} MUSD, status ${p.status} (2 = ready)`);
    await page.getByRole("button", { name: "Done" }).click().catch(() => {});
    await page.getByText("This rescue can run now").first().waitFor({ timeout: 30_000 }).catch(() => {});
    await shot(page, "04-guard-ready");
    await ctx.close();
  }

  // ---- 2. Watcher (third party): runs the rescue from its own wallet, then swaps BTC for MUSD.
  {
    const { ctx, page } = await open(browser, watcher);
    await page.goto(`${BASE}/guard?owner=${deployer.address}`);
    await connect(page, watcher.address);
    const before = await pub.readContract({ address: A.TroveManager, abi: tm, functionName: "getEntireDebtAndColl", args: [deployer.address] });
    const tipBefore = await pub.readContract({ address: A.MUSD, abi: erc20, functionName: "balanceOf", args: [watcher.address] });
    await page.getByRole("button", { name: "Run rescue now" }).click();
    const h = await awaitTx(page, "Rescue executed", "watcher: runs the deployer's ready rescue (permissionless)", "watcher");
    const after = await pub.readContract({ address: A.TroveManager, abi: tm, functionName: "getEntireDebtAndColl", args: [deployer.address] });
    const tipAfter = await pub.readContract({ address: A.MUSD, abi: erc20, functionName: "balanceOf", args: [watcher.address] });
    const repaid = before[1] + before[2] - (after[1] + after[2]);
    const p2 = await settled(() => plan(deployer.address), (v) => v.status === 0);
    check("watcher: runs the deployer's ready rescue (permissionless)", !!h && repaid > 0n && p2.status === 0, `debt -${formatEther(repaid)} MUSD, tip +${formatEther(tipAfter - tipBefore)} MUSD`);
    await shot(page, "05-rescue-run-by-third-party");

    await page.getByText(shortAddress(watcher.address)).first().click();
    await page.getByRole("button", { name: /Get MUSD with BTC/ }).click();
    await page.fill("#swap-in", "0.0005");
    await page.getByText(/Pool price/).first().waitFor({ timeout: 30_000 });
    await shot(page, "06-swap");
    const m0 = await pub.readContract({ address: A.MUSD, abi: erc20, functionName: "balanceOf", args: [watcher.address] });
    await page.getByRole("button", { name: /Swap BTC for MUSD/ }).click();
    const sh = await awaitTx(page, "Swap confirmed", "watcher: swaps BTC for MUSD through Mezo Pools", "watcher");
    const m1 = await pub.readContract({ address: A.MUSD, abi: erc20, functionName: "balanceOf", args: [watcher.address] });
    check("watcher: swaps BTC for MUSD through Mezo Pools", !!sh && m1 > m0, `+${formatEther(m1 - m0)} MUSD`);
    await ctx.close();
  }

  // ---- 3. Deployer: direct rescue through the simulator flow (prepare, confirm, sign, verify).
  {
    const { ctx, page } = await open(browser, deployer);
    await page.goto(`${BASE}/rescue/${deployer.address}`);
    await connect(page, deployer.address);
    await page.locator("#repay").waitFor({ timeout: 60_000 });
    const roomNow = await repayRoom(deployer.address);
    const repayStr = roomNow >= 10n * 10n ** 18n ? "5" : dec2(roomNow / 2n);
    await page.fill("#repay", repayStr);
    await page.getByRole("button", { name: "Review transaction" }).click();
    await page.getByText("Confirm rescue transaction").waitFor({ timeout: 60_000 });
    await shot(page, "07-rescue-confirm");
    await page.getByRole("button", { name: /Sign repayMUSD/ }).click();
    await page.getByText("Rescue verified").first().waitFor({ timeout: TX_TIMEOUT });
    const href = await page.locator('a[href*="/tx/"]').last().getAttribute("href");
    const hash = href?.match(/0x[0-9a-fA-F]{64}/)?.[0];
    if (hash) txs.push({ step: `deployer: repay ${repayStr} MUSD via simulator`, wallet: "deployer", hash });
    check(`deployer: repay ${repayStr} MUSD via simulator (verified receipt + re-read)`, !!hash, hash);
    await shot(page, "08-rescue-verified");
    await ctx.close();
  }

  // ---- 4. Demo trove owner: protect the long-running demo trove with a BTC top-up plan.
  {
    const { ctx, page } = await open(browser, troveOwner);
    await page.goto(`${BASE}/guard`);
    await connect(page, troveOwner.address);
    const existing = await plan(troveOwner.address);
    if (existing.status === 0) {
      await page.locator("#g-trigger").waitFor({ timeout: 60_000 });
      await page.getByRole("radio", { name: "Add BTC" }).click();
      await page.fill("#g-trigger", process.env.E2E_DEMO_TRIGGER || "118");
      await page.fill("#g-amount", "0.003");
      await page.fill("#g-tip", "0");
      await page.getByRole("button", { name: /Sign and store plan/ }).click();
      const h = await awaitTx(page, "Rescue plan stored on-chain", "demo trove owner: store BTC top-up plan", "trove-owner");
      const p = await plan(troveOwner.address);
      check("demo trove owner: store BTC top-up plan", !!h && p.plan.kind === 2 && (p.status === 1 || p.status === 2), `status ${p.status}, ICR ${formatEther(p.icr * 100n)}%`);
      await page.getByRole("button", { name: "Done" }).click().catch(() => {});
    } else {
      const logs = (await pub.getLogs({ address: RESCUE_GUARD.address, event: rescueGuardAbi.find((x) => x.type === "event" && x.name === "Armed") as never, args: { borrower: troveOwner.address } as never, fromBlock: BigInt(RESCUE_GUARD.deployBlock), toBlock: "latest" })) as unknown as { transactionHash: Hex | null }[];
      const last = logs[logs.length - 1];
      if (last?.transactionHash) txs.push({ step: "demo trove owner: store BTC top-up plan", wallet: "trove-owner", hash: last.transactionHash });
      check("demo trove owner: plan already stored (Armed event found)", !!last, `status ${existing.status}${last ? `, tx ${last.transactionHash}` : ""}`);
    }
    await shot(page, "09-demo-trove-protected");
    await ctx.close();
  }

  // ---- 5. Outsider: cannot run a plan that is not ready; the registry shows both plans and the rescue.
  {
    const { ctx, page } = await open(browser, outsider);
    await page.goto(`${BASE}/guard?owner=${troveOwner.address}`);
    await connect(page, outsider.address);
    await page.getByText("Protected troves").first().waitFor();
    const p = await plan(troveOwner.address);
    const runVisible = await page.getByRole("button", { name: "Run rescue now" }).isVisible().catch(() => false);
    check("outsider: no run button while the demo trove is above its trigger", p.status !== 2 ? !runVisible : true, `status ${p.status}`);
    let reverted = false;
    try {
      await pub.simulateContract({ ...G, functionName: "execute", args: [troveOwner.address, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000"], account: outsider.address });
    } catch (e) {
      reverted = /TriggerNotReached/.test((e as Error).message) || /TriggerNotReached/.test(JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    }
    check("outsider: execute() on a waiting plan reverts with TriggerNotReached", p.status === 2 || reverted);
    await page.reload();
    await page.getByText("Rescues run on-chain").first().waitFor();
    await page.waitForTimeout(3000);
    const rows = await page.locator("ul li a[href*='/tx/']").count();
    check("registry lists the rescue run on-chain", rows >= 1, `${rows} rescue(s)`);
    await shot(page, "10-registry");
    await ctx.close();
  }
  await browser.close();

  // ---- 6. Every transaction confirmed through the Mezo explorer API.
  for (const t of txs) {
    let status = "unknown";
    for (let i = 0; i < 6 && status !== "ok"; i++) {
      try {
        const r = await fetch(`https://api.explorer.test.mezo.org/api/v2/transactions/${t.hash}`);
        const j = (await r.json()) as { status?: string; result?: string };
        status = j.status ?? "unknown";
      } catch {
        /* retry */
      }
      if (status !== "ok") await new Promise((r) => setTimeout(r, 4000));
    }
    check(`explorer confirms ${t.step}`, status === "ok", t.hash);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  writeFileSync(
    "deployments/e2e-wave2.json",
    JSON.stringify({ ranAt: new Date().toISOString(), baseUrl: BASE, rescueGuard: RESCUE_GUARD.address, wallets: { deployer: deployer.address, troveOwner: troveOwner.address, watcher: watcher.address, outsider: outsider.address }, passed, total: results.length, results, transactions: txs.map((t) => ({ ...t, explorer: `https://explorer.test.mezo.org/tx/${t.hash}` })) }, null, 2) + "\n",
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.split("\n").slice(0, 3).join("\n") : e);
  process.exit(1);
});
