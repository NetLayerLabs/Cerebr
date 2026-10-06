// Genesis Drop helpers (components/GenesisDropCard.tsx, the landing call-to-action and the
// Studio's neuron preset). Every number shown comes from a live chain read; nothing is cached here.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { Abi, Address, PublicClient } from 'viem'
import { compileNeuron, type NeuronSpec } from '@cerebr/sdk'
import { dropsAbi, hasClaimed, readDrop, type Drop } from '@cerebr/sdk/tapeout'
import type { TxParams } from './cerebr.ts'
import type { Key } from '../i18n/index.tsx'
import { XLAYER_ID } from '../config/chains.ts'
import { contractsFor } from '../config/env.ts'

/**
 * The first neurons we suggest after a claim: 4-input threshold neurons that compile to exactly
 * 16 NAND in the Studio's default 'direct' output mode, i.e. one claim. y = [x0 + x1 + x2 - x3 >= 2]
 * is left out on purpose: it is circuit #15 (the creator's Studio test). Each claimer gets the first
 * design, starting from an offset derived from their address, that is not taped out yet
 * (pickGenesisNeuron), so claimers do not all tape out byte-identical copies.
 */
export const GENESIS_NEURONS: readonly NeuronSpec[] = [
  { weights: [1, 1, -1, -1], theta: 1 },
  { weights: [1, -1, 1, -1], theta: 1 },
  { weights: [-1, 1, 1, -1], theta: 1 },
  { weights: [1, 1, 1, -1], theta: 1 },
  { weights: [1, 1, -1, -1], theta: 0 },
  { weights: [1, -1, 1, -1], theta: 0 },
  { weights: [-1, 1, 1, -1], theta: 0 },
  { weights: [1, -1, -1, -1], theta: 0 },
  { weights: [-1, 1, -1, -1], theta: 0 },
  { weights: [-1, -1, 1, -1], theta: 0 },
]

/**
 * The suggested first neuron for `who`: the first of GENESIS_NEURONS, starting at an offset from the
 * address, for which `onchain(spec)` is false; the offset's design when every one is taped out.
 */
export function pickGenesisNeuron(who: string | undefined, onchain: (spec: NeuronSpec) => boolean): NeuronSpec {
  const n = GENESIS_NEURONS.length
  const start = who ? parseInt(who.slice(-6), 16) % n : 0
  for (let i = 0; i < n; i++) {
    const spec = GENESIS_NEURONS[(start + i) % n]
    if (!onchain(spec)) return spec
  }
  return GENESIS_NEURONS[start]
}

/** The neuron as a formula, e.g. y = [x0 + x1 - x2 - x3 ≥ 1] (zero weights are skipped). */
export function neuronFormula(spec: NeuronSpec): string {
  let sum = ''
  spec.weights.forEach((w, i) => {
    if (w === 0) return
    const x = `x${i}`
    sum += sum === '' ? (w < 0 ? `-${x}` : x) : w < 0 ? ` - ${x}` : ` + ${x}`
  })
  return `y = [${sum || '0'} ≥ ${spec.theta}]`
}

/** NAND count of a neuron in the Studio's default ('direct') output mode. */
export const neuronNand = (spec: NeuronSpec) => compileNeuron(spec, { mode: 'direct' }).counts.nand

/**
 * Studio hash arg for a neuron: `neuron:<w0,w1,...>:<theta>` (route `#studio/neuron:1,1,1,-1:2`).
 * StudioView reads it with parseNeuronArg and opens the neuron tab with that spec.
 */
export const neuronArg = (spec: NeuronSpec) => `neuron:${spec.weights.join(',')}:${spec.theta}`

/** Parses `neuron:<w,..>:<theta>` (2 to 6 weights of -1 / 0 / +1, theta in the slider's range); undefined if invalid. */
export function parseNeuronArg(arg: string | undefined): NeuronSpec | undefined {
  const m = arg ? /^neuron:(-?[01](?:,-?[01]){1,5}):(-?\d{1,2})$/.exec(decodeURIComponent(arg)) : null
  if (!m) return undefined
  const weights = m[1].split(',').map(Number)
  const theta = Number(m[2])
  const lo = weights.reduce((a, w) => a + Math.min(0, w), 0)
  const hi = weights.reduce((a, w) => a + Math.max(0, w), 0) + 1
  if (weights.some((w) => w !== -1 && w !== 0 && w !== 1) || theta < lo || theta > hi) return undefined
  return { weights: weights.map((w) => (Object.is(w, -0) ? 0 : w)), theta }
}

/** drops.claim(dropId) as a useTx() call. */
export function claimTx(drops: Address, dropId: bigint): TxParams {
  return { address: drops, abi: dropsAbi as Abi, functionName: 'claim', args: [dropId] }
}

/** The Drops contract's require() strings (fork-verified, see sdk drops.ts) mapped to drop.err.* keys. */
const REASONS: [string, Key][] = [
  ['already claimed', 'drop.err.claimed'],
  ['drained', 'drop.err.drained'],
  ['already cancelled', 'drop.err.cancelled'],
  ['cancelled', 'drop.err.cancelled'],
  ['no drop', 'drop.err.noDrop'],
  ['ERC1155InvalidReceiver', 'drop.err.receiver'],
  ['0x57f447ce', 'drop.err.receiver'],
]

/** A drop-specific i18n key for a failed claim simulation, when the revert is one we know. */
export function dropErrorKey(e: unknown): Key | undefined {
  const parts: string[] = []
  let x = e as { shortMessage?: string; message?: string; details?: string; cause?: unknown } | undefined
  for (let i = 0; x && i < 8; i++, x = x.cause as typeof x) parts.push(x.shortMessage ?? '', x.message ?? '', x.details ?? '')
  const msg = parts.join(' ')
  return REASONS.find(([k]) => msg.includes(k))?.[1]
}

export type GenesisDrop = { drop: Drop; claimed?: boolean }

/**
 * Live state of the Genesis Drop (contracts.genesisDropId on contracts.drops), plus whether `who`
 * already claimed it. `data === null` means there is no such drop (hide the UI). Refetched every
 * 15 s and after every useTx() write (which invalidates all queries).
 */
export function useGenesisDrop(who?: Address) {
  // X Layer's satellite contracts with the VITE_* overrides; also works on the landing page (no useNet there).
  const contracts = contractsFor(XLAYER_ID)
  const pc = usePublicClient({ chainId: XLAYER_ID }) as PublicClient | undefined
  return useQuery({
    queryKey: ['cerebr', 'drop', contracts?.drops, contracts?.genesisDropId.toString(), who],
    enabled: !!pc && !!contracts,
    refetchInterval: 15_000,
    retry: 1,
    queryFn: async (): Promise<GenesisDrop | null> => {
      const { drops, genesisDropId } = contracts!
      const [drop, claimed] = await Promise.all([
        readDrop(pc!, genesisDropId, drops).catch((e: unknown) => {
          if (e instanceof Error && e.message.startsWith('no drop')) return null
          throw e
        }),
        who ? hasClaimed(pc!, genesisDropId, who, drops) : Promise.resolve(undefined),
      ])
      return drop ? { drop, claimed } : null
    },
  })
}
