import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

const FRIENDLY: Record<string, string> = {
  SlippageExceeded: 'Price moved beyond your slippage tolerance. Re-quote and try again.',
  InsufficientPayment: 'Not enough OKB sent for this buy.',
  MaxSupplyExceeded: 'This buy would exceed the 10M CBR max supply.',
  LaunchWalletCapExceeded: 'Fair-launch cap: this wallet already bought its limit for this block.',
  LaunchBlockCapExceeded: 'Fair-launch cap: this block is full. Try again next block.',
  EnforcedPause: 'The processor is paused (sells stay open).',
  ERC20InsufficientBalance: 'Not enough CBR.',
  RevealTooEarly: 'Too early: the reveal block has not been mined yet.',
  AlreadyRevealed: 'Already revealed.',
  CircuitNotRevealed: 'Both circuits must be revealed before fusion.',
  TierMismatch: 'Both circuits must be the same tier.',
  NotCircuitOwner: 'You must own both circuits directly.',
  MaxTierReached: 'Singularity circuits cannot be fused further.',
  SameCircuit: 'Pick two different circuits.',
  ZeroAmount: 'Amount must be greater than zero.',
}

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'Request rejected in wallet.'
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name && FRIENDLY[name]) return FRIENDLY[name]
      if (name) return `Reverted: ${name}`
      return revert.shortMessage
    }
    return e.shortMessage
  }
  return e instanceof Error ? e.message : String(e)
}
