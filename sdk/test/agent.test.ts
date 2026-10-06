import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_PINS, DEFAULT_AGENT_CONFIG, agentCostPerDay, agentInputHex, cerebrAgentAbi, checkRecord, deriveAgentInputs,
  explainInputs, goNoGoCircuit, goNoGoReference, nextEma, Verdict, type AgentRecord,
} from '../src/neuro/agent.ts';
import { decisionNeuron } from '../src/neuro/library.ts';
import { encodeHex } from '../src/neuro/netlist.ts';

const DAY0 = 1_790_035_200n; // UTC midnight
const FLAT = 20_000_000n;

test('agent: compiled neuron == reference on all 32 inputs, and matches mainnet #8 samples', () => {
  for (let x = 0; x < 32; x++) assert.equal(goNoGoCircuit(x), goNoGoReference(x), `x=${x}`);
  // eval(8, x) on X Layer mainnet (read 2026-10-06)
  const onchain: [number, number][] = [[0, 0], [3, 1], [7, 1], [15, 1], [23, 1], [31, 0]];
  for (const [x, y] of onchain) assert.equal(goNoGoCircuit(x), y);
});

test('agent: the simulated netlist is the one taped out as circuit #8', () => {
  const state = JSON.parse(readFileSync(new URL('../../launch/state.196.json', import.meta.url), 'utf8'));
  const entry = state.circuits['threshold-neuron'] as { circuitId: string; netlist: string };
  assert.equal(entry.circuitId, '8');
  assert.equal(encodeHex(decisionNeuron.build({ mode: 'direct' })), entry.netlist);
});

test('agent: pin order and weights', () => {
  assert.deepEqual(AGENT_PINS.map((p) => p.pin), ['e0', 'e1', 'e2', 'i0', 'i1']);
  assert.deepEqual(AGENT_PINS.map((p) => p.weight), [1, 1, 1, -1, -1]);
  assert.deepEqual(decisionNeuron.inputs, ['e0', 'e1', 'e2', 'i0', 'i1']);
  const e = explainInputs(0b10011);
  assert.equal(e.calm, true);
  assert.equal(e.active, true);
  assert.equal(e.rested, false);
  assert.equal(e.refractory, true);
  assert.equal(e.sum, 1);
  assert.equal(agentInputHex(7), '0x07');
});

test('agent: deriveAgentInputs mirrors the contract (same cases as CerebrAgent.t.sol)', () => {
  const bn = 2_000_000n;
  const ts = DAY0 + 14n * 3600n;
  const d = (basefee: bigint, ema: bigint, timestamp: bigint, prevGoBlock: bigint) =>
    deriveAgentInputs({ basefee, ema, timestamp, blockNumber: bn, prevGoBlock });
  assert.equal(d(FLAT, FLAT, ts, 0n), 0x07);
  assert.equal(d(50_000_000n, 50_000_000n, ts, 0n) & 1, 1);
  assert.equal(d(50_000_001n, 50_000_001n, ts, 0n) & 1, 0);
  assert.equal(d(FLAT, FLAT, DAY0 + 12n * 3600n, 0n) & 2, 0);
  assert.equal(d(FLAT, FLAT, DAY0 + 13n * 3600n, 0n) & 2, 2);
  assert.equal(d(FLAT, FLAT, DAY0 + 21n * 3600n, 0n) & 2, 0);
  assert.equal(d(FLAT, FLAT, ts, bn - 43_200n) & 4, 4);
  assert.equal(d(FLAT, FLAT, ts, bn - 43_199n) & 4, 0);
  assert.equal(d(30_000_000n, FLAT, ts, 0n) & 8, 0);
  assert.equal(d(30_000_001n, FLAT, ts, 0n) & 8, 8);
  assert.equal(d(FLAT, FLAT, ts, bn - 3_599n) & 16, 16);
  assert.equal(d(FLAT, FLAT, ts, bn - 3_600n) & 16, 0);
  assert.equal(d(FLAT, FLAT, ts, bn + 1n) & 20, 4);
  const wrap = { ...DEFAULT_AGENT_CONFIG, windowStartHour: 22, windowEndHour: 3 };
  assert.equal(deriveAgentInputs({ basefee: FLAT, ema: FLAT, timestamp: DAY0 + 23n * 3600n, blockNumber: 1n, prevGoBlock: 0n }, wrap) & 2, 2);
  assert.equal(deriveAgentInputs({ basefee: FLAT, ema: FLAT, timestamp: DAY0 + 3n * 3600n, blockNumber: 1n, prevGoBlock: 0n }, wrap) & 2, 0);
});

test('agent: checkRecord verifies and catches tampering', () => {
  const r: AgentRecord = {
    caller: '0x0000000000000000000000000000000000000001', blockNumber: 1_000_000, timestamp: Number(DAY0 + 14n * 3600n),
    inputs: 7, outputs: 1, seq: 1, prevGoBlock: 0, basefee: FLAT, ema: FLAT, verdict: Verdict.Go, reason: 0, viaBrainWallet: false,
  };
  assert.deepEqual(checkRecord(r), { inputsOk: true, outputOk: true, expectedInputs: 7, expectedOutput: 1 });
  assert.equal(checkRecord({ ...r, outputs: 0, verdict: Verdict.NoGo }).outputOk, false);
  assert.equal(checkRecord({ ...r, basefee: 60_000_000n }).inputsOk, false);
  assert.equal(checkRecord({ ...r, outputs: 0, verdict: Verdict.Abstain, reason: 1 }).outputOk, true);
});

test('agent: EMA converges exactly in both directions', () => {
  let e = FLAT;
  for (let i = 0; i < 250; i++) e = nextEma(e, 100_000_000n);
  assert.equal(e, 100_000_000n);
  for (let i = 0; i < 250; i++) e = nextEma(e, 1n);
  assert.equal(e, 1n);
  assert.equal(nextEma(FLAT, 28_000_000n), 21_000_000n);
  assert.equal(nextEma(21_000_000n, 1_000_000n), 18_500_000n);
});

test('agent: cost math and ABI surface', () => {
  const c = agentCostPerDay(100_000n, 20_000_000n, 600);
  assert.equal(c.actsPerDay, 144);
  assert.equal(c.perAct, 2_000_000_000_000n);
  assert.equal(c.perDay, 288_000_000_000_000n);
  const names = cerebrAgentAbi.filter((x) => x.type === 'function').map((x) => (x as { name: string }).name);
  for (const n of ['act', 'observe', 'observeAt', 'latestDecision', 'decisions', 'stats', 'config', 'replay', 'brainWallet', 'deriveInputs']) {
    assert.ok(names.includes(n), n);
  }
  assert.ok(cerebrAgentAbi.some((x) => x.type === 'event' && x.name === 'Decision'));
  assert.ok(cerebrAgentAbi.some((x) => x.type === 'error' && x.name === 'TooSoon'));
});
