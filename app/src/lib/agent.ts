// CerebrAgent (src/agent/CerebrAgent.sol, AGENT.md): typed reads for the read-only Agent view. The ABI,
// the pin mapping and the offline replay check come from the SDK module sdk/src/neuro/agent.ts (viem-free,
// imported by path as AGENT.md says). Pure: no React, no import.meta.env.
import type { Address, Hex, PublicClient } from 'viem'
import { circuitsAbi } from '@cerebr/sdk/tapeout'
import {
  AGENT_PINS,
  AGENT_THETA,
  FALLBACK_NAMES,
  Verdict,
  agentInputHex,
  cerebrAgentAbi,
  checkRecord,
  explainInputs,
  type AgentConfig,
  type ReplayCheck,
} from '../../../sdk/src/neuro/agent.ts'

export { AGENT_PINS, AGENT_THETA, FALLBACK_NAMES, Verdict, agentInputHex, checkRecord, explainInputs, type AgentConfig, type ReplayCheck }

/** ICerebrAgent.Record as viem decodes it. */
export type AgentRecord = {
  caller: Address
  blockNumber: number
  timestamp: number
  inputs: number
  outputs: number
  seq: number
  prevGoBlock: number
  basefee: bigint
  ema: bigint
  verdict: number
  reason: number
  viaBrainWallet: boolean
}

/** ICerebrAgent.Observation. */
export type Observation = {
  blockNumber: bigint
  timestamp: bigint
  basefee: bigint
  ema: bigint
  hourUtc: bigint
  blocksSinceGo: bigint
  inputs: number
  outputs: number
  verdict: number
  reason: number
  canAct: boolean
  nextActBlock: bigint
}

/** ICerebrAgent.Stats. */
export type AgentStats = { decisions: number; goCount: number; noGoCount: number; abstainCount: number; brainWalletCount: number; lastActBlock: number }

/** The agent's ring buffer size: decisions() returns at most this many records. */
export const RING = 64
/** blocksSinceGo when the agent never said Go (type(uint256).max). */
export const NEVER = (1n << 256n) - 1n
/** The keeper daemon's cadence (agent/, INTERVAL_SEC=600). */
export const KEEPER_INTERVAL_SEC = 600

/**
 * Live state: stats() and observeAt(latest baseFeePerGas). On X Layer an eth_call without a gas price
 * sees BASEFEE = 0, so observe() would report a basefee of 0: observeAt takes the real one.
 */
export async function readAgentLive(pc: PublicClient, agent: Address): Promise<{ obs: Observation; stats: AgentStats }> {
  const block = await pc.getBlock({ blockTag: 'latest' })
  const [obs, stats] = await Promise.all([
    pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'observeAt', args: [block.baseFeePerGas ?? 0n] }) as Promise<Observation>,
    pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'stats' }) as Promise<AgentStats>,
  ])
  return { obs, stats }
}

/** The immutable policy configuration. */
export const readAgentConfig = (pc: PublicClient, agent: Address) =>
  pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'config' }) as Promise<AgentConfig>

/** The ring buffer (the last 64 decisions), newest first. X Layer's RPC caps eth_getLogs at ~100 blocks, so history comes from here. */
export async function readDecisions(pc: PublicClient, agent: Address, n: number): Promise<AgentRecord[]> {
  if (n === 0) return []
  const from = Math.max(1, n - (RING - 1))
  const rs = (await pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'decisions', args: [BigInt(from), BigInt(RING)] })) as readonly AgentRecord[]
  return [...rs].filter((r) => r.seq > 0).reverse()
}

/** The recorded output byte as eval() returns it (1-byte bytes). */
export const outputHex = (outputs: number): Hex => agentInputHex(outputs)

export type ReplayResult = {
  /** circuits.eval(policy, inputs) as returned onchain. */
  ret: Hex
  /** ret equals the recorded output (undefined for an Abstain: the circuit's answer was not used). */
  evalOk?: boolean
  /** Offline: inputs re-derived from the record's observables + config, and the netlist re-simulated. */
  local: ReplayCheck
  pass: boolean
}

/** Replays one decision: an eval() eth_call of the policy circuit on the recorded input byte, plus checkRecord locally. */
export async function replayDecision(pc: PublicClient, circuits: Address, policy: bigint, r: AgentRecord, cfg: AgentConfig): Promise<ReplayResult> {
  const ret = (await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'eval', args: [policy, agentInputHex(r.inputs)] })) as Hex
  const evalOk = r.verdict === Verdict.Abstain ? undefined : ret.toLowerCase() === outputHex(r.outputs)
  const local = checkRecord(r, cfg)
  return { ret, evalOk, local, pass: evalOk !== false && local.inputsOk && local.outputOk }
}

/** "HH:MM" in UTC. */
export const utcTime = (ts: number | bigint) => new Date(Number(ts) * 1000).toISOString().slice(11, 16)
