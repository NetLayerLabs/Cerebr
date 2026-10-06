// Pure chain definitions (no import.meta.env) so Node scripts can import this file too.
import { defineChain } from 'viem'

export const XLAYER_ID = 196
export const multicall3 = { address: '0xcA11bde05977b3631167028862bE2a173976CA11', blockCreated: 47416 } as const

export const okb = { name: 'OKB', symbol: 'OKB', decimals: 18 } as const

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
