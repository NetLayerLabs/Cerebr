import { useCallback, useState } from 'react'
import { useConfig, useConnection } from 'wagmi'
import { writeContract, waitForTransactionReceipt, simulateContract } from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import type { TransactionReceipt } from 'viem'
import { errorMessage } from '../lib/errors.ts'
import type { TxParams } from '../lib/cerebr.ts'
import { useToasts } from './useToasts.tsx'
import { useNet } from './useCpu.ts'

export type { TxParams }
type SimulateParams = Parameters<typeof simulateContract>[1]

/**
 * Simulate -> send -> wait, with toasts and a refresh of all reads afterwards.
 * Simulation first gives decoded revert reasons before the wallet pops up.
 */
export function useTx() {
  const config = useConfig()
  const qc = useQueryClient()
  const { push, update } = useToasts()
  const { address, chainId: walletChain } = useConnection()
  const { chainId, explorerTx } = useNet()
  const [busy, setBusy] = useState<string | null>(null)

  const send = useCallback(
    async (label: string, params: TxParams, opts: { refresh?: boolean } = {}): Promise<TransactionReceipt | undefined> => {
      if (!address) {
        push({ kind: 'error', title: 'Connect a wallet first' })
        return undefined
      }
      if (walletChain !== chainId) {
        push({ kind: 'error', title: 'Wrong network', body: 'Switch your wallet to the selected network.' })
        return undefined
      }
      setBusy(label)
      const id = push({ kind: 'pending', title: label, body: 'Confirm in your wallet…' })
      try {
        const { request } = await simulateContract(config, { ...params, account: address, chainId } as unknown as SimulateParams)
        const hash = await writeContract(config, request as Parameters<typeof writeContract>[1])
        update(id, { body: 'Waiting for confirmation…', href: explorerTx(hash) })
        const receipt = await waitForTransactionReceipt(config, { hash, chainId })
        if (receipt.status !== 'success') throw new Error('Transaction reverted')
        update(id, { kind: 'success', body: `Confirmed in block ${receipt.blockNumber}` })
        if (opts.refresh !== false) await qc.invalidateQueries()
        return receipt
      } catch (e) {
        update(id, { kind: 'error', body: errorMessage(e) })
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [address, walletChain, chainId, config, push, update, qc, explorerTx],
  )

  return { send, busy }
}
