"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { usePosition, useSystem } from "@/lib/client/api";
import { amountsFromDTO, paramsFromDTO } from "@/lib/convert";
import { WAD, applyBpsChange, assessPosition, positionFromEntire, MUSD_SOURCE_DEFAULTS } from "@/lib/risk";
import { formatBps, formatHF, formatRatioPct, formatUsd, shortAddress } from "@/lib/risk/format";
import { ConnectButton } from "./wallet";
import { Button, RiskBadge, CATEGORY_COLOR, SourceTag } from "./ui";
import { hfColor, clearanceHeight } from "./hero-color";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false, loading: () => <div className="absolute inset-0 grid place-items-center text-[13px] text-fg-3">Loading 3D view…</div> });

/** The owner's real trove on Mezo testnet, used as the live example in the hero. */
export const EXAMPLE_TROVE = "0x10ac9924a78051BdD770978740C5084205cdB628";

function Poster({ icrPct, hf }: { icrPct: number; hf: number }) {
  const h = clearanceHeight(icrPct);
  const y = 250 - Math.max(-0.9, h) * 52;
  const c = `#${hfColor(hf).getHexString()}`;
  return (
    <svg viewBox="0 0 400 340" className="absolute inset-0 h-full w-full" role="img" aria-label={`Collateral sphere at ${icrPct.toFixed(0)}% above the 110% liquidation plane`}>
      <defs>
        <radialGradient id="ps" cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="0.4" stopColor={c} />
          <stop offset="1" stopColor="#101316" />
        </radialGradient>
        <radialGradient id="pp" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#f0544f" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f0544f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="262" rx="185" ry="46" fill="url(#pp)" />
      <ellipse cx="200" cy="262" rx="150" ry="34" fill="none" stroke="#f0544f" strokeOpacity="0.6" />
      <line x1="200" y1={y + 34} x2="200" y2="262" stroke="#7fe0d9" strokeOpacity="0.5" strokeDasharray="3 4" />
      <circle cx="200" cy={y} r="34" fill="url(#ps)" />
    </svg>
  );
}

export function Hero() {
  const sys = useSystem();
  const ex = usePosition(EXAMPLE_TROVE);
  const [changeBps, setChangeBps] = useState(0);
  const [mode, setMode] = useState<"3d" | "poster">("3d");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 639px)");
    const set = () => setMode(mq.matches ? "poster" : "3d");
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  const live = ex.data?.active && ex.data.system.price;
  const params = live ? paramsFromDTO(ex.data!.system.params) : MUSD_SOURCE_DEFAULTS;
  const amounts = live ? amountsFromDTO(ex.data!) : positionFromEntire(WAD, 50_000n * WAD, 0n, MUSD_SOURCE_DEFAULTS);
  const base = live ? BigInt(ex.data!.system.price!) : sys.data?.price ? BigInt(sys.data.price) : 80_000n * WAD;
  const price = applyBpsChange(base, changeBps);
  const r = assessPosition(amounts, price, params, false);
  const icrPct = r.icr == null ? 400 : Number((r.icr * 10_000n) / WAD) / 100;
  const hf = r.hf == null ? 4 : Number((r.hf * 1000n) / WAD) / 1000;

  return (
    <section className="relative overflow-hidden border-b border-ink-3">
      <div className="grid-floor pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_70%_60%,black,transparent_70%)]" aria-hidden />
      <div className="relative mx-auto grid max-w-[1320px] items-center gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-16">
        <div className="max-w-[600px]">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal/30 bg-teal/10 px-3 py-1 text-[13px] text-teal">
            <span className="size-1.5 rounded-full bg-teal" /> Live on Mezo testnet with the MUSD trove protocol
          </p>
          <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.02em] text-fg sm:text-[60px]">
            Know Your Risk.
            <br />
            Rescue Your Position.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-fg-2">
            MUSD Rescue helps DeFi borrowers monitor collateral health, simulate repayment strategies, and act before liquidation risk becomes critical.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ConnectButton size="lg" label="Connect Wallet" />
            <Link href="/demo">
              <Button size="lg" variant="secondary">
                <FlaskConical className="size-4" /> Explore Demo
              </Button>
            </Link>
          </div>
          <p className="mt-6 max-w-[56ch] text-[13px] leading-relaxed text-fg-3">
            MUSD Rescue provides risk-management information. It cannot guarantee that liquidation will be prevented: prices, interest and transaction timing can change faster than any rescue.
          </p>
        </div>

        <div className="relative">
          <div className="panel relative aspect-[5/4] w-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_80%,rgba(240,84,79,0.10),transparent_60%)]">
            {mode === "3d" ? <HeroScene icrPct={icrPct} hf={hf} /> : <Poster icrPct={icrPct} hf={hf} />}
            <div className="pointer-events-none absolute left-4 top-4 flex flex-col items-start gap-1.5">
              <span className="flex items-center gap-2 text-[12.5px] text-fg-2">
                {live ? (
                  <>
                    <SourceTag kind="onchain" /> Live trove <span className="num">{shortAddress(EXAMPLE_TROVE)}</span>
                  </>
                ) : (
                  <>
                    <SourceTag kind="simulated" /> Illustration: 1 BTC, 50,000 MUSD
                  </>
                )}
              </span>
              <RiskBadge category={r.category} />
            </div>
            <div className="pointer-events-none absolute right-4 top-4 text-right">
              <div className="num text-[28px] leading-none" style={{ color: CATEGORY_COLOR[r.category] }}>
                {formatHF(r.hf)}
              </div>
              <div className="text-[12px] text-fg-3">health factor</div>
              <div className="num mt-2 text-[15px] text-fg">{formatRatioPct(r.icr)}</div>
              <div className="text-[12px] text-fg-3">collateral ratio</div>
            </div>
            <div className="pointer-events-none absolute bottom-3 left-4 text-[12px] text-critical/90">Liquidation plane: 110% collateral ratio</div>
          </div>
          <div className="mt-4">
            <label htmlFor="hero-price" className="flex items-baseline justify-between text-[13px] text-fg-3">
              <span>Drag the BTC price and watch the collateral fall toward the liquidation plane</span>
            </label>
            <input id="hero-price" type="range" className="scrub" min={-6000} max={4000} step={25} value={changeBps} onChange={(e) => setChangeBps(Number(e.target.value))} aria-valuetext={`BTC ${formatUsd(price, 0)}, ${formatBps(changeBps, 1, true)}`} />
            <div className="num flex justify-between text-[12.5px]">
              <span className="text-fg-3">−60%</span>
              <span className="text-fg">
                BTC {formatUsd(price, 0)} <span className={changeBps < 0 ? "text-critical" : changeBps > 0 ? "text-safe" : "text-fg-3"}>{formatBps(changeBps, 1, true)}</span>
              </span>
              <span className="text-fg-3">+40%</span>
            </div>
            <p className="mt-1 text-[12.5px] text-fg-3">
              {r.liquidationPrice ? <>Liquidation below <span className="num text-fg-2">{formatUsd(r.liquidationPrice, 0)}</span>. </> : null}
              Starting price is the on-chain MUSD oracle.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
