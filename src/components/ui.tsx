"use client";
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Check, CircleDashed, CircleHelp, Copy, ExternalLink, Eye, LoaderCircle, OctagonAlert, ShieldCheck, Siren, TriangleAlert, Info } from "lucide-react";
import type { RiskCategory } from "@/lib/risk/health";
import { CATEGORY_LABEL } from "@/lib/risk/health";
import { explorerAddress, explorerTx } from "@/config/chains";
import type { Freshness } from "@/lib/risk/freshness";

export function cn(...a: Parameters<typeof clsx>) {
  return twMerge(clsx(...a));
}

/* ------------------------------------------------------------------ buttons */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  /** The one blue action on a screen. */
  primary: "bg-blue text-paper hover:bg-blue-deep font-semibold",
  /** Black outline: secondary actions. */
  secondary: "bg-paper text-ink border border-ink hover:bg-surface",
  ghost: "text-ink hover:bg-surface",
  /** Destructive or irreversible: solid black. */
  danger: "bg-ink text-paper hover:bg-ink-soft font-semibold",
  /** Inline text action. */
  quiet: "text-blue hover:underline underline-offset-4 px-0 h-auto",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
  lg: "h-12 px-5 text-[16px]",
};

export function buttonClasses({ variant = "secondary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
    SIZE[size],
    VARIANT[variant],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }>(
  function Button({ variant = "secondary", size = "md", loading, className, children, disabled, type = "button", ...rest }, ref) {
    return (
      <button ref={ref} type={type} disabled={disabled || loading} className={buttonClasses({ variant, size, className })} {...rest}>
        {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);

/** A link that looks like a button (never nest <Button> inside <Link>). */
export function ButtonLink({ href, variant = "secondary", size = "md", className, children, external, ...rest }: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode; external?: boolean; "aria-label"?: string }) {
  const cls = buttonClasses({ variant, size, className });
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} {...rest}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

/* --------------------------------------------------------------------- risk */

/** Colour for a risk figure: blue when healthy, black for every level of risk, grey when unknown. */
export const CATEGORY_COLOR: Record<RiskCategory, string> = {
  "no-debt": "var(--color-muted)",
  healthy: "var(--color-blue)",
  caution: "var(--color-ink)",
  high: "var(--color-ink)",
  critical: "var(--color-ink)",
  liquidatable: "var(--color-ink)",
  unknown: "var(--color-muted)",
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

/** Risk badge: ink density rises with risk. Always text + icon, never colour alone. */
const CATEGORY_BADGE: Record<RiskCategory, string> = {
  "no-debt": "border border-line-strong text-muted",
  healthy: "border border-blue text-blue",
  caution: "border border-ink text-ink",
  high: "border-2 border-ink text-ink font-semibold",
  critical: "border border-ink bg-ink text-paper font-semibold",
  liquidatable: "border border-ink hatch-inverse text-paper font-semibold",
  unknown: "border border-dashed border-line-strong text-muted",
};

export function RiskBadge({ category, size = "md", className }: { category: RiskCategory; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-badge)] leading-none",
        size === "sm" ? "px-1.5 py-1 text-[12px]" : size === "lg" ? "px-2.5 py-1.5 text-[15px]" : "px-2 py-1 text-[13px]",
        CATEGORY_BADGE[category],
        className,
      )}
    >
      <Icon className={size === "lg" ? "size-4" : "size-3.5"} aria-hidden />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

/* ------------------------------------------------------------------- layout */

export function Stat({ label, value, sub, tone, className, simulated, size = "md" }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string; className?: string; simulated?: boolean; size?: "md" | "lg" }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className={cn("num mt-0.5 truncate font-medium text-ink", size === "lg" ? "text-[32px] leading-tight" : "text-[20px]", simulated && "simulated")} style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export type SourceKind = "onchain" | "simulated" | "fictional" | "offchain" | "external" | "recorded";

/** Where a number comes from. "fictional" renders as "Example data". */
export function SourceTag({ kind, className }: { kind: SourceKind; className?: string }) {
  const map: Record<SourceKind, { label: string; cls: string }> = {
    onchain: { label: "On-chain", cls: "border-blue text-blue" },
    simulated: { label: "Simulated", cls: "border-dashed border-blue text-blue" },
    fictional: { label: "Example data", cls: "border-dotted border-ink text-ink" },
    offchain: { label: "App event", cls: "border-line-strong text-muted" },
    external: { label: "External reference", cls: "border-dashed border-line-strong text-muted" },
    recorded: { label: "Recorded by MUSD Rescue", cls: "border-line-strong text-muted" },
  };
  const m = map[kind];
  return <span className={cn("inline-flex shrink-0 items-center rounded-[var(--radius-badge)] border px-1.5 py-0.5 text-[12px] leading-none font-medium", m.cls, className)}>{m.label}</span>;
}

/** Data freshness: blue dot when live, black ring when ageing, solid black when stale. */
export function FreshnessPill({ freshness, ageLabel }: { freshness: Freshness; ageLabel?: string }) {
  const m = {
    fresh: { dot: "bg-blue", t: "Live" },
    aging: { dot: "border-2 border-ink bg-paper", t: "Ageing" },
    stale: { dot: "bg-ink", t: "Stale" },
    missing: { dot: "border border-line-strong bg-paper", t: "No data" },
  }[freshness];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] text-ink-soft", freshness === "stale" && "font-semibold text-ink")} title={`Data freshness: ${m.t}`}>
      <span className={cn("size-2 rounded-full", m.dot)} aria-hidden />
      {m.t}
      {ageLabel && <span className="num text-muted">{ageLabel}</span>}
    </span>
  );
}

/** Shortened address/hash in monospace. */
export function Address({ value, chars = 4, className }: { value: string; chars?: number; className?: string }) {
  const short = value.length > 2 + chars * 2 + 1 ? `${value.slice(0, 2 + chars)}…${value.slice(-chars)}` : value;
  return (
    <span className={cn("addr", className)} title={value}>
      {short}
    </span>
  );
}

export function ExplorerLink({ hash, address, children, className }: { hash?: string; address?: string; children?: ReactNode; className?: string }) {
  const href = hash ? explorerTx(hash) : address ? explorerAddress(address) : "#";
  const v = hash ?? address ?? "";
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 text-blue underline-offset-4 hover:underline", className)}>
      {children ?? <span className="addr">{v.slice(0, 10)}…{v.slice(-6)}</span>}
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
      className="inline-flex items-center gap-1 rounded p-1 align-middle text-muted hover:text-ink"
      aria-label={done ? "Copied" : label}
    >
      {done ? <Check className="size-3.5 text-blue" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-6 sm:p-8">
      {icon && <div className="text-ink">{icon}</div>}
      <h3 className="text-[20px] font-semibold text-ink">{title}</h3>
      {children && <div className="max-w-[64ch] text-ink-soft">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Could not load live data", error, onRetry }: { title?: string; error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-[var(--radius-panel)] border-2 border-ink bg-paper p-5">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <TriangleAlert className="size-4" aria-hidden /> {title}
      </div>
      <p className="mt-1 text-[14px] text-ink-soft">{error instanceof Error ? error.message : String(error)}</p>
      <p className="mt-1 text-[14px] text-muted">No values are shown in place of missing data, and rescue actions stay disabled until a fresh read succeeds.</p>
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export type CalloutTone = "neutral" | "info" | "watch" | "act" | "urgent";

/**
 * A boxed message. Tone follows the risk scale: info = blue, watch = black outline,
 * act = heavy black outline, urgent = solid black.
 */
export function Callout({ tone = "neutral", title, children, icon, className, role }: { tone?: CalloutTone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string; role?: string }) {
  const cls = {
    neutral: "border border-line bg-surface text-ink",
    info: "border border-blue bg-blue-tint text-ink",
    watch: "border border-ink bg-paper text-ink",
    act: "border-2 border-ink bg-paper text-ink",
    urgent: "border border-ink bg-ink text-paper",
  }[tone];
  const DefaultIcon = tone === "info" || tone === "neutral" ? Info : tone === "urgent" ? OctagonAlert : TriangleAlert;
  return (
    <div role={role} className={cn("flex gap-2.5 rounded-[var(--radius-control)] px-3.5 py-3 text-[14px]", cls, className)}>
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon ?? <DefaultIcon className="size-4" />}
      </span>
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(tone === "urgent" ? "text-paper" : "text-ink-soft", title ? "mt-0.5" : "")}>{children}</div>}
      </div>
    </div>
  );
}

/** The risk engine's recommendation (`recommend()` in lib/risk) as a callout. */
export function Recommendation({ rec, className }: { rec: { tone: "ok" | "watch" | "act" | "urgent" | "neutral"; title: string; body: string }; className?: string }) {
  const tone: CalloutTone = rec.tone === "ok" ? "info" : rec.tone;
  return (
    <Callout tone={tone} title={rec.title} className={className} icon={rec.tone === "ok" ? <ShieldCheck className="size-4" /> : undefined}>
      {rec.body}
    </Callout>
  );
}

export function SectionHeading({ title, desc, right, as: As = "h2" }: { title: ReactNode; desc?: ReactNode; right?: ReactNode; as?: "h1" | "h2" | "h3" }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <As className={cn("font-semibold tracking-[-0.015em] text-ink", As === "h1" ? "text-[28px] leading-tight sm:text-[32px]" : As === "h2" ? "text-[20px]" : "text-[16px]")}>{title}</As>
        {desc && <div className="mt-1 max-w-[72ch] text-[15px] text-ink-soft">{desc}</div>}
      </div>
      {right}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[var(--radius-control)] border border-ink p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-[4px] px-3 py-1.5 text-[13px] transition-colors", value === o.value ? "bg-ink text-paper" : "text-ink hover:bg-surface")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TextLink({ href, children, className, external }: { href: string; children: ReactNode; className?: string; external?: boolean }) {
  const cls = cn("text-blue underline-offset-4 hover:underline", className);
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-[13px] font-medium text-ink">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <div className="text-[13px] text-muted">{hint}</div>
      ) : null}
    </div>
  );
}

export const inputCls =
  "num h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-[16px] text-ink placeholder:text-muted focus:border-blue focus:outline-none";

/* -------------------------------------------------------------------- hatch */

/**
 * SVG pattern definition for the liquidation-zone hatch. Render once inside an <svg> (or a recharts chart)
 * and fill shapes with `url(#<id>)`.
 */
export function HatchPattern({ id = "hatch", color = "#000000", gap = 6, weight = 1.1 }: { id?: string; color?: string; gap?: number; weight?: number }) {
  return (
    <defs>
      <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={gap} height={gap} fill="#ffffff" />
        <line x1="0" y1="0" x2="0" y2={gap} stroke={color} strokeWidth={weight * 1.4} />
      </pattern>
    </defs>
  );
}

/** Small legend swatch showing the hatch. */
export function HatchSwatch({ className }: { className?: string }) {
  return <span className={cn("hatch inline-block size-3 border border-ink align-[-1px]", className)} aria-hidden />;
}
