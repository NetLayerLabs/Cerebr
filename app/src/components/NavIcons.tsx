import type { ReactNode } from 'react'
import type { View } from '../hooks/useRoute.ts'

/**
 * Tab marks for the app nav: one 16px line glyph per view, drawn on a 16-unit grid in the
 * chip / gate vocabulary (square caps, 1.4 stroke, currentColor). Fills use currentColor at low
 * opacity so they follow the theme and the active-tab colour.
 */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'square', strokeLinejoin: 'miter' } as const

const GLYPHS: Record<View, ReactNode> = {
  // Processor: a die with pins on all four sides
  processor: (
    <>
      <rect x="4" y="4" width="8" height="8" {...P} />
      <rect x="6.5" y="6.5" width="3" height="3" fill="currentColor" />
      <path d="M6 1.5V4M10 1.5V4M6 12v2.5M10 12v2.5M1.5 6H4M1.5 10H4M12 6h2.5M12 10h2.5" {...P} />
    </>
  ),
  // Circuit Studio: a NAND gate (AND body + output bubble)
  studio: (
    <>
      <path d="M1.5 5.5H4M1.5 10.5H4M4 2.5h4a5.5 5.5 0 0 1 0 11H4z" {...P} />
      <circle cx="14" cy="8" r="1.3" {...P} />
    </>
  ),
  // Train: a 3x3 pixel grid with the strokes being learned
  train: (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" {...P} />
      <path d="M1.5 5.83h13M1.5 10.17h13M5.83 1.5v13M10.17 1.5v13" {...P} strokeWidth={0.8} opacity={0.55} />
      <path d="M2.6 6.9h2.5v2.2H2.6zM6.9 6.9h2.2v2.2H6.9zM10.9 6.9h2.5v2.2h-2.5z" fill="currentColor" />
    </>
  ),
  // Inference: a signal entering low and leaving as a clean pulse
  playground: (
    <>
      <path d="M1 11h3.5V4.5H9V11h2.5" {...P} />
      <path d="M11.5 8H15M13 5.8 15 8l-2 2.2" {...P} />
    </>
  ),
  // Arena: a tic-tac-toe board with the network's ring in the centre
  arena: (
    <>
      <path d="M5.83 1.5v13M10.17 1.5v13M1.5 5.83h13M1.5 10.17h13" {...P} />
      <circle cx="8" cy="8" r="1.25" {...P} strokeWidth={1.2} />
    </>
  ),
  // Gallery: two taped-out dies, stacked
  gallery: (
    <>
      <path d="M4.5 1.5h10v10" {...P} opacity={0.55} />
      <rect x="1.5" y="4.5" width="10" height="10" {...P} />
      <rect x="4.5" y="7.5" width="4" height="4" fill="currentColor" opacity={0.85} />
    </>
  ),
  // Agent: a neuron (soma + dendrites + axon) firing
  agent: (
    <>
      <circle cx="7" cy="8" r="2.6" {...P} />
      <path d="M5.2 6.1 2.2 3.1M5.2 9.9l-3 3M4.4 8H1.2M9.6 8h3.2" {...P} />
      <circle cx="14" cy="8" r="1.1" fill="currentColor" />
    </>
  ),
}

export function NavIcon({ view, size = 16 }: { view: View; size?: number }) {
  return (
    <svg className="nav-ico" width={size} height={size} viewBox="0 0 16 16" aria-hidden focusable="false">
      {GLYPHS[view]}
    </svg>
  )
}
