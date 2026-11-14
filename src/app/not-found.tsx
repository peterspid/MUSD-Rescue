import Link from "next/link";
import { LogoMark } from "@/components/logo";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto w-fit"><LogoMark size={48} /></div>
        <h1 className="mt-5 font-display text-3xl font-semibold">Nothing at this address</h1>
        <p className="mt-2 text-fg-2">The page does not exist. If you were looking for a trove, open it as /positions/0x… with the owner address.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/dashboard" className="rounded-lg bg-teal px-4 py-2 font-semibold text-ink-0">Go to dashboard</Link>
          <Link href="/" className="rounded-lg border border-ink-5 px-4 py-2 text-fg">Home</Link>
        </div>
      </div>
    </main>
  );
}
