import { LogoMark } from "@/components/logo";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md">
        <LogoMark size={40} />
        <h1 className="mt-5 text-[32px] font-semibold leading-tight">Nothing at this address</h1>
        <p className="mt-2 text-ink-soft">
          This page does not exist. To look at a trove, open <span className="addr">/positions/0x…</span> with the owner&apos;s address.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/dashboard" variant="primary">
            Go to dashboard
          </ButtonLink>
          <ButtonLink href="/">Home</ButtonLink>
        </div>
      </div>
    </main>
  );
}
