import "server-only";
import { createWalletClient, getAddress, http, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { mezoTestnet, NETWORKS } from "@/config/chains";
import { RESCUE_GUARD, rescueGuardAbi } from "@/config/guard";
import { GUARD_GAS_FLOORS, borrowerOperationsSignaturesAbi } from "@/config/pools";
import { computeGasLimit } from "../rescue/gas";
import { explainGuardError, kindFromId, nicrAfterRescue, statusFromId, type GuardKind } from "../guard/plan";
import type { GuardDTO, GuardExecutionDTO, GuardPlanDTO, GuardRegistryDTO, GuardRegistryRowDTO, KeeperRunDTO } from "../guard/dto";
import { chainClient } from "./chain";
import { computeHints, readPosition } from "./musd-adapter";

const G = { address: RESCUE_GUARD.address, abi: rescueGuardAbi } as const;
export const guardDeployed = () => !isAddressEqual(RESCUE_GUARD.address, zeroAddress);

type RawPlan = { kind: number; deadline: bigint; amount: bigint; keeperTip: bigint; triggerIcr: bigint; nonce: bigint; signature: Hex };

function planDTO(p: RawPlan | undefined): GuardPlanDTO | null {
  const kind = p ? kindFromId(Number(p.kind)) : null;
  if (!p || !kind) return null;
  return { kind, amount: p.amount.toString(), keeperTip: p.keeperTip.toString(), triggerIcr: p.triggerIcr.toString(), deadline: Number(p.deadline), nonce: p.nonce.toString() };
}

/** Everything the UI needs about one owner's guard, read at a single block. */
export async function readGuard(owner: Address): Promise<GuardDTO> {
  const c = chainClient();
  const blockNumber = await c.getBlockNumber();
  const empty: GuardDTO = { deployed: false, address: RESCUE_GUARD.address, owner, status: "none", icr: null, price: null, plan: null, reserves: { musd: "0", btc: "0" }, currentNonce: "0", outstanding: { live: false, deadline: 0 }, blockNumber: blockNumber.toString(), fetchedAt: Date.now() };
  if (!guardDeployed()) return empty;
  const [plan, status, musd, btc, nonce, outstanding] = await c.multicall({
    blockNumber,
    allowFailure: false,
    contracts: [
      { ...G, functionName: "getPlan", args: [owner] },
      { ...G, functionName: "planStatus", args: [owner] },
      { ...G, functionName: "musdReserve", args: [owner] },
      { ...G, functionName: "btcReserve", args: [owner] },
      { address: RESCUE_GUARD.borrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, functionName: "getNonce", args: [owner] },
      { ...G, functionName: "outstandingAuthorization", args: [owner] },
    ],
  });
  const [st, icr, price] = status as unknown as readonly [number, bigint, bigint];
  return {
    ...empty,
    deployed: true,
    status: statusFromId(Number(st)),
    icr: icr > 0n ? icr.toString() : null,
    price: price > 0n ? price.toString() : null,
    plan: planDTO(plan as unknown as RawPlan),
    reserves: { musd: String(musd), btc: String(btc) },
    currentNonce: String(nonce),
    outstanding: (() => {
      const [live, , deadline] = outstanding as unknown as readonly [boolean, bigint, bigint];
      return { live, deadline: Number(deadline) };
    })(),
  };
}

// ---------------------------------------------------------------------------------------------
// Registry: every borrower that ever armed a plan, from Armed events (incremental, chunked: Mezo RPC caps
// eth_getLogs at 10,000 blocks per call).

const LOG_CHUNK = 9_999n;
const scan = { to: 0n, owners: new Set<string>(), executions: [] as GuardExecutionDTO[], at: 0 };
const EVENTS = rescueGuardAbi.filter((x) => x.type === "event" && (x.name === "Armed" || x.name === "RescueExecuted"));

async function scanEvents() {
  if (!guardDeployed()) return;
  const c = chainClient();
  const head = await c.getBlockNumber();
  let from = scan.to === 0n ? BigInt(RESCUE_GUARD.deployBlock) : scan.to + 1n;
  while (from <= head) {
    const to = from + LOG_CHUNK > head ? head : from + LOG_CHUNK;
    const logs = await c.getLogs({ address: RESCUE_GUARD.address, events: EVENTS, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args as Record<string, unknown>;
      if (l.eventName === "Armed") scan.owners.add(getAddress(a.borrower as string));
      if (l.eventName === "RescueExecuted") {
        scan.executions.push({
          owner: getAddress(a.borrower as string),
          keeper: getAddress(a.keeper as string),
          kind: kindFromId(Number(a.kind)) ?? "repay",
          amount: String(a.amount),
          keeperTip: String(a.keeperTip),
          icrBefore: String(a.icrBefore),
          icrAfter: String(a.icrAfter),
          price: String(a.price),
          txHash: l.transactionHash!,
          blockNumber: Number(l.blockNumber),
        });
      }
    }
    scan.to = to;
    from = to + 1n;
  }
  scan.at = Date.now();
}

let registryCache: { at: number; data: GuardRegistryDTO } | null = null;

export async function listGuards(force = false): Promise<GuardRegistryDTO> {
  if (!force && registryCache && Date.now() - registryCache.at < 15_000) return registryCache.data;
  const keeper = keeperAccount();
  const base: GuardRegistryDTO = { deployed: guardDeployed(), address: RESCUE_GUARD.address, deployBlock: RESCUE_GUARD.deployBlock, scannedTo: "0", keeper: { configured: !!keeper, address: keeper?.address ?? null, btc: null }, plans: [], executions: [], fetchedAt: Date.now() };
  if (!guardDeployed()) return base;
  const c = chainClient();
  await scanEvents();
  const owners = [...scan.owners] as Address[];
  const results = owners.length
    ? await c.multicall({
        allowFailure: true,
        contracts: owners.flatMap((o) => [
          { ...G, functionName: "getPlan", args: [o] },
          { ...G, functionName: "planStatus", args: [o] },
          { ...G, functionName: "musdReserve", args: [o] },
          { ...G, functionName: "btcReserve", args: [o] },
        ]),
      })
    : [];
  const plans: GuardRegistryRowDTO[] = owners.map((owner, i) => {
    const [p, s, m, b] = results.slice(i * 4, i * 4 + 4);
    const st = s?.status === "success" ? (s.result as unknown as readonly [number, bigint, bigint]) : null;
    return {
      owner,
      status: st ? statusFromId(Number(st[0])) : "none",
      icr: st && st[1] > 0n ? st[1].toString() : null,
      plan: p?.status === "success" ? planDTO(p.result as unknown as RawPlan) : null,
      reserves: { musd: m?.status === "success" ? String(m.result) : "0", btc: b?.status === "success" ? String(b.result) : "0" },
    };
  });
  // Ready first, then armed, then everything else; within a group, lowest ICR first.
  const rank = (s: string) => (s === "ready" ? 0 : s === "waiting" ? 1 : s === "none" ? 3 : 2);
  plans.sort((a, b) => rank(a.status) - rank(b.status) || Number(BigInt(a.icr ?? "0") - BigInt(b.icr ?? "0")));
  const data: GuardRegistryDTO = {
    ...base,
    scannedTo: scan.to.toString(),
    keeper: { ...base.keeper, btc: keeper ? (await c.getBalance({ address: keeper.address })).toString() : null },
    plans,
    executions: [...scan.executions].sort((a, b) => b.blockNumber - a.blockNumber).slice(0, 50),
    fetchedAt: Date.now(),
  };
  registryCache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------------------------------------
// Execution (keeper and any visitor's wallet).

/** SortedTroves hints for the trove's position after its planned rescue. */
export async function executeHints(owner: Address, plan: { kind: GuardKind; amount: bigint }): Promise<{ upper: Address; lower: Address }> {
  const pos = await readPosition(owner);
  if (!pos.active) return { upper: zeroAddress, lower: zeroAddress };
  const nicr = nicrAfterRescue(plan.kind, plan.amount, BigInt(pos.coll), BigInt(pos.principal), BigInt(pos.interest));
  const h = await computeHints(nicr, owner);
  return { upper: h.upper, lower: h.lower };
}

let keeperCache: PrivateKeyAccount | null | undefined;
function keeperAccount(): PrivateKeyAccount | null {
  if (keeperCache !== undefined) return keeperCache;
  const k = process.env.KEEPER_PRIVATE_KEY?.trim();
  keeperCache = k && /^(0x)?[0-9a-fA-F]{64}$/.test(k) ? privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as Hex) : null;
  return keeperCache;
}

let lastKeeperRun = 0;
const KEEPER_MIN_INTERVAL_MS = 20_000;

/**
 * Run every plan RescueGuard reports as Ready. The contract re-checks the trigger on-chain, so the keeper can only
 * ever execute rescues the borrower authorized, at or below their trigger. Each candidate is simulated first.
 */
export async function runKeeper(source: "cron" | "visit" | "check_now"): Promise<KeeperRunDTO> {
  const out: KeeperRunDTO = { ok: true, checked: 0, ready: 0, executed: [], failed: [] };
  if (!guardDeployed()) return { ...out, skipped: "RescueGuard is not deployed" };
  const keeper = keeperAccount();
  if (!keeper) return { ...out, skipped: "No keeper key configured on this server. Anyone can still run ready rescues from the Guard page." };
  if (source !== "cron" && Date.now() - lastKeeperRun < KEEPER_MIN_INTERVAL_MS) return { ...out, skipped: "The keeper ran less than 20 seconds ago." };
  lastKeeperRun = Date.now();

  const reg = await listGuards(true);
  out.checked = reg.plans.length;
  const ready = reg.plans.filter((p) => p.status === "ready" && p.plan);
  out.ready = ready.length;
  if (!ready.length) return out;

  const c = chainClient();
  const wallet = createWalletClient({ account: keeper, chain: mezoTestnet, transport: http(process.env.MEZO_TESTNET_RPC || NETWORKS.testnet.rpc) });
  for (const row of ready) {
    const owner = getAddress(row.owner);
    try {
      const { upper, lower } = await executeHints(owner, { kind: row.plan!.kind, amount: BigInt(row.plan!.amount) });
      const args = [owner, upper, lower] as const;
      await c.simulateContract({ ...G, functionName: "execute", args, account: keeper });
      const estimate = await c.estimateContractGas({ ...G, functionName: "execute", args, account: keeper }).catch(() => null);
      const gas = computeGasLimit(estimate, GUARD_GAS_FLOORS.execute).limit;
      const hash = await wallet.writeContract({ ...G, functionName: "execute", args, gas });
      const rc = await c.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2_000 });
      out.executed.push({ owner, txHash: hash, status: rc.status });
    } catch (e) {
      out.ok = false;
      out.failed.push({ owner, error: explainGuardError(e) });
    }
  }
  registryCache = null;
  return out;
}
