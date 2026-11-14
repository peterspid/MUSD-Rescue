"use client";
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/** The app's dialog frame. While `locked` (a wallet prompt or transaction is in flight) it cannot be dismissed. */
export function Modal({ open, onOpenChange, title, description, locked, children, width = 560 }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; locked?: boolean; children: ReactNode; width?: number }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o && locked ? undefined : onOpenChange(o))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <Dialog.Content
          className="panel fixed left-1/2 top-1/2 z-50 max-h-[92dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 sm:p-6"
          style={{ width: `min(${width}px, calc(100vw - 24px))` }}
          onEscapeKeyDown={(e) => locked && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-[20px] font-semibold">{title}</Dialog.Title>
            {!locked && (
              <Dialog.Close className="rounded p-1 text-muted hover:text-ink" aria-label="Close">
                <X className="size-5" />
              </Dialog.Close>
            )}
          </div>
          {description ? <Dialog.Description className="mt-1 text-[14px] text-ink-soft">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Dialog</Dialog.Description>}
          <div className="mt-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
