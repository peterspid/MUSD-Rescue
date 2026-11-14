"use client";
import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import type { HistoryResponse } from "@/lib/client/api";
import type { RadarTroveDTO } from "@/lib/dto";
import { WAD } from "@/lib/risk/math";
import { toChartNumber } from "@/lib/risk/format";
import { HatchPattern, HatchSwatch, SourceTag } from "./ui";

// Blue / black / white only: position series blue, oracle price black, external reference grey dashed,
// anything at or below the 110% liquidation line hatched black.
const SERIES_POSITION = "#1e40ff";
const SERIES_ORACLE = "#000000";
const SERIES_REFERENCE = "#5e5e5e";
const GRID = "#e6e6e6";
const AXIS = "#5e5e5e";

const tickTime = (range: string) => (t: number) => {
  const d = new Date(t * 1000);
  return range === "24h" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-ink bg-paper px-3 py-2 text-[13px]">
      <div className="num mb-1 text-muted">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.color && <span className="h-0.5 w-3" style={{ background: r.color }} />}
          <span className="text-ink-soft">{r.label}</span>
          <span className="num ml-auto pl-3 text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** On-chain oracle price (archive reads) with an optional, clearly labelled external reference series. */
export function PriceHistoryChart({ data, range, reference }: { data: HistoryResponse; range: string; reference?: { t: number; p: number }[] | null }) {
  const points = useMemo(() => {
    const rows: { t: number; oracle: number | null; reference: number | null }[] = data.archive
      .filter((p) => p.price)
      .map((p) => ({ t: p.blockTime, oracle: toChartNumber(BigInt(p.price!)), reference: null }));
    if (reference?.length && rows.length) {
      const t0 = rows[0].t;
      for (const r of reference) if (r.t >= t0) rows.push({ t: r.t, oracle: null, reference: r.p });
      rows.sort((a, b) => a.t - b.t);
    }
    return rows;
  }, [data, reference]);
  if (!points.length) return <p className="text-[14px] text-muted">No oracle history could be read for this range.</p>;
  return (
    <figure>
      <div className="h-[220px] w-full">
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickTime(range)} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tickFormatter={usd} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipBox
                    title={new Date(Number(label) * 1000).toLocaleString()}
                    rows={payload.filter((x) => x.value != null).map((x) => ({ label: x.dataKey === "oracle" ? "MUSD oracle (on-chain)" : "CoinGecko (external)", value: usd(Number(x.value)), color: x.dataKey === "oracle" ? SERIES_ORACLE : SERIES_REFERENCE }))}
                  />
                ) : null
              }
            />
            <Line dataKey="oracle" stroke={SERIES_ORACLE} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} name="MUSD oracle" />
            {reference && <Line dataKey="reference" stroke={SERIES_REFERENCE} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} name="External reference" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: SERIES_ORACLE }} /> MUSD oracle <SourceTag kind="onchain" /></span>
        {reference && <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: SERIES_REFERENCE }} /> CoinGecko BTC/USD <SourceTag kind="external" /></span>}
        <span>PriceFeed.fetchPrice() read at {data.archive.length} past blocks.</span>
      </figcaption>
    </figure>
  );
}

/** Health factor over time from archive reads, with the 1.00 liquidation line. */
export function HealthHistoryChart({ data, range, mcr }: { data: HistoryResponse; range: string; mcr: bigint }) {
  const points = useMemo(
    () => data.archive.filter((p) => p.icr).map((p) => ({ t: p.blockTime, hf: toChartNumber((BigInt(p.icr!) * WAD) / mcr) })),
    [data, mcr],
  );
  if (points.length < 2)
    return <p className="text-[14px] text-muted">Not enough history yet: the trove did not exist for most of this range. Health history starts when the trove was opened.</p>;
  const max = Math.max(...points.map((p) => p.hf ?? 0), 2.2);
  return (
    <figure>
      <div className="h-[200px] w-full">
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={tickTime(range)} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={[0.8, Math.ceil(max * 10) / 10]} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} width={40} tickFormatter={(v) => Number(v).toFixed(1)} />
            <HatchPattern id="hatch-hf" />
            <ReferenceArea y1={0.8} y2={1} fill="url(#hatch-hf)" fillOpacity={1} stroke="none" ifOverflow="hidden" />
            <ReferenceLine y={1} stroke="#000000" strokeWidth={1.5} label={{ value: "Liquidation (HF 1.00)", position: "insideTopRight", fill: "#000000", fontSize: 12 }} />
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? <TooltipBox title={new Date(Number(label) * 1000).toLocaleString()} rows={[{ label: "Health factor", value: Number(payload[0].value).toFixed(3), color: SERIES_POSITION }]} /> : null
              }
            />
            <Line dataKey="hf" stroke={SERIES_POSITION} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-[12px] text-muted">
        Health factor = ICR ÷ 110%, computed from getEntireDebtAndColl and the oracle price at each sampled block. <HatchSwatch /> Below 1.00 is liquidatable. <SourceTag kind="onchain" />
      </figcaption>
    </figure>
  );
}

export const RADAR_BUCKETS = [
  { key: "liq", label: "< 110%", sub: "liquidatable", min: 0, max: 110, color: "url(#hatch-radar)" },
  { key: "crit", label: "110–132%", sub: "critical", min: 110, max: 132, color: "#000000" },
  { key: "high", label: "132–165%", sub: "high risk", min: 132, max: 165, color: "#5e5e5e" },
  { key: "caution", label: "165–220%", sub: "caution", min: 165, max: 220, color: "#bdbdbd" },
  { key: "healthy", label: "> 220%", sub: "healthy", min: 220, max: Infinity, color: "#1e40ff" },
] as const;

export function bucketTroves(troves: RadarTroveDTO[]) {
  return RADAR_BUCKETS.map((b) => {
    const list = troves.filter((t) => {
      if (!t.icr) return false;
      const p = Number((BigInt(t.icr) * 10_000n) / WAD) / 100;
      return p >= b.min && p < b.max;
    });
    const debt = list.reduce((s, t) => s + BigInt(t.debt), 0n);
    return { ...b, count: list.length, debt, debtNum: toChartNumber(debt) ?? 0 };
  });
}

export function RadarHistogram({ troves }: { troves: RadarTroveDTO[] }) {
  const buckets = bucketTroves(troves);
  const [metric, setMetric] = useState<"count" | "debt">("count");
  return (
    <figure>
      <div className="mb-2 flex gap-1 text-[13px]">
        {(["count", "debt"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMetric(m)} aria-pressed={metric === m} className={metric === m ? "rounded-[4px] bg-ink px-2 py-0.5 text-paper" : "rounded-[4px] px-2 py-0.5 text-ink hover:bg-surface"}>
            {m === "count" ? "Troves" : "Debt (MUSD)"}
          </button>
        ))}
      </div>
      <div className="h-[230px] w-full">
        <ResponsiveContainer>
          <BarChart data={buckets} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barCategoryGap={6}>
            <HatchPattern id="hatch-radar" />
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => (metric === "debt" ? `${(Number(v) / 1e6).toFixed(1)}M` : String(v))} />
            <Tooltip
              cursor={{ fill: "#f4f4f4" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload as (typeof buckets)[number];
                return <TooltipBox title={`ICR ${b.label} (${b.sub})`} rows={[{ label: "Troves", value: String(b.count) }, { label: "Debt", value: `${Math.round(b.debtNum).toLocaleString("en-US")} MUSD` }]} />;
              }}
            />
            <Bar dataKey={metric === "count" ? "count" : "debtNum"} radius={[2, 2, 0, 0]} isAnimationActive={false} label={{ position: "top", fill: "#000000", fontSize: 12, formatter: (v: unknown) => (metric === "count" ? String(v) : `${(Number(v) / 1e6).toFixed(2)}M`) }}>
              {buckets.map((b) => (
                <Cell key={b.key} fill={b.color} stroke={b.key === "liq" ? "#000000" : undefined} strokeWidth={b.key === "liq" ? 1 : 0} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-[12px] text-muted">Every open MUSD trove on Mezo testnet bucketed by collateral ratio at the current oracle price. Bands use the default health-factor thresholds × 110%.</figcaption>
    </figure>
  );
}

/** Cumulative debt that becomes liquidatable as BTC falls (step curve from every trove's liquidation price). */
export function LiquidationCurve({ troves, price }: { troves: RadarTroveDTO[]; price: bigint }) {
  const points = useMemo(() => {
    const drops = troves
      .filter((t) => t.dropToLiquidationBps != null)
      .map((t) => ({ drop: Number(t.dropToLiquidationBps) / 100, debt: toChartNumber(BigInt(t.debt)) ?? 0 }))
      .sort((a, b) => a.drop - b.drop);
    const out: { drop: number; debt: number; troves: number }[] = [];
    let cum = 0;
    let n = 0;
    for (let d = 0; d <= 60; d += 2) {
      while (drops.length && drops[0].drop <= d) {
        cum += drops[0].debt;
        n++;
        drops.shift();
      }
      out.push({ drop: d, debt: cum, troves: n });
    }
    return out;
  }, [troves]);
  const p = toChartNumber(price) ?? 0;
  return (
    <figure>
      <div className="h-[220px] w-full">
        <ResponsiveContainer>
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <HatchPattern id="hatch-liq" />
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="drop" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `−${v}%`} />
            <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${(Number(v) / 1e6).toFixed(1)}M`} />
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as (typeof points)[number];
                return <TooltipBox title={`BTC −${r.drop}% (${usd(p * (1 - r.drop / 100))})`} rows={[{ label: "Liquidatable troves", value: String(r.troves) }, { label: "Their debt", value: `${Math.round(r.debt).toLocaleString("en-US")} MUSD`, color: "#000000" }]} />;
              }}
            />
            <Area type="stepAfter" dataKey="debt" stroke="#000000" strokeWidth={2} fill="url(#hatch-liq)" fillOpacity={1} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 text-[12px] text-muted">MUSD debt that would fall below 110% ICR if BTC dropped by the amount on the x-axis, everything else unchanged. Hypothetical, not a forecast.</figcaption>
    </figure>
  );
}
