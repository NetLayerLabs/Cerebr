import type { Address } from 'viem'

/** Addresses of one Cerebr deployment (mirrors deployments/<chainId>.json). */
export type Deployment = {
  chainId: number
  deployBlock: number
  launchEndBlock: number
  processor: Address
  circuit: Address
  lens: Address
  erc6551Registry: Address
  accountImplementation: Address
}
