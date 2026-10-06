import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, zh, type Dict } from './dict.ts'

/**
 * Lightweight i18n: two dictionaries with identical, type-checked key sets, a React context for the
 * current language and `t(key, params)` / `rich(key, params)` helpers.
 *
 * - Placeholders: `{name}` is replaced by params.name.
 * - Rich strings (rich()): `<em>…</em>`, `<code>…</code>`, `<b>…</b>` render as those elements,
 *   `<br/>` as a line break, and any other `<tag>…</tag>` calls params.tag(children).
 */
export type Lang = 'en' | 'zh'
export type Key = keyof Dict
export type Params = Record<string, string | number | bigint>
export type RichParams = Record<string, ReactNode | ((children: ReactNode) => ReactNode)>

export const LANGS: readonly { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'zh', label: '简体中文', short: '中文' },
]

const DICTS: Record<Lang, Dict> = { en, zh }
export const LANG_KEY = 'cerebr.lang'
const htmlLang = (l: Lang) => (l === 'zh' ? 'zh-CN' : 'en')
const parse = (v: string | null | undefined): Lang | undefined => (v === 'zh' || v === 'zh-CN' ? 'zh' : v === 'en' ? 'en' : undefined)

function initialLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  const fromUrl = parse(new URLSearchParams(window.location.search).get('lang'))
  if (fromUrl) {
    try {
      localStorage.setItem(LANG_KEY, fromUrl)
    } catch {
      /* ignore */
    }
    return fromUrl
  }
  try {
    return parse(localStorage.getItem(LANG_KEY)) ?? 'en'
  } catch {
    return 'en'
  }
}

/** The current language, for code outside React (error messages, toasts). Kept in sync by the provider. */
let current: Lang = initialLang()
if (typeof document !== 'undefined') document.documentElement.lang = htmlLang(current)

const fill = (s: string, params?: Params) => (params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s)

/** Translate outside React (uses the current language). */
export function translate(key: Key, params?: Params, lang: Lang = current): string {
  return fill(DICTS[lang][key] ?? en[key], params)
}

const TAGS: Record<string, (c: ReactNode) => ReactNode> = {
  em: (c) => <em>{c}</em>,
  code: (c) => <code>{c}</code>,
  b: (c) => <b>{c}</b>,
}

function renderRich(s: string, p: RichParams, base: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /<(\w+)>([\s\S]*?)<\/\1>|<br\/>|\{(\w+)\}/g
  let last = 0
  let i = 0
  for (const m of s.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push(s.slice(last, at))
    const k = `${base}${i++}`
    if (m[1]) {
      const inner = renderRich(m[2], p, `${k}.`)
      const r = p[m[1]]
      const node = typeof r === 'function' ? r(inner) : TAGS[m[1]] ? TAGS[m[1]](inner) : inner
      out.push(<Fragment key={k}>{node}</Fragment>)
    } else if (m[0] === '<br/>') {
      out.push(<br key={k} />)
    } else {
      const v = p[m[3]]
      out.push(<Fragment key={k}>{typeof v === 'function' ? m[0] : v === undefined ? m[0] : v}</Fragment>)
    }
    last = at + m[0].length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

export type T = (key: Key, params?: Params) => string
export type Rich = (key: Key, params?: RichParams) => ReactNode

interface I18n {
  lang: Lang
  setLang: (l: Lang) => void
  t: T
  rich: Rich
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current)
  useEffect(() => {
    current = lang
    document.documentElement.lang = htmlLang(lang)
    document.title = translate('meta.title', undefined, lang)
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate('meta.description', undefined, lang))
  }, [lang])
  const setLang = useCallback((l: Lang) => {
    current = l
    setLangState(l)
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* storage blocked: the choice lasts for this page only */
    }
    // Keep a shared ?lang= link in step with the choice, so a reload shows what was picked.
    const url = new URL(window.location.href)
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', l)
      window.history.replaceState(window.history.state, '', url)
    }
  }, [])
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(key, params, lang),
      rich: (key, params = {}) => renderRich(DICTS[lang][key] ?? en[key], params, ''),
    }),
    [lang, setLang],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const c = useContext(Ctx)
  if (!c) throw new Error('I18nProvider missing')
  return c
}

/** `const t = useT()`: translate in components (re-renders on language change). */
export const useT = (): T => useI18n().t
