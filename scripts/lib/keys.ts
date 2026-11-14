/**
 * Key handling for scripts (never used by the app). Keys are read at runtime and never printed or committed:
 *  - deployer: .env.deployer in the repo root (gitignored by `.env*`, excluded from Vercel uploads), line
 *    PRIVATE_KEY=... Override with DEPLOYER_ENV_FILE. Deploys RescueGuard and funds the test wallets.
 *  - demo trove owner: TROVE_OWNER_ENV_FILE (default C:/Users/nikku/Desktop/.env.txt, outside the repo). Owns the
 *    long-running demo trove 0x10ac…B628 shown across the app; used as one of the e2e borrowers.
 *  - test wallets: .env.e2e-wallets.json in the repo root (gitignored), generated on first use. Testnet only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const DEPLOYER_ENV_FILE = resolve(process.env.DEPLOYER_ENV_FILE || ".env.deployer");
export const TROVE_OWNER_ENV_FILE = process.env.TROVE_OWNER_ENV_FILE || "C:/Users/nikku/Desktop/.env.txt";
export const WALLETS_FILE = resolve(process.env.TEST_WALLETS_FILE || ".env.e2e-wallets.json");

function keyFromEnvFile(path: string): PrivateKeyAccount {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(/PRIVATE_KEY\s*=\s*["']?(0x)?([0-9a-fA-F]{64})/);
  if (!m) throw new Error(`PRIVATE_KEY not found in ${path}`);
  return privateKeyToAccount(`0x${m[2]}` as Hex);
}

export function loadDeployer(): PrivateKeyAccount {
  return keyFromEnvFile(DEPLOYER_ENV_FILE);
}

export function loadTroveOwner(): PrivateKeyAccount {
  return keyFromEnvFile(TROVE_OWNER_ENV_FILE);
}

export type WalletRole = "keeper" | "watcher" | "outsider";
const ROLES: WalletRole[] = ["keeper", "watcher", "outsider"];

/** Test wallets by role, created (and saved to the gitignored file) if missing. */
export function loadWallets(): Record<WalletRole, PrivateKeyAccount> {
  let stored: Partial<Record<WalletRole, string>> = {};
  if (existsSync(WALLETS_FILE)) stored = JSON.parse(readFileSync(WALLETS_FILE, "utf8"));
  let changed = false;
  for (const r of ROLES) {
    if (!stored[r]) {
      stored[r] = generatePrivateKey();
      changed = true;
    }
  }
  if (changed) writeFileSync(WALLETS_FILE, JSON.stringify(stored, null, 2), { mode: 0o600 });
  return Object.fromEntries(ROLES.map((r) => [r, privateKeyToAccount(stored[r] as Hex)])) as Record<WalletRole, PrivateKeyAccount>;
}
