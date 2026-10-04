// Pure deployment lookup (no import.meta.env) so Node scripts can import this file too.
import type { Address } from 'viem'
import { generatedDeployments } from '../generated/deployments.ts'
import type { Deployment } from './types.ts'

export type { Deployment }

/**
 * Deployment for `chainId`: the generated file (from deployments/*.json), with an optional lens
 * address override. The dApp only strictly needs the lens: every other address is re-read from
 * `lens.protocolState()` at runtime.
 */
export function getDeployment(chainId: number, lensOverride?: Address): Deployment | undefined {
  const d = generatedDeployments[chainId]
  if (lensOverride) {
    return d
      ? { ...d, lens: lensOverride }
      : {
          chainId,
          deployBlock: 0,
          launchEndBlock: 0,
          lens: lensOverride,
          processor: '0x0000000000000000000000000000000000000000',
          circuit: '0x0000000000000000000000000000000000000000',
          erc6551Registry: '0x0000000000000000000000000000000000000000',
          accountImplementation: '0x0000000000000000000000000000000000000000',
        }
  }
  return d
}
