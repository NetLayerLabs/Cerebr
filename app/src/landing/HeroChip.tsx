/** Animated hero illustration: a neural processor die with signal pulses running along its traces. */
export function HeroChip() {
  const pins = Array.from({ length: 9 }, (_, i) => 92 + i * 27)
  const traces = [
    'M60 120 H120 V170 H150',
    'M60 200 H110 V230 H150',
    'M60 290 H130 V250 H150',
    'M420 130 H380 V180 H350',
    'M420 210 H390 V240 H350',
    'M420 300 H370 V260 H350',
    'M190 40 V90 H210 V150',
    'M290 40 V100 H270 V150',
    'M210 440 V400 H230 V350',
    'M300 440 V390 H280 V350',
  ]
  const nodes: [number, number][] = [
    [205, 205], [250, 190], [295, 210], [215, 255], [260, 250], [300, 265], [235, 300], [280, 300],
  ]
  const edges: [number, number][] = [
    [0, 1], [1, 2], [0, 3], [1, 4], [2, 5], [3, 4], [4, 5], [3, 6], [4, 6], [4, 7], [5, 7], [0, 4], [2, 4],
  ]
  return (
    <svg viewBox="0 0 480 480" className="lp-chip" role="img" aria-label="Cerebr neural processor">
      <defs>
        <linearGradient id="hcG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ddc97" />
          <stop offset="0.6" stopColor="#2bb3ff" />
          <stop offset="1" stopColor="#b26bff" />
        </linearGradient>
        <radialGradient id="hcGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#2bb3ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#2bb3ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="250" cy="245" r="200" fill="url(#hcGlow)" className="lp-breathe" />
      {/* pins */}
      <g stroke="#26324a" strokeWidth="6" strokeLinecap="round">
        {pins.map((p) => (
          <g key={p}>
            <line x1={p + 12} y1="118" x2={p + 12} y2="140" />
            <line x1={p + 12} y1="350" x2={p + 12} y2="372" />
            <line x1="118" y1={p + 12} x2="140" y2={p + 12} />
            <line x1="350" y1={p + 12} x2="372" y2={p + 12} />
          </g>
        ))}
      </g>
      {/* traces + pulses */}
      <g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {traces.map((d, i) => (
          <g key={d}>
            <path d={d} stroke="#1c2536" />
            <path d={d} stroke="url(#hcG)" className="lp-trace" style={{ animationDelay: `${(i * 0.37) % 3}s` }} pathLength={100} />
          </g>
        ))}
      </g>
      {/* die */}
      <rect x="140" y="140" width="210" height="210" rx="22" fill="#0d1320" stroke="url(#hcG)" strokeWidth="2.5" />
      <rect x="156" y="156" width="178" height="178" rx="14" fill="none" stroke="#1c2536" />
      {/* neural mesh */}
      <g stroke="url(#hcG)" strokeWidth="1.3" opacity="0.75">
        {edges.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} />
        ))}
      </g>
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5.5" fill="#e6edf3" className="lp-node" style={{ animationDelay: `${i * 0.25}s` }} />
      ))}
      <text x="245" y="178" textAnchor="middle" className="lp-chip-label">
        CEREBR · NEURAL CPU
      </text>
      <text x="245" y="328" textAnchor="middle" className="lp-chip-sub">
        X LAYER · 196
      </text>
    </svg>
  )
}
