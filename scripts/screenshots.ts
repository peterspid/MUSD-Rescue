/**
 * README screenshots (desktop 1280 and phone 390) from a running app.
 *   E2E_BASE_URL=http://localhost:3300 npx tsx scripts/screenshots.ts
 * The demo trove owner's wallet is injected (read-only use here) so wallet-gated pages show real state.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { injectWallet } from "./lib/injected-wallet";
import { loadTroveOwner } from "./lib/keys";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3300").replace(/\/$/, "");
const OUT = "docs/screenshots";
const DEMO = "0x10ac9924a78051BdD770978740C5084205cdB628";

const PAGES: { name: string; path: string; wallet?: boolean; full?: boolean }[] = [
  { name: "landing", path: "/" },
  { name: "guard", path: "/guard", wallet: true, full: true },
  { name: "dashboard", path: "/dashboard", wallet: true },
  { name: "position", path: `/positions/${DEMO}` },
  { name: "rescue", path: `/rescue/${DEMO}` },
  { name: "radar", path: "/radar" },
];

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3_000);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  for (const vp of [{ tag: "desktop", width: 1280, height: 860 }, { tag: "mobile", width: 390, height: 844 }]) {
    for (const p of PAGES) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.tag === "mobile" ? 2 : 1 });
      const page = await ctx.newPage();
      if (p.wallet) await injectWallet(page, loadTroveOwner());
      await page.goto(`${BASE}${p.path}`);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await page.screenshot({ path: `${OUT}/${p.name}-${vp.tag}.png`, fullPage: !!p.full && vp.tag === "desktop", timeout: 30_000 });
      console.log(`${p.name}-${vp.tag}.png${overflow > 0 ? `  WARNING horizontal overflow ${overflow}px` : ""}`);
      await ctx.close();
    }
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
