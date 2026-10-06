import { useMemo } from 'react'
import { useBlockNumber, useChainId, useChains, useConnection, usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { listCircuits, readCpu, readFees, transistorBalances, type CpuInfo } from '@cerebr/sdk/tapeout'
import type { TapeoutFees } from '@cerebr/sdk/tapeout'
import { cpuFor } from '../config/env.ts'
import { TAPEOUT, identifyCircuits, indexByNetlist, resolveLabel, type ChainCircuit, type CircuitLabel } from '../lib/cerebr.ts'
import { hasLabel, readLabels, type OnchainLabel } from '../lib/scope.ts'

/** Current chain, its Cerebr CPU config, a public client and explorer links. */
export function useNet() {
  const chainId = useChainId()
  const chains = useChains()
  const chain = chains.find((c) => c.id === chainId)
  const cfg = useMemo(() => cpuFor(chainId), [chainId])
  const pc = usePublicClient({ chainId }) as PublicClient | undefined
  const { data: blockNumber } = useBlockNumber({ chainId, watch: { pollingInterval: 4_000 } })
  const explorer = chain?.blockExplorers?.default.url
  return {
    chainId,
    chain,
    cfg,
    pc,
    blockNumber,
    explorerAddr: (a: string) => (explorer ? `${explorer}/address/${a}` : undefined),
    explorerTx: (h: string) => (explorer ? `${explorer}/tx/${h}` : undefined),
  }
}

export type CpuState = CpuInfo & { fees: TapeoutFees }

/** The Cerebr CPU as TapeOut reports it (name, story, cap, minted, price, fees, circuit count). Live reads only. */
export function useCpu() {
  const { chainId, cfg, pc } = useNet()
  const q = useQuery({
    queryKey: ['cerebr', 'cpu', chainId, cfg?.circuits],
    enabled: !!pc && !!cfg,
    refetchInterval: 15_000,
    queryFn: async (): Promise<CpuState> => {
      // Both reads are independent: one round trip each, sent together.
      const [cpu, fees] = await Promise.all([readCpu(pc!, cfg!.circuits, undefined, { transistors: cfg!.transistors }), readFees(pc!, { circuits: cfg!.circuits })])
      return { ...cpu, fees }
    },
  })
  return { cfg, cpu: q.data, error: q.error, isLoading: q.isLoading }
}

export type CircuitRow = ChainCircuit & {
  /** What the app shows: onchain label, else catalog identification, else 'Circuit #N'. */
  label: CircuitLabel
  /** Recognised as a catalog circuit from its netlist bytes. */
  known: boolean
  /** The circuit's CerebrScope label, when its owner has set one. */
  onchain?: OnchainLabel
  /** The catalog label matched from the bytes, if any (what "Name onchain" proposes). */
  catalog?: CircuitLabel
}

/**
 * Every circuit on the Cerebr CPU, with its netlist and its name: CerebrScope's onchain label, the
 * catalog entry matched by netlist bytes, or 'Circuit #N'. Circuits and labels are read in parallel,
 * one multicall each.
 */
export function useCircuits() {
  const { chainId, cfg, pc } = useNet()
  const { cpu } = useCpu()
  const count = cpu?.circuitCount
  const q = useQuery({
    queryKey: ['cerebr', 'circuits', chainId, cfg?.circuits, cfg?.scope, count?.toString()],
    enabled: !!pc && !!cfg && count !== undefined,
    staleTime: 30_000,
    queryFn: async () => {
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1))
      const [list, onchain] = await Promise.all([
        listCircuits(pc!, cfg!.circuits, { withNetlist: true }) as Promise<ChainCircuit[]>,
        cfg!.scope ? readLabels(pc!, cfg!.scope, cfg!.circuits, ids, TAPEOUT.multicall3) : Promise.resolve(new Map<bigint, OnchainLabel>()),
      ])
      const catalog = identifyCircuits(cfg!.circuits, list, cfg!.catalog)
      const rows: CircuitRow[] = list.map((c) => {
        const own = onchain.get(c.id)
        const cat = catalog.get(c.id)
        return { ...c, label: resolveLabel(c, own, cat), known: !!cat, onchain: hasLabel(own) ? own : undefined, catalog: cat }
      })
      return { rows, index: indexByNetlist(list) }
    },
  })
  return { circuits: q.data?.rows, index: q.data?.index, isLoading: q.isLoading || (count === undefined && !!cfg), error: q.error }
}

/** NAND / LATCH balances of the connected wallet on the Cerebr CPU. */
export function useBalances() {
  const { address } = useConnection()
  const { chainId, pc } = useNet()
  const { cpu } = useCpu()
  const q = useQuery({
    queryKey: ['cerebr', 'balances', chainId, cpu?.transistors, address],
    enabled: !!pc && !!cpu && !!address,
    refetchInterval: 15_000,
    queryFn: () => transistorBalances(pc!, cpu!.transistors, address as Address),
  })
  return { address, balances: q.data }
}
