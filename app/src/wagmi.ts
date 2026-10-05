import { createConfig, http, injected, mock, type CreateConnectorFn } from 'wagmi'
import type { EIP1193Provider } from 'viem'
import { anvilEnabled, appChains } from './config/env.ts'
import { FORK_CHAIN_ID } from './config/chains.ts'

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

// Local fork only: drives an unlocked anvil dev account through the RPC. No key is held in the app.
// Account #2: on an X Layer fork, #0, #1 and #5 carry mainnet EIP-7702 delegations and cannot
// receive ERC-1155 transistors.
if (anvilEnabled) {
  connectors.push(
    mock({ accounts: ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'], features: { reconnect: true, defaultConnected: import.meta.env.VITE_ANVIL_AUTOCONNECT === 'true' } }),
  )
}

export const wagmiConfig = createConfig({
  chains: appChains,
  connectors,
  transports: Object.fromEntries(appChains.map((c) => [c.id, http()])),
  multiInjectedProviderDiscovery: true,
})

export const ANVIL_DEV_CHAIN = FORK_CHAIN_ID

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
