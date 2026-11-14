"use client";
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Check, CircleDashed, CircleHelp, Copy, ExternalLink, Eye, LoaderCircle, OctagonAlert, ShieldCheck, Siren, TriangleAlert } from "lucide-react";
import type { RiskCategory } from "@/lib/risk/health";
import { CATEGORY_LABEL } from "@/lib/risk/health";
import { explorerAddress, explorerTx } from "@/config/chains";
import type { Freshness } from "@/lib/risk/freshness";

export function cn(...a: Parameters<typeof clsx>) {
  return twMerge(clsx(...a));
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
const VARIANT: Record<Variant, string> = {
  primary: "bg-teal text-ink-0 hover:bg-teal-strong font-semibold shadow-[0_8px_24px_-12px_rgb(79_198_191/0.7)]",
  secondary: "bg-ink-3 text-fg hover:bg-ink-4 border border-ink-5",
  ghost: "text-fg-2 hover:text-fg hover:bg-ink-3",
  danger: "bg-critical/90 text-white hover:bg-critical font-semibold",
  quiet: "text-teal hover:text-teal-strong underline-offset-4 hover:underline px-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }>(
  function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
    const sz = size === "sm" ? "h-8 px-3 text-[13px]" : size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm";
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn("inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap", sz, VARIANT[variant], className)}
        {...rest}
      >
        {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

export const CATEGORY_COLOR: Record<RiskCategory, string> = {
  "no-debt": "var(--color-fg-3)",
  healthy: "var(--color-safe)",
  caution: "var(--color-caution)",
  high: "var(--color-high)",
  critical: "var(--color-critical)",
  liquidatable: "var(--color-critical)",
  unknown: "var(--color-fg-3)",
};

const CATEGORY_ICON: Record<RiskCategory, typeof ShieldCheck> = {
  "no-debt": CircleDashed,
  healthy: ShieldCheck,
  caution: Eye,
  high: TriangleAlert,
  critical: Siren,
  liquidatable: OctagonAlert,
  unknown: CircleHelp,
};

/** Risk status is always text + icon + colour, never colour alone. */
export function RiskBadge({ category, size = "md", className }: { category: RiskCategory; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : size === "lg" ? "px-3.5 py-1.5 text-[15px]" : "px-2.5 py-1 text-[13px]",
        category === "liquidatable" && "animate-[sweep_1.6s_ease-in-out_infinite]",
        className,
      )}
      style={{ color, borderColor: `color-mix(in oklab, ${color} 45%, transparent)`, background: `color-mix(in oklab, ${color} 12%, transparent)` }}
    >
      <Icon className={size === "lg" ? "size-4" : "size-3.5"} aria-hidden />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function Stat({ label, value, sub, tone, className, simulated }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; className?: string; simulated?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-fg-3">{label}</div>
      <div className={cn("num mt-0.5 text-xl text-fg truncate", simulated && "simulated")} style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[12.5px] text-fg-3">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function SourceTag({ kind, className }: { kind: "onchain" | "simulated" | "fictional" | "offchain" | "external" | "recorded"; className?: string }) {
  const map = {
    onchain: { label: "On-chain", cls: "text-teal border-teal/40 bg-teal/10" },
    simulated: { label: "Simulated", cls: "text-fg-2 border-dashed border-fg-3/60" },
    fictional: { label: "Fictional", cls: "text-fiction border-fiction/50 bg-fiction/10" },
    offchain: { label: "App event", cls: "text-fg-2 border-ink-5 bg-ink-3" },
    external: { label: "External reference", cls: "text-caution border-caution/40 bg-caution/10" },
    recorded: { label: "Recorded by MUSD Rescue", cls: "text-fg-2 border-ink-5" },
  }[kind];
  return <span className={cn("inline-flex items-center rounded-md border px-1.5 py-px text-[11.5px] font-medium", map.cls, className)}>{map.label}</span>;
}

export function FreshnessPill({ freshness, ageLabel }: { freshness: Freshness; ageLabel?: string }) {
  const m = {
    fresh: { c: "var(--color-safe)", t: "Live" },
    aging: { c: "var(--color-caution)", t: "Aging" },
    stale: { c: "var(--color-critical)", t: "Stale" },
    missing: { c: "var(--color-fg-3)", t: "No data" },
  }[freshness];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2" title={`Data freshness: ${m.t}`}>
      <span className="size-2 rounded-full" style={{ background: m.c, boxShadow: freshness === "fresh" ? `0 0 0 3px color-mix(in oklab, ${m.c} 25%, transparent)` : undefined }} />
      {m.t}
      {ageLabel && <span className="num text-fg-3">{ageLabel}</span>}
    </span>
  );
}

export function ExplorerLink({ hash, address, children, className }: { hash?: string; address?: string; children?: ReactNode; className?: string }) {
  const href = hash ? explorerTx(hash) : address ? explorerAddress(address) : "#";
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 text-teal hover:text-teal-strong hover:underline underline-offset-4", className)}>
      {children ?? <span className="num">{(hash ?? address ?? "").slice(0, 10)}…{(hash ?? address ?? "").slice(-6)}</span>}
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(opens Mezo explorer)</span>
    </a>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-flex items-center gap-1 rounded p-1 text-fg-3 hover:text-fg"
      aria-label={label}
    >
      {done ? <Check className="size-3.5 text-safe" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel-flat flex flex-col items-start gap-3 p-6 sm:p-8">
      {icon && <div className="text-teal">{icon}</div>}
      <h3 className="font-display text-xl font-semibold text-fg">{title}</h3>
      {children && <div className="max-w-[62ch] text-fg-2">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Could not load live data", error, onRetry }: { title?: string; error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel-flat border-critical/40 p-5">
      <div className="flex items-center gap-2 font-medium text-critical">
        <TriangleAlert className="size-4" /> {title}
      </div>
      <p className="mt-1 text-sm text-fg-2">{error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-1 text-sm text-fg-3">No values are shown in place of missing data, and rescue actions stay disabled until a fresh read succeeds.</p>
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function SectionHeading({ title, desc, right, as: As = "h2" }: { title: ReactNode; desc?: ReactNode; right?: ReactNode; as?: "h1" | "h2" | "h3" }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <As className={cn("font-display font-semibold tracking-[-0.01em] text-fg", As === "h1" ? "text-3xl sm:text-[34px] leading-tight" : As === "h2" ? "text-xl" : "text-lg")}>{title}</As>
        {desc && <p className="mt-1 max-w-[72ch] text-[14.5px] text-fg-2">{desc}</p>}
      </div>
      {right}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius-control)] border border-ink-4 bg-ink-1 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1.5 text-[13px] transition-colors", value === o.value ? "bg-ink-4 text-fg" : "text-fg-3 hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("text-teal hover:text-teal-strong underline-offset-4 hover:underline", className)}>
      {children}
    </Link>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg-2">
        {label}
      </label>
      {children}
      {error ? <p className="text-[12.5px] text-critical">{error}</p> : hint ? <p className="text-[12.5px] text-fg-3">{hint}</p> : null}
    </div>
  );
}

export const inputCls =
  "num h-11 w-full rounded-[var(--radius-control)] border border-ink-4 bg-ink-1 px-3 text-[15px] text-fg placeholder:text-fg-3 focus:border-teal focus:outline-none";
