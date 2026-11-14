"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import { Activity, Bell, BellRing, FlaskConical, LayoutDashboard, LifeBuoy, Radar, Search, Settings, FileText, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ConnectButton, NetworkNotice } from "./wallet";
import { FreshnessPill, cn } from "./ui";
import { Logo } from "./logo";
import { useSession } from "./session";
import { api, useSystem } from "@/lib/client/api";
import { assessFreshness } from "@/lib/risk/freshness";
import { formatBps, formatRatioPct, formatUsd } from "@/lib/risk/format";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/guard", label: "Guard", icon: ShieldCheck },
  { href: "/radar", label: "Radar", icon: Radar },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/demo", label: "Demo", icon: FlaskConical, desktopOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function SystemStrip() {
  const { data, error, isLoading, dataUpdatedAt } = useSystem();
  const now = useNow(5000);
  const fresh = assessFreshness(error && !data ? null : dataUpdatedAt || null, now);
  const ageS = dataUpdatedAt ? Math.max(0, Math.round((now - dataUpdatedAt) / 1000)) : null;
  const items: { k: string; v: ReactNode; title: string }[] = data
    ? [
        { k: "BTC oracle", v: data.price ? formatUsd(BigInt(data.price)) : <span className="font-semibold text-ink">unavailable</span>, title: "PriceFeed.fetchPrice() on Mezo testnet — the price MUSD uses for liquidations" },
        { k: "System TCR", v: formatRatioPct(data.tcr ? BigInt(data.tcr) : undefined), title: "Total collateral ratio of all troves" },
        {
          k: data.recoveryMode ? "Recovery Mode" : "To Recovery Mode",
          v: data.recoveryMode ? <span className="font-semibold text-ink">active</span> : data.dropToRecoveryBps ? `−${formatBps(BigInt(data.dropToRecoveryBps))} BTC` : "—",
          title: "Recovery Mode starts when TCR < 150%. It restricts operations; MUSD still liquidates only below 110% ICR.",
        },
        { k: "Troves", v: data.troveCount.toLocaleString("en-US"), title: "Open troves (TroveManager.getTroveOwnersCount)" },
        { k: "Block", v: Number(data.blockNumber).toLocaleString("en-US"), title: "Latest Mezo testnet block read" },
      ]
    : [];
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1240px] items-center gap-x-6 gap-y-1 overflow-x-auto px-4 py-2 text-[13px] sm:px-6 [scrollbar-width:none]">
        <span className="shrink-0 rounded-[var(--radius-badge)] border border-blue px-1.5 py-0.5 text-[12px] leading-none font-medium text-blue">Testnet</span>
        {isLoading && <span className="text-muted">Reading Mezo testnet…</span>}
        {error && !data && <span className="font-medium text-ink">Mezo testnet RPC is not responding. No numbers are shown rather than stale ones.</span>}
        {items.map((i) => (
          <span key={i.k} className="flex shrink-0 items-baseline gap-1.5" title={i.title}>
            <span className="text-muted">{i.k}</span>
            <span className="num text-ink">{i.v}</span>
          </span>
        ))}
        <span className="ml-auto shrink-0">
          <FreshnessPill freshness={fresh} ageLabel={ageS != null ? `${ageS}s` : undefined} />
        </span>
      </div>
    </div>
  );
}

interface Notification {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  quiet: boolean;
  created_at: string;
  read_at: string | null;
  trove_owner: string | null;
}

function NotificationsBell() {
  const session = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: Notification[]; unread: number }>("/api/notifications"),
    enabled: !!session.address,
    refetchInterval: 60_000,
  });
  // "On every visit": evaluate this user's alert rules when the app opens (server throttles to once a minute).
  useEffect(() => {
    if (!session.address) return;
    api("/api/monitor/check", { method: "POST", json: { source: "visit" } })
      .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
      .catch(() => {});
  }, [session.address, qc]);
  // Browser notifications while the app is open (opt-in, never during quiet hours).
  useEffect(() => {
    if (!data) return;
    const fresh = data.notifications.filter((n) => !n.read_at && !seen.current.has(n.id));
    const first = seen.current.size === 0;
    data.notifications.forEach((n) => seen.current.add(n.id));
    if (first) return;
    for (const n of fresh) {
      toast[n.severity === "critical" ? "error" : "warning"](n.title, { description: n.body });
      if (!n.quiet && session.prefs.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          new Notification(`MUSD Rescue: ${n.title}`, { body: n.body, tag: `rescue-${n.id}` });
        } catch {
          /* unsupported */
        }
      }
    }
  }, [data, session.prefs.browserNotifications]);
  if (!session.address) return null;
  const unread = data?.unread ?? 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-ink-soft hover:bg-surface hover:text-ink" aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        {unread ? <BellRing className="size-5 text-ink" aria-hidden /> : <Bell className="size-5" aria-hidden />}
        {unread > 0 && <span className="num absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-blue text-[10px] font-semibold text-paper">{Math.min(unread, 9)}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="panel absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(380px,calc(100vw-24px))] overflow-auto p-2">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[14px] font-medium">Notifications</span>
              {unread > 0 && (
                <button
                  className="text-[13px] text-blue hover:underline"
                  onClick={async () => {
                    await api("/api/notifications", { method: "POST", json: { all: true } });
                    qc.invalidateQueries({ queryKey: ["notifications"] });
                  }}
                >
                  Mark all read
                </button>
              )}
            </div>
            {!data?.notifications.length && <p className="px-2 py-4 text-[14px] text-muted">No alerts yet. Create rules on the Alerts page.</p>}
            {data?.notifications.slice(0, 20).map((n) => (
              <div key={n.id} className={cn("rounded-md px-2 py-2", !n.read_at && "bg-surface")}>
                <div className="flex items-center gap-2 text-[14px]">
                  <span className={cn("size-2 shrink-0 rounded-full", n.severity === "critical" ? "bg-ink" : n.severity === "warning" ? "border-2 border-ink" : "bg-blue")} aria-hidden />
                  <span className="sr-only">{n.severity}</span>
                  <span className="font-medium">{n.title}</span>
                  {n.quiet && <span className="text-[12px] text-muted">quiet hours</span>}
                </div>
                <p className="mt-0.5 text-[13px] text-ink-soft">{n.body}</p>
                <p className="num mt-0.5 text-[12px] text-muted">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))}
            <Link href="/alerts" onClick={() => setOpen(false)} className="block px-2 py-2 text-[13px] text-blue hover:underline">
              Manage alerts
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  const { address } = useAccount();
  const qc = useQueryClient();
  const session = useSession();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openEv = () => setOpen(true);
    window.addEventListener("keydown", h);
    window.addEventListener("open-command-palette", openEv);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("open-command-palette", openEv);
    };
  }, []);
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const addr = q.trim();
  const validAddr = isAddress(addr, { strict: false });
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content className="panel fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden p-0">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Command label="Command palette" shouldFilter={!validAddr}>
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search className="size-4 text-muted" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Jump to a page, or paste any 0x address to watch…" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted" />
            </div>
            <Command.List className="max-h-[50vh] overflow-auto p-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-muted">
              <Command.Empty className="px-3 py-6 text-[14px] text-muted">Nothing matches.</Command.Empty>
              {validAddr && (
                <Command.Group heading="Address">
                  <Item onSelect={() => go(`/positions/${addr}`)}>Watch {addr.slice(0, 10)}… (read-only)</Item>
                  <Item onSelect={() => go(`/rescue/${addr}`)}>Simulate rescue for {addr.slice(0, 10)}…</Item>
                </Command.Group>
              )}
              {address && (
                <Command.Group heading="My trove">
                  <Item onSelect={() => go(`/positions/${address}`)}>Open my position</Item>
                  <Item onSelect={() => go(`/rescue/${address}`)}>Open rescue simulator</Item>
                  <Item onSelect={() => go(`/positions/${address}/report`)}>Printable risk report</Item>
                </Command.Group>
              )}
              <Command.Group heading="Go to">
                {NAV.map((n) => (
                  <Item key={n.href} onSelect={() => go(n.href)}>
                    {n.label}
                  </Item>
                ))}
                <Item onSelect={() => go("/methodology")}>Risk methodology</Item>
                <Item onSelect={() => go("/")}>Home</Item>
              </Command.Group>
              <Command.Group heading="Actions">
                <Item
                  onSelect={() => {
                    qc.invalidateQueries();
                    setOpen(false);
                    toast("Refreshing live data");
                  }}
                >
                  Refresh all live data
                </Item>
                {session.address && (
                  <Item
                    onSelect={async () => {
                      setOpen(false);
                      try {
                        const r = await api<{ alertsFired: number; rulesEvaluated: number }>("/api/monitor/check", { method: "POST", json: { source: "check_now" } });
                        qc.invalidateQueries({ queryKey: ["notifications"] });
                        toast.success(`Checked ${r.rulesEvaluated} alert rules`, { description: `${r.alertsFired} alert(s) fired.` });
                      } catch (e) {
                        toast.error("Check failed", { description: (e as Error).message });
                      }
                    }}
                  >
                    Check my alerts now
                  </Item>
                )}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <Command.Item onSelect={onSelect} className="cursor-pointer rounded-md px-3 py-2 text-[14px] text-ink-soft data-[selected=true]:bg-surface data-[selected=true]:text-ink">
      {children}
    </Command.Item>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = useMemo(() => NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + "/"))?.href, [pathname]);
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-blue focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="no-print sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="MUSD Rescue home">
            <Logo />
          </Link>
          <nav className="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active === n.href ? "page" : undefined}
                className={cn("flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 text-[14px] transition-colors", active === n.href ? "bg-surface font-medium text-ink" : "text-ink-soft hover:text-ink")}
              >
                <n.icon className="size-4" aria-hidden />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
              className="hidden items-center gap-2 rounded-[var(--radius-control)] border border-line-strong px-2.5 py-1.5 text-[13px] text-ink-soft hover:border-ink hover:text-ink sm:flex"
              aria-label="Open command palette"
            >
              <Search className="size-3.5" /> Search
              <kbd className="rounded-[3px] border border-line-strong px-1 text-[12px] text-muted">Ctrl K</kbd>
            </button>
            <NotificationsBell />
            <ConnectButton size="sm" />
          </div>
        </div>
        <SystemStrip />
        <NetworkNotice />
      </header>
      <main id="main" className="mx-auto max-w-[1240px] px-4 pb-28 pt-8 sm:px-6 lg:pb-16">
        {children}
      </main>
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line bg-paper lg:hidden" aria-label="Main mobile">
        {NAV.filter((n) => !("desktopOnly" in n)).map((n) => (
          <Link key={n.href} href={n.href} aria-current={active === n.href ? "page" : undefined} className={cn("flex min-w-0 flex-col items-center gap-0.5 border-t-2 py-2 text-[12px]", active === n.href ? "border-blue font-medium text-blue" : "border-transparent text-ink-soft")}>
            <n.icon className="size-5" aria-hidden />
            {n.label}
          </Link>
        ))}
      </nav>
      <footer className="no-print mx-auto hidden max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-6 py-5 text-[13px] text-muted lg:flex">
        <span className="flex items-center gap-1.5">
          <LifeBuoy className="size-3.5" /> Risk information only. MUSD Rescue cannot guarantee that liquidation will be prevented.
        </span>
        <Link href="/methodology" className="hover:text-ink">
          <FileText className="mr-1 inline size-3.5" />
          Methodology
        </Link>
        <Link href="/legal" className="hover:text-ink">
          Terms, privacy &amp; risk
        </Link>
        <span className="ml-auto flex items-center gap-1">
          <RefreshCw className="size-3.5" /> Live reads every 15 s. Alerts are checked daily, on each visit, and on demand.
        </span>
      </footer>
      <CommandPalette />
    </div>
  );
}
