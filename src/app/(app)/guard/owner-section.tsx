"use client";
import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { getAddress, isAddress } from "viem";
import { ShieldCheck } from "lucide-react";
import { GuardPanel } from "@/components/guard/panel";
import { ConnectButton } from "@/components/wallet";
import { WatchInput } from "@/components/watch-input";
import { EmptyState } from "@/components/ui";

/** Your guard when connected, or any trove's guard via ?owner=0x… (read-only unless it is your wallet). */
export function GuardOwnerSection() {
  const params = useSearchParams();
  const { address } = useAccount();
  const raw = params.get("owner");
  const viewed = raw && isAddress(raw, { strict: false }) ? getAddress(raw) : null;
  const owner = viewed ?? address ?? null;

  if (!owner) {
    return (
      <EmptyState icon={<ShieldCheck className="size-7" />} title="Connect the wallet that owns your trove" action={<ConnectButton />}>
        <p>Rescue Guard is set up from the wallet that owns the trove. You can also look up any trove&apos;s guard read-only.</p>
        <WatchInput className="mt-4 max-w-[560px]" />
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {viewed && address && viewed.toLowerCase() !== address.toLowerCase() && <p className="text-[13px] text-muted">Viewing another trove read-only. You can still run its rescue when it is ready.</p>}
      <GuardPanel owner={owner} />
    </div>
  );
}
