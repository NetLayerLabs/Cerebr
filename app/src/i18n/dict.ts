/**
 * All UI strings, merged from per-feature namespaces in ./ns.
 *
 * Ownership: each namespace belongs to one feature, and a feature engineer edits ONLY their own
 * ns/<feature>.en.ts + ns/<feature>.zh.ts pair (this file never needs touching again for them):
 *
 *   core     ns/core.*      shared chrome, Processor, Studio, Inference, Gallery, landing, nav.*, sf.* (footer)
 *   train    ns/train.*     views/TrainView.tsx              keys 'train.*'
 *   arena    ns/arena.*     views/ArenaView.tsx              keys 'arena.*'
 *   drop     ns/drop.*      components/GenesisDropCard.tsx   keys 'drop.*'
 *   market   ns/market.*    components/MarketPanel.tsx + the MARKET block in GalleryView   keys 'market.*'
 *   anim     ns/anim.*      components/GateAnimation.tsx + the ANIMATION block in PlaygroundView   keys 'anim.*'
 *   agent    ns/agent.*     views/AgentView.tsx              keys 'agent.*'
 *
 * Adding keys to an existing namespace: add them to ns/<feature>.en.ts, then the same keys to
 * ns/<feature>.zh.ts (a missing or extra zh key is a type error inside that file). Nothing else.
 *
 * Adding a new namespace:
 *   1. ns/<feature>.en.ts  ->  export const en = { '<feature>.title': '…', … }   (prefix every key)
 *   2. ns/<feature>.zh.ts  ->  import type { en } from './<feature>.en.ts'
 *                              export const zh: Record<keyof typeof en, string> = { … }
 *   3. Import both here, add them to NAMESPACES and spread them into `en` / `zh` below.
 * `npm run i18n:check` also fails on keys that two namespaces both define, on zh strings whose
 * {placeholders} / <tags> differ from the en source, and on English UI text that bypasses t().
 */
import { en as coreEn } from './ns/core.en.ts'
import { zh as coreZh } from './ns/core.zh.ts'
import { en as trainEn } from './ns/train.en.ts'
import { zh as trainZh } from './ns/train.zh.ts'
import { en as arenaEn } from './ns/arena.en.ts'
import { zh as arenaZh } from './ns/arena.zh.ts'
import { en as dropEn } from './ns/drop.en.ts'
import { zh as dropZh } from './ns/drop.zh.ts'
import { en as marketEn } from './ns/market.en.ts'
import { zh as marketZh } from './ns/market.zh.ts'
import { en as animEn } from './ns/anim.en.ts'
import { zh as animZh } from './ns/anim.zh.ts'
import { en as agentEn } from './ns/agent.en.ts'
import { zh as agentZh } from './ns/agent.zh.ts'

export const NAMESPACES = {
  core: { en: coreEn, zh: coreZh },
  train: { en: trainEn, zh: trainZh },
  arena: { en: arenaEn, zh: arenaZh },
  drop: { en: dropEn, zh: dropZh },
  market: { en: marketEn, zh: marketZh },
  anim: { en: animEn, zh: animZh },
  agent: { en: agentEn, zh: agentZh },
}

export const en = { ...coreEn, ...trainEn, ...arenaEn, ...dropEn, ...marketEn, ...animEn, ...agentEn }
export type Dict = Record<keyof typeof en, string>
export const zh: Dict = { ...coreZh, ...trainZh, ...arenaZh, ...dropZh, ...marketZh, ...animZh, ...agentZh }
