/** Mark: a collateral sphere held above the 110% liquidation floor. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <radialGradient id="lm-s" cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#9ff0ea" />
          <stop offset="0.55" stopColor="#4fc6bf" />
          <stop offset="1" stopColor="#1f6f6b" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#15191d" stroke="#2c343c" />
      <circle cx="16" cy="12" r="6.2" fill="url(#lm-s)" />
      <path d="M16 18.6v3.2" stroke="#4fc6bf" strokeWidth="1.4" strokeDasharray="1.2 1.4" />
      <rect x="6" y="23.2" width="20" height="2.2" rx="1.1" fill="#f0544f" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-fg">
        MUSD <span className="text-fg-2">Rescue</span>
      </span>
    </span>
  );
}
