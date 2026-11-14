"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress } from "viem";
import { Plus, Trash2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { ALERT_KINDS, type AlertKind, type AlertFrequency } from "@/lib/alerts/evaluate";
import { shortAddress } from "@/lib/risk/format";
import { Button, Field, inputCls, cn } from "./ui";
import { useSession } from "./session";

export interface RuleRow {
  id: string;
  trove_owner: string;
  kind: AlertKind;
  threshold: number | null;
  frequency: AlertFrequency;
  channel: "in_app" | "in_app_browser";
  quiet_start: number | null;
  quiet_end: number | null;
  tz_offset_min: number;
  enabled: boolean;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
}

const FREQ_LABEL: Record<AlertFrequency, string> = { every_check: "Every check", once_per_hour: "At most hourly", once_per_day: "At most daily" };
const selectCls = "h-11 w-full rounded-[var(--radius-control)] border border-ink-4 bg-ink-1 px-3 text-[14px] text-fg focus:border-teal focus:outline-none";

export function useRules() {
  const session = useSession();
  return useQuery({ queryKey: ["rules"], queryFn: () => api<{ rules: RuleRow[] }>("/api/alerts"), enabled: !!session.address });
}

export function AlertRules({ owner, compact }: { owner?: string; compact?: boolean }) {
  const session = useSession();
  const qc = useQueryClient();
  const rules = useRules();
  const [kind, setKind] = useState<AlertKind>("enters_warning");
  const [threshold, setThreshold] = useState<string>(String(ALERT_KINDS.enters_warning.defaultThreshold));
  const [target, setTarget] = useState(owner ?? "");
  const [frequency, setFrequency] = useState<AlertFrequency>("once_per_day");
  const [browser, setBrowser] = useState(false);
  const [quietOn, setQuietOn] = useState(false);
  const [qs, setQs] = useState("22");
  const [qe, setQe] = useState("7");
  const [saving, setSaving] = useState(false);

  if (!session.address) {
    return (
      <div className="well flex flex-wrap items-center gap-3 p-4 text-[14px] text-fg-2">
        <KeyRound className="size-4 text-teal" />
        <span className="flex-1">Sign in with your wallet (a free signature, no transaction) to save alert rules.</span>
        <Button size="sm" variant="secondary" loading={session.signingIn} onClick={() => session.signIn()}>
          Sign in
        </Button>
      </div>
    );
  }
  const list = (rules.data?.rules ?? []).filter((r) => !owner || r.trove_owner.toLowerCase() === owner.toLowerCase());
  const meta = ALERT_KINDS[kind];

  async function create() {
    const t = threshold.trim() === "" ? null : Number(threshold);
    if (!isAddress(target, { strict: false })) return toast.error("Enter the trove owner address to watch.");
    if (meta.thresholdLabel && (t == null || !Number.isFinite(t) || t <= 0)) return toast.error("Enter a positive threshold.");
    setSaving(true);
    try {
      await api("/api/alerts", {
        method: "POST",
        json: {
          troveOwner: target,
          kind,
          threshold: meta.thresholdLabel ? t : null,
          frequency,
          channel: browser ? "in_app_browser" : "in_app",
          quietStart: quietOn ? Number(qs) : null,
          quietEnd: quietOn ? Number(qe) : null,
          tzOffsetMin: -new Date().getTimezoneOffset(),
        },
      });
      if (browser && typeof Notification !== "undefined" && Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm === "granted") await session.savePrefs({ browserNotifications: true });
      }
      qc.invalidateQueries({ queryKey: ["rules"] });
      toast.success("Alert rule saved");
    } catch (e) {
      toast.error("Could not save the rule", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("grid gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
        {!owner && (
          <Field label="Trove owner" htmlFor="rule-owner">
            <input id="rule-owner" className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0x…" spellCheck={false} />
          </Field>
        )}
        <Field label="Condition" htmlFor="rule-kind">
          <select
            id="rule-kind"
            className={selectCls}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as AlertKind;
              setKind(k);
              setThreshold(ALERT_KINDS[k].defaultThreshold == null ? "" : String(ALERT_KINDS[k].defaultThreshold));
            }}
          >
            {(Object.keys(ALERT_KINDS) as AlertKind[]).map((k) => (
              <option key={k} value={k}>
                {ALERT_KINDS[k].label}
              </option>
            ))}
          </select>
        </Field>
        {meta.thresholdLabel && (
          <Field label={meta.thresholdLabel} htmlFor="rule-threshold">
            <input id="rule-threshold" inputMode="decimal" className={inputCls} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
        )}
        <Field label="Frequency" htmlFor="rule-freq" hint="How often a persisting condition may notify again.">
          <select id="rule-freq" className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value as AlertFrequency)}>
            {(Object.keys(FREQ_LABEL) as AlertFrequency[]).map((f) => (
              <option key={f} value={f}>
                {FREQ_LABEL[f]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] text-fg-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={browser} onChange={(e) => setBrowser(e.target.checked)} className="accent-[var(--color-teal)]" /> Also show a browser notification while the app is open
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={quietOn} onChange={(e) => setQuietOn(e.target.checked)} className="accent-[var(--color-teal)]" /> Quiet hours
        </label>
        {quietOn && (
          <span className="flex items-center gap-2">
            from
            <input aria-label="Quiet hours start" className={cn(inputCls, "h-9 w-16")} value={qs} onChange={(e) => setQs(e.target.value)} />
            to
            <input aria-label="Quiet hours end" className={cn(inputCls, "h-9 w-16")} value={qe} onChange={(e) => setQe(e.target.value)} />
            <span className="text-fg-3">(local hour, 0–23)</span>
          </span>
        )}
        <Button className="ml-auto" variant="primary" size="sm" loading={saving} onClick={create}>
          <Plus className="size-4" /> Add rule
        </Button>
      </div>
      <p className="text-[12.5px] text-fg-3">{meta.describe(threshold === "" ? null : Number(threshold))}. In-app notifications are always recorded; quiet hours only silence browser pop-ups.</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13.5px]">
          <thead>
            <tr className="text-[12px] text-fg-3">
              {!owner && <th className="py-2 font-normal">Trove</th>}
              <th className="py-2 font-normal">Condition</th>
              <th className="py-2 font-normal">Frequency</th>
              <th className="py-2 font-normal">Last checked</th>
              <th className="py-2 font-normal">Last fired</th>
              <th className="py-2 font-normal">On</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-fg-3">
                  No rules yet.
                </td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.id} className="border-t border-ink-4">
                {!owner && <td className="num py-2.5">{shortAddress(r.trove_owner)}</td>}
                <td className="py-2.5">
                  {ALERT_KINDS[r.kind].describe(r.threshold)}
                  {r.quiet_start != null && <span className="ml-2 text-[12px] text-fg-3">quiet {r.quiet_start}:00–{r.quiet_end}:00</span>}
                  {r.channel === "in_app_browser" && <span className="ml-2 text-[12px] text-fg-3">+ browser</span>}
                </td>
                <td className="py-2.5 text-fg-2">{FREQ_LABEL[r.frequency]}</td>
                <td className="num py-2.5 text-fg-3">{r.last_evaluated_at ? new Date(r.last_evaluated_at).toLocaleString() : "never"}</td>
                <td className="num py-2.5 text-fg-3">{r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleString() : "—"}</td>
                <td className="py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Enabled"
                    checked={r.enabled}
                    className="accent-[var(--color-teal)]"
                    onChange={async (e) => {
                      await api(`/api/alerts/${r.id}`, { method: "PATCH", json: { enabled: e.target.checked } }).catch((er) => toast.error((er as Error).message));
                      qc.invalidateQueries({ queryKey: ["rules"] });
                    }}
                  />
                </td>
                <td className="py-2.5 text-right">
                  <button
                    className="rounded p-1 text-fg-3 hover:text-critical"
                    aria-label="Delete rule"
                    onClick={async () => {
                      await api(`/api/alerts/${r.id}`, { method: "DELETE" }).catch((er) => toast.error((er as Error).message));
                      qc.invalidateQueries({ queryKey: ["rules"] });
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
