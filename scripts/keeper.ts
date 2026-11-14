/**
 * Standalone RescueGuard keeper. Anyone can run one: it watches every armed plan and executes the ones the contract
 * reports as Ready, earning the owner-chosen tip. RescueGuard re-checks the trigger on-chain, so a keeper can never
 * move funds outside what a borrower authorized.
 *
 *   npm run keeper                 # loop every 30 s (KEEPER_INTERVAL_S to change)
 *   npm run keeper -- --once       # one pass, exit (used by the e2e)
 *
 * Key: KEEPER_PRIVATE_KEY, or the `keeper` wallet in the gitignored .env.e2e-wallets.json. Never printed.
 */
import { createPublicClient, createWalletClient, http, getAddress, isAddressEqual, zeroAddress, formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/config/chains";
import { MUSD_CONTRACTS, ABIS } from "../src/config/contracts";
import { RESCUE_GUARD, rescueGuardAbi } from "../src/config/guard";
import { GUARD_GAS_FLOORS } from "../src/config/pools";
import { computeGasLimit } from "../src/lib/rescue/gas";
import { explainGuardError, kindFromId, nicrAfterRescue, statusFromId } from "../src/lib/guard/plan";
import { loadWallets } from "./lib/keys";

const A = MUSD_CONTRACTS.testnet;
const G = { address: RESCUE_GUARD.address, abi: rescueGuardAbi } as const;
const pub = createPublicClient({ chain: mezoTestnet, transport: http() });
const ONCE = process.argv.includes("--once");
const INTERVAL = Number(process.env.KEEPER_INTERVAL_S || 30) * 1000;

function keeperAccount() {
  const k = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (k) return privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex);
  return loadWallets().keeper;
}

const owners = new Set<Address>();
let scannedTo = 0n;
const EVENTS = rescueGuardAbi.filter((x) => x.type === "event" && x.name === "Armed");

async function scan() {
  const head = await pub.getBlockNumber();
  let from = scannedTo === 0n ? BigInt(RESCUE_GUARD.deployBlock) : scannedTo + 1n;
  while (from <= head) {
    const to = from + 9_999n > head ? head : from + 9_999n;
    for (const l of await pub.getLogs({ address: RESCUE_GUARD.address, events: EVENTS, fromBlock: from, toBlock: to })) owners.add(getAddress((l.args as { borrower: string }).borrower));
    scannedTo = to;
    from = to + 1n;
  }
}

async function hints(owner: Address, kind: "repay" | "addColl", amount: bigint): Promise<[Address, Address]> {
  const e = await pub.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getEntireDebtAndColl", args: [owner] });
  const [coll, principal, interest] = e as unknown as readonly [bigint, bigint, bigint];
  const nicr = nicrAfterRescue(kind, amount, coll, principal, interest);
  if (nicr == null) return [zeroAddress, zeroAddress];
  const size = await pub.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getSize" });
  const trials = BigInt(Math.max(1, Math.ceil(15 * Math.sqrt(Number(size)))));
  const [approx] = await pub.readContract({ address: A.HintHelpers, abi: ABIS.HintHelpers, functionName: "getApproxHint", args: [nicr, trials, BigInt(Date.now())] });
  let [upper, lower] = await pub.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "findInsertPosition", args: [nicr, approx, approx] });
  if (isAddressEqual(upper, owner)) upper = await pub.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getPrev", args: [owner] });
  if (isAddressEqual(lower, owner)) lower = await pub.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getNext", args: [owner] });
  return [upper, lower];
}

export async function keeperPass(log = console.log): Promise<{ executed: { owner: Address; hash: Hex; status: string }[] }> {
  const account = keeperAccount();
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http() });
  await scan();
  const executed: { owner: Address; hash: Hex; status: string }[] = [];
  for (const owner of owners) {
    const [st, icr] = (await pub.readContract({ ...G, functionName: "planStatus", args: [owner] })) as unknown as readonly [number, bigint, bigint];
    const status = statusFromId(Number(st));
    if (status !== "ready") continue;
    const plan = (await pub.readContract({ ...G, functionName: "getPlan", args: [owner] })) as unknown as { kind: number; amount: bigint };
    const kind = kindFromId(Number(plan.kind))!;
    log(`ready: ${owner} ICR ${formatEther(icr * 100n)}% plan ${kind} ${formatEther(plan.amount)}`);
    try {
      const [upper, lower] = await hints(owner, kind, plan.amount);
      const args = [owner, upper, lower] as const;
      await pub.simulateContract({ ...G, functionName: "execute", args, account });
      const est = await pub.estimateContractGas({ ...G, functionName: "execute", args, account }).catch(() => null);
      const hash = await wallet.writeContract({ ...G, functionName: "execute", args, gas: computeGasLimit(est, GUARD_GAS_FLOORS.execute).limit });
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      log(`  executed ${hash} (${rc.status}, gas ${rc.gasUsed})`);
      executed.push({ owner, hash, status: rc.status });
    } catch (e) {
      log(`  skipped: ${explainGuardError(e)}`);
    }
  }
  return { executed };
}

async function main() {
  if (isAddressEqual(RESCUE_GUARD.address, zeroAddress)) throw new Error("RescueGuard is not deployed (src/config/guard.ts)");
  const account = keeperAccount();
  console.log(`keeper ${account.address} watching RescueGuard ${RESCUE_GUARD.address}, balance ${formatEther(await pub.getBalance({ address: account.address }))} BTC`);
  do {
    try {
      await keeperPass();
    } catch (e) {
      console.error("pass failed:", e instanceof Error ? e.message.split("\n")[0] : e);
    }
    if (!ONCE) await new Promise((r) => setTimeout(r, INTERVAL));
  } while (!ONCE);
}

if (process.argv[1]?.endsWith("keeper.ts")) main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
