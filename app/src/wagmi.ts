import { createConfig, http, injected, type CreateConnectorFn } from 'wagmi'
import type { EIP1193Provider } from 'viem'
import { appChains } from './config/env.ts'

declare global {
  interface Window {
    okxwallet?: EIP1193Provider
  }
}

// Real injected wallets only, X Layer mainnet only.
const connectors: CreateConnectorFn[] = [
  // OKX Wallet first: it injects window.okxwallet (and usually window.ethereum too).
  injected({
    target: {
      id: 'okxWallet',
      name: 'OKX Wallet',
      // window.okxwallet is an EIP-1193 provider; cast to wagmi's WalletProvider shape.
      provider: (w) => (w as { okxwallet?: unknown } | undefined)?.okxwallet as never,
    },
  }),
  // Any other injected wallet (EIP-6963 wallets are also discovered automatically).
  injected(),
]

export const wagmiConfig = createConfig({
  chains: appChains,
  connectors,
  // Concurrent reads are sent as JSON-RPC batches of at most 10 calls (rpc.xlayer.tech rejects larger ones).
  transports: Object.fromEntries(appChains.map((c) => [c.id, http(undefined, { batch: { batchSize: 10, wait: 10 } })])),
  multiInjectedProviderDiscovery: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
