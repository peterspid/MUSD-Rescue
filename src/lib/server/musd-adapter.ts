import "server-only";
import { decodeEventLog, encodeFunctionData, getAddress, isAddressEqual, keccak256, pad, parseAbi, toHex, zeroAddress, type Address, type Hex } from "viem";
import { MUSD_CONTRACTS, ABIS, GAS_FLOORS, CONTRACT_SOURCES, MUSD_TOKEN } from "@/config/contracts";
import { NETWORKS, mezoTestnet } from "@/config/chains";
import { chainClient, mapLimit } from "./chain";
import type { HistoryPointDTO, ParamsDTO, PositionDTO, PreparedRescueDTO, RadarDTO, RadarTroveDTO, SystemDTO, TroveEventDTO } from "../dto";
import type { LendingAdapter, RescueRequest } from "../adapters/types";
import {
  WAD,
  assessPosition,
  assessSystem,
  computeCR,
  healthFactor,
  interestPerDay,
  liquidationPrice,
  liquidationThreshold,
  positionFromEntire,
  priceDropToLiquidationBps,
  simulateAdjustment,
  TROVE_STATUS_LABEL,
  TroveStatus,
  type ProtocolParams,
} from "../risk";
import { computeGasLimit } from "../rescue/gas";
import { paramsFromDTO } from "../convert";
import { approvalRequirement } from "../rescue/approval";

const A = MUSD_CONTRACTS.testnet;

const multicall3Abi = parseAbi([
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
]);
const oracleAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export class AdapterError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

type McResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

let oracleAddr: Address | null = null;
async function oracle(): Promise<Address> {
  if (!oracleAddr) {
    oracleAddr = await chainClient().readContract({ address: A.PriceFeed, abi: ABIS.PriceFeed, functionName: "oracle" });
  }
  return oracleAddr;
}

function systemCalls(oracleAddress: Address) {
  return [
    { address: A.PriceFeed, abi: ABIS.PriceFeed, functionName: "fetchPrice" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "getEntireSystemColl" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "getEntireSystemDebt" },
    { address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getTroveOwnersCount" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "MCR" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "CCR" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "MUSD_GAS_COMPENSATION" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "minNetDebt" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "borrowingRate" },
    { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "redemptionRate" },
    { address: A.InterestRateManager, abi: ABIS.InterestRateManager, functionName: "interestRate" },
    { address: A.StabilityPool, abi: ABIS.StabilityPool, functionName: "getTotalMUSDDeposits" },
    { address: A.Multicall3, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
    { address: A.Multicall3, abi: multicall3Abi, functionName: "getBlockNumber" },
    { address: oracleAddress, abi: oracleAbi, functionName: "latestRoundData" },
  ] as const;
}
const SYS_LEN = 15;

function ok<T>(r: McResult, label: string): T {
  if (r.status !== "success") throw new AdapterError(502, "rpc", `Could not read ${label} from Mezo testnet: ${r.error?.message?.split("\n")[0] ?? "unknown error"}`);
  return r.result as T;
}

export { paramsFromDTO };

function buildSystem(r: McResult[], fetchedAt: number): SystemDTO {
  const totalColl = ok<bigint>(r[1], "system collateral");
  const totalDebt = ok<bigint>(r[2], "system debt");
  const troveCount = ok<bigint>(r[3], "trove count");
  const blockTime = ok<bigint>(r[12], "block timestamp");
  const blockNumber = ok<bigint>(r[13], "block number");
  const params: ParamsDTO = {
    mcr: ok<bigint>(r[4], "MCR").toString(),
    ccr: ok<bigint>(r[5], "CCR").toString(),
    gasCompensation: ok<bigint>(r[6], "gas compensation").toString(),
    minNetDebt: ok<bigint>(r[7], "minNetDebt").toString(),
    borrowingRate: ok<bigint>(r[8], "borrowing rate").toString(),
    redemptionRate: ok<bigint>(r[9], "redemption rate").toString(),
    interestRateBps: Number(ok<number>(r[10], "interest rate")),
  };
  const price = r[0].status === "success" ? (r[0].result as bigint) : null;
  const priceError = r[0].status === "failure" ? (r[0].error.message.includes("stale") ? "PriceFeed: Oracle is stale." : r[0].error.message.split("\n")[0]) : null;
  let oracleUpdatedAt: number | null = null;
  if (r[14].status === "success") {
    const rd = r[14].result as readonly [bigint, bigint, bigint, bigint, bigint];
    oracleUpdatedAt = Number(rd[3]);
  }
  const sys = price ? assessSystem({ totalColl, totalDebt, price }, paramsFromDTO(params)) : null;
  return {
    network: "testnet",
    blockNumber: blockNumber.toString(),
    blockTime: Number(blockTime),
    price: price?.toString() ?? null,
    priceError,
    oracleUpdatedAt,
    oracleAgeSec: oracleUpdatedAt != null ? Number(blockTime) - oracleUpdatedAt : null,
    tcr: sys?.tcr?.toString() ?? null,
    recoveryMode: sys ? sys.recoveryMode : null,
    recoveryPrice: sys?.recoveryPrice?.toString() ?? null,
    dropToRecoveryBps: sys?.dropToRecoveryBps?.toString() ?? null,
    totalColl: totalColl.toString(),
    totalDebt: totalDebt.toString(),
    troveCount: Number(troveCount),
    stabilityPoolMusd: r[11].status === "success" ? (r[11].result as bigint).toString() : "0",
    params,
    fetchedAt,
  };
}

async function multicall(contracts: readonly unknown[], blockNumber?: bigint): Promise<McResult[]> {
  return (await chainClient().multicall({
    contracts: contracts as never,
    allowFailure: true,
    blockNumber,
  })) as unknown as McResult[];
}

export async function readSystem(blockNumber?: bigint): Promise<SystemDTO> {
  const r = await multicall(systemCalls(await oracle()), blockNumber);
  return buildSystem(r, Date.now());
}

export async function readPosition(owner: Address, blockNumber?: bigint): Promise<PositionDTO> {
  const o = getAddress(owner);
  const calls = [
    ...systemCalls(await oracle()),
    { address: A.TroveManager, abi: ABIS.TroveManager, functionName: "Troves", args: [o] },
    { address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getEntireDebtAndColl", args: [o] },
    { address: A.MUSD, abi: ABIS.MUSD, functionName: "balanceOf", args: [o] },
    { address: A.Multicall3, abi: multicall3Abi, functionName: "getEthBalance", args: [o] },
  ] as const;
  const r = await multicall(calls, blockNumber);
  const fetchedAt = Date.now();
  const system = buildSystem(r, fetchedAt);
  const params = paramsFromDTO(system.params);
  const t = ok<readonly [bigint, bigint, bigint, bigint, number, number, bigint, bigint, bigint]>(r[SYS_LEN], "trove");
  const e = ok<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>(r[SYS_LEN + 1], "trove debt");
  const musd = ok<bigint>(r[SYS_LEN + 2], "MUSD balance");
  const btc = ok<bigint>(r[SYS_LEN + 3], "BTC balance");
  const status = Number(t[4]);
  const active = status === TroveStatus.Active;
  const amounts = positionFromEntire(e[0], e[1], e[2], params);
  const accrued = e[2] - t[2] - e[5];
  const price = system.price ? BigInt(system.price) : null;
  let risk: PositionDTO["risk"] = null;
  if (price != null && active) {
    const a = assessPosition(amounts, price, params, !!system.recoveryMode);
    risk = {
      icr: a.icr?.toString() ?? null,
      hf: a.hf?.toString() ?? null,
      category: a.category,
      threshold: a.threshold.toString(),
      liquidationPrice: a.liquidationPrice?.toString() ?? null,
      dropToLiquidationBps: a.dropToLiquidationBps?.toString() ?? null,
      collValue: a.collValue.toString(),
      debtValue: a.debtValue.toString(),
      maxRepayWithoutClosing: a.maxRepayWithoutClosing.toString(),
      closeCost: a.closeCost.toString(),
    };
  }
  return {
    source: "onchain",
    owner: o,
    network: "testnet",
    status,
    statusLabel: TROVE_STATUS_LABEL[status] ?? `Status ${status}`,
    active,
    coll: amounts.coll.toString(),
    principal: amounts.principal.toString(),
    interest: amounts.interest.toString(),
    debt: amounts.debt.toString(),
    netDebt: amounts.netDebt.toString(),
    breakdown: {
      storedColl: t[0].toString(),
      pendingColl: e[3].toString(),
      storedPrincipal: t[1].toString(),
      pendingPrincipal: e[4].toString(),
      gasCompensation: active ? system.params.gasCompensation : "0",
      storedInterest: t[2].toString(),
      accruedInterest: (accrued > 0n ? accrued : 0n).toString(),
      pendingInterest: e[5].toString(),
    },
    interestRateBps: Number(t[5]),
    interestPerDay: interestPerDay(amounts.principal, Number(t[5])).toString(),
    lastInterestUpdateTime: Number(t[6]),
    maxBorrowingCapacity: t[7].toString(),
    risk,
    wallet: { musd: musd.toString(), btc: btc.toString() },
    system,
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Liquidation radar: every trove, batched through Multicall3 at one block height.
let radarCache: { at: number; data: RadarDTO } | null = null;
const RADAR_TTL_MS = 60_000;

export async function listAllTroves(force = false): Promise<RadarDTO> {
  if (!force && radarCache && Date.now() - radarCache.at < RADAR_TTL_MS) return radarCache.data;
  const system = await readSystem();
  const bn = BigInt(system.blockNumber);
  const count = system.troveCount;
  const idx = Array.from({ length: count }, (_, i) => BigInt(i));
  const ownersRes = await multicall(idx.map((i) => ({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getTroveFromTroveOwnersArray", args: [i] })), bn);
  const owners = ownersRes.filter((r) => r.status === "success").map((r) => r.result as Address);
  const entRes = await multicall(owners.map((o) => ({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getEntireDebtAndColl", args: [o] })), bn);
  const params = paramsFromDTO(system.params);
  const price = system.price ? BigInt(system.price) : null;
  const threshold = liquidationThreshold(params, !!system.recoveryMode);
  const troves: RadarTroveDTO[] = [];
  owners.forEach((owner, i) => {
    const r = entRes[i];
    if (r.status !== "success") return;
    const e = r.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
    const debt = e[1] + e[2];
    const icr = price != null ? computeCR(e[0], debt, price) : null;
    const liq = liquidationPrice(e[0], debt, threshold);
    troves.push({
      owner,
      coll: e[0].toString(),
      debt: debt.toString(),
      icr: icr?.toString() ?? null,
      liquidationPrice: liq?.toString() ?? null,
      dropToLiquidationBps: price != null ? priceDropToLiquidationBps(price, liq)?.toString() ?? null : null,
    });
  });
  troves.sort((a, b) => {
    if (a.icr == null) return 1;
    if (b.icr == null) return -1;
    const x = BigInt(a.icr), y = BigInt(b.icr);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const data: RadarDTO = { system, troves, method: "multicall3", fetchedAt: Date.now() };
  radarCache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------------------------------------
// History from archive state: PriceFeed.fetchPrice and getEntireDebtAndColl at past blocks.
let blockTimeCache: { at: number; secPerBlock: number } | null = null;
async function secondsPerBlock(): Promise<number> {
  if (blockTimeCache && Date.now() - blockTimeCache.at < 3_600_000) return blockTimeCache.secPerBlock;
  const c = chainClient();
  const latest = await c.getBlock();
  const past = await c.getBlock({ blockNumber: latest.number - 50_000n });
  const spb = Number(latest.timestamp - past.timestamp) / 50_000;
  blockTimeCache = { at: Date.now(), secPerBlock: spb > 0 ? spb : 4 };
  return blockTimeCache.secPerBlock;
}

const historyCache = new Map<string, { at: number; data: HistoryPointDTO[] }>();
const HISTORY_TTL_MS = 5 * 60_000;

export async function readHistory(owner: Address | null, rangeSec: number, points: number): Promise<HistoryPointDTO[]> {
  const key = `${owner ?? "system"}|${rangeSec}|${points}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.data;
  const c = chainClient();
  const [latest, spb] = await Promise.all([c.getBlockNumber(), secondsPerBlock()]);
  const span = BigInt(Math.round(rangeSec / spb));
  const n = Math.max(2, Math.min(points, 96));
  const blocks: bigint[] = [];
  for (let k = 0; k < n; k++) {
    const b = latest - (span * BigInt(n - 1 - k)) / BigInt(n - 1);
    if (b > 0n) blocks.push(b);
  }
  const o = owner ? getAddress(owner) : null;
  const data = await mapLimit(blocks, 8, async (bn): Promise<HistoryPointDTO> => {
    const calls = [
      { address: A.PriceFeed, abi: ABIS.PriceFeed, functionName: "fetchPrice" },
      { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "getEntireSystemColl" },
      { address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "getEntireSystemDebt" },
      { address: A.Multicall3, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
      ...(o
        ? [
            { address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getTroveStatus", args: [o] },
            { address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getEntireDebtAndColl", args: [o] },
          ]
        : []),
    ];
    try {
      const r = await multicall(calls, bn);
      const price = r[0].status === "success" ? (r[0].result as bigint) : null;
      const sColl = r[1].status === "success" ? (r[1].result as bigint) : null;
      const sDebt = r[2].status === "success" ? (r[2].result as bigint) : null;
      const ts = r[3].status === "success" ? Number(r[3].result as bigint) : 0;
      const tcr = price != null && sColl != null && sDebt != null ? computeCR(sColl, sDebt, price) : null;
      let status: number | null = null, coll: bigint | null = null, debt: bigint | null = null, icr: bigint | null = null;
      if (o && r[4]?.status === "success" && r[5]?.status === "success") {
        status = Number(r[4].result);
        const e = r[5].result as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
        if (status === TroveStatus.Active) {
          coll = e[0];
          debt = e[1] + e[2];
          icr = price != null ? computeCR(coll, debt, price) : null;
        }
      }
      return { blockNumber: bn.toString(), blockTime: ts, price: price?.toString() ?? null, tcr: tcr?.toString() ?? null, status, coll: coll?.toString() ?? null, debt: debt?.toString() ?? null, icr: icr?.toString() ?? null };
    } catch {
      return { blockNumber: bn.toString(), blockTime: 0, price: null, tcr: null, status: null, coll: null, debt: null, icr: null };
    }
  });
  const clean = data.filter((p) => p.blockTime > 0);
  historyCache.set(key, { at: Date.now(), data: clean });
  if (historyCache.size > 200) historyCache.delete(historyCache.keys().next().value as string);
  return clean;
}

// ---------------------------------------------------------------------------------------------
// Trove event log (Blockscout getLogs over full history, RPC fallback for the last 10k blocks).
const TROVE_UPDATED_TOPIC = keccak256(toHex("TroveUpdated(address,uint256,uint256,uint256,uint256,uint16,uint256,uint8)"));
const TROVE_LIQUIDATED_TOPIC = keccak256(toHex("TroveLiquidated(address,uint256,uint256,uint8)"));
const BO_OPS = ["Trove opened", "Trove closed", "Trove adjusted", "Refinanced"];
const TM_OPS = ["Redistribution applied", "Liquidated", "Redeemed against"];

interface RawLog { address: string; topics: string[]; data: string; blockNumber: string; timeStamp?: string; transactionHash: string; logIndex?: string }

async function blockscoutLogs(address: Address, topic0: Hex, owner: Address): Promise<RawLog[]> {
  const url = `${NETWORKS.testnet.explorerApi.replace("/v2", "")}?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${address}&topic0=${topic0}&topic1=${pad(owner.toLowerCase() as Hex)}&topic0_1_opr=and`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const j = (await res.json()) as { status: string; message: string; result: RawLog[] | string };
  if (!Array.isArray(j.result)) {
    if (/no records/i.test(j.message)) return [];
    throw new Error(`explorer: ${j.message}`);
  }
  return j.result;
}

const eventsCache = new Map<string, { at: number; data: TroveEventDTO[] }>();

export async function readTroveEvents(owner: Address): Promise<TroveEventDTO[]> {
  const o = getAddress(owner);
  const hit = eventsCache.get(o);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  let logs: RawLog[];
  try {
    const [bo, tm, liq] = await Promise.all([
      blockscoutLogs(A.BorrowerOperations, TROVE_UPDATED_TOPIC, o),
      blockscoutLogs(A.TroveManager, TROVE_UPDATED_TOPIC, o),
      blockscoutLogs(A.TroveManager, TROVE_LIQUIDATED_TOPIC, o),
    ]);
    logs = [...bo, ...tm, ...liq];
  } catch {
    const c = chainClient();
    const latest = await c.getBlockNumber();
    const raw = await c.getLogs({ address: [A.BorrowerOperations, A.TroveManager], fromBlock: latest > 9_999n ? latest - 9_999n : 0n, toBlock: latest, topics: [[TROVE_UPDATED_TOPIC, TROVE_LIQUIDATED_TOPIC], pad(o.toLowerCase() as Hex)] } as never);
    logs = (raw as unknown as { address: string; topics: string[]; data: string; blockNumber: bigint; transactionHash: string }[]).map((l) => ({ ...l, blockNumber: toHex(l.blockNumber) }));
  }
  const events: TroveEventDTO[] = [];
  for (const l of logs) {
    const isBO = isAddressEqual(l.address as Address, A.BorrowerOperations);
    try {
      const ev = decodeEventLog({ abi: isBO ? ABIS.BorrowerOperations : ABIS.TroveManager, data: l.data as Hex, topics: l.topics as [Hex, ...Hex[]] });
      const bn = Number(BigInt(l.blockNumber));
      const ts = l.timeStamp ? Number(BigInt(l.timeStamp)) : null;
      if (ev.eventName === "TroveUpdated") {
        const a = ev.args as { _principal: bigint; _interest: bigint; _coll: bigint; _operation: number };
        events.push({ txHash: l.transactionHash, blockNumber: bn, timestamp: ts, contract: isBO ? "BorrowerOperations" : "TroveManager", operation: (isBO ? BO_OPS : TM_OPS)[Number(a._operation)] ?? `Operation ${a._operation}`, principal: a._principal.toString(), interest: a._interest.toString(), coll: a._coll.toString() });
      } else if (ev.eventName === "TroveLiquidated") {
        const a = ev.args as { _debt: bigint; _coll: bigint };
        events.push({ txHash: l.transactionHash, blockNumber: bn, timestamp: ts, contract: "TroveManager", operation: "Liquidated", principal: a._debt.toString(), interest: "0", coll: a._coll.toString() });
      }
    } catch {
      /* unrelated log */
    }
  }
  // Describe adjustments by diffing consecutive states (chronological).
  events.sort((a, b) => a.blockNumber - b.blockNumber);
  for (let i = 1; i < events.length; i++) {
    const cur = events[i], prev = events[i - 1];
    if (cur.operation !== "Trove adjusted") continue;
    const dColl = BigInt(cur.coll) - BigInt(prev.coll);
    const dDebt = BigInt(cur.principal) + BigInt(cur.interest) - (BigInt(prev.principal) + BigInt(prev.interest));
    const parts: string[] = [];
    if (dColl > 0n) parts.push("Collateral added");
    if (dColl < 0n) parts.push("Collateral withdrawn");
    if (dDebt < 0n) parts.push("Debt repaid");
    if (dDebt > 0n && BigInt(cur.principal) > BigInt(prev.principal)) parts.push("Debt drawn");
    if (parts.length) cur.operation = parts.join(" + ");
  }
  events.reverse();
  eventsCache.set(o, { at: Date.now(), data: events });
  return events;
}

// ---------------------------------------------------------------------------------------------
// Hints and transaction preparation.
export async function computeHints(nicr: bigint | null, owner: Address): Promise<{ upper: Address; lower: Address; numTrials: number }> {
  if (nicr == null) return { upper: zeroAddress, lower: zeroAddress, numTrials: 0 };
  const c = chainClient();
  const size = await c.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getSize" });
  const numTrials = Math.max(1, Math.ceil(15 * Math.sqrt(Number(size))));
  const seed = BigInt(Math.floor(Math.random() * 2 ** 48));
  const [approx] = await c.readContract({ address: A.HintHelpers, abi: ABIS.HintHelpers, functionName: "getApproxHint", args: [nicr, BigInt(numTrials), seed] });
  let [upper, lower] = await c.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "findInsertPosition", args: [nicr, approx, approx] });
  // reInsert removes the trove before inserting it again, so a hint pointing at itself must be replaced by its neighbour.
  if (isAddressEqual(upper, owner)) upper = await c.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getPrev", args: [owner] });
  if (isAddressEqual(lower, owner)) lower = await c.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getNext", args: [owner] });
  return { upper, lower, numTrials };
}

function revertReason(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; details?: string; cause?: { reason?: string; shortMessage?: string } };
  return err?.cause?.reason || err?.shortMessage || err?.details || err?.message?.split("\n")[0] || "execution reverted";
}

export async function prepareRescue(req: RescueRequest): Promise<PreparedRescueDTO> {
  const { owner, repay, addColl } = req;
  if (repay < 0n || addColl < 0n || (repay === 0n && addColl === 0n)) throw new AdapterError(400, "invalid-amount", "Enter a repayment and/or a collateral amount.");
  // 1–2. Read and refresh the position immediately before preparing.
  const pos = await readPosition(owner);
  if (!pos.active) throw new AdapterError(422, "no-trove", "This address has no active MUSD trove.");
  if (!pos.system.price) throw new AdapterError(503, "oracle", `Oracle price unavailable (${pos.system.priceError ?? "unknown"}). The contract would reject the transaction.`);
  const params = paramsFromDTO(pos.system.params);
  const price = BigInt(pos.system.price);
  const amounts = positionFromEntire(BigInt(pos.coll), BigInt(pos.principal), BigInt(pos.interest), params);
  // 3. Validate with the protocol rules.
  const sim = simulateAdjustment(
    {
      position: amounts,
      price,
      params,
      system: { totalColl: BigInt(pos.system.totalColl), totalDebt: BigInt(pos.system.totalDebt) },
      active: true,
      wallet: { musd: BigInt(pos.wallet.musd), btc: BigInt(pos.wallet.btc) },
    },
    { repay, addColl },
  );
  if (!sim.ok) throw new AdapterError(422, "simulation-blocked", sim.checks.filter((c) => c.level === "block").map((c) => c.message).join(" "), sim.checks);
  // Hints for SortedTroves.reInsert (NICR uses principal only).
  const hints = await computeHints(sim.newNICR, getAddress(owner));
  let functionName: PreparedRescueDTO["functionName"];
  let data: Hex;
  let floor: bigint;
  if (repay > 0n && addColl > 0n) {
    functionName = "adjustTrove";
    data = encodeFunctionData({ abi: ABIS.BorrowerOperations, functionName: "adjustTrove", args: [0n, repay, false, hints.upper, hints.lower] });
    floor = GAS_FLOORS.adjustTrove;
  } else if (repay > 0n) {
    functionName = "repayMUSD";
    data = encodeFunctionData({ abi: ABIS.BorrowerOperations, functionName: "repayMUSD", args: [repay, hints.upper, hints.lower] });
    floor = GAS_FLOORS.repayMUSD;
  } else {
    functionName = "addColl";
    data = encodeFunctionData({ abi: ABIS.BorrowerOperations, functionName: "addColl", args: [hints.upper, hints.lower] });
    floor = GAS_FLOORS.addColl;
  }
  const c = chainClient();
  // Simulate on-chain (eth_call from the owner) — catches anything our model missed.
  try {
    await c.call({ account: getAddress(owner), to: A.BorrowerOperations, data, value: addColl });
  } catch (e) {
    throw new AdapterError(422, "chain-simulation-failed", `The protocol would reject this transaction: ${revertReason(e)}`);
  }
  const estimate = await c.estimateGas({ account: getAddress(owner), to: A.BorrowerOperations, data, value: addColl }).catch(() => null);
  const gas = computeGasLimit(estimate, floor);
  const gasPrice = await c.getGasPrice();
  const before = sim.before!;
  const after = sim.after!;
  const approval = approvalRequirement("burn-by-protocol", 0n, repay, A.BorrowerOperations);
  return {
    tx: { to: A.BorrowerOperations, data, value: addColl.toString(), gas: gas.limit.toString(), chainId: mezoTestnet.id },
    action: repay > 0n && addColl > 0n ? "repay_and_add" : repay > 0n ? "repay" : "add_collateral",
    functionName,
    amounts: { repay: repay.toString(), coll: addColl.toString() },
    hints: { upper: hints.upper, lower: hints.lower, nicr: sim.newNICR?.toString() ?? null, numTrials: hints.numTrials },
    approval: { needed: approval.needed, explanation: approval.explanation },
    gas: { estimate: estimate?.toString() ?? null, limit: gas.limit.toString(), floorApplied: gas.floorApplied, gasPrice: gasPrice.toString(), maxFeeWei: (gas.limit * gasPrice).toString() },
    before: { icr: before.icr?.toString() ?? null, hf: before.hf?.toString() ?? null, category: before.category, debt: amounts.debt.toString(), coll: amounts.coll.toString() },
    after: { icr: after.icr?.toString() ?? null, hf: after.hf?.toString() ?? null, category: after.category, debt: sim.newPosition!.debt.toString(), coll: sim.newPosition!.coll.toString() },
    checks: sim.checks.map((ch) => ({ id: ch.id, level: ch.level, message: ch.message })),
    chainSimulation: { ok: true },
    blockNumber: pos.system.blockNumber,
    price: price.toString(),
    preparedAt: Date.now(),
    contract: { name: "BorrowerOperations", address: A.BorrowerOperations },
    network: { name: mezoTestnet.name, chainId: mezoTestnet.id },
  };
}

export const musdAdapter: LendingAdapter = {
  metadata: {
    id: "mezo-musd",
    name: "Mezo MUSD",
    network: "testnet",
    chainId: mezoTestnet.id,
    collateral: [{ symbol: "BTC", decimals: 18, native: true }],
    debtToken: { symbol: MUSD_TOKEN.symbol, address: A.MUSD, decimals: 18 },
    riskMetric: "icr",
    repaymentTokenModel: "burn-by-protocol",
    contracts: { ...A },
    sources: [
      { label: "mezo-org/musd deployment artifacts (matsnet)", url: CONTRACT_SOURCES.testnetArtifacts },
      { label: "Mezo contracts reference", url: CONTRACT_SOURCES.docs },
    ],
  },
  async getParams() {
    return paramsFromDTO((await readSystem()).params);
  },
  getSystem: () => readSystem(),
  async discoverPositions(owner) {
    const p = await readPosition(owner);
    return p.status === TroveStatus.NonExistent ? [] : [p];
  },
  getPosition: (owner) => readPosition(owner),
  listPositions: () => listAllTroves(),
  getHistory: (owner, rangeSec, points) => readHistory(owner, rangeSec, points),
  getEvents: (owner) => readTroveEvents(owner),
  prepareRescue,
};

/** Health factor for a radar row (used by the radar API to bucket troves). */
export function radarHealth(icr: string | null, params: ProtocolParams, recoveryMode: boolean): bigint | null {
  return icr == null ? null : healthFactor(BigInt(icr), liquidationThreshold(params, recoveryMode));
}
export const ONE = WAD;
