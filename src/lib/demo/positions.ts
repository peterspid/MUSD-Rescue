/**
 * FICTIONAL demo positions. These never touch the chain, the database, or the live dashboard.
 * Every object carries `source: "fictional"` and an id prefixed with `demo-`; the live code paths
 * reject both (see src/lib/positions/id.ts and src/lib/positions/portfolio.ts, covered by tests).
 */
import { WAD } from "../risk/math";
import type { PositionAmounts } from "../risk/position";
import { MUSD_SOURCE_DEFAULTS, type ProtocolParams } from "../risk/params";

export interface DemoPosition {
  source: "fictional";
  id: `demo-${string}`;
  name: string;
  story: string;
  amounts: PositionAmounts;
  interestRateBps: number;
  walletMusd: bigint;
  walletBtc: bigint;
}

const musd = (n: number) => BigInt(Math.round(n * 100)) * (WAD / 100n);
const btc = (n: string) => {
  const [i, f = ""] = n.split(".");
  return BigInt(i) * WAD + BigInt(f.padEnd(18, "0"));
};

function amounts(coll: bigint, principal: bigint, interest: bigint, params: ProtocolParams = MUSD_SOURCE_DEFAULTS): PositionAmounts {
  const debt = principal + interest;
  return { coll, principal, interest, debt, netDebt: debt - params.gasCompensation };
}

/** Fictional reference price used by the demo (not the live oracle). */
export const DEMO_BASE_PRICE = 80_000n * WAD;

/** Fictional system totals so the demo can show Recovery Mode behaviour when the slider drops far enough. */
export const DEMO_SYSTEM = { totalColl: 1_000n * WAD, totalDebt: 40_000_000n * WAD };

export const DEMO_POSITIONS: readonly DemoPosition[] = [
  {
    source: "fictional",
    id: "demo-harbor",
    name: "Harbor",
    story: "Conservative borrower. Plenty of headroom.",
    amounts: amounts(btc("0.5"), musd(11_980), musd(20.4)),
    interestRateBps: 100,
    walletMusd: musd(400),
    walletBtc: btc("0.02"),
  },
  {
    source: "fictional",
    id: "demo-ridge",
    name: "Ridge",
    story: "Borrowed close to the caution line. One bad week away from it.",
    amounts: amounts(btc("0.12"), musd(4_242.5), musd(7.5)),
    interestRateBps: 100,
    walletMusd: musd(250),
    walletBtc: btc("0.01"),
  },
  {
    source: "fictional",
    id: "demo-ember",
    name: "Ember",
    story: "Leveraged up. A modest BTC dip puts it in danger.",
    amounts: amounts(btc("0.05"), musd(2_795), musd(5)),
    interestRateBps: 100,
    walletMusd: musd(600),
    walletBtc: btc("0.004"),
  },
] as const;

export function getDemoPosition(id: string): DemoPosition | undefined {
  return DEMO_POSITIONS.find((p) => p.id === id);
}
