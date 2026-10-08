import { useI18n } from '../i18n/index.tsx'
import { useTheme } from '../theme.ts'

/**
 * "Built by NetLayer Labs" credit pill, linking to netlayerlabs.com, shared by the landing and app
 * footers. The mark is a real transparent PNG (public/brand): white on the dark theme, the ink
 * variant (netlayer-mark-ink-*.png) on the light theme.
 */
export function BuiltBy() {
  const { rich } = useI18n()
  const ink = useTheme() === 'light' ? '-ink' : ''
  return (
    <a className="built-by" href="https://www.netlayerlabs.com/" target="_blank" rel="noopener noreferrer">
      <img
        className="built-by-mark"
        src={`/brand/netlayer-mark${ink}-32.png`}
        srcSet={`/brand/netlayer-mark${ink}-32.png 2x, /brand/netlayer-mark${ink}-64.png 3x`}
        width={16}
        height={16}
        alt=""
        aria-hidden
      />
      <span>{rich('common.builtBy')}</span>
    </a>
  )
}
