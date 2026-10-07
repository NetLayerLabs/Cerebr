import { useId } from 'react'

/**
 * Partner marks for "Live on X Layer · built on TapeOut" credits, drawn in currentColor so they
 * follow the theme. X Layer: OKX's official small-size icon from the X Layer media kit. TapeOut: the bow-tie mark from
 * tapeout.net's own icon (same path, without its background tile).
 */
type MarkProps = { size?: number; title?: string; className?: string }

export function XLayerMark({ size = 18, title = 'X Layer', className }: MarkProps) {
  // OKX's official "X Layer icon, when less than 40px" (XLayer-logo-kit.zip in github.com/okx/xlayer-docs,
  // media-kit/), recoloured to currentColor. The two faded stripes are the kit's masked squares as clip paths.
  const id = 'xl' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const sq = (x: number, y: number) => `M${x + 15.24} ${y}H${x + 1.09}C${x + 0.49} ${y} ${x} ${y + 0.49} ${x} ${y + 1.09}V${y + 15.24}C${x} ${y + 15.85} ${x + 0.49} ${y + 16.33} ${x + 1.09} ${y + 16.33}H${x + 15.24}C${x + 15.85} ${y + 16.33} ${x + 16.33} ${y + 15.85} ${x + 16.33} ${y + 15.24}V${y + 1.09}C${x + 16.33} ${y + 0.49} ${x + 15.85} ${y} ${x + 15.24} ${y}Z`
  return (
    <svg className={className} width={size * (64 / 50)} height={size} viewBox="0 0 64 50" role="img" aria-label={title}>
      <defs>
        <clipPath id={`${id}-t`}>
          <rect x="54.29" y="0.63" width="9.24" height="16.33" />
        </clipPath>
        <clipPath id={`${id}-b`}>
          <rect x="54.29" y="33.29" width="9.24" height="16.33" />
        </clipPath>
      </defs>
      <g fill="currentColor">
        <path d={sq(0.62, 0.63)} />
        <path d={sq(33.28, 0.63)} />
        <path d={sq(17, 17)} />
        <path d={sq(0.62, 33.29)} />
        <path d={sq(33.28, 33.29)} />
        <path d={sq(47.2, 0.63)} opacity="0.5" clipPath={`url(#${id}-t)`} />
        <path d={sq(47.2, 33.29)} opacity="0.5" clipPath={`url(#${id}-b)`} />
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
