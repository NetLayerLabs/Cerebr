import { useCallback, useState } from 'react'
import { useConfig, useConnection } from 'wagmi'
import { writeContract, waitForTransactionReceipt, simulateContract, getPublicClient } from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../lib/errors.ts'
import { useToasts } from './useToasts.tsx'
import { useCerebr } from './useCerebr.ts'

import type { Abi, Address } from 'viem'

/** Loosely typed write; the ABI (generated from forge artifacts) still encodes/validates args. */
export type TxParams = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}
type SimulateParams = Parameters<typeof simulateContract>[1]

/**
 * These calls also run the on-chain reveal queue, whose cost depends on how many sealed Circuits
 * are ready at inclusion time, which can differ from when the gas was estimated. Pad the limit
 * past the bounded worst case (2 reveals + 4 skips ≈ 72k) so they can't run out of gas.
 */
const AUTO_REVEAL_FNS = new Set(['buyTransistors', 'tapeOutCircuit', 'tapeOutCircuitTier', 'fuseCircuits', 'processRevealQueue'])
const AUTO_REVEAL_GAS_PAD = 80_000n

/**
 * Simulate -> send -> wait, with toasts and a refresh of all reads afterwards.
 * Simulation first gives decoded custom-error messages before the wallet pops up.
 */
export function useTx() {
  const config = useConfig()
  const qc = useQueryClient()
  const { push, update } = useToasts()
  const { address, chainId: walletChain } = useConnection()
  const { chainId, explorerTx } = useCerebr()
  const [busy, setBusy] = useState<string | null>(null)

  const send = useCallback(
    async (label: string, params: TxParams) => {
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
        if (AUTO_REVEAL_FNS.has(params.functionName)) {
          const est = await getPublicClient(config, { chainId })!.estimateContractGas({ ...params, account: address } as never)
          ;(request as { gas?: bigint }).gas = est + AUTO_REVEAL_GAS_PAD
        }
        const hash = await writeContract(config, request as Parameters<typeof writeContract>[1])
        update(id, { body: 'Waiting for confirmation…', href: explorerTx(hash) })
        const receipt = await waitForTransactionReceipt(config, { hash, chainId })
        if (receipt.status !== 'success') throw new Error('Transaction reverted')
        update(id, { kind: 'success', body: `Confirmed in block ${receipt.blockNumber}` })
        await qc.invalidateQueries()
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
