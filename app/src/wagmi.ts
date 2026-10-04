import { createConfig, http, injected, mock, type CreateConnectorFn } from 'wagmi'
import type { EIP1193Provider } from 'viem'
import { anvilEnabled, appChains } from './config/env.ts'
import { ANVIL_ID } from './config/chains.ts'

declare global {
  interface Window {
    okxwallet?: EIP1193Provider
  }
}

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

// Local demo only: drives anvil's unlocked account #0 through the RPC. No key is held in the app.
if (anvilEnabled) {
  connectors.push(
    mock({ accounts: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'], features: { reconnect: true, defaultConnected: import.meta.env.VITE_ANVIL_AUTOCONNECT === 'true' } }),
  )
}

export const wagmiConfig = createConfig({
  chains: appChains,
  connectors,
  transports: Object.fromEntries(appChains.map((c) => [c.id, http()])),
  multiInjectedProviderDiscovery: true,
})

export const ANVIL_DEV_CHAIN = ANVIL_ID

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
