import Link from "next/link";
import { Bell, Gauge, ShieldCheck, Radar as RadarIcon } from "lucide-react";
import { Hero } from "@/components/hero";
import { Logo } from "@/components/logo";
import { ConnectButton } from "@/components/wallet";
import { WatchInput } from "@/components/watch-input";
import { LiveNumbers, RadarTeaser } from "@/components/landing-live";
import { SystemStrip } from "@/components/app-shell";

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-ink-3 bg-ink-0/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="MUSD Rescue home">
            <Logo />
          </Link>
          <nav className="ml-6 hidden items-center gap-5 text-[14px] text-fg-2 md:flex" aria-label="Main">
            <Link href="/dashboard" className="hover:text-fg">Dashboard</Link>
            <Link href="/radar" className="hover:text-fg">Liquidation radar</Link>
            <Link href="/demo" className="hover:text-fg">Demo</Link>
            <Link href="/methodology" className="hover:text-fg">Methodology</Link>
          </nav>
          <div className="ml-auto">
            <ConnectButton size="sm" />
          </div>
        </div>
        <SystemStrip />
      </header>

      <main>
        <Hero />

        <section className="mx-auto max-w-[1320px] px-4 py-14 sm:px-6" aria-labelledby="benefits">
          <h2 id="benefits" className="sr-only">What MUSD Rescue does</h2>
          <div className="grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-ink-3 bg-ink-3 md:grid-cols-3">
            {[
              { icon: Gauge, t: "Monitor collateral health", d: "Your trove's collateral ratio, health factor and liquidation price, read from TroveManager every 15 seconds with interest accrued to the second." },
              { icon: ShieldCheck, t: "Simulate rescue strategies", d: "Repay MUSD, add BTC or both. Every simulation applies the contract's own rules, including the 1,800 MUSD minimum net debt." },
              { icon: Bell, t: "Get early risk warnings", d: "Alert rules for warning zones, price drops and unexpected debt. Checked daily by a scheduler, on every visit, and on demand." },
            ].map((b) => (
              <div key={b.t} className="bg-ink-1 p-6 sm:p-7">
                <b.icon className="size-6 text-teal" aria-hidden />
                <h3 className="mt-4 font-display text-xl font-semibold">{b.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-fg-2">{b.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-[1320px] gap-6 px-4 pb-14 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
          <LiveNumbers />
          <div className="panel flex flex-col justify-between gap-5 p-6">
            <div>
              <h2 className="font-display text-2xl font-semibold">Check any trove, no wallet needed</h2>
              <p className="mt-2 max-w-[52ch] text-fg-2">Paste the address that owns an MUSD trove to see its live risk, history and rescue options in read-only mode.</p>
            </div>
            <WatchInput />
            <RadarTeaser />
          </div>
        </section>

        <section className="border-y border-ink-3 bg-ink-1/60" aria-labelledby="how">
          <div className="mx-auto max-w-[1320px] px-4 py-14 sm:px-6">
            <h2 id="how" className="font-display text-2xl font-semibold">How a rescue works</h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-4">
              {[
                ["Read", "Your trove, the oracle price and system TCR are read straight from the MUSD contracts."],
                ["Simulate", "Price scenarios and rescue amounts are checked against MCR, Recovery Mode and minimum-debt rules."],
                ["Confirm", "The server re-reads the trove, computes list hints, simulates with eth_call and shows exactly what you will sign."],
                ["Verify", "After your wallet sends it, the receipt is verified on-chain and the trove is re-read to show the new ratio."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="num grid size-8 shrink-0 place-items-center rounded-full border border-teal/40 text-[13px] text-teal">{i + 1}</span>
                  <div>
                    <h3 className="font-medium text-fg">{t}</h3>
                    <p className="mt-1 text-[14px] text-fg-2">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-[1320px] px-4 py-12 sm:px-6">
          <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-panel)] border border-caution/30 bg-caution/5 p-5 text-[14px] text-fg-2">
            <RadarIcon className="size-5 text-caution" aria-hidden />
            <p className="max-w-[90ch] flex-1">
              MUSD Rescue is a risk-information tool for Mezo testnet. It never holds funds, never asks for keys, and only sends transactions you confirm in your own wallet. It cannot guarantee that a trove will not be liquidated. Read the <Link href="/methodology" className="text-teal hover:underline">methodology</Link> and <Link href="/legal" className="text-teal hover:underline">risk disclosure</Link>.
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-ink-3 px-4 py-6 text-center text-[12.5px] text-fg-3">
        MUSD Rescue for the Mezo ecosystem. Testnet software. Not financial advice.
      </footer>
    </div>
  );
}
