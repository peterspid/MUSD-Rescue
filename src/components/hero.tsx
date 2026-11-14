"use client";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { usePosition, useSystem } from "@/lib/client/api";
import { amountsFromDTO, paramsFromDTO } from "@/lib/convert";
import { WAD, applyBpsChange, assessPosition, positionFromEntire, MUSD_SOURCE_DEFAULTS } from "@/lib/risk";
import { formatBps, formatHF, formatRatioPct, formatUsd } from "@/lib/risk/format";
import { ConnectButton } from "./wallet";
import { Address, ButtonLink, CATEGORY_COLOR, HatchSwatch, RiskBadge, SourceTag, cn } from "./ui";

/** The owner's real trove on Mezo testnet, used as the live example in the hero. */
export const EXAMPLE_TROVE = "0x10ac9924a78051BdD770978740C5084205cdB628";

const SCALE_MIN = 100;
const SCALE_MAX = 250;
const at = (p: number) => Math.min(1, Math.max(0, (p - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));
const icrPctOf = (icr: bigint | null) => (icr == null ? null : Number((icr * 10_000n) / WAD) / 100);

/**
 * The clearance scale: collateral ratio from 100% to 250%. Below 110% is hatched (liquidation), the dashed
 * line is the 150% Recovery Mode threshold, the blue marker is the trove at the chosen BTC price and the
 * small black ring is where it sits at today's oracle price.
 */
function ClearanceScale({ icrPct, icrNowPct, moved }: { icrPct: number | null; icrNowPct: number | null; moved: boolean }) {
  const ticks = Array.from({ length: (SCALE_MAX - SCALE_MIN) / 10 + 1 }, (_, i) => SCALE_MIN + i * 10);
  const markerAt = icrPct == null ? null : at(icrPct);
  const labelShift = markerAt == null ? "" : markerAt < 0.08 ? "translate-x-0" : markerAt > 0.92 ? "-translate-x-full" : "-translate-x-1/2";
  const below = icrPct != null && icrPct < 110;
  return (
    <div className="relative h-[156px] w-full select-none" aria-hidden>
      {/* liquidation zone */}
      <div className="hatch absolute top-[44px] h-[76px] border-y border-l border-ink" style={{ left: 0, width: `${at(110) * 100}%` }} />
      <div className="absolute top-[30px] h-[90px] w-[2px] -translate-x-1/2 bg-ink" style={{ left: `${at(110) * 100}%` }} />
      {/* recovery mode threshold */}
      <div className="absolute top-[44px] h-[76px] -translate-x-1/2 border-l border-dashed border-ink" style={{ left: `${at(150) * 100}%` }} />
      {/* axis + ticks */}
      <div className="absolute inset-x-0 top-[120px] h-[2px] bg-ink" />
      {ticks.map((t) => (
        <div key={t} className={cn("absolute top-[122px] w-px -translate-x-1/2 bg-ink", t % 50 === 0 ? "h-[8px]" : "h-[4px]")} style={{ left: `${at(t) * 100}%` }} />
      ))}
      {[100, 110, 150, 200, 250].map((t) => (
        <span
          key={t}
          className={cn("num absolute top-[132px] text-[12px]", t === 100 ? "translate-x-0" : t === 250 ? "-translate-x-full" : "-translate-x-1/2", t === 110 ? "font-semibold text-ink" : "text-muted", t === 100 && "hidden")}
          style={{ left: `${at(t) * 100}%` }}
        >
          {t}%
        </span>
      ))}
      {/* today's position, when the slider has moved */}
      {moved && icrNowPct != null && (
        <div className="absolute top-[52px] -translate-x-1/2" style={{ left: `${at(icrNowPct) * 100}%` }}>
          <span className="block size-3 rounded-full border-2 border-ink bg-paper" />
          <span className="mx-auto block h-[56px] w-px bg-ink" />
        </div>
      )}
      {/* the trove at the chosen price */}
      {markerAt != null && (
        <>
          <span className={cn("num absolute top-[4px] whitespace-nowrap text-[16px] font-semibold", labelShift, below ? "text-ink" : "text-blue")} style={{ left: `${markerAt * 100}%` }}>
            {icrPct! > SCALE_MAX ? `>${SCALE_MAX}%` : `${icrPct!.toFixed(1)}%`}
          </span>
          <div className="absolute top-[32px] -translate-x-1/2" style={{ left: `${markerAt * 100}%` }}>
            <span className={cn("block size-[14px] rounded-full", below ? "bg-ink" : "bg-blue")} />
            <span className={cn("mx-auto block h-[74px] w-[3px]", below ? "bg-ink" : "bg-blue")} />
          </div>
        </>
      )}
    </div>
  );
}

export function Hero() {
  const sys = useSystem();
  const ex = usePosition(EXAMPLE_TROVE);
  const [changeBps, setChangeBps] = useState(0);

  const live = ex.data?.active && ex.data.system.price;
  const params = live ? paramsFromDTO(ex.data!.system.params) : MUSD_SOURCE_DEFAULTS;
  const amounts = live ? amountsFromDTO(ex.data!) : positionFromEntire(WAD, 50_000n * WAD, 0n, MUSD_SOURCE_DEFAULTS);
  const base = live ? BigInt(ex.data!.system.price!) : sys.data?.price ? BigInt(sys.data.price) : 80_000n * WAD;
  const price = applyBpsChange(base, changeBps);
  const r = assessPosition(amounts, price, params, false);
  const now = assessPosition(amounts, base, params, false);
  const icrPct = icrPctOf(r.icr);
  const liquidatable = r.category === "liquidatable";

  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-[1240px] items-start gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-20">
        <div className="max-w-[560px]">
          <p className="flex items-center gap-2 text-[14px] text-ink-soft">
            <span className="size-2 rounded-full bg-blue" aria-hidden /> Live on Mezo testnet, reading the MUSD protocol contracts
          </p>
          <h1 className="mt-5 text-[40px] font-bold leading-[1.04] tracking-[-0.03em] text-ink sm:text-[56px]">See how far BTC can fall before your trove is liquidated.</h1>
          <p className="mt-6 max-w-[50ch] text-[17px] leading-relaxed text-ink-soft">
            MUSD Rescue reads your Mezo MUSD trove straight from the protocol, shows the price that would liquidate it, and prepares the repayment or collateral top-up that keeps it above the line.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ConnectButton size="lg" label="Connect wallet" />
            <ButtonLink href="/demo" size="lg" variant="secondary">
              <FlaskConical className="size-4" aria-hidden /> Explore the demo
            </ButtonLink>
          </div>
          <p className="mt-8 max-w-[56ch] text-[13px] leading-relaxed text-muted">
            Risk information only. MUSD Rescue cannot guarantee that a trove will not be liquidated: prices, interest and transaction timing can change faster than any rescue.
          </p>
        </div>

        <div className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
              {live ? (
                <>
                  <SourceTag kind="onchain" /> Live trove <Address value={EXAMPLE_TROVE} />
                </>
              ) : (
                <>
                  <SourceTag kind="simulated" /> Illustration: 1 BTC backing 50,000 MUSD
                </>
              )}
            </span>
            <RiskBadge category={r.category} />
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-4">
            <div className="min-w-0">
              <dt className="text-[13px] text-muted">BTC price</dt>
              <dd className={cn("num mt-0.5 truncate text-[22px] font-medium sm:text-[28px]", changeBps !== 0 && "simulated")}>{formatUsd(price, 0)}</dd>
              <dd className="num text-[13px] text-muted">{changeBps === 0 ? "oracle now" : `${formatBps(changeBps, 1, true)} from oracle`}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[13px] text-muted">Collateral ratio</dt>
              <dd className="num mt-0.5 truncate text-[22px] font-medium sm:text-[28px]" style={{ color: CATEGORY_COLOR[r.category] }}>
                {formatRatioPct(r.icr)}
              </dd>
              <dd className="text-[13px] text-muted">liquidation below 110%</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[13px] text-muted">Health factor</dt>
              <dd className="num mt-0.5 truncate text-[22px] font-medium sm:text-[28px]" style={{ color: CATEGORY_COLOR[r.category] }}>
                {formatHF(r.hf)}
              </dd>
              <dd className="text-[13px] text-muted">1.00 is the line</dd>
            </div>
          </dl>

          <div className="mt-6">
            <ClearanceScale icrPct={icrPct} icrNowPct={icrPctOf(now.icr)} moved={changeBps !== 0} />
          </div>

          <div className="mt-2">
            <label htmlFor="hero-price" className="text-[14px] font-medium text-ink">
              Move the BTC price
            </label>
            <input
              id="hero-price"
              type="range"
              className="scrub"
              min={-6000}
              max={4000}
              step={25}
              value={changeBps}
              onChange={(e) => setChangeBps(Number(e.target.value))}
              aria-valuetext={`BTC ${formatUsd(price, 0)}, ${formatBps(changeBps, 1, true)}, collateral ratio ${formatRatioPct(r.icr)}`}
            />
            <div className="num flex justify-between text-[13px] text-muted">
              <span>−60%</span>
              <button type="button" className="text-blue underline-offset-4 hover:underline disabled:text-muted disabled:no-underline" onClick={() => setChangeBps(0)} disabled={changeBps === 0}>
                Reset to oracle price
              </button>
              <span>+40%</span>
            </div>
          </div>

          <p className={cn("mt-4 border-t border-line pt-4 text-[15px]", liquidatable ? "font-semibold text-ink" : "text-ink-soft")}>
            {liquidatable
              ? "At this price the trove is below 110% and anyone can liquidate it."
              : r.liquidationPrice
                ? (
                  <>
                    Liquidated below <span className="num font-semibold text-ink">{formatUsd(r.liquidationPrice, 0)}</span>. From here BTC can fall{" "}
                    <span className="num font-semibold text-ink">{formatBps(r.dropToLiquidationBps)}</span> before that happens.
                  </>
                )
                : "No debt, so nothing can be liquidated."}
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
            <li className="flex items-center gap-1.5">
              <HatchSwatch /> Liquidation zone, below 110%
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-3 border-l border-dashed border-ink" aria-hidden /> Recovery Mode threshold, 150%
            </li>
            {changeBps !== 0 && (
              <li className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full border-2 border-ink" aria-hidden /> At today&apos;s oracle price
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
