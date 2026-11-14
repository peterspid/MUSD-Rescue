import type { Metadata } from "next";
import { MUSD_CONTRACTS, CONTRACT_SOURCES } from "@/config/contracts";
import { NETWORKS } from "@/config/chains";

export const metadata: Metadata = { title: "Risk methodology" };

const A = MUSD_CONTRACTS.testnet;

function Code({ children }: { children: React.ReactNode }) {
  return <code className="num rounded bg-surface px-1.5 py-0.5 text-[13px] text-ink">{children}</code>;
}

export default function Methodology() {
  return (
    <article className="mx-auto flex max-w-[78ch] flex-col gap-8 text-[15.5px] leading-relaxed text-ink-soft">
      <header>
        <h1 className="text-[34px] font-semibold leading-tight text-ink">Risk methodology</h1>
        <p className="mt-2">How MUSD Rescue reads a trove, measures its risk and checks a rescue before you sign it. Every rule below was read from the MUSD contract source (github.com/mezo-org/musd) and checked against live reads on Mezo testnet.</p>
      </header>

      <section>
        <h2 className="text-2xl font-semibold text-ink">The position</h2>
        <p className="mt-2">A position is an MUSD trove: native BTC collateral against MUSD debt. Each address can own one trove, so the owner address is the position id. We read <Code>TroveManager.getEntireDebtAndColl(owner)</Code>, which returns collateral, principal and interest including interest accrued up to the current block and any pending redistribution rewards.</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li><strong className="text-ink">Debt</strong> = principal + interest. Principal includes the borrowed MUSD, the one-off borrowing fee (0.1% on testnet) and the 200 MUSD gas compensation reserved for liquidators.</li>
          <li><strong className="text-ink">Interest</strong> is simple, not compounding: principal × rate × seconds ÷ (10,000 × 31,556,952). Each trove keeps the rate it was opened with (1.00% on testnet).</li>
          <li><strong className="text-ink">Oracle price</strong> is <Code>PriceFeed.fetchPrice()</Code>, the same BTC/USD value the protocol uses. It reverts if the oracle is more than 60 seconds old, and then every trove operation reverts too, so we disable rescue actions.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-ink">Collateral ratio and health factor</h2>
        <p className="mt-2"><strong className="text-ink">ICR</strong> = collateral × price ÷ debt, exactly as <Code>getCurrentICR</Code> computes it with integer (floor) division. A trove can be liquidated by anyone when ICR &lt; MCR = 110%.</p>
        <p className="mt-2">MUSD has no native health factor, so we define one from the protocol’s own parameters: <strong className="text-ink">health factor = ICR ÷ 110%</strong>. A health factor of 1.00 is the liquidation line. ICR is always shown next to it.</p>
        <p className="mt-2"><strong className="text-ink">Liquidation price</strong> = debt × 110% ÷ collateral. <strong className="text-ink">Room to liquidation</strong> is how far the BTC price can fall from the current oracle price before reaching it.</p>
        <p className="mt-2">Risk bands are product defaults you can change in Settings: healthy above 2.0, caution 1.5 to 2.0, high risk 1.2 to 1.5, critical 1.2 and below, liquidatable below 1.0.</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-ink">Recovery Mode</h2>
        <p className="mt-2">When the system’s total collateral ratio (TCR) falls below the critical ratio CCR = 150%, MUSD enters Recovery Mode. We show TCR and the BTC drop that would trigger it on every page.</p>
        <p className="mt-2">Unlike Liquity v1 and Threshold USD, <strong className="text-ink">MUSD does not liquidate troves between 110% and 150% in Recovery Mode</strong>. <Code>TroveManager._getTotalsFromBatchLiquidate</Code> only liquidates when ICR &lt; MCR, and the MUSD changelog states that liquidations are the same in both modes. Recovery Mode instead changes what you can do: no collateral withdrawals, no closing troves, no refinancing, new debt only if it leaves ICR ≥ 150% and improves it, and no borrowing fee. Repayments and collateral top-ups are always allowed.</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-ink">Rescue rules we enforce</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>Repayments pay accrued interest first, then principal (<Code>InterestRateMath.calculateDebtAdjustment</Code>).</li>
          <li>Net debt (debt − 200 MUSD) must stay at or above <Code>minNetDebt</Code> = 1,800 MUSD after a repayment. The largest repayment without closing is debt − 2,000 MUSD; repaying more means <Code>closeTrove()</Code>, which needs debt − 200 MUSD in the wallet and is blocked in Recovery Mode.</li>
          <li>In Normal Mode, every adjustment (including a repayment or top-up) must leave ICR ≥ 110% and the system TCR ≥ 150%. A rescue that is too small for a trove already below 110% reverts, so the simulator tells you the minimum that works.</li>
          <li><strong className="text-ink">No approval is needed to repay.</strong> <Code>BorrowerOperations</Code> burns MUSD directly from your wallet through the MUSD burn list (verified: <Code>MUSD.burnList(BorrowerOperations) == true</Code>), so allowance is never read. We confirmed it by simulating <Code>repayMUSD</Code> from a wallet with zero allowance.</li>
          <li>Target solvers round in your favour: the repayment uses debt − floor(coll × price ÷ target) and the deposit uses ceil(target × debt ÷ price) − coll, then verify the result with the same integer maths as the contract.</li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-ink">Transaction safety</h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>The server re-reads the trove at the latest block and validates the amounts with the rules above.</li>
          <li>It computes SortedTroves hints: NICR = coll × 1e20 ÷ principal (the list ignores interest), <Code>HintHelpers.getApproxHint</Code> with ⌈15·√n⌉ trials, then <Code>SortedTroves.findInsertPosition</Code>.</li>
          <li>It simulates the exact call with <Code>eth_call</Code> from your address and sets an explicit gas limit (estimate × 1.3, never below a safety floor, because Mezo enforces the EIP-7623 calldata floor).</li>
          <li>Your browser independently decodes the calldata and checks the contract and network before showing the confirmation screen. Quotes expire after 60 seconds.</li>
          <li>After your wallet sends it, the receipt must be successful, sent by you to BorrowerOperations, contain the TroveUpdated event and the exact MUSD burn. The trove is re-read at the receipt block and the block before it, both at the same oracle price, so the improvement shown is the effect of your action alone. Each transaction hash is recorded once.</li>
        </ol>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-ink">History and monitoring</h2>
        <p className="mt-2">PriceFeed keeps no history, but the Mezo testnet RPC serves historical state, so charts call <Code>fetchPrice()</Code> and <Code>getEntireDebtAndColl()</Code> at evenly spaced past blocks: real on-chain history, not interpolation. MUSD Rescue also records its own observations on every visit and in the daily job. A CoinGecko BTC/USD line can be overlaid as an external reference; it is never used in calculations.</p>
        <p className="mt-2">Alerts are evaluated once a day by a scheduled job (06:00 UTC), on every visit and on Check now. That is not continuous monitoring, and we say so wherever alerts appear.</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-ink">Contracts (Mezo testnet, chain 31611)</h2>
        <ul className="mt-2 space-y-1 text-[14px]">
          {Object.entries(A).map(([k, v]) => (
            <li key={k} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5">
              <span>{k}</span>
              <a className="num text-blue hover:underline" href={`${NETWORKS.testnet.explorer}/address/${v}`} target="_blank" rel="noreferrer">{v}</a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[14px]">Source: <a className="text-blue hover:underline" href={CONTRACT_SOURCES.testnetArtifacts} target="_blank" rel="noreferrer">mezo-org/musd deployment artifacts</a>. MUSD matches the address in the Mezo contracts reference.</p>
      </section>
    </article>
  );
}
