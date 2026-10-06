import { useMemo } from 'react'
import { CATALOG } from '@cerebr/sdk'
import { useI18n, type Lang } from './index.tsx'

/**
 * Translations of circuit DATA: the SDK catalog's names, descriptions and stories (keyed by catalog
 * id), word-like pin names and the app's generated fallback names. English needs no table: the
 * SDK / onchain text is shown as written.
 *
 * Text is translated when it is exactly the catalog's English (so the onchain labels the launch
 * script wrote from the catalog translate too, while a custom name an owner wrote stays as written).
 */
import { CATALOG_ZH, GENERIC_ZH, PINS_ZH } from './ns/circuits.zh.ts'

const PATTERNS_ZH: [RegExp, string][] = [
  [/^Circuit #(\d+)$/, '电路 #$1'],
  [/^Neuron (.+)$/, '神经元 $1'],
]

export interface CircuitText {
  /** Translated circuit name (catalog / generated); custom names come back unchanged. */
  name: (s: string) => string
  description: (s: string) => string
  story: (s: string) => string
  pin: (s: string) => string
  pins: (s: readonly string[]) => string[]
}

const identity: CircuitText = { name: (s) => s, description: (s) => s, story: (s) => s, pin: (s) => s, pins: (s) => [...s] }

function build(lang: Lang): CircuitText {
  if (lang === 'en') return identity
  const names = new Map<string, string>()
  const texts = new Map<string, string>()
  for (const c of CATALOG) {
    const z = CATALOG_ZH[c.id]
    if (!z) continue
    names.set(c.name, z.name)
    texts.set(c.description, z.description)
    texts.set(c.story, z.story)
  }
  const generic = (s: string) => {
    if (GENERIC_ZH[s]) return GENERIC_ZH[s]
    for (const [re, to] of PATTERNS_ZH) if (re.test(s)) return s.replace(re, to)
    return s
  }
  const pin = (s: string) => PINS_ZH[s] ?? s
  return {
    name: (s) => names.get(s) ?? generic(s),
    description: (s) => texts.get(s) ?? GENERIC_ZH[s] ?? s,
    story: (s) => texts.get(s) ?? GENERIC_ZH[s] ?? s,
    pin,
    pins: (s) => s.map(pin),
  }
}

const cache = new Map<Lang, CircuitText>()
export const circuitText = (lang: Lang): CircuitText => {
  if (!cache.has(lang)) cache.set(lang, build(lang))
  return cache.get(lang)!
}

/** `const ct = useCircuitText()`: ct.name(label.name), ct.pins(label.inputs), … in the current language. */
export function useCircuitText(): CircuitText {
  const { lang } = useI18n()
  return useMemo(() => circuitText(lang), [lang])
}
