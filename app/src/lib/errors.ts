import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem'

const FRIENDLY: Record<string, string> = {
  // TapeOut
  FeeTooLow: 'The fee sent is below what TapeOut asks. Fees may have changed: reload and try again.',
  ProtocolFeeTooLow: 'The protocol fee sent is below what TapeOut asks. Reload and try again.',
  AlreadyOpened: 'This brain wallet is already open.',
  NotRegisteredCPU: 'That address is not a processor registered in the TapeOut factory.',
  NotOwner: 'Only the circuit owner can do that.',
  OnlyCall: 'Brain wallets only allow plain calls.',
  ERC1155InsufficientBalance: 'Not enough transistors: mint the missing NAND / LATCH first.',
  ERC721NonexistentToken: 'That circuit does not exist.',
  // CerebrScope label registry
  NotCircuitOwner: 'Only the circuit owner can label it.',
  LabelTooLong: 'Label too long (name 64, description 512, pins 32 bytes).',
  TooManyPinLabels: 'More pin labels than the circuit has pins.',
}

export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'Request rejected in wallet.'
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName
      if (name && FRIENDLY[name]) return FRIENDLY[name]
      if (name) return `Reverted: ${name}`
      const reason = revert.reason ?? revert.shortMessage
      return TAPEOUT_REASONS[reason] ?? reason
    }
    return e.shortMessage
  }
  return e instanceof Error ? e.message : String(e)
}

/** TapeOut's require() strings, observed on a fork (see TAPEOUT.md). */
const TAPEOUT_REASONS: Record<string, string> = {
  'tapeout fee': 'tapeout() takes exactly TAPEOUT_FEE: the fee changed, reload and retry.',
  'no outputs': 'The netlist has no outputs.',
  'too few signals for outputs': 'Outputs must be gate outputs (the last nOut signals), not raw inputs or constants.',
  'NAND: future signal': 'A gate reads a signal that is defined later in the netlist.',
  'has latch: use step': 'This circuit has state: run it with step(), not eval().',
  'bad id': 'Unknown transistor id (NAND = 0, LATCH = 1).',
}
