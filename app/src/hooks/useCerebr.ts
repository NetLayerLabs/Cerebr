import { useBlockNumber, useChainId, useChains, useConnection, useReadContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { Address } from 'viem'
import { cerebrLensAbi } from '../abi/index.ts'
import { deploymentFor } from '../config/env.ts'

const LIVE = new Set(['protocolState', 'userState', 'quoteBuyExactOKB', 'quoteBuy', 'quoteSell'])

/** Current chain, its deployment, and the live protocol snapshot (refreshed every block). */
export function useCerebr() {
  const chainId = useChainId()
  const chains = useChains()
  const chain = chains.find((c) => c.id === chainId)
  const deployment = deploymentFor(chainId)
  const lens = deployment?.lens

  const { data: blockNumber } = useBlockNumber({ chainId, watch: { pollingInterval: 2_000 } })
  const state = useReadContract({
    address: lens,
    abi: cerebrLensAbi,
    functionName: 'protocolState',
    chainId,
    query: { enabled: !!lens },
  })

  // Refresh live reads once per new block (heavy / static reads such as tokenURI and the curve
  // points are refreshed only after the user's own transactions).
  const qc = useQueryClient()
  useEffect(() => {
    if (blockNumber === undefined) return
    qc.invalidateQueries({
      predicate: (q) => {
        const [kind, params] = q.queryKey as [string, { functionName?: string; scopeKey?: string } | undefined]
        return kind === 'readContract' && !!params?.functionName && LIVE.has(params.functionName) && params.scopeKey !== 'static'
      },
    })
  }, [blockNumber, qc])

  const explorer = chain?.blockExplorers?.default.url
  return {
    chainId,
    chain,
    deployment,
    lens,
    blockNumber,
    state: state.data,
    stateError: state.error,
    isLoading: state.isLoading,
    explorerAddr: (a: Address) => (explorer ? `${explorer}/address/${a}` : undefined),
    explorerTx: (h: string) => (explorer ? `${explorer}/tx/${h}` : undefined),
  }
}

/** The connected wallet's position (CBR, OKB, Circuits). */
export function useUserState() {
  const { address } = useConnection()
  const { lens, chainId } = useCerebr()
  const q = useReadContract({
    address: lens,
    abi: cerebrLensAbi,
    functionName: 'userState',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: !!lens && !!address },
  })
  return { address, user: q.data, isLoading: q.isLoading }
}
