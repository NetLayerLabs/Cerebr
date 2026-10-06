// Pure addresses of the contracts around the Cerebr CPU (no import.meta.env), so Node scripts can
// import this file too. The CPU itself (circuits / transistors / scope) lives in cpu.ts; env.ts
// applies VITE_* overrides and exposes `contractsFor` to the app (read it through useNet().contracts).
import type { Address } from 'viem'
import { XLAYER_DROPS, XLAYER_MARKET } from '@cerebr/sdk/tapeout'
import { XLAYER_ID } from './chains.ts'

/** Cerebr's satellite contracts on one chain. Every number they hold is read live, never cached here. */
export type ContractsConfig = {
  chainId: number
  /** TapeOut's ownerless drops (airdrop) contract, deployed by Cerebr. */
  drops: Address
  /** The Genesis Drop on `drops` (400 NAND, 16 per claim, one claim per address). */
  genesisDropId: bigint
  /** TapeOut's circuit marketplace (UUPS proxy). Approval-based listings, 1% fee snapshotted per listing. */
  market: Address
  /** First block worth scanning for marketplace events. */
  marketFrom: bigint
  /** NeuralArena: tic-tac-toe against a taped-out neural network (human moves first). */
  arena: Address
  /** NeuralArena's deploy block (first block worth scanning for its events). */
  arenaFrom: bigint
  /** The arena bot's circuit id on the Cerebr CPU. */
  arenaBot: bigint
  /** CerebrAgent: an autonomous agent whose policy is a taped-out neuron (AGENT.md). Read-only in the app. */
  agent: Address
  /** The agent's policy circuit id on the Cerebr CPU (#8, the Go/No-Go Neuron). */
  agentPolicy: bigint
  /** The policy circuit's TapeOut ERC-6551 account ("brain wallet"), fixed at deployment. */
  agentBrain: Address
  /** The keeper daemon's hot wallet (calls act() every 10 minutes; act() is permissionless). */
  agentKeeper: Address
}

export const XLAYER_CONTRACTS: ContractsConfig = {
  chainId: XLAYER_ID,
  drops: XLAYER_DROPS ?? '0xf037a5543f19619a2291009ae1542b71d50ff9b9',
  genesisDropId: 1n,
  market: XLAYER_MARKET.circuitMarket,
  marketFrom: XLAYER_MARKET.circuitMarketFrom,
  arena: '0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD',
  arenaFrom: 72515972n,
  arenaBot: 16n,
  agent: '0x3d736c6419dCa667a351907578b68717Cd6e3340',
  agentPolicy: 8n,
  agentBrain: '0x550500EF28b4Ebe39a7431E2A86A45f97F6db141',
  agentKeeper: '0x09a00521Ff00407f81963FcE5D4D20917289902A',
}

/** Satellite contracts on `chainId` (X Layer mainnet only), with optional overrides. */
export function contractsConfigFor(chainId: number, override: Partial<Omit<ContractsConfig, 'chainId'>> = {}): ContractsConfig | undefined {
  if (chainId !== XLAYER_ID) return undefined
  const defined = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined))
  return { ...XLAYER_CONTRACTS, ...defined }
}
