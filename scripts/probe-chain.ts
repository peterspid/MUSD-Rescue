/**
 * Live probe of every protocol assumption MUSD Rescue relies on. Read-only; no keys needed.
 *   npm run probe
 */
import { createPublicClient, http, formatUnits, encodeFunctionData, parseUnits, type Address } from "viem";
import { mezoTestnet, mezoMainnet } from "../src/config/chains";
import { MUSD_CONTRACTS, ABIS } from "../src/config/contracts";

const DEPLOYER = "0x10ac9924a78051BdD770978740C5084205cdB628" as Address;
const RESCUE_USER = "0xf0bAa8365c7B8132B3dbfE7D0294Fc7042E72668" as Address;

async function main() {
  const c = createPublicClient({ chain: mezoTestnet, transport: http() });
  const A = MUSD_CONTRACTS.testnet;
  const f = (v: bigint, d = 18) => formatUnits(v, d);
  console.log("chainId", await c.getChainId(), "block", await c.getBlockNumber());
  for (const [k, a] of Object.entries(A)) {
    const code = await c.getCode({ address: a as Address });
    console.log("code", k.padEnd(20), a, code ? `${(code.length - 2) / 2} bytes` : "NONE");
  }
  const price = await c.readContract({ address: A.PriceFeed, abi: ABIS.PriceFeed, functionName: "fetchPrice" });
  console.log("price", f(price));
  const oracle = await c.readContract({ address: A.PriceFeed, abi: ABIS.PriceFeed, functionName: "oracle" });
  const rd = await c.readContract({
    address: oracle, functionName: "latestRoundData",
    abi: [{ type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [
      { name: "roundId", type: "uint80" }, { name: "answer", type: "int256" }, { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" }, { name: "answeredInRound", type: "uint80" }] }],
  });
  const blk = await c.getBlock();
  console.log("oracle", oracle, "updatedAt", rd[3], "block ts", blk.timestamp, "age s", blk.timestamp - rd[3]);
  for (const fn of ["MCR", "CCR", "MUSD_GAS_COMPENSATION", "minNetDebt", "borrowingRate", "redemptionRate", "getEntireSystemColl", "getEntireSystemDebt"] as const) {
    const v = await c.readContract({ address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: fn });
    console.log("BO." + fn, f(v as bigint));
  }
  console.log("IRM.interestRate bps", await c.readContract({ address: A.InterestRateManager, abi: ABIS.InterestRateManager, functionName: "interestRate" }));
  console.log("TCR", f(await c.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getTCR", args: [price] })));
  console.log("recovery", await c.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "checkRecoveryMode", args: [price] }));
  console.log("trove owners", await c.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getTroveOwnersCount" }));
  console.log("sorted size", await c.readContract({ address: A.SortedTroves, abi: ABIS.SortedTroves, functionName: "getSize" }));
  console.log("burnList(BO)", await c.readContract({ address: A.MUSD, abi: ABIS.MUSD, functionName: "burnList", args: [A.BorrowerOperations] }));
  for (const who of [DEPLOYER, RESCUE_USER]) {
    const t = await c.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "Troves", args: [who] });
    const e = await c.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getEntireDebtAndColl", args: [who] });
    const icr = await c.readContract({ address: A.TroveManager, abi: ABIS.TroveManager, functionName: "getCurrentICR", args: [who, price] });
    const bal = await c.readContract({ address: A.MUSD, abi: ABIS.MUSD, functionName: "balanceOf", args: [who] });
    const allowance = await c.readContract({ address: A.MUSD, abi: ABIS.MUSD, functionName: "allowance", args: [who, A.BorrowerOperations] });
    console.log(who, "Troves", t, "entire", e.map((x) => f(x)), "ICR", f(icr), "MUSD", f(bal), "allowance→BO", f(allowance), "BTC", f(await c.getBalance({ address: who })));
  }
  // Simulate a 5 MUSD repay from the deployer with ZERO allowance → proves no approval needed (burn via burnList).
  try {
    const sim = await c.simulateContract({
      account: DEPLOYER, address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "repayMUSD",
      args: [parseUnits("5", 18), DEPLOYER, DEPLOYER],
    });
    console.log("simulate repayMUSD(5) ok", sim.result);
    const est = await c.estimateGas({ account: DEPLOYER, to: A.BorrowerOperations, data: encodeFunctionData({ abi: ABIS.BorrowerOperations, functionName: "repayMUSD", args: [parseUnits("5", 18), DEPLOYER, DEPLOYER] }) });
    console.log("estimate repay gas", est);
  } catch (e) { console.log("simulate repay FAILED", (e as Error).message.slice(0, 300)); }
  try {
    await c.simulateContract({ account: DEPLOYER, address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "addColl", args: [DEPLOYER, DEPLOYER], value: parseUnits("0.00001", 18) });
    console.log("simulate addColl ok");
  } catch (e) { console.log("simulate addColl FAILED", (e as Error).message.slice(0, 300)); }
  try {
    await c.simulateContract({ account: RESCUE_USER, address: A.BorrowerOperations, abi: ABIS.BorrowerOperations, functionName: "repayMUSD", args: [parseUnits("5", 18), RESCUE_USER, RESCUE_USER] });
    console.log("rescue user repay unexpectedly ok");
  } catch (e) { console.log("rescue user repay revert (expected):", (e as Error).message.split("\n").slice(0, 3).join(" | ")); }
  // Multicall3 availability on mainnet too
  const m = createPublicClient({ chain: mezoMainnet, transport: http() });
  try {
    console.log("mainnet chainId", await m.getChainId(), "multicall code", !!(await m.getCode({ address: MUSD_CONTRACTS.mainnet.Multicall3 })));
    for (const [k, a] of Object.entries(MUSD_CONTRACTS.mainnet)) {
      const code = await m.getCode({ address: a as Address });
      console.log("mainnet code", k.padEnd(20), code ? "yes" : "NONE");
    }
    const mp = await m.readContract({ address: MUSD_CONTRACTS.mainnet.PriceFeed, abi: ABIS.PriceFeed, functionName: "fetchPrice" });
    console.log("mainnet price", f(mp), "troves", await m.readContract({ address: MUSD_CONTRACTS.mainnet.TroveManager, abi: ABIS.TroveManager, functionName: "getTroveOwnersCount" }));
  } catch (e) { console.log("mainnet probe failed", (e as Error).message.slice(0, 200)); }
}
main().catch((e) => { console.error(e); process.exit(1); });
