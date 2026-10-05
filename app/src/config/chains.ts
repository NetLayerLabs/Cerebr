// Pure chain definitions (no import.meta.env) so Node scripts can import this file too.
import { defineChain } from 'viem'

export const XLAYER_ID = 196
/**
 * Local anvil fork of X Layer mainnet, for demos and rehearsals:
 *   anvil --fork-url https://rpc.xlayer.tech --chain-id 31337
 * It needs its own chain id so wallets and wagmi never confuse it with the real X Layer (196).
 * TapeOut's contracts (factory, opener, multicall3) keep their mainnet addresses on the fork.
 */
export const FORK_CHAIN_ID = 31337
const multicall3 = { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 47416 } as const

const okb = { name: 'OKB', symbol: 'OKB', decimals: 18 } as const

export function makeXLayer(rpc = 'https://rpc.xlayer.tech') {
  return defineChain({
    id: XLAYER_ID,
    name: 'X Layer',
    nativeCurrency: okb,
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: 'OKLink', url: 'https://www.oklink.com/xlayer' } },
    contracts: { multicall3 },
  })
}

/** X Layer fork on a local anvil. No explorer: links are hidden. */
export function makeXLayerFork(rpc = 'http://127.0.0.1:8545') {
  return defineChain({
    id: FORK_CHAIN_ID,
    name: 'X Layer fork (local)',
    nativeCurrency: okb,
    rpcUrls: { default: { http: [rpc] } },
    contracts: { multicall3 },
    testnet: true,
  })
}
