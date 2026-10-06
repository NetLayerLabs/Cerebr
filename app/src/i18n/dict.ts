/**
 * All UI strings, merged from per-feature namespaces in ./ns.
 *
 * Adding a feature (e.g. a new view):
 *   1. ns/<feature>.en.ts  ->  export const en = { '<feature>.title': '…', … }   (prefix every key)
 *   2. ns/<feature>.zh.ts  ->  import type { en } from './<feature>.en.ts'
 *                              export const zh: Record<keyof typeof en, string> = { … }
 *      (a missing or extra zh key is a type error inside that file)
 *   3. Import both here and spread them into `en` / `zh` below.
 * `npm run i18n:check` also fails on keys that two namespaces both define.
 */
import { en as coreEn } from './ns/core.en.ts'
import { zh as coreZh } from './ns/core.zh.ts'

export const NAMESPACES = { core: { en: coreEn, zh: coreZh } }

export const en = { ...coreEn }
export type Dict = Record<keyof typeof en, string>
export const zh: Dict = { ...coreZh }
