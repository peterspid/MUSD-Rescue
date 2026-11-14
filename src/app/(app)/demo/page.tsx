"use client";
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { DEMO_BASE_PRICE, DEMO_POSITIONS, DEMO_SYSTEM } from "@/lib/demo/positions";
import { MUSD_SOURCE_DEFAULTS, assessPosition } from "@/lib/risk";
import { formatAmount, formatBtc, formatHF, formatRatioPct } from "@/lib/risk/format";
import { Simulator } from "@/components/simulator";
import { RiskBadge, SectionHeading, SourceTag, cn, CATEGORY_COLOR } from "@/components/ui";
import { useSession } from "@/components/session";

export default function DemoPage() {
  const [id, setId] = useState<string>(DEMO_POSITIONS[1].id);
  const session = useSession();
  const pos = DEMO_POSITIONS.find((p) => p.id === id)!;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-dotted border-ink px-4 py-3 text-[14px] text-ink">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden />
        <p>
          <strong className="font-semibold">Example data only.</strong> These three troves, their prices and every simulated transaction are made up. Nothing here reads or writes the blockchain, and none of it appears on your live dashboard.
        </p>
      </div>
      <SectionHeading as="h1" title="Demo: rescue a position" desc="Pick an example trove, move the BTC price and try repaying or adding collateral. The maths is the same engine that runs on live troves, with the real MUSD rules (110% MCR, 1,800 MUSD minimum net debt, 1% simple interest)." />
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Example positions">
        {DEMO_POSITIONS.map((p) => {
          const r = assessPosition(p.amounts, DEMO_BASE_PRICE, MUSD_SOURCE_DEFAULTS, false, session.thresholds);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={id === p.id}
              onClick={() => setId(p.id)}
              className={cn("rounded-[var(--radius-panel)] border p-4 text-left transition-colors", id === p.id ? "border-2 border-ink" : "border-dotted border-ink hover:bg-surface")}
            >
              <div className="flex items-center justify-between">
                <span className="text-[16px] font-semibold">{p.name}</span>
                <SourceTag kind="fictional" />
              </div>
              <p className="mt-1 text-[13px] text-ink-soft">{p.story}</p>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="num text-[25px] font-medium" style={{ color: CATEGORY_COLOR[r.category] }}>{formatHF(r.hf)}</div>
                  <div className="num text-[13px] text-muted">{formatBtc(p.amounts.coll)} BTC, {formatAmount(p.amounts.debt, 0)} MUSD, ICR {formatRatioPct(r.icr)}</div>
                </div>
                <RiskBadge category={r.category} size="sm" />
              </div>
            </button>
          );
        })}
      </div>
      <Simulator
        key={pos.id}
        mode="fictional"
        position={pos.amounts}
        basePrice={DEMO_BASE_PRICE}
        params={MUSD_SOURCE_DEFAULTS}
        system={DEMO_SYSTEM}
        wallet={{ musd: pos.walletMusd, btc: pos.walletBtc }}
        interestRateBps={pos.interestRateBps}
        thresholds={session.thresholds}
        active
      />
      <p className="text-[13px] text-muted">
        Example wallet for {pos.name}: {formatAmount(pos.walletMusd)} MUSD and {formatBtc(pos.walletBtc)} BTC. Example base price $80,000; the example system enters Recovery Mode below about $60,000.
      </p>
    </div>
  );
}
