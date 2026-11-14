import { Suspense } from "react";
import type { Metadata } from "next";
import { RESCUE_GUARD } from "@/config/guard";
import { ExplorerLink, SectionHeading, Skeleton } from "@/components/ui";
import { GuardRegistry } from "@/components/guard/registry";
import { GuardOwnerSection } from "./owner-section";

export const metadata: Metadata = {
  title: "Rescue Guard",
  description: "Store a rescue on-chain that runs by itself when your MUSD trove's collateral ratio falls below your trigger.",
};

export default function GuardPage() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        as="h1"
        title="Rescue Guard"
        desc="Store a rescue on-chain and it runs by itself when your collateral ratio falls below your trigger, even while you are offline. You keep control: withdraw or cancel at any time."
      />

      <Suspense fallback={<Skeleton className="h-64" />}>
        <GuardOwnerSection />
      </Suspense>

      <section className="grid gap-5 md:grid-cols-3" aria-labelledby="how-guard">
        <h2 id="how-guard" className="sr-only">
          How Rescue Guard works
        </h2>
        {[
          ["You sign once", "A RepayMUSD or AddColl authorization for MUSD's own BorrowerOperationsSignatures contract, plus an MUSD permit for the reserve. One transaction stores both."],
          ["The chain checks the trigger", "Anyone can call execute(). RescueGuard reads your collateral ratio at the MUSD oracle price and only proceeds while it is below your trigger."],
          ["The rescue lands, or nothing moves", "The repayment or top-up goes straight into your trove. If it would not lift the ratio above 110%, the whole call reverts and your reserve stays put."],
        ].map(([t, d], i) => (
          <div key={t} className="flex gap-3">
            <span className="num grid size-7 shrink-0 place-items-center rounded-full border border-ink text-[13px] font-semibold">{i + 1}</span>
            <div>
              <h3 className="font-semibold">{t}</h3>
              <p className="mt-1 text-[14px] text-ink-soft">{d}</p>
            </div>
          </div>
        ))}
      </section>
      <p className="-mt-4 text-[13px] text-muted">
        Contract: <ExplorerLink address={RESCUE_GUARD.address} /> (verified source). No owner, no admin, no upgrades, no fees. Audit notes are in the repository&apos;s SECURITY.md. Run your own keeper with <code className="addr">npm run keeper</code>.
      </p>

      <GuardRegistry />
    </div>
  );
}
