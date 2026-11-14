"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { PositionDTO } from "@/lib/dto";
import { amountsFromDTO, paramsFromDTO, systemTotals } from "@/lib/convert";
import { assessFreshness, gateRescueActions } from "@/lib/risk/freshness";
import { classifyChain } from "@/config/chains";
import { api } from "@/lib/client/api";
import { Simulator } from "./simulator";
import { RescueDialog, useRescueFlow } from "./rescue-flow";
import { useSession } from "./session";
import { formatHF } from "@/lib/risk/format";

/** Live simulator + transaction flow for one trove. Read-only for anyone but the owner on Mezo testnet. */
export function LiveRescuePanel({ position, dataUpdatedAt, onScenarioPrice }: { position: PositionDTO; dataUpdatedAt: number; onScenarioPrice?: (p: bigint) => void }) {
  const { address, chainId, isConnected } = useAccount();
  const session = useSession();
  const [icrAtOpen] = useState<bigint | null>(() => (position.risk?.icr ? BigInt(position.risk.icr) : null));
  const flow = useRescueFlow(position.owner as `0x${string}`, icrAtOpen);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const isOwner = !!address && address.toLowerCase() === position.owner.toLowerCase();
  const gate = gateRescueActions({
    freshness: assessFreshness(dataUpdatedAt || null, now),
    priceAvailable: !!position.system.price,
    networkWritable: isConnected && classifyChain(chainId).writes,
    isOwner,
    troveActive: position.active,
  });
  const params = paramsFromDTO(position.system.params);
  if (!position.system.price) return null;
  return (
    <>
      <Simulator
        mode="live"
        position={amountsFromDTO(position)}
        basePrice={BigInt(position.system.price)}
        params={params}
        system={systemTotals(position.system)}
        wallet={isOwner ? { musd: BigInt(position.wallet.musd), btc: BigInt(position.wallet.btc) } : undefined}
        interestRateBps={position.interestRateBps}
        thresholds={session.thresholds}
        active={position.active}
        defaultTargetHF={session.prefs.defaultTargetHF}
        gate={gate}
        preparing={flow.state.s === "preparing"}
        onPrepare={(i) => flow.prepare(i)}
        onScenarioPrice={onScenarioPrice}
        onSimulated={(s) => {
          if (!session.address || !isOwner) return;
          api("/api/activity", {
            method: "POST",
            json: { kind: "simulation_completed", owner: position.owner, title: `Simulated rescue: HF after ${s.hfAfter ? formatHF(BigInt(s.hfAfter)) : "—"}`, details: s },
          }).catch(() => {});
        }}
      />
      <RescueDialog flow={flow} onClose={flow.reset} />
    </>
  );
}
