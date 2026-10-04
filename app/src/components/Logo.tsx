export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ddc97" />
          <stop offset="1" stopColor="#2bb3ff" />
        </linearGradient>
      </defs>
      <g stroke="url(#lg)" strokeWidth="2" strokeLinecap="round">
        <path d="M4 12h5M4 20h5M4 28h5M31 12h5M31 20h5M31 28h5M12 4v5M20 4v5M28 4v5M12 31v5M20 31v5M28 31v5" />
      </g>
      <rect x="9" y="9" width="22" height="22" rx="4" fill="#101826" stroke="url(#lg)" strokeWidth="2" />
      <circle cx="20" cy="20" r="5" fill="url(#lg)" />
      <path d="M20 15v-3M20 25v3M15 20h-3M25 20h3" stroke="#e6edf3" strokeWidth="1.4" />
    </svg>
  )
}
