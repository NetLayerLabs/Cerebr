import { BaseError, ContractFunctionRevertedError, InsufficientFundsError, UserRejectedRequestError } from 'viem'
import { translate, type Key } from '../i18n/index.tsx'

/** Custom errors with a friendly message (i18n key err.<ErrorName>). */
const FRIENDLY = new Set([
  // TapeOut
  'FeeTooLow',
  'ProtocolFeeTooLow',
  'AlreadyOpened',
  'NotRegisteredCPU',
  'NotOwner',
  'OnlyCall',
  'ERC1155InsufficientBalance',
  'ERC1155InvalidReceiver',
  'ERC721NonexistentToken',
  // CerebrScope label registry
  'NotCircuitOwner',
  'LabelTooLong',
  'TooManyPinLabels',
  'NotCPU',
])

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return translate('err.rejected')
    if (e.walk((x) => x instanceof InsufficientFundsError || (x as Error).name === 'InsufficientFundsError')) return translate('err.insufficientFunds')
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name && FRIENDLY.has(name)) return translate(`err.${name}` as Key)
      if (name) return translate('err.reverted', { name })
      const reason = revert.reason ?? revert.shortMessage
      const k = TAPEOUT_REASONS[reason]
      return k ? translate(k) : reason
    }
    return e.shortMessage
  }
  return e instanceof Error ? e.message : String(e)
}

/** TapeOut's require() strings, observed on a fork (see TAPEOUT.md). */
const TAPEOUT_REASONS: Record<string, Key> = {
  'tapeout fee': 'err.r.tapeoutFee',
  'no outputs': 'err.r.noOutputs',
  'too few signals for outputs': 'err.r.fewSignals',
  'NAND: future signal': 'err.r.nandFuture',
  'has latch: use step': 'err.r.hasLatch',
  'bad id': 'err.r.badId',
  insufficient: 'err.r.insufficient',
  zero: 'err.r.zero',
  'supply cap': 'err.r.supplyCap',
  'no circuit': 'err.r.noCircuit',
  'REF: pin mismatch': 'err.r.refPins',
  'REF: target not a registered CPU': 'err.r.refCpu',
  'REF: future signal': 'err.r.refFuture',
  'LATCH d out of range': 'err.r.latchRange',
}
