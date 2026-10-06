import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LANGS, useI18n } from '../i18n/index.tsx'
import { setTheme, useTheme } from '../theme.ts'

const Icon = {
  moon: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
    </svg>
  ),
  sun: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.3v1.6M8 13.1v1.6M1.3 8h1.6M13.1 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1" />
    </svg>
  ),
  globe: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="6.3" />
      <path d="M1.7 8h12.6M8 1.7c1.8 1.8 2.6 3.9 2.6 6.3S9.8 12.5 8 14.3M8 1.7C6.2 3.5 5.4 5.6 5.4 8s.8 4.5 2.6 6.3" />
    </svg>
  ),
  chevron: (
    <svg className="pref-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.2 3.8 5 6.6l2.8-2.8" />
    </svg>
  ),
}

/** Dark / light segmented control. */
export function ThemeToggle() {
  const theme = useTheme()
  const { t } = useI18n()
  return (
    <div className="pref-seg" role="group" aria-label={t('pref.theme')}>
      <button type="button" aria-pressed={theme === 'dark'} aria-label={t('pref.dark')} title={t('pref.dark')} onClick={() => setTheme('dark')}>
        {Icon.moon}
      </button>
      <button type="button" aria-pressed={theme === 'light'} aria-label={t('pref.light')} title={t('pref.light')} onClick={() => setTheme('light')}>
        {Icon.sun}
      </button>
    </div>
  )
}

/** Globe button with the current language; opens a small menu (English / 简体中文). */
export function LanguageMenu() {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const cur = LANGS.find((l) => l.id === lang) ?? LANGS[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    document.addEventListener('keydown', onKey)
    // Focus the selected item so arrow keys / Enter work straight away.
    items.current[LANGS.findIndex((l) => l.id === lang)]?.focus()
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, lang])

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.current.findIndex((el) => el === document.activeElement)
    const n = LANGS.length
    const go = (k: number) => {
      e.preventDefault()
      items.current[(k + n) % n]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(n - 1)
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className="pref-lang-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="pref-lang"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('pref.language')}: ${cur.label}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {Icon.globe}
        <span className="pref-lang-long">{cur.label}</span>
        <span className="pref-lang-short">{cur.short}</span>
        {Icon.chevron}
      </button>
      {open && (
        <div className="pref-menu" role="menu" aria-label={t('pref.language')} onKeyDown={onMenuKey}>
          {LANGS.map((l, i) => (
            <button
              key={l.id}
              ref={(el) => {
                items.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={l.id === lang}
              lang={l.id === 'zh' ? 'zh-CN' : 'en'}
              className="pref-item"
              onClick={() => {
                setLang(l.id)
                setOpen(false)
                btn.current?.focus()
              }}
            >
              <span>{l.label}</span>
              {l.id === lang && <span className="pref-dot" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Both controls, as they sit in the landing nav and the app header. */
export function Preferences({ className = '' }: { className?: string }) {
  return (
    <div className={`prefs ${className}`}>
      <ThemeToggle />
      <LanguageMenu />
    </div>
  )
}
