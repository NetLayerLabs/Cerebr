// Node loader hook: resolves '@cerebr/sdk' and '@cerebr/sdk/<module>' to the SDK sources, the same
// mapping as vite.config.ts / tsconfig.json, so scripts import the app's lib/ files unchanged.
// Usage: node --import ./scripts/sdk-alias.mjs scripts/<script>.ts
import { registerHooks } from 'node:module'

const sdk = new URL('../../sdk/src/', import.meta.url)

registerHooks({
  resolve(specifier, context, next) {
    const m = /^@cerebr\/sdk(?:\/([a-z]+))?$/.exec(specifier)
    if (m) return next(new URL(m[1] ? `${m[1]}/index.ts` : 'index.ts', sdk).href, context)
    return next(specifier, context)
  },
})
