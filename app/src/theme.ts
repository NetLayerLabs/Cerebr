import { useSyncExternalStore } from 'react'

/**
 * Colour theme (dark default, light "printed datasheet"). The choice lives on <html data-theme>,
 * set before first paint by the inline script in index.html and persisted in localStorage.
 */
export type Theme = 'dark' | 'light'

export const THEME_KEY = 'cerebr.theme'
const META: Record<Theme, string> = { dark: '#070a10', light: '#f5f4ef' }

const root = () => document.documentElement
export const getTheme = (): Theme => (root().dataset.theme === 'light' ? 'light' : 'dark')

const subs = new Set<() => void>()

function apply(t: Theme) {
  root().dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[t])
}

export function setTheme(t: Theme) {
  apply(t)
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  subs.forEach((f) => f())
}

// In case the inline bootstrap script did not run (it normally has).
if (typeof document !== 'undefined' && !root().dataset.theme) {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(THEME_KEY)
  } catch {
    /* ignore */
  }
  apply(saved === 'light' ? 'light' : 'dark')
}

const subscribe = (f: () => void) => {
  subs.add(f)
  return () => subs.delete(f)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => 'dark')
}
