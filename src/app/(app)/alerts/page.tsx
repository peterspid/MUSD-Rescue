"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { AlertRules } from "@/components/alert-rules";
import { useSession } from "@/components/session";
import { Button, FreshnessPill, SectionHeading, cn } from "@/components/ui";
import { assessFreshness, MONITOR_POLICY } from "@/lib/risk/freshness";
import { shortAddress } from "@/lib/risk/format";

interface Run {
  started_at: string;
  finished_at: string | null;
  ok: boolean;
  troves_checked: number;
  rules_evaluated: number;
  alerts_fired: number;
  block_number: string | null;
}
interface Status {
  schedule: { cron: string; description: string };
  lastCron: (Run & { error: string | null }) | null;
  lastCronOk: Run | null;
  lastOk: Run | null;
  lastUserOk: Run | null;
}
interface Notification {
  id: string;
  severity: string;
  title: string;
  body: string;
  quiet: boolean;
  source: string;
  created_at: string;
  read_at: string | null;
  trove_owner: string | null;
}

export default function AlertsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const status = useQuery({ queryKey: ["monitor-status"], queryFn: () => api<Status>("/api/monitor/status"), refetchInterval: 60_000 });
  const notes = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: Notification[]; unread: number }>("/api/notifications"), enabled: !!session.address });
  const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  const lastOkAt = status.data?.lastOk?.finished_at ? new Date(status.data.lastOk.finished_at).getTime() : null;
  const cronOkAt = status.data?.lastCronOk?.finished_at ? new Date(status.data.lastCronOk.finished_at).getTime() : null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        as="h1"
        title="Alerts"
        desc="Rules are evaluated by a scheduled job once a day (06:00 UTC, the Vercel Hobby cron limit), each time you open the app, and whenever you press Check now. MUSD Rescue is not a continuous monitor: a fast BTC move between checks will not be caught in time."
        right={
          session.address ? (
            <Button
              variant="primary"
              loading={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  const r = await api<{ rulesEvaluated: number; alertsFired: number; trovesChecked: number; ok: boolean }>("/api/monitor/check", { method: "POST", json: { source: "check_now" } });
                  toast[r.ok ? "success" : "warning"](`Checked ${r.rulesEvaluated} rule(s) across ${r.trovesChecked} trove(s)`, { description: `${r.alertsFired} alert(s) fired.` });
                  qc.invalidateQueries({ queryKey: ["notifications"] });
                  qc.invalidateQueries({ queryKey: ["monitor-status"] });
                  qc.invalidateQueries({ queryKey: ["rules"] });
                } catch (e) {
                  toast.error("Check failed", { description: (e as Error).message });
                } finally {
                  setChecking(false);
                }
              }}
            >
              <RefreshCw className="size-4" /> Check now
            </Button>
          ) : null
        }
      />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Monitoring status">
        <div className="panel p-5">
          <div className="flex items-center gap-2 text-[13px] text-muted"><Clock className="size-4" /> Scheduled monitoring</div>
          <div className="mt-2 font-medium">Daily at 06:00 UTC</div>
          <div className="mt-1 flex items-center gap-2 text-[13px] text-ink-soft">
            Last successful run: <span className="num">{cronOkAt ? new Date(cronOkAt).toLocaleString() : "not yet"}</span>
          </div>
          <div className="mt-2"><FreshnessPill freshness={assessFreshness(cronOkAt, Date.now(), MONITOR_POLICY)} /></div>
          {status.data?.lastCron && !status.data.lastCron.ok && <p className="mt-2 text-[13px] font-medium text-ink">Last run failed: {status.data.lastCron.error ?? "unknown error"}</p>}
        </div>
        <div className="panel p-5">
          <div className="text-[13px] text-muted">Last successful check (any source)</div>
          <div className="num mt-2 font-medium">{lastOkAt ? new Date(lastOkAt).toLocaleString() : "never"}</div>
          {status.data?.lastOk && <p className="mt-1 text-[13px] text-ink-soft">{status.data.lastOk.rules_evaluated} rules, {status.data.lastOk.troves_checked} troves, block {status.data.lastOk.block_number ? Number(status.data.lastOk.block_number).toLocaleString("en-US") : "—"}</p>}
          {session.address && <p className="mt-1 text-[13px] text-muted">Your last check: {status.data?.lastUserOk ? new Date(status.data.lastUserOk.finished_at!).toLocaleString() : "never"}</p>}
        </div>
        <div className="panel p-5">
          <div className="flex items-center gap-2 text-[13px] text-muted"><BellRing className="size-4" /> Channels</div>
          <p className="mt-2 text-[14px] text-ink-soft">In-app inbox (always). Browser notifications only while a tab is open. Email and messaging are not offered because no delivery infrastructure is in place.</p>
          {perm !== "unsupported" && (
            <Button
              size="sm"
              className="mt-3"
              variant="secondary"
              disabled={perm === "denied"}
              onClick={async () => {
                const r = await Notification.requestPermission();
                await session.savePrefs({ browserNotifications: r === "granted" });
                toast(r === "granted" ? "Browser notifications on" : "Browser notifications not allowed");
              }}
            >
              {perm === "granted" ? (session.prefs.browserNotifications ? "Browser notifications on" : "Enable browser notifications") : perm === "denied" ? "Blocked in browser settings" : "Allow browser notifications"}
            </Button>
          )}
        </div>
      </section>

      <section className="panel p-5 sm:p-6">
        <h2 className="text-[16px] font-semibold">Rules</h2>
        <div className="mt-4">
          <AlertRules />
        </div>
      </section>

      {session.address && (
        <section className="panel p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold">Inbox</h2>
            {(notes.data?.unread ?? 0) > 0 && (
              <Button size="sm" variant="ghost" onClick={async () => { await api("/api/notifications", { method: "POST", json: { all: true } }); qc.invalidateQueries({ queryKey: ["notifications"] }); }}>
                Mark all read
              </Button>
            )}
          </div>
          {!notes.data?.notifications.length && <p className="mt-3 text-[14px] text-muted">No notifications yet.</p>}
          <ul className="mt-3 divide-y divide-line">
            {notes.data?.notifications.map((n) => (
              <li key={n.id} className={cn("flex flex-wrap gap-x-4 gap-y-1 py-3", !n.read_at && "border-l-2 border-l-blue pl-3")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.severity === "critical" ? "bg-ink" : n.severity === "warning" ? "border-2 border-ink" : "bg-blue")} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{n.title} <span className="text-[13px] font-normal text-muted">{n.severity}{n.quiet ? ", quiet hours" : ""}{!n.read_at ? ", unread" : ""}</span></div>
                  <p className="text-[14px] text-ink-soft">{n.body}</p>
                </div>
                <div className="num text-right text-[13px] text-muted">
                  {new Date(n.created_at).toLocaleString()}
                  <br />
                  {n.trove_owner ? shortAddress(n.trove_owner) : ""} via {n.source.replace("_", " ")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
