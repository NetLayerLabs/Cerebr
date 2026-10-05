// TapeOut deployment on X Layer mainnet (chainId 196), verified on an anvil fork at block ~72.375M
// (2026-10-04). See TAPEOUT.md for the evidence behind every value here.

import { defineChain, type Address, type Chain } from 'viem';

export interface TapeoutConfig {
  chainId: number;
  /** TapeOut factory (EIP-1967 UUPS proxy). Creates CPUs; `isCPU(circuits)` is the registry. */
  factory: Address;
  /** Opener: turns a circuit NFT into its native ERC-6551 account ("brain wallet"). */
  opener: Address;
  /** ERC-6551 account implementation passed to the registry (itself a beacon proxy). */
  accountImpl: Address;
  /** The beacon behind accountImpl (an immutable in its bytecode); `implementation()` is the upgradeable account logic. */
  accountBeacon?: Address;
  /** Canonical ERC-6551 registry used by the opener (salt 0). */
  registry: Address;
  /** BEM token (TapeOut's protocol token; not needed for CPU / circuit flows). */
  bem: Address;
  multicall3: Address;
  /** First block worth scanning for TapeOut events. */
  fromBlock: bigint;
  explorer: string;
}

export const XLAYER: TapeoutConfig = {
  chainId: 196,
  factory: '0x1f09daefa827f02cbb40967cc91b259763760761',
  opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  accountImpl: '0xac4f791353ee9f06e2c50ae4c34680d28ea52a57',
  accountBeacon: '0x9b135f586f7850a3fa92210c298f732b20bc8f44',
  registry: '0x000000006551c19487814612e58fe06813775758',
  bem: '0x60e62Efa9405d6873C5deaBD4E6CC91c25363952',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  fromBlock: 70995047n,
  explorer: 'https://www.oklink.com/xlayer',
};

/** ERC-1155 token ids on every CPU's transistors contract (`NAND()` / `LATCH()` constants). */
export const NAND_ID = 0n;
export const LATCH_ID = 1n;

/** The TapeOut app only lists an X Layer processor with supplyCap >= 10000 and minted >= 1. */
export const LISTING_QUALITY = { minSupplyCap: 10000n, minMinted: 1n } as const;

export const XLAYER_RPC = 'https://rpc.xlayer.tech';

export const xLayer: Chain = defineChain({
  id: 196,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC] } },
  blockExplorers: { default: { name: 'OKLink', url: XLAYER.explorer } },
  contracts: { multicall3: { address: XLAYER.multicall3, blockCreated: 47416 } },
});

/** A local anvil fork of X Layer (`anvil --fork-url https://rpc.xlayer.tech --chain-id 196`). */
/** A local anvil fork of X Layer. `id` is the node's chain id: 196, or 31337 for the dApp's local fork. */
export function xLayerFork(rpcUrl = 'http://127.0.0.1:8545', id = 196): Chain {
  return defineChain({ ...xLayer, id, name: 'X Layer (fork)', rpcUrls: { default: { http: [rpcUrl] } } });
}

export function explorerTx(hash: string, cfg: TapeoutConfig = XLAYER): string {
  return `${cfg.explorer}/tx/${hash}`;
}

export function explorerAddress(address: string, cfg: TapeoutConfig = XLAYER): string {
  return `${cfg.explorer}/address/${address}`;
}
