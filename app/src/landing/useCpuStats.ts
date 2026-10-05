// Live numbers for the landing page's stats strip, read straight from the Cerebr CPU on X Layer
// mainnet with the SDK's readCpu(). Returns undefined (and the strip hides) when no CPU is
// configured or the read fails, so the page never shows a broken or made-up number.

import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http } from 'viem'
import { readCpu, xLayer, type CpuInfo } from '@cerebr/sdk/tapeout'
import { ISSUANCE, RPC_196 } from './issuance.ts'

export function useCpuStats(): CpuInfo | undefined {
  const cpu = ISSUANCE.cpu
  const { data } = useQuery({
    queryKey: ['landing-cpu', cpu],
    enabled: !!cpu,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: () => readCpu(createPublicClient({ chain: xLayer, transport: http(RPC_196) }), cpu!),
  })
  return data
}
