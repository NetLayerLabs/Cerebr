// Vite-only configuration (reads import.meta.env). Node scripts use chains.ts / deployments.ts.
import { isAddress, type Address, type Chain } from 'viem'
import { ANVIL_ID, XLAYER_ID, XLAYER_TESTNET_ID, makeAnvil, makeXLayer, makeXLayerTestnet } from './chains.ts'
import { getDeployment } from './deployments.ts'
import { generatedDeployments } from '../generated/deployments.ts'

const env = import.meta.env

/** Local anvil is offered in `vite dev`, or in a build with VITE_ENABLE_ANVIL=true. */
export const anvilEnabled = env.DEV || env.VITE_ENABLE_ANVIL === 'true'

export const xLayer = makeXLayer(env.VITE_RPC_196 || undefined)
export const xLayerTestnet = makeXLayerTestnet(env.VITE_RPC_1952 || undefined)
export const anvil = makeAnvil(env.VITE_RPC_31337 || undefined)

const allChains: Chain[] = anvilEnabled ? [xLayer, xLayerTestnet, anvil] : [xLayer, xLayerTestnet]

function lensOverride(chainId: number): Address | undefined {
  const v = (env as Record<string, string | undefined>)[`VITE_LENS_${chainId}`]
  return v && isAddress(v) ? v : undefined
}

export function deploymentFor(chainId: number) {
  return getDeployment(chainId, lensOverride(chainId))
}

/** Chain shown before a wallet connects: VITE_DEFAULT_CHAIN_ID, else the first one with a deployment. */
export const defaultChainId: number = (() => {
  const fromEnv = Number(env.VITE_DEFAULT_CHAIN_ID)
  const ids = allChains.map((c) => c.id as number)
  if (ids.includes(fromEnv)) return fromEnv
  for (const id of [XLAYER_ID, XLAYER_TESTNET_ID, ANVIL_ID]) {
    if (ids.includes(id) && (generatedDeployments[id] || lensOverride(id))) return id
  }
  return XLAYER_ID
})()

/** Configured chains, default chain first (wagmi starts on, and dev connectors connect to, chains[0]). */
export const appChains = [
  ...allChains.filter((c) => c.id === defaultChainId),
  ...allChains.filter((c) => c.id !== defaultChainId),
] as [Chain, ...Chain[]]
