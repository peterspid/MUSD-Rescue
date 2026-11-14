import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms, privacy and risk disclosure" };

export default function Legal() {
  return (
    <article className="mx-auto flex max-w-[76ch] flex-col gap-7 text-[15px] leading-relaxed text-ink-soft">
      <h1 className="text-[32px] font-semibold text-ink">Terms, privacy and risk disclosure</h1>
      <section>
        <h2 className="text-xl font-semibold text-ink">Risk disclosure</h2>
        <p className="mt-2">MUSD Rescue provides risk-management information about MUSD troves on Mezo testnet. It cannot guarantee that a position will not be liquidated or redeemed against. BTC prices, oracle updates, accrued interest, redistributions and transaction timing can change a trove’s health faster than any check or transaction. Scenarios are hypothetical and are not predictions or financial advice.</p>
        <p className="mt-2">Monitoring is periodic: a scheduled job once a day, plus checks when you open the app or press Check now. It is not continuous.</p>
      </section>
      <section>
        <h2 className="text-xl font-semibold text-ink">Non-custodial</h2>
        <p className="mt-2">MUSD Rescue never holds funds and never asks for private keys or seed phrases. Transactions are prepared by the app but only sent when you confirm them in your own wallet. No custom smart contract sits between you and the MUSD protocol.</p>
      </section>
      <section>
        <h2 className="text-xl font-semibold text-ink">Privacy</h2>
        <p className="mt-2">If you sign in with your wallet we store your address, your alert rules, watchlist, risk-category preferences, notifications, and the hashes of rescue transactions you asked us to verify. Public blockchain data is read from Mezo RPC and explorer services. Anonymous page analytics are collected by Vercel Analytics. We do not sell data. Without signing in, your watchlist and settings stay in your browser.</p>
      </section>
      <section>
        <h2 className="text-xl font-semibold text-ink">Terms</h2>
        <p className="mt-2">This is testnet software provided as is, without warranty. Testnet assets have no value. Use of MUSD itself is governed by the Mezo protocol and its documentation.</p>
      </section>
    </article>
  );
}
