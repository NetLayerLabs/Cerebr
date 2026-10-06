import { useToasts } from '../hooks/useToasts.tsx'
import { useT } from '../i18n/index.tsx'

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  const t = useT()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`} onClick={() => dismiss(x.id)}>
          <div className="toast-title">
            {x.kind === 'pending' ? <span className="spinner" /> : x.kind === 'success' ? '✓' : '✕'} {x.title}
          </div>
          {x.body && <div className="small muted">{x.body}</div>}
          {x.href && (
            <a className="small" href={x.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {t('toast.explorer')}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
