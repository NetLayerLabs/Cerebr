// Vite-only configuration (reads import.meta.env). Node scripts use chains.ts / cpu.ts.
import { isAddress, type Address, type Chain } from 'viem'
import { FORK_CHAIN_ID, XLAYER_ID, makeXLayer, makeXLayerFork } from './chains.ts'
import { cpuConfigFor, type CpuConfig } from './cpu.ts'
import { generatedCpus } from '../generated/cpus.ts'

const env = import.meta.env
const vars = env as unknown as Record<string, string | undefined>

/** The app shows X Layer mainnet only. The local fork is a developer opt-in: VITE_ENABLE_ANVIL=true. */
export const anvilEnabled = env.VITE_ENABLE_ANVIL === 'true'

export const xLayer = makeXLayer(env.VITE_RPC_196 || undefined)
export const xLayerFork = makeXLayerFork(env.VITE_RPC_31337 || undefined)

const allChains: Chain[] = anvilEnabled ? [xLayer, xLayerFork] : [xLayer]

const addr = (v: string | null | undefined): Address | undefined => (v && isAddress(v) ? v : undefined)

/** `?cpu=0x…` (a CPU's circuits address) overrides the configured CPU, for exploring any TapeOut CPU. */
const urlCpu = typeof window !== 'undefined' ? addr(new URLSearchParams(window.location.search).get('cpu')) : undefined

/**
 * The Cerebr CPU on `chainId`: launch/out (generated), overridden by VITE_CPU_<chainId> /
 * VITE_SCOPE_<chainId>, then by ?cpu=.
 */
export function cpuFor(chainId: number): CpuConfig | undefined {
  const circuits = urlCpu ?? addr(vars[`VITE_CPU_${chainId}`])
  const scope = addr(vars[`VITE_SCOPE_${chainId}`])
  return cpuConfigFor(chainId, { circuits, scope })
}

/** Chain shown before a wallet connects: VITE_DEFAULT_CHAIN_ID, else the first one with a CPU. */
export const defaultChainId: number = (() => {
  const fromEnv = Number(env.VITE_DEFAULT_CHAIN_ID)
  const ids = allChains.map((c) => c.id as number)
  if (ids.includes(fromEnv)) return fromEnv
  for (const id of [XLAYER_ID, FORK_CHAIN_ID]) {
    if (ids.includes(id) && (generatedCpus[id] || vars[`VITE_CPU_${id}`])) return id
  }
  return XLAYER_ID
})()

/** Configured chains, default chain first (wagmi starts on, and dev connectors connect to, chains[0]). */
export const appChains = [
  ...allChains.filter((c) => c.id === defaultChainId),
  ...allChains.filter((c) => c.id !== defaultChainId),
] as [Chain, ...Chain[]]
