/**
 * Partner marks for "Live on X Layer · built on TapeOut" credits, drawn in currentColor so they
 * follow the theme. X Layer: the OKX "X" of five squares with its two fading stripes (redrawn as a
 * vector from the chain icon published in the DefiLlama icon set). TapeOut: the bow-tie mark from
 * tapeout.net's own icon (same path, without its background tile).
 */
type MarkProps = { size?: number; title?: string; className?: string }

export function XLayerMark({ size = 18, title = 'X Layer', className }: MarkProps) {
  const c = 100 / 3 // one cell of the 3x3 grid
  return (
    <svg className={className} width={size * (128 / 99)} height={size} viewBox="0 0 128 99" role="img" aria-label={title}>
      <g fill="currentColor">
        <rect x="0" y="0" width={c} height={c} />
        <rect x={2 * c} y="0" width={c} height={c} />
        <rect x={c} y={c} width={c} height={c} />
        <rect x="0" y={2 * c} width={c} height={c} />
        <rect x={2 * c} y={2 * c} width={c} height={c} />
        <rect x="106" y="0" width="12" height={c} opacity="0.5" />
        <rect x="123" y="0" width="5" height={c} opacity="0.29" />
        <rect x="106" y={2 * c} width="12" height={c} opacity="0.5" />
        <rect x="123" y={2 * c} width="5" height={c} opacity="0.29" />
      </g>
    </svg>
  )
}

export function TapeOutMark({ size = 18, title = 'TapeOut', className }: MarkProps) {
  return (
    <svg className={className} width={size * (1020 / 856)} height={size} viewBox="0 0 1020 856" role="img" aria-label={title}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M0 0L472 256L472 599L0 856ZM41 72L41 786L431 575L431 283ZM1020 0L548 256L548 599L1020 856ZM979 72L979 786L589 575L589 283Z"
      />
    </svg>
  )
}
