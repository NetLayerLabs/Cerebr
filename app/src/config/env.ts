// Vite-only configuration (reads import.meta.env). Node scripts use chains.ts / cpu.ts.
import { isAddress, type Address, type Chain } from 'viem'
import { XLAYER_ID, makeXLayer } from './chains.ts'
import { cpuConfigFor, type CpuConfig } from './cpu.ts'
import { contractsConfigFor, type ContractsConfig } from './contracts.ts'

const env = import.meta.env

/** The app runs on X Layer mainnet only. VITE_RPC_196 optionally points it at a private RPC. */
export const xLayer = makeXLayer(env.VITE_RPC_196 || undefined)

const addr = (v: string | undefined): Address | undefined => (v && isAddress(v) ? v : undefined)

/** The Cerebr CPU on `chainId`: launch/out (generated), overridden at build time by VITE_CPU_196 / VITE_SCOPE_196. */
export function cpuFor(chainId: number): CpuConfig | undefined {
  if (chainId !== XLAYER_ID) return undefined
  return cpuConfigFor(chainId, { circuits: addr(env.VITE_CPU_196), scope: addr(env.VITE_SCOPE_196) })
}

/**
 * Drops, marketplace, NeuralArena and CerebrAgent on `chainId` (config/contracts.ts), overridden at build time by
 * VITE_DROPS_196 / VITE_MARKET_196 / VITE_ARENA_196 / VITE_AGENT_196. Views read it through useNet().contracts.
 */
export function contractsFor(chainId: number): ContractsConfig | undefined {
  return contractsConfigFor(chainId, { drops: addr(env.VITE_DROPS_196), market: addr(env.VITE_MARKET_196), arena: addr(env.VITE_ARENA_196), agent: addr(env.VITE_AGENT_196) })
}

export const appChains = [xLayer] as [Chain, ...Chain[]]
