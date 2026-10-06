// Cerebr Agent (src/agent/CerebrAgent.sol): an autonomous onchain agent whose brain is the taped-out
// Go/No-Go Neuron (Cerebr circuit #8). This module is viem-free: the ABI as a const, the input mapping,
// a local mirror of the decision (the compiled neuron netlist, simulated), replay checks and cost math.
// The daemon (agent/) and the app import it by path: `sdk/src/neuro/agent.ts`. See AGENT.md.

import { decisionNeuron, programFor } from './library.ts';
import { evalBits } from './sim.ts';

/** Cerebr processor circuits contract on X Layer and the policy circuit the agent uses by default. */
export const AGENT_DEFAULTS = {
  circuits: '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF',
  opener: '0x536add8f30f03b69f6fbf29d425a816a0dc50106',
  policyCircuitId: 8n,
} as const;

/** The five input pins, in eval() bit order (bit i of the 1-byte input, LSB-first). */
export const AGENT_PINS = [
  { bit: 0, pin: 'e0', key: 'calm', weight: +1, label: 'CALM', rule: 'basefee <= calmMaxBasefee' },
  { bit: 1, pin: 'e1', key: 'active', weight: +1, label: 'ACTIVE', rule: 'UTC hour in [windowStartHour, windowEndHour)' },
  { bit: 2, pin: 'e2', key: 'rested', weight: +1, label: 'RESTED', rule: 'no Go yet, or last Go >= restBlocks ago' },
  { bit: 3, pin: 'i0', key: 'spike', weight: -1, label: 'SPIKE', rule: 'basefee * 10000 > ema * spikeBps' },
  { bit: 4, pin: 'i1', key: 'refractory', weight: -1, label: 'REFRACTORY', rule: 'last Go < refractoryBlocks ago' },
] as const;

export const AGENT_THETA = 2;

export type PinKey = (typeof AGENT_PINS)[number]['key'];

/** Mirrors ICerebrAgent.Verdict. */
export const Verdict = { NoGo: 0, Go: 1, Abstain: 2 } as const;
export const VERDICT_NAMES = ['No-Go', 'Go', 'Abstain'] as const;
/** Mirrors ICerebrAgent.Fallback. */
export const FALLBACK_NAMES = ['None', 'CallFailed', 'BadReturn', 'BadOutput'] as const;

export interface AgentConfig {
  calmMaxBasefee: bigint;
  spikeBps: number;
  windowStartHour: number;
  windowEndHour: number;
  restBlocks: number;
  refractoryBlocks: number;
  minIntervalBlocks: number;
}

/** The deployment defaults (script/DeployAgent.s.sol). */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  calmMaxBasefee: 50_000_000n,
  spikeBps: 15_000,
  windowStartHour: 13,
  windowEndHour: 21,
  restBlocks: 43_200,
  refractoryBlocks: 3_600,
  minIntervalBlocks: 300,
};

export interface AgentObservationInput {
  basefee: bigint;
  /** The EMA before this decision (Record.ema / Decision.ema). */
  ema: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  /** Last Go block before this decision; 0n = never (Record.prevGoBlock). */
  prevGoBlock: bigint;
}

const U64_MAX = (1n << 64n) - 1n;
const NEVER = (1n << 256n) - 1n;

export function hourOf(timestamp: bigint): number {
  return Number((timestamp / 3600n) % 24n);
}

export function inWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export function blocksSince(prevGoBlock: bigint, blockNumber: bigint): bigint {
  return prevGoBlock === 0n || prevGoBlock > blockNumber ? NEVER : blockNumber - prevGoBlock;
}

/** Exactly CerebrAgent.deriveInputs: the 1-byte eval input for an observation. */
export function deriveAgentInputs(o: AgentObservationInput, cfg: AgentConfig = DEFAULT_AGENT_CONFIG): number {
  const bf = o.basefee > U64_MAX ? U64_MAX : o.basefee;
  const since = blocksSince(o.prevGoBlock, o.blockNumber);
  let x = 0;
  if (bf <= cfg.calmMaxBasefee) x |= 1;
  if (inWindow(hourOf(o.timestamp), cfg.windowStartHour, cfg.windowEndHour)) x |= 2;
  if (since >= BigInt(cfg.restBlocks)) x |= 4;
  if (bf * 10_000n > o.ema * BigInt(cfg.spikeBps)) x |= 8;
  if (since < BigInt(cfg.refractoryBlocks)) x |= 16;
  return x;
}

/** The pins as named booleans. */
export function explainInputs(inputs: number): Record<PinKey, boolean> & { sum: number } {
  const out = { sum: 0 } as Record<PinKey, boolean> & { sum: number };
  for (const p of AGENT_PINS) {
    const on = ((inputs >> p.bit) & 1) === 1;
    out[p.key] = on;
    if (on) out.sum += p.weight;
  }
  return out;
}

/** The reference neuron: y = [e0 + e1 + e2 - i0 - i1 >= 2]. */
export function goNoGoReference(inputs: number): 0 | 1 {
  return explainInputs(inputs).sum >= AGENT_THETA ? 1 : 0;
}

let program: ReturnType<typeof programFor> | undefined;
/** Simulates the compiled NAND netlist of circuit #8 (the bytes taped out on mainnet). */
export function goNoGoCircuit(inputs: number): 0 | 1 {
  program ??= programFor(decisionNeuron, { mode: 'direct' });
  const bits = AGENT_PINS.map((p) => (inputs >> p.bit) & 1);
  return evalBits(program, bits)[0] === 1 ? 1 : 0;
}

/** The exact eval() input bytes (hex) for an input byte, for a replay through circuits.eval. */
export function agentInputHex(inputs: number): `0x${string}` {
  return `0x${(inputs & 0xff).toString(16).padStart(2, '0')}`;
}

export interface AgentRecord {
  caller: string;
  blockNumber: number | bigint;
  timestamp: number | bigint;
  inputs: number;
  outputs: number;
  seq: number | bigint;
  prevGoBlock: number | bigint;
  basefee: bigint;
  ema: bigint;
  verdict: number;
  reason: number;
  viaBrainWallet: boolean;
}

export interface ReplayCheck {
  /** The inputs recomputed from the record's observables and the config match the recorded inputs. */
  inputsOk: boolean;
  /** The local netlist simulation gives the recorded output (Go/No-Go only; an Abstain is skipped). */
  outputOk: boolean;
  expectedInputs: number;
  expectedOutput: 0 | 1;
}

/** Offline verification of a stored decision: re-derive the inputs, re-simulate the neuron. The onchain
 *  check is `circuits.eval(policyCircuitId, agentInputHex(r.inputs)) == r.outputs` (or agent.replay(seq)). */
export function checkRecord(r: AgentRecord, cfg: AgentConfig = DEFAULT_AGENT_CONFIG): ReplayCheck {
  const expectedInputs = deriveAgentInputs(
    { basefee: r.basefee, ema: r.ema, timestamp: BigInt(r.timestamp), blockNumber: BigInt(r.blockNumber), prevGoBlock: BigInt(r.prevGoBlock) },
    cfg,
  );
  const expectedOutput = goNoGoCircuit(r.inputs);
  const outputOk = r.verdict === Verdict.Abstain ? r.outputs === 0 : r.outputs === expectedOutput && r.verdict === expectedOutput;
  return { inputsOk: expectedInputs === r.inputs, outputOk, expectedInputs, expectedOutput };
}

/** EMA step of CerebrAgent (alpha 1/8, step rounded up so a flat basefee is reached exactly). */
export function nextEma(ema: bigint, basefee: bigint): bigint {
  if (basefee >= ema) return ema + (basefee - ema + 7n) / 8n;
  return ema - (ema - basefee + 7n) / 8n;
}

/** Cost of running the keeper: wei per day for `gasPerAct` at `gasPrice` every `intervalSec` seconds. */
export function agentCostPerDay(gasPerAct: bigint, gasPrice: bigint, intervalSec: number): { perAct: bigint; actsPerDay: number; perDay: bigint } {
  const actsPerDay = Math.floor(86_400 / intervalSec);
  const perAct = gasPerAct * gasPrice;
  return { perAct, actsPerDay, perDay: perAct * BigInt(actsPerDay) };
}

export const cerebrAgentAbi = [
  {"type":"function","name":"EMA_DIV","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"INFERENCE_GAS","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"MAX_GATES","inputs":[],"outputs":[{"name":"","type":"uint32"}],"stateMutability":"view"},
  {"type":"function","name":"N_IN","inputs":[],"outputs":[{"name":"","type":"uint32"}],"stateMutability":"view"},
  {"type":"function","name":"N_OUT","inputs":[],"outputs":[{"name":"","type":"uint32"}],"stateMutability":"view"},
  {"type":"function","name":"RING_SIZE","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"act","inputs":[],"outputs":[{"name":"seq","type":"uint256"},{"name":"verdict","type":"uint8","internalType":"enum ICerebrAgent.Verdict"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"brainWallet","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"circuits","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
  {"type":"function","name":"config","inputs":[],"outputs":[{"name":"","type":"tuple","internalType":"struct ICerebrAgent.Config","components":[{"name":"calmMaxBasefee","type":"uint64"},{"name":"spikeBps","type":"uint32"},{"name":"windowStartHour","type":"uint8"},{"name":"windowEndHour","type":"uint8"},{"name":"restBlocks","type":"uint32"},{"name":"refractoryBlocks","type":"uint32"},{"name":"minIntervalBlocks","type":"uint32"}]}],"stateMutability":"view"},
  {"type":"function","name":"decisions","inputs":[{"name":"fromSeq","type":"uint256"},{"name":"count","type":"uint256"}],"outputs":[{"name":"out","type":"tuple[]","internalType":"struct ICerebrAgent.Record[]","components":[{"name":"caller","type":"address"},{"name":"blockNumber","type":"uint40"},{"name":"timestamp","type":"uint40"},{"name":"inputs","type":"uint8"},{"name":"outputs","type":"uint8"},{"name":"seq","type":"uint40"},{"name":"prevGoBlock","type":"uint40"},{"name":"basefee","type":"uint64"},{"name":"ema","type":"uint64"},{"name":"verdict","type":"uint8","internalType":"enum ICerebrAgent.Verdict"},{"name":"reason","type":"uint8","internalType":"enum ICerebrAgent.Fallback"},{"name":"viaBrainWallet","type":"bool"}]}],"stateMutability":"view"},
  {"type":"function","name":"deriveInputs","inputs":[{"name":"basefee","type":"uint256"},{"name":"ema_","type":"uint256"},{"name":"timestamp","type":"uint256"},{"name":"blockNumber","type":"uint256"},{"name":"prevGoBlock","type":"uint256"}],"outputs":[{"name":"inputs","type":"uint8"}],"stateMutability":"view"},
  {"type":"function","name":"ema","inputs":[],"outputs":[{"name":"","type":"uint128"}],"stateMutability":"view"},
  {"type":"function","name":"hourOf","inputs":[{"name":"timestamp","type":"uint256"}],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"pure"},
  {"type":"function","name":"inputBytes","inputs":[{"name":"inputs","type":"uint8"}],"outputs":[{"name":"","type":"bytes"}],"stateMutability":"pure"},
  {"type":"function","name":"lastGoBlock","inputs":[],"outputs":[{"name":"","type":"uint40"}],"stateMutability":"view"},
  {"type":"function","name":"latestDecision","inputs":[],"outputs":[{"name":"r","type":"tuple","internalType":"struct ICerebrAgent.Record","components":[{"name":"caller","type":"address"},{"name":"blockNumber","type":"uint40"},{"name":"timestamp","type":"uint40"},{"name":"inputs","type":"uint8"},{"name":"outputs","type":"uint8"},{"name":"seq","type":"uint40"},{"name":"prevGoBlock","type":"uint40"},{"name":"basefee","type":"uint64"},{"name":"ema","type":"uint64"},{"name":"verdict","type":"uint8","internalType":"enum ICerebrAgent.Verdict"},{"name":"reason","type":"uint8","internalType":"enum ICerebrAgent.Fallback"},{"name":"viaBrainWallet","type":"bool"}]}],"stateMutability":"view"},
  {"type":"function","name":"observe","inputs":[],"outputs":[{"name":"","type":"tuple","internalType":"struct ICerebrAgent.Observation","components":[{"name":"blockNumber","type":"uint256"},{"name":"timestamp","type":"uint256"},{"name":"basefee","type":"uint256"},{"name":"ema","type":"uint256"},{"name":"hourUtc","type":"uint256"},{"name":"blocksSinceGo","type":"uint256"},{"name":"inputs","type":"uint8"},{"name":"outputs","type":"uint8"},{"name":"verdict","type":"uint8","internalType":"enum ICerebrAgent.Verdict"},{"name":"reason","type":"uint8","internalType":"enum ICerebrAgent.Fallback"},{"name":"canAct","type":"bool"},{"name":"nextActBlock","type":"uint256"}]}],"stateMutability":"view"},
  {"type":"function","name":"observeAt","inputs":[{"name":"basefee","type":"uint256"}],"outputs":[{"name":"","type":"tuple","internalType":"struct ICerebrAgent.Observation","components":[{"name":"blockNumber","type":"uint256"},{"name":"timestamp","type":"uint256"},{"name":"basefee","type":"uint256"},{"name":"ema","type":"uint256"},{"name":"hourUtc","type":"uint256"},{"name":"blocksSinceGo","type":"uint256"},{"name":"inputs","type":"uint8"},{"name":"outputs","type":"uint8"},{"name":"verdict","type":"uint8","internalType":"enum ICerebrAgent.Verdict"},{"name":"reason","type":"uint8","internalType":"enum ICerebrAgent.Fallback"},{"name":"canAct","type":"bool"},{"name":"nextActBlock","type":"uint256"}]}],"stateMutability":"view"},
  {"type":"function","name":"policyCircuitId","inputs":[],"outputs":[{"name":"","type":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"replay","inputs":[{"name":"seq","type":"uint256"}],"outputs":[{"name":"outputs","type":"uint8"},{"name":"matches","type":"bool"}],"stateMutability":"view"},
  {"type":"function","name":"stats","inputs":[],"outputs":[{"name":"","type":"tuple","internalType":"struct ICerebrAgent.Stats","components":[{"name":"decisions","type":"uint40"},{"name":"goCount","type":"uint40"},{"name":"noGoCount","type":"uint40"},{"name":"abstainCount","type":"uint40"},{"name":"brainWalletCount","type":"uint40"},{"name":"lastActBlock","type":"uint40"}]}],"stateMutability":"view"},
  {"type":"event","name":"Decision","inputs":[{"name":"seq","type":"uint256","indexed":true},{"name":"caller","type":"address","indexed":true},{"name":"verdict","type":"uint8","indexed":true,"internalType":"enum ICerebrAgent.Verdict"},{"name":"blockNumber","type":"uint256","indexed":false},{"name":"basefee","type":"uint256","indexed":false},{"name":"ema","type":"uint256","indexed":false},{"name":"blocksSinceGo","type":"uint256","indexed":false},{"name":"inputs","type":"uint8","indexed":false},{"name":"outputs","type":"uint8","indexed":false},{"name":"viaBrainWallet","type":"bool","indexed":false}],"anonymous":false},
  {"type":"event","name":"InferenceReceipt","inputs":[{"name":"seq","type":"uint256","indexed":true},{"name":"circuits","type":"address","indexed":true},{"name":"circuitId","type":"uint256","indexed":true},{"name":"inputs","type":"bytes","indexed":false},{"name":"outputs","type":"bytes","indexed":false},{"name":"gasUsed","type":"uint256","indexed":false},{"name":"fallbackReason","type":"uint8","indexed":false,"internalType":"enum ICerebrAgent.Fallback"}],"anonymous":false},
  {"type":"error","name":"BadCircuit","inputs":[]},
  {"type":"error","name":"BadConfig","inputs":[]},
  {"type":"error","name":"InsufficientGasForInference","inputs":[]},
  {"type":"error","name":"TooSoon","inputs":[{"name":"nextActBlock","type":"uint256"}]},
] as const;
