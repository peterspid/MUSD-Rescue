"use client";
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useAccount, useBalance, useConnect, useDisconnect, useReadContract, useSwitchChain, useWalletClient } from "wagmi";
import { LogOut, Plug, TriangleAlert, Wallet, X, KeyRound, Coins, Network } from "lucide-react";
import { toast } from "sonner";
import { Button, CopyButton, cn } from "./ui";
import { useSession } from "./session";
import { classifyChain, mezoTestnet } from "@/config/chains";
import { MUSD_CONTRACTS, ABIS } from "@/config/contracts";
import { formatAmount, formatBtc, shortAddress } from "@/lib/risk/format";
import { classifyWalletError } from "@/lib/rescue/flow";

export function useNetworkSupport() {
  const { chainId, isConnected } = useAccount();
  return { support: classifyChain(isConnected ? chainId : null), isConnected, chainId };
}

export function ConnectModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { connectors, connectAsync, isPending } = useConnect();
  const [busy, setBusy] = useState<string | null>(null);
  const list = connectors.filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-[20px] font-semibold">Connect a wallet</Dialog.Title>
              <Dialog.Description className="mt-1 text-[14px] text-ink-soft">MUSD Rescue reads your trove and asks your wallet to sign only when you confirm a rescue. It never asks for keys or seed phrases.</Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <ul className="mt-5 flex flex-col gap-2">
            {list.length === 0 && <li className="text-[14px] text-ink-soft">No browser wallet detected. Install MetaMask, Rabby or another EVM wallet, then reload.</li>}
            {list.map((c) => (
              <li key={c.uid}>
                <button
                  disabled={isPending}
                  onClick={async () => {
                    setBusy(c.uid);
                    try {
                      await connectAsync({ connector: c, chainId: mezoTestnet.id });
                      onOpenChange(false);
                    } catch (e) {
                      const k = classifyWalletError(e);
                      if (k.kind === "rejected") toast("Connection cancelled");
                      else {
                        // Some wallets refuse chainId on connect if Mezo isn't added yet: connect first, switch afterwards.
                        try {
                          await connectAsync({ connector: c });
                          onOpenChange(false);
                        } catch (e2) {
                          toast.error("Could not connect", { description: classifyWalletError(e2).message });
                        }
                      }
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line-strong bg-paper px-4 py-3 text-left transition-colors hover:border-ink disabled:opacity-60"
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" className="size-7 rounded-md" />
                  ) : (
                    <Wallet className="size-7 rounded-md bg-surface p-1 text-ink" aria-hidden />
                  )}
                  <span className="flex-1 font-medium">{c.name === "Injected" ? "Browser wallet" : c.name}</span>
                  {busy === c.uid && <span className="text-[13px] text-muted">Check your wallet…</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-muted">
            Need testnet BTC for gas? Use the{" "}
            <a className="text-blue underline-offset-4 hover:underline" href="https://faucet.test.mezo.org/" target="_blank" rel="noreferrer">
              Mezo faucet
            </a>
            .
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConnectButton({ size = "md", label = "Connect wallet" }: { size?: "sm" | "md" | "lg"; label?: string }) {
  const { address, isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Button size={size} variant="primary" disabled>{label}</Button>;
  if (!isConnected || !address)
    return (
      <>
        <Button size={size} variant="primary" onClick={() => setOpen(true)}>
          <Plug className="size-4" aria-hidden /> {label}
        </Button>
        <ConnectModal open={open} onOpenChange={setOpen} />
      </>
    );
  return (
    <div className="relative">
      <Button size={size} variant="secondary" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
        <span className="size-2 rounded-full bg-blue" aria-hidden />
        <span className="addr">{shortAddress(address)}</span>
      </Button>
      {menu && <AccountMenu onClose={() => setMenu(false)} />}
    </div>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const session = useSession();
  const { support } = useNetworkSupport();
  const btc = useBalance({ address, chainId: mezoTestnet.id, query: { enabled: !!address } });
  const musd = useReadContract({ address: MUSD_CONTRACTS.testnet.MUSD, abi: ABIS.MUSD, functionName: "balanceOf", args: address ? [address] : undefined, chainId: mezoTestnet.id, query: { enabled: !!address } });
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div role="menu" className="panel absolute right-0 z-50 mt-2 w-[min(300px,calc(100vw-24px))] border-ink p-4">
        <div className="flex items-center justify-between">
          <span className="addr text-[14px]">{shortAddress(address, 6)}</span>
          <CopyButton value={address ?? ""} label="Copy address" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[14px]">
          <div>
            <div className="text-[13px] text-muted">BTC (gas and collateral)</div>
            <div className="num">{btc.data ? formatBtc(btc.data.value) : "—"}</div>
          </div>
          <div>
            <div className="text-[13px] text-muted">MUSD</div>
            <div className="num">{musd.data !== undefined ? formatAmount(musd.data as bigint) : "—"}</div>
          </div>
        </div>
        <div className={cn("mt-3 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-[13px]", support.kind === "supported" ? "border-blue text-blue" : "border-2 border-ink font-medium text-ink")}>{support.label}</div>
        <div className="mt-3 flex flex-col gap-1.5">
          {session.address ? (
            <div className="text-[13px] text-muted">
              {session.matchesWallet ? "Signed in — alerts and history are saved." : `Signed in as ${shortAddress(session.address)} (a different wallet).`}
            </div>
          ) : (
            <Button size="sm" variant="secondary" loading={session.signingIn} onClick={() => session.signIn()}>
              <KeyRound className="size-3.5" /> Sign in to save alerts
            </Button>
          )}
          {session.address && !session.matchesWallet && (
            <Button size="sm" variant="secondary" loading={session.signingIn} onClick={() => session.signIn()}>
              Sign in with this wallet
            </Button>
          )}
          <WalletHelpers compact />
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              disconnect();
              if (session.address) await session.signOut();
              onClose();
            }}
          >
            <LogOut className="size-3.5" /> Disconnect
          </Button>
        </div>
      </div>
    </>
  );
}

/** Add Mezo Testnet to the wallet (switchChain falls back to wallet_addEthereumChain) and add MUSD (wallet_watchAsset). */
export function WalletHelpers({ compact }: { compact?: boolean }) {
  const { switchChainAsync, isPending } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const { isConnected } = useAccount();
  if (!isConnected) return null;
  return (
    <div className={cn("flex gap-1.5", compact ? "flex-col" : "flex-wrap")}>
      <Button
        size="sm"
        variant={compact ? "ghost" : "secondary"}
        loading={isPending}
        onClick={async () => {
          try {
            await switchChainAsync({ chainId: mezoTestnet.id });
            toast.success("Wallet is on Mezo Testnet");
          } catch (e) {
            const k = classifyWalletError(e);
            toast.error(k.kind === "rejected" ? "Network switch cancelled" : "Could not switch network", { description: k.kind === "failed" ? k.message : undefined });
          }
        }}
      >
        <Network className="size-3.5" /> Add / switch to Mezo Testnet
      </Button>
      <Button
        size="sm"
        variant={compact ? "ghost" : "secondary"}
        onClick={async () => {
          try {
            await walletClient?.watchAsset({ type: "ERC20", options: { address: MUSD_CONTRACTS.testnet.MUSD, symbol: "MUSD", decimals: 18 } });
          } catch (e) {
            const k = classifyWalletError(e);
            if (k.kind === "failed") toast.error("Wallet did not add MUSD", { description: k.message });
          }
        }}
      >
        <Coins className="size-3.5" /> Add MUSD to wallet
      </Button>
    </div>
  );
}

/** Explicit unsupported-network message with a standard wallet switch flow. */
export function NetworkNotice() {
  const { support, isConnected } = useNetworkSupport();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !isConnected || support.kind === "supported") return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-ink bg-ink px-4 py-2.5 text-[14px] text-paper">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">
        {support.label}. MUSD Rescue reads positions from Mezo Testnet and only prepares rescue transactions there. Switch networks in your wallet to act.
      </span>
      <Button
        size="sm"
        variant="secondary"
        loading={isPending}
        onClick={() => switchChainAsync({ chainId: mezoTestnet.id }).catch((e) => toast.error("Switch failed", { description: classifyWalletError(e).message }))}
      >
        Switch to Mezo Testnet
      </Button>
    </div>
  );
}
