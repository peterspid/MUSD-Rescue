import Link from "next/link";
import { Bell, Gauge, ShieldCheck } from "lucide-react";
import { Hero } from "@/components/hero";
import { Logo } from "@/components/logo";
import { ConnectButton } from "@/components/wallet";
import { WatchInput } from "@/components/watch-input";
import { LiveNumbers, RadarTeaser } from "@/components/landing-live";
import { SystemStrip } from "@/components/app-shell";

const BENEFITS = [
  { icon: Gauge, t: "Watch collateral health", d: "Collateral ratio, health factor and liquidation price for your trove, read from TroveManager every 15 seconds with interest accrued to the second." },
  { icon: ShieldCheck, t: "Plan a rescue that will go through", d: "Repay MUSD, add BTC or both. Each plan is checked against the contract's own rules, including the 1,800 MUSD minimum net debt, before you sign anything." },
  { icon: Bell, t: "Hear about it early", d: "Alert rules for warning zones, price drops and unexpected debt, checked daily by a scheduler, on every visit and whenever you press Check now." },
];

const STEPS = [
  ["Read", "Your trove, the oracle price and the system collateral ratio come straight from the MUSD contracts."],
  ["Simulate", "Price scenarios and rescue amounts are checked against the 110% minimum, Recovery Mode and minimum-debt rules."],
  ["Confirm", "The server re-reads the trove, computes list hints, simulates the call and shows exactly what you will sign."],
  ["Verify", "Once your wallet sends it, the receipt is checked on-chain and the trove is read again to show the new ratio."],
] as const;

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="MUSD Rescue home">
            <Logo />
          </Link>
          <nav className="ml-6 hidden items-center gap-6 text-[14px] text-ink-soft md:flex" aria-label="Main">
            <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
            <Link href="/radar" className="hover:text-ink">Liquidation radar</Link>
            <Link href="/demo" className="hover:text-ink">Demo</Link>
            <Link href="/methodology" className="hover:text-ink">Methodology</Link>
          </nav>
          <div className="ml-auto">
            <ConnectButton size="sm" />
          </div>
        </div>
        <SystemStrip />
      </header>

      <main>
        <Hero />

        <section className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6" aria-labelledby="benefits">
          <h2 id="benefits" className="max-w-[24ch] text-[25px] font-semibold leading-tight tracking-[-0.015em] sm:text-[32px]">
            Built for the five minutes when BTC is falling
          </h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
            {BENEFITS.map((b, i) => (
              <div key={b.t} className={i === 0 ? "md:pr-8" : i === 1 ? "md:px-8" : "md:pl-8"}>
                <b.icon className="size-6 text-ink" aria-hidden />
                <h3 className="mt-4 text-[20px] font-semibold leading-snug">{b.t}</h3>
                <p className="mt-2 max-w-[42ch] text-[15px] leading-relaxed text-ink-soft">{b.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto grid max-w-[1240px] gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <LiveNumbers />
          <div className="panel flex flex-col justify-between gap-6 p-6">
            <div>
              <h2 className="text-[25px] font-semibold leading-tight tracking-[-0.015em]">Check any trove, no wallet needed</h2>
              <p className="mt-2 max-w-[52ch] text-ink-soft">Paste the address that owns an MUSD trove to see its live risk, history and rescue options in read-only mode.</p>
            </div>
            <WatchInput />
            <RadarTeaser />
          </div>
        </section>

        <section className="border-y border-line bg-surface" aria-labelledby="how">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
            <h2 id="how" className="text-[25px] font-semibold leading-tight tracking-[-0.015em] sm:text-[32px]">
              How a rescue works
            </h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="border-t-2 border-ink pt-4">
                  <span className="num text-[14px] text-muted">Step {i + 1}</span>
                  <h3 className="mt-1 text-[20px] font-semibold">{t}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6">
          <p className="max-w-[90ch] text-[14px] leading-relaxed text-ink-soft">
            MUSD Rescue is a risk-information tool for Mezo testnet. It never holds funds, never asks for keys, and only sends transactions you confirm in your own wallet. It cannot guarantee that a trove will not be liquidated. Read the{" "}
            <Link href="/methodology" className="text-blue underline-offset-4 hover:underline">methodology</Link> and the{" "}
            <Link href="/legal" className="text-blue underline-offset-4 hover:underline">risk disclosure</Link>.
          </p>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-[13px] text-muted sm:px-6">
          <span>MUSD Rescue for the Mezo ecosystem. Testnet software, not financial advice.</span>
          <Link href="/methodology" className="hover:text-ink">Methodology</Link>
          <Link href="/legal" className="hover:text-ink">Terms, privacy and risk</Link>
        </div>
      </footer>
    </div>
  );
}
