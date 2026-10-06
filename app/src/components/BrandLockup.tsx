/**
 * The Cerebr lockup (chip mark + CEREBR + "CRB-1 // NEURAL PROCESSOR"), keyed to transparency.
 * Both theme variants are rendered and CSS shows the one matching [data-theme], so the swap needs
 * no React state and never flashes. `height` is the rendered height in CSS px; the PNGs are 2x / 4x.
 */
export function BrandLockup({ height = 30, className }: { height?: number; className?: string }) {
  const width = Math.round(height * 4.93)
  return (
    <span className={`brand-lockup${className ? ` ${className}` : ''}`} role="img" aria-label="Cerebr">
      <img
        className="brand-lockup-dark"
        src="/brand/cerebr-lockup-dark-64.png"
        srcSet="/brand/cerebr-lockup-dark-64.png 2x, /brand/cerebr-lockup-dark-128.png 4x"
        width={width}
        height={height}
        alt=""
        aria-hidden
      />
      <img
        className="brand-lockup-light"
        src="/brand/cerebr-lockup-light-64.png"
        srcSet="/brand/cerebr-lockup-light-64.png 2x, /brand/cerebr-lockup-light-128.png 4x"
        width={width}
        height={height}
        alt=""
        aria-hidden
      />
    </span>
  )
}
