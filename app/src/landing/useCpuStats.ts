// Live data for the landing page, read straight from the Cerebr CPU on X Layer mainnet with the
// SDK. Nothing on the page falls back to a config or hardcoded number: until a read lands the page
// shows a neutral '…'. One viem client with JSON-RPC batching (the X Layer RPC accepts at most 10
// calls per batch), react-query caching, and multicall for anything per-circuit.

import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http, parseAbi, type Address, type Hex, type PublicClient } from 'viem'
import {
  accountOf,
  circuitsAbi,
  listCircuits,
  packBits,
  readCpu,
  readFees,
  transistorBalances,
  unpackBits,
  XLAYER,
  xLayer,
  type CircuitInfo,
  type CpuInfo,
  type TapeoutFees,
} from '@cerebr/sdk/tapeout'
import { decode, fromHex, OP, prepare, run, type Element, type Program } from '@cerebr/sdk/neuro'
import { ISSUANCE, RPC_196 } from './issuance.ts'
import { XLAYER_CONTRACTS } from '../config/contracts.ts'
import { arenaAbi } from '../lib/arena.ts'
import { cerebrAgentAbi } from '../../../sdk/src/neuro/agent.ts'

const pc = createPublicClient({ chain: xLayer, transport: http(RPC_196, { batch: { batchSize: 10, wait: 10 } }) }) as PublicClient
const mc = { allowFailure: false, multicallAddress: XLAYER.multicall3 } as const

const scopeAbi = parseAbi([
  'struct Label { string name; string description; string[] inputs; string[] outputs; }',
  'function labelOf(address circuits, uint256 id) view returns (Label)',
])

const LIVE = { staleTime: 30_000, refetchInterval: 30_000, retry: 1 } as const
const ONCE = { staleTime: 5 * 60_000, retry: 1 } as const

/** Processor state (name, supply, price, fees, circuit count). */
export function useCpuStats(): CpuInfo | undefined {
  const cpu = ISSUANCE.cpu
  const { data } = useQuery({
    queryKey: ['landing-cpu', cpu],
    enabled: !!cpu,
    ...LIVE,
    queryFn: () => readCpu(pc, cpu!, XLAYER, { transistors: ISSUANCE.transistors }),
  })
  return data
}

/** Every fee a Cerebr flow pays (mint, tape-out, brain-wallet open, ...). */
export function useFees(): TapeoutFees | undefined {
  const cpu = ISSUANCE.cpu
  const { data } = useQuery({
    queryKey: ['landing-fees', cpu],
    enabled: !!cpu,
    ...LIVE,
    queryFn: () => readFees(pc, { circuits: cpu! }),
  })
  return data
}

export interface Counts {
  nand: number
  latch: number
  ref: number
}

export interface LiveCircuit extends CircuitInfo {
  netlist: Hex
  elements: Element[]
  counts: Counts
  /** REF targets in netlist order. */
  refs: { cpu: string; id: number }[]
  /** CerebrScope label name, when set (only read for circuits outside the catalog copy). */
  label?: string
  labelDescription?: string
}

/** Every circuit of the processor with its decoded netlist. `knownIds` skip the label read. */
export function useCircuits(knownIds: readonly number[]): LiveCircuit[] | undefined {
  const cpu = ISSUANCE.cpu
  const { data } = useQuery({
    queryKey: ['landing-circuits', cpu],
    enabled: !!cpu,
    ...LIVE,
    queryFn: async () => {
      const list = await listCircuits(pc, cpu!, { withNetlist: true })
      const out: LiveCircuit[] = list.map((c) => {
        const elements = decode(c.netlist!, c.nIn)
        const counts = { nand: 0, latch: 0, ref: 0 }
        const refs: LiveCircuit['refs'] = []
        for (const e of elements) {
          if (e.op === OP.NAND) counts.nand++
          else if (e.op === OP.LATCH) counts.latch++
          else {
            counts.ref++
            if ('cpu' in e.target) refs.push({ cpu: e.target.cpu, id: Number(e.target.circuitId) })
          }
        }
        return { ...c, netlist: c.netlist!, elements, counts, refs }
      })
      const extra = out.filter((c) => !knownIds.includes(Number(c.id)))
      if (ISSUANCE.scope && extra.length) {
        const labels = await pc.multicall({
          contracts: extra.map((c) => ({ address: ISSUANCE.scope!, abi: scopeAbi, functionName: 'labelOf', args: [cpu!, c.id] }) as const),
          allowFailure: true,
          multicallAddress: XLAYER.multicall3,
        })
        extra.forEach((c, k) => {
          const r = labels[k]
          if (r.status === 'success' && r.result.name) {
            c.label = r.result.name
            c.labelDescription = r.result.description || undefined
          }
        })
      }
      return out
    },
  })
  return data
}

export interface XorLive {
  /** REF targets of #5 in order: hidden 1 (OR), hidden 2 (NAND), output (AND). */
  refs: number[]
  /** rows[r] = [x0, x1, hidden1, hidden2, y] for (x0, x1) = 00, 01, 10, 11. */
  rows: [number, number, number, number, number][]
}

/** XOR truth table from live eval(): the network (#5) and the two hidden neurons it REFs. */
export function useXor(xor: LiveCircuit | undefined): XorLive | undefined {
  const cpu = ISSUANCE.cpu
  const local = xor?.refs.filter((r) => r.cpu.toLowerCase() === cpu?.toLowerCase())
  const { data } = useQuery({
    queryKey: ['landing-xor', cpu, xor?.netlist],
    enabled: !!cpu && !!xor && local!.length >= 3,
    ...ONCE,
    queryFn: async (): Promise<XorLive> => {
      const ins = [[0, 0], [0, 1], [1, 0], [1, 1]]
      const ids = [local![0].id, local![1].id, Number(xor!.id)]
      const res = await pc.multicall({
        contracts: ids.flatMap((id) => ins.map((b) => ({ address: cpu!, abi: circuitsAbi, functionName: 'eval', args: [BigInt(id), packBits(b)] }) as const)),
        ...mc,
      })
      const bit = (k: number) => unpackBits(res[k] as Hex, 1)[0]
      return {
        refs: local!.map((r) => r.id),
        rows: ins.map(([a, b], r) => [a, b, bit(r), bit(4 + r), bit(8 + r)]),
      }
    },
  })
  return data
}

export interface Timing {
  spikes: number[]
  counts: number[]
  fires: number[]
  /** Ticks whose step() on X Layer matched the simulator; undefined while checking. */
  verified?: number
  /** First tick where step() disagreed with the simulator, if any. */
  mismatch?: number
}

/**
 * Integrate-and-fire timing from #14's onchain netlist: the SDK simulator runs the spike sequence
 * with state, then every tick is checked against step() on X Layer (one multicall, after the
 * simulation is on screen), feeding each tick the state the simulator says it starts from.
 */
export function useTiming(circuit: LiveCircuit | undefined, all: LiveCircuit[] | undefined, spikes: number[]): Timing | undefined {
  const cpu = ISSUANCE.cpu
  const sim = circuit && all ? simulate(circuit, all, spikes) : undefined
  const { data: check } = useQuery({
    queryKey: ['landing-timing', cpu, circuit?.netlist, spikes.join('')],
    enabled: !!cpu && !!sim,
    ...ONCE,
    queryFn: async () => {
      const res = await pc.multicall({
        contracts: sim!.ticks.map((t) => ({
          address: cpu!,
          abi: circuitsAbi,
          functionName: 'step',
          args: [circuit!.id, packBits(t.state), packBits(t.inputs)],
        }) as const),
        ...mc,
      })
      let verified = 0
      let mismatch: number | undefined
      res.forEach((r, i) => {
        const [st, out] = r as readonly [Hex, Hex]
        const t = sim!.ticks[i]
        const ok =
          unpackBits(st, circuit!.nState).join('') === t.next.join('') && unpackBits(out, circuit!.nOut).join('') === t.outputs.join('')
        if (ok) verified++
        else mismatch ??= i
      })
      return { verified, mismatch }
    },
  })
  if (!sim) return undefined
  return { spikes, counts: sim.counts, fires: sim.fires, verified: check?.verified, mismatch: check?.mismatch }
}

function simulate(c: LiveCircuit, all: LiveCircuit[], spikes: number[]) {
  const cache = new Map<string, Program>()
  const resolve = (cpu: string, id: bigint): Program => {
    const sub = all.find((x) => x.id === id && cpu.toLowerCase() === x.circuits.toLowerCase())
    if (!sub) throw new Error(`REF to unknown circuit ${cpu}#${id}`)
    const key = `${cpu}#${id}`
    let p = cache.get(key)
    if (!p) cache.set(key, (p = prepare(fromHex(sub.netlist), sub.nIn, sub.nOut, resolve)))
    return p
  }
  const prog = prepare(fromHex(c.netlist), c.nIn, c.nOut, resolve)
  let state: number[] = Array(prog.nState).fill(0)
  const ticks: { state: number[]; inputs: number[]; next: number[]; outputs: number[] }[] = []
  for (const s of spikes) {
    const inputs = [s, 0] // spike, inhibit
    const r = run(prog, state, inputs)
    const next = Array.from(r.newState)
    ticks.push({ state, inputs, next, outputs: Array.from(r.outputs) })
    state = next
  }
  // COUNT is the 2-bit membrane potential held in the latches after the tick (p0 + 2 * p1).
  return { ticks, counts: ticks.map((t) => t.next.reduce((v, b, i) => v + (b << i), 0)), fires: ticks.map((t) => t.outputs[0]) }
}

export interface Misc {
  chainId: number
  gasPrice: bigint
  /** Brain wallet of the example circuit. */
  wallet: { account: Address; opened: boolean }
}

/** Chain id, gas price and the example circuit's brain wallet. */
export function useMisc(walletCircuit: bigint): Misc | undefined {
  const cpu = ISSUANCE.cpu
  const { data } = useQuery({
    queryKey: ['landing-misc', cpu, walletCircuit.toString()],
    enabled: !!cpu,
    ...LIVE,
    queryFn: async () => {
      const [chainId, gasPrice, wallet] = await Promise.all([pc.getChainId(), pc.getGasPrice(), accountOf(pc, cpu!, walletCircuit)])
      return { chainId, gasPrice, wallet: { account: wallet.account, opened: wallet.opened } }
    },
  })
  return data
}

/** Transistors held by the processor's creator (the deployment wallet). */
export function useCreatorHoldings(cpu: CpuInfo | undefined): { nand: bigint; latch: bigint } | undefined {
  const { data } = useQuery({
    queryKey: ['landing-creator', cpu?.transistors, cpu?.creator],
    enabled: !!cpu,
    ...LIVE,
    queryFn: () => transistorBalances(pc, cpu!.transistors, cpu!.creator),
  })
  return data
}

/** The hero's live proof points: CerebrAgent's latest decision and NeuralArena's record. */
export type HeroPulse = {
  agent?: { verdict: number; timestamp: number }
  arena?: { games: bigint; humanWins: bigint }
}

export function useHeroPulse(): HeroPulse | undefined {
  const { data } = useQuery({
    queryKey: ['landing-pulse', XLAYER_CONTRACTS.agent, XLAYER_CONTRACTS.arena],
    ...LIVE,
    queryFn: async (): Promise<HeroPulse> => {
      const [rec, stats] = await Promise.all([
        pc.readContract({ address: XLAYER_CONTRACTS.agent, abi: cerebrAgentAbi, functionName: 'latestDecision' }).catch(() => undefined) as Promise<{ seq: number; verdict: number; timestamp: number } | undefined>,
        pc.readContract({ address: XLAYER_CONTRACTS.arena, abi: arenaAbi, functionName: 'stats' }).catch(() => undefined) as Promise<{ games: bigint; humanWins: bigint } | undefined>,
      ])
      return {
        agent: rec && Number(rec.seq) > 0 ? { verdict: Number(rec.verdict), timestamp: Number(rec.timestamp) } : undefined,
        arena: stats ? { games: stats.games, humanWins: stats.humanWins } : undefined,
      }
    },
  })
  return data
}
