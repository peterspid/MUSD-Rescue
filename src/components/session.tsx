"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { mezoTestnet } from "@/config/chains";
import { DEFAULT_THRESHOLD_PREFS, thresholdsFromPrefs, type ThresholdPrefs } from "@/lib/convert";
import type { RiskThresholds } from "@/lib/risk/health";
import { classifyWalletError } from "@/lib/rescue/flow";

interface Prefs {
  thresholds?: ThresholdPrefs;
  defaultTargetHF?: number;
  browserNotifications?: boolean;
}

interface SessionCtx {
  address: `0x${string}` | null;
  loading: boolean;
  signingIn: boolean;
  /** Session belongs to the connected wallet. */
  matchesWallet: boolean;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  prefs: Prefs;
  thresholds: RiskThresholds;
  savePrefs: (p: Prefs) => Promise<void>;
  watchlist: string[];
  addWatch: (owner: string) => Promise<void>;
  removeWatch: (owner: string) => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);
const LOCAL_WATCH = "musd-rescue:watchlist";
const LOCAL_PREFS = "musd-rescue:prefs";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address: wallet } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [watchlist, setWatchlist] = useState<string[]>([]);

  const loadUserData = useCallback(async (signedIn: boolean) => {
    if (signedIn) {
      const [p, w] = await Promise.all([
        api<{ prefs: Prefs }>("/api/settings").catch(() => ({ prefs: {} as Prefs })),
        api<{ items: { trove_owner: string }[] }>("/api/watchlist").catch(() => ({ items: [] })),
      ]);
      setPrefs(p.prefs ?? {});
      setWatchlist(w.items.map((i) => i.trove_owner));
    } else {
      setPrefs(readLocal<Prefs>(LOCAL_PREFS, {}));
      setWatchlist(readLocal<string[]>(LOCAL_WATCH, []));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api<{ address: `0x${string}` | null }>("/api/auth/session")
      .then(async (s) => {
        if (!alive) return;
        setAddress(s.address);
        await loadUserData(!!s.address);
      })
      .catch(() => loadUserData(false))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loadUserData]);

  const signIn = useCallback(async () => {
    if (!wallet) {
      toast.error("Connect a wallet first.");
      return false;
    }
    setSigningIn(true);
    try {
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
      const message = createSiweMessage({
        domain: window.location.host,
        address: wallet,
        statement: "Sign in to MUSD Rescue to save alerts, watchlists and verified rescue history. This does not send a transaction or cost gas.",
        uri: window.location.origin,
        version: "1",
        chainId: mezoTestnet.id,
        nonce,
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessageAsync({ message });
      const res = await api<{ address: `0x${string}` }>("/api/auth/verify", { method: "POST", json: { message, signature } });
      setAddress(res.address);
      await loadUserData(true);
      qc.invalidateQueries();
      toast.success("Signed in", { description: "Alerts and verified history are now saved to your wallet address." });
      return true;
    } catch (e) {
      const c = classifyWalletError(e);
      toast.error(c.kind === "rejected" ? "Sign-in cancelled" : "Sign-in failed", { description: c.kind === "rejected" ? "You declined the signature request." : (e as Error).message });
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [wallet, signMessageAsync, loadUserData, qc]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAddress(null);
    await loadUserData(false);
    qc.invalidateQueries();
  }, [loadUserData, qc]);

  const savePrefs = useCallback(
    async (p: Prefs) => {
      const merged = { ...prefs, ...p };
      setPrefs(merged);
      if (address) await api("/api/settings", { method: "PUT", json: p });
      else writeLocal(LOCAL_PREFS, merged);
    },
    [prefs, address],
  );

  const addWatch = useCallback(
    async (owner: string) => {
      if (watchlist.some((w) => w.toLowerCase() === owner.toLowerCase())) return;
      const next = [...watchlist, owner];
      setWatchlist(next);
      if (address) await api("/api/watchlist", { method: "POST", json: { troveOwner: owner } });
      else writeLocal(LOCAL_WATCH, next);
    },
    [watchlist, address],
  );

  const removeWatch = useCallback(
    async (owner: string) => {
      const next = watchlist.filter((w) => w.toLowerCase() !== owner.toLowerCase());
      setWatchlist(next);
      if (address) await api(`/api/watchlist?owner=${owner}`, { method: "DELETE" });
      else writeLocal(LOCAL_WATCH, next);
    },
    [watchlist, address],
  );

  const value = useMemo<SessionCtx>(
    () => ({
      address,
      loading,
      signingIn,
      matchesWallet: !!address && !!wallet && address.toLowerCase() === wallet.toLowerCase(),
      signIn,
      signOut,
      prefs,
      thresholds: thresholdsFromPrefs(prefs.thresholds ?? DEFAULT_THRESHOLD_PREFS),
      savePrefs,
      watchlist,
      addWatch,
      removeWatch,
    }),
    [address, loading, signingIn, wallet, signIn, signOut, prefs, savePrefs, watchlist, addWatch, removeWatch],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
