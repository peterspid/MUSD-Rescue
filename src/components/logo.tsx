/** Mark: collateral (circle) held above the liquidation line (bar), on a blue tile. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#1e40ff" />
      <circle cx="16" cy="12.5" r="5.5" fill="#ffffff" />
      <rect x="7" y="21.5" width="18" height="3" fill="#ffffff" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.015em] text-ink">MUSD Rescue</span>
    </span>
  );
}
