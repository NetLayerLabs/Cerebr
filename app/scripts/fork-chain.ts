// Node scripts only (never imported by the browser bundle): a local anvil fork of X Layer mainnet
// for the smoke test. The dApp itself only ever offers X Layer mainnet (src/config/chains.ts).
//   anvil --fork-url https://rpc.xlayer.tech --chain-id 31337
// It has its own chain id so wallets never confuse it with the real X Layer (196). TapeOut's
// contracts (factory, opener, multicall3) and CerebrScope keep their mainnet addresses on the fork.
import { defineChain } from 'viem'
import { multicall3, okb } from '../src/config/chains.ts'

export const FORK_CHAIN_ID = 31337

/** X Layer fork on a local anvil. `id` must match anvil's --chain-id. Refuses non-loopback RPCs. */
export function makeXLayerFork(rpc = 'http://127.0.0.1:8545', id = FORK_CHAIN_ID) {
  const host = new URL(rpc).hostname
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing non-local RPC ${rpc}: forks only`)
  return defineChain({
    id,
    name: 'X Layer fork (local)',
    nativeCurrency: okb,
    rpcUrls: { default: { http: [rpc] } },
    contracts: { multicall3 },
    testnet: true,
  })
}
