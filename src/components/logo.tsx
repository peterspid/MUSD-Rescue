/** Mark: the clearance scale. A marker (your trove) stands to the right of the liquidation tick. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#1e40ff" />
      <rect x="6" y="22" width="20" height="2.5" fill="#ffffff" />
      <rect x="9" y="16" width="2" height="6" fill="#ffffff" />
      <rect x="19" y="12" width="2.5" height="10" fill="#ffffff" />
      <circle cx="20.25" cy="11" r="4.25" fill="#ffffff" />
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
