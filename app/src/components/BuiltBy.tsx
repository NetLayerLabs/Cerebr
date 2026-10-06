/**
 * "Built by NetLayer Labs" credit pill (plain text, not a link), shared by the landing and app
 * footers. The mark is a real transparent PNG (public/brand): white for the app's dark theme; the
 * ink variant (netlayer-mark-ink-*.png) is there for light backgrounds.
 */
export function BuiltBy() {
  return (
    <span className="built-by">
      <img
        className="built-by-mark"
        src="/brand/netlayer-mark-32.png"
        srcSet="/brand/netlayer-mark-32.png 2x, /brand/netlayer-mark-64.png 3x"
        width={16}
        height={16}
        alt=""
        aria-hidden
      />
      <span>
        Built by <b>NetLayer Labs</b>
      </span>
    </span>
  )
}
