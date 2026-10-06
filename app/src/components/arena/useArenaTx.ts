import { useCallback, useState } from 'react'
import { useConfig, useConnection } from 'wagmi'
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Address, type PublicClient, type TransactionReceipt } from 'viem'
import { useNet } from '../../hooks/useCpu.ts'
import { useToasts } from '../../hooks/useToasts.tsx'
import { errorMessage } from '../../lib/errors.ts'
import { ARENA_ERRORS, arenaAbi, playGasLimit, type ArenaError } from '../../lib/arena.ts'
import { translate as t, type Key } from '../../i18n/index.tsx'

/** NeuralArena's custom errors in plain words, else the app's usual decoding. */
export function arenaError(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError)
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined
    if (name && (ARENA_ERRORS as readonly string[]).includes(name)) return t(`arena.err.${name as ArenaError}` as Key)
  }
  return errorMessage(e)
}

type Call = { functionName: 'newGame'; args?: undefined } | { functionName: 'play'; args: readonly [bigint, number] }
export type ArenaTxResult = { receipt: TransactionReceipt; gasLimit?: bigint }

/**
 * useTx() for NeuralArena: simulate (decoded reverts before the wallet opens) -> for play(), an
 * explicit gas limit from eth_estimateGas with a margin (play must be able to forward the full 3M eval
 * budget, so wallets that guess low would revert InsufficientGasForInference) -> send -> receipt ->
 * toasts -> refresh every read.
 */
export function useArenaTx(arena: Address | undefined) {
  const config = useConfig()
  const qc = useQueryClient()
  const { push, update } = useToasts()
  const { address, chainId: walletChain } = useConnection()
  const { chainId, pc, explorerTx } = useNet()
  const [busy, setBusy] = useState<string | null>(null)

  const send = useCallback(
    async (label: string, call: Call): Promise<ArenaTxResult | undefined> => {
      if (!address) {
        push({ kind: 'error', title: t('tx.connectFirst') })
        return undefined
      }
      if (walletChain !== chainId) {
        push({ kind: 'error', title: t('tx.wrongNetwork'), body: t('tx.wrongNetworkBody') })
        return undefined
      }
      if (!arena || !pc) return undefined
      setBusy(call.functionName)
      const id = push({ kind: 'pending', title: label, body: t('tx.confirm') })
      try {
        const params = { address: arena, abi: arenaAbi, functionName: call.functionName, args: call.args, account: address, chainId } as const
        const { request } = await simulateContract(config, params as Parameters<typeof simulateContract>[1])
        let gasLimit: bigint | undefined
        if (call.functionName === 'play') {
          const data = encodeFunctionData({ abi: arenaAbi, functionName: 'play', args: call.args })
          const est = await (pc as PublicClient).estimateGas({ account: address, to: arena, data })
          gasLimit = playGasLimit(est)
        }
        const hash = await writeContract(config, { ...(request as Parameters<typeof writeContract>[1]), ...(gasLimit ? { gas: gasLimit } : {}) })
        update(id, { body: t('tx.waiting'), href: explorerTx(hash) })
        const receipt = await waitForTransactionReceipt(config, { hash, chainId })
        if (receipt.status !== 'success') throw new Error(t('tx.reverted'))
        update(id, { kind: 'success', body: t('tx.confirmed', { n: receipt.blockNumber }) })
        await qc.invalidateQueries()
        return { receipt, gasLimit }
      } catch (e) {
        update(id, { kind: 'error', body: arenaError(e) })
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [address, walletChain, chainId, arena, pc, config, push, update, qc, explorerTx],
  )
  return { send, busy }
}
