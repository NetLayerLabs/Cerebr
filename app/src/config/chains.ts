// Pure chain definitions (no import.meta.env) so Node scripts can import this file too.
import { defineChain } from 'viem'

export const XLAYER_ID = 196
export const XLAYER_TESTNET_ID = 1952
export const ANVIL_ID = 31337

const okb = { name: 'OKB', symbol: 'OKB', decimals: 18 } as const

export function makeXLayer(rpc = 'https://rpc.xlayer.tech') {
  return defineChain({
    id: XLAYER_ID,
    name: 'X Layer',
    nativeCurrency: okb,
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: 'OKLink', url: 'https://www.oklink.com/xlayer' } },
  })
}

export function makeXLayerTestnet(rpc = 'https://testrpc.xlayer.tech') {
  return defineChain({
    id: XLAYER_TESTNET_ID,
    name: 'X Layer Testnet',
    nativeCurrency: okb,
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: 'OKLink', url: 'https://www.oklink.com/xlayer-test' } },
    testnet: true,
  })
}

/** Local anvil. Native token is ETH on anvil, but it stands in for OKB in the demo. */
export function makeAnvil(rpc = 'http://127.0.0.1:8545') {
  return defineChain({
    id: ANVIL_ID,
    name: 'Anvil (local)',
    nativeCurrency: okb,
    rpcUrls: { default: { http: [rpc] } },
    testnet: true,
  })
}
