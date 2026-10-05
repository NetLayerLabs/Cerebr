import { useMemo } from 'react'
import { useBlockNumber, useChainId, useChains, useConnection, usePublicClient } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address, PublicClient } from 'viem'
import { listCircuits, readCpu, readFees, transistorBalances, type CpuInfo } from '@cerebr/sdk/tapeout'
import type { TapeoutFees } from '@cerebr/sdk/tapeout'
import { cpuFor } from '../config/env.ts'
import { FORK_CHAIN_ID } from '../config/chains.ts'
import { identifyCircuits, indexByNetlist, fallbackLabel, type ChainCircuit, type CircuitLabel } from '../lib/cerebr.ts'
import { loadLabels } from '../lib/labels.ts'

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
    isFork: chainId === FORK_CHAIN_ID,
    explorerAddr: (a: string) => (explorer ? `${explorer}/address/${a}` : undefined),
    explorerTx: (h: string) => (explorer ? `${explorer}/tx/${h}` : undefined),
  }
}

export type CpuState = CpuInfo & { fees: TapeoutFees }

/** The Cerebr CPU as TapeOut reports it (name, story, cap, minted, price, fees, circuit count). */
export function useCpu() {
  const { chainId, cfg, pc } = useNet()
  const q = useQuery({
    queryKey: ['cerebr', 'cpu', chainId, cfg?.circuits],
    enabled: !!pc && !!cfg,
    refetchInterval: 15_000,
    queryFn: async (): Promise<CpuState> => {
      const cpu = await readCpu(pc!, cfg!.circuits)
      const fees = await readFees(pc!, cpu)
      return { ...cpu, fees }
    },
  })
  return { cfg, cpu: q.data, error: q.error, isLoading: q.isLoading }
}

export type CircuitRow = ChainCircuit & { label: CircuitLabel; known: boolean }

/** Every circuit on the Cerebr CPU, with its netlist and what the app recognises it as. */
export function useCircuits() {
  const { chainId, cfg, pc } = useNet()
  const { cpu } = useCpu()
  const count = cpu?.circuitCount
  const q = useQuery({
    queryKey: ['cerebr', 'circuits', chainId, cfg?.circuits, count?.toString()],
    enabled: !!pc && !!cfg && count !== undefined,
    staleTime: 30_000,
    queryFn: async () => {
      const list = (await listCircuits(pc!, cfg!.circuits, { withNetlist: true })) as ChainCircuit[]
      const labels = identifyCircuits(cfg!.circuits, list, cfg!.catalog, loadLabels(chainId, cfg!.circuits))
      const rows: CircuitRow[] = list.map((c) => ({ ...c, label: labels.get(c.id) ?? fallbackLabel(c), known: labels.has(c.id) }))
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
