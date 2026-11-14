/**
 * Top up the e2e test wallets with testnet BTC from the deployer and record the transfers.
 *   npx tsx scripts/fund-wallets.ts
 * Wallets: keeper (runs rescues for tips), watcher (a second user who watches troves and swaps), outsider
 * (tries unauthorized actions). Keys live in the gitignored .env.e2e-wallets.json; addresses are recorded.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { mezoTestnet } from "../src/config/chains";
import { loadDeployer, loadWallets } from "./lib/keys";

const TARGET: Record<string, bigint> = { keeper: parseEther("0.002"), watcher: parseEther("0.004"), outsider: parseEther("0.0005") };

async function main() {
  const pub = createPublicClient({ chain: mezoTestnet, transport: http() });
  const deployer = loadDeployer();
  const wallet = createWalletClient({ account: deployer, chain: mezoTestnet, transport: http() });
  const wallets = loadWallets();
  const out = existsSync("deployments/test-wallets.json") ? JSON.parse(readFileSync("deployments/test-wallets.json", "utf8")) : { note: "Testnet e2e wallets (addresses only; keys are never committed).", wallets: {}, funding: [] };
  out.wallets.deployer = { address: deployer.address, role: "Owner of the real MUSD trove used in the demo; deploys RescueGuard and funds the others." };
  for (const [role, acct] of Object.entries(wallets)) {
    out.wallets[role] = { address: acct.address, role: { keeper: "Runs ready rescues for the keeper tip.", watcher: "Second user: watches troves, swaps BTC for MUSD.", outsider: "Attempts unauthorized actions (negative tests)." }[role] };
    const bal = await pub.getBalance({ address: acct.address });
    const need = TARGET[role] - bal;
    console.log(`${role.padEnd(8)} ${acct.address} balance ${formatEther(bal)} BTC`);
    if (need <= 0n) continue;
    const hash = await wallet.sendTransaction({ to: acct.address, value: need, gas: 30_000n });
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    console.log(`  funded +${formatEther(need)} BTC  tx ${hash} (${rc.status})`);
    out.funding.push({ role, to: acct.address, value: formatEther(need), tx: hash, block: Number(rc.blockNumber), at: new Date().toISOString() });
  }
  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/test-wallets.json", JSON.stringify(out, null, 2) + "\n");
  console.log("deployer balance", formatEther(await pub.getBalance({ address: deployer.address })), "BTC");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
