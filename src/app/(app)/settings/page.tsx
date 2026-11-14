"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useSession } from "@/components/session";
import { WalletHelpers, useNetworkSupport, ConnectButton } from "@/components/wallet";
import { Button, ExplorerLink, Field, SectionHeading, inputCls, cn } from "@/components/ui";
import { NETWORKS } from "@/config/chains";
import { MUSD_CONTRACTS, CONTRACT_SOURCES } from "@/config/contracts";
import { DEFAULT_THRESHOLD_PREFS } from "@/lib/convert";
import { shortAddress } from "@/lib/risk/format";

export default function SettingsPage() {
  const session = useSession();
  const { address } = useAccount();
  const { support } = useNetworkSupport();
  const health = useQuery({ queryKey: ["health"], queryFn: () => fetch("/api/health").then((r) => r.json() as Promise<{ db: string; rpc: string; chainId: number | null; blockNumber: string | null; latencyMs: number; time: string }>), refetchInterval: 30_000 });
  const t = session.prefs.thresholds ?? DEFAULT_THRESHOLD_PREFS;
  const [h, setH] = useState(String(t.healthyAbove));
  const [c, setC] = useState(String(t.cautionFrom));
  const [k, setK] = useState(String(t.criticalAtOrBelow));
  const [target, setTarget] = useState(String(session.prefs.defaultTargetHF ?? 1.5));
  useEffect(() => {
    setH(String(t.healthyAbove));
    setC(String(t.cautionFrom));
    setK(String(t.criticalAtOrBelow));
  }, [t.healthyAbove, t.cautionFrom, t.criticalAtOrBelow]);
  const nums = [Number(h), Number(c), Number(k)];
  const valid = nums.every(Number.isFinite) && nums[0] > nums[1] && nums[1] > nums[2] && nums[2] > 1 && nums[0] <= 20;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading as="h1" title="Settings" desc="Network, risk categories and data sources." />

      <section className="panel grid grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-2">
        <div>
          <h2 className="text-[16px] font-semibold">Network</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px]">
            <dt className="text-muted">Primary network</dt>
            <dd>Mezo Testnet (chain 31611)</dd>
            <dt className="text-muted">RPC</dt>
            <dd className="addr break-all">{NETWORKS.testnet.rpc}</dd>
            <dt className="text-muted">Explorer</dt>
            <dd><a className="text-blue underline-offset-4 hover:underline" href={NETWORKS.testnet.explorer} target="_blank" rel="noreferrer">{NETWORKS.testnet.explorer}</a></dd>
            <dt className="text-muted">Your wallet</dt>
            <dd className={cn(support.kind === "supported" ? "text-blue" : "font-semibold text-ink")}>{address ? `${shortAddress(address)} on ${support.label}` : "Not connected"}</dd>
            <dt className="text-muted">Mezo Mainnet</dt>
            <dd className="text-ink-soft">Read-only: contract addresses are listed below; MUSD Rescue never prepares mainnet transactions.</dd>
          </dl>
          <div className="mt-4">{address ? <WalletHelpers /> : <ConnectButton size="sm" />}</div>
        </div>
        <div>
          <h2 className="text-[16px] font-semibold">Session</h2>
          <p className="mt-2 text-[14px] text-ink-soft">
            {session.address ? <>Signed in as <span className="addr">{shortAddress(session.address, 6)}</span>. Alerts, watchlist and settings are saved server-side.</> : "Not signed in. Your watchlist and risk settings stay in this browser only."}
          </p>
          <div className="mt-3 flex gap-2">
            {session.address ? (
              <Button size="sm" variant="secondary" onClick={() => session.signOut()}>Sign out</Button>
            ) : (
              <Button size="sm" variant="primary" disabled={!address} loading={session.signingIn} onClick={() => session.signIn()}>Sign in with wallet</Button>
            )}
          </div>
          <h2 className="mt-6 text-[16px] font-semibold">Data sources</h2>
          <ul className="mt-2 space-y-1.5 text-[14px]">
            <li className="flex justify-between"><span className="text-ink-soft">Mezo testnet RPC</span><span className={health.data?.rpc === "ok" ? "text-blue" : "font-semibold text-ink"}>{health.data ? (health.data.rpc === "ok" ? `ok, block ${Number(health.data.blockNumber).toLocaleString("en-US")}` : "error") : "…"}</span></li>
            <li className="flex justify-between"><span className="text-ink-soft">Database (alerts, history)</span><span className={health.data?.db === "ok" ? "text-blue" : "font-semibold text-ink"}>{health.data ? health.data.db : "…"}</span></li>
            <li className="flex justify-between"><span className="text-ink-soft">Trove event logs</span><span className="text-muted">Mezo Blockscout API</span></li>
            <li className="flex justify-between"><span className="text-ink-soft">External BTC reference (charts only)</span><span className="text-muted">CoinGecko</span></li>
          </ul>
        </div>
      </section>

      <section className="panel p-5 sm:p-6">
        <h2 className="text-[16px] font-semibold">Risk categories</h2>
        <p className="mt-1 max-w-[80ch] text-[14px] text-ink-soft">
          Product defaults, not protocol rules: healthy above 2.0, caution 1.5–2.0, high risk 1.2–1.5, critical 1.2 and below. The protocol line (health factor 1.00 = 110% collateral ratio) cannot be changed.
        </p>
        <div className="mt-4 grid max-w-[720px] gap-4 sm:grid-cols-4">
          <Field label="Healthy above" htmlFor="th-h"><input id="th-h" className={inputCls} inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></Field>
          <Field label="Caution from" htmlFor="th-c"><input id="th-c" className={inputCls} inputMode="decimal" value={c} onChange={(e) => setC(e.target.value)} /></Field>
          <Field label="Critical at or below" htmlFor="th-k"><input id="th-k" className={inputCls} inputMode="decimal" value={k} onChange={(e) => setK(e.target.value)} /></Field>
          <Field label="Default target HF" htmlFor="th-t"><input id="th-t" className={inputCls} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        </div>
        {!valid && <p className="mt-2 text-[13px] font-medium text-ink">Must satisfy healthy &gt; caution &gt; critical &gt; 1.00.</p>}
        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!valid}
            onClick={async () => {
              try {
                await session.savePrefs({ thresholds: { healthyAbove: nums[0], cautionFrom: nums[1], criticalAtOrBelow: nums[2] }, defaultTargetHF: Math.min(10, Math.max(1.05, Number(target) || 1.5)) });
                toast.success("Risk categories saved");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setH("2"); setC("1.5"); setK("1.2"); setTarget("1.5"); }}>Reset to defaults</Button>
        </div>
      </section>

      <section className="panel p-5 sm:p-6">
        <h2 className="text-[16px] font-semibold">Verified contract addresses</h2>
        <p className="mt-1 text-[14px] text-muted">
          From the official <a className="text-blue underline-offset-4 hover:underline" href={CONTRACT_SOURCES.repo} target="_blank" rel="noreferrer">mezo-org/musd</a> deployment artifacts; each was checked live for deployed bytecode.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[14px]">
            <thead><tr className="text-[13px] text-muted"><th className="py-2 font-normal">Contract</th><th className="py-2 font-normal">Testnet (31611)</th><th className="py-2 font-normal">Mainnet (31612, read-only)</th></tr></thead>
            <tbody>
              {(Object.keys(MUSD_CONTRACTS.testnet) as (keyof typeof MUSD_CONTRACTS.testnet)[]).map((name) => (
                <tr key={name} className="border-t border-line">
                  <td className="py-2">{name}</td>
                  <td className="py-2"><ExplorerLink address={MUSD_CONTRACTS.testnet[name]} /></td>
                  <td className="py-2"><a className="addr text-ink-soft underline-offset-4 hover:text-ink hover:underline" href={`${NETWORKS.mainnet.explorer}/address/${MUSD_CONTRACTS.mainnet[name]}`} target="_blank" rel="noreferrer">{shortAddress(MUSD_CONTRACTS.mainnet[name], 6)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
