import { useToasts } from '../hooks/useToasts.tsx'

export function Toasts() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <div className="toast-title">
            {t.kind === 'pending' ? <span className="spinner" /> : t.kind === 'success' ? '✓' : '✕'} {t.title}
          </div>
          {t.body && <div className="small muted">{t.body}</div>}
          {t.href && (
            <a className="small" href={t.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              View on explorer ↗
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
