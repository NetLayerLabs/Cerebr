// Compiles the configured catalog circuits, checks them against their reference models, and turns
// "what is still left to do" into an ordered plan with an exact fee total and a gas estimate.

import type { Address, Hex } from 'viem';
import {
  catalogResolver,
  encodeHex,
  getCircuit,
  OP,
  prepare,
  verifyCircuit,
  type NeuralCircuit,
  type Netlist,
  type OutputMode,
  type Program,
  type RefTarget,
} from '../../src/neuro/index.ts';
import { GAS, hexToBytes, scanNetlist, type TapeoutFees } from '../../src/tapeout/index.ts';
import type { LaunchConfig } from './config.ts';
import type { LaunchState } from './state.ts';

/** createCPU with Cerebr's ~400-byte story measured 987k gas on the fork (SDK GAS.createCpu assumes a short story). */
const CREATE_CPU_GAS = 1_000_000n;

export interface CompiledCircuit {
  entry: { id: string; flagship?: boolean };
  circuit: NeuralCircuit;
  netlist: Netlist;
  nand: number;
  latch: number;
  ref: number;
  /** Encoded bytes; undefined until every REF dependency has a real circuit id. */
  hex?: Hex;
  /** Simulator program with REFs linked to the deployed (or local) dependencies. */
  program?: Program;
}

/** Flattened gate count as the contract reports it (NAND + LATCH, through every REF). */
export function flatGateCount(prog: Program): number {
  let n = 0;
  for (const pe of prog.elements) n += pe.el.op === OP.REF ? flatGateCount(pe.sub!) : 1;
  return n;
}

export function deployedTargets(state: LaunchState): Record<string, RefTarget> {
  const out: Record<string, RefTarget> = {};
  if (!state.cpu) return out;
  for (const [id, rec] of Object.entries(state.circuits)) out[id] = { cpu: state.cpu.circuits, circuitId: BigInt(rec.circuitId) };
  return out;
}

/**
 * Compiles every configured circuit. Circuits whose REF dependencies are all deployed are also
 * encoded with the real (circuits address, circuit id) and linked into a simulator program.
 */
export function compile(cfg: LaunchConfig, deployed: Record<string, RefTarget>): CompiledCircuit[] {
  const mode: OutputMode = cfg.outputMode;
  const { resolve } = catalogResolver({ mode, deployed });
  return cfg.circuits.map((entry) => {
    const circuit = getCircuit(entry.id);
    const netlist = circuit.build({ mode });
    const out: CompiledCircuit = { entry, circuit, netlist, nand: netlist.counts.nand, latch: netlist.counts.latch, ref: netlist.counts.ref };
    if (circuit.deps.every((d) => deployed[d])) {
      out.hex = encodeHex(netlist, (p) => deployed[p]);
      out.program = prepare(hexToBytes(out.hex), netlist.nIn, netlist.nOut, resolve);
      scanNetlist(out.hex, netlist.nIn, netlist.nOut); // the offline subset of tapeout()'s rules
    }
    return out;
  });
}

/** Exhaustive simulator-vs-reference check of every configured circuit (local, before spending). */
export function verifyLocally(cfg: LaunchConfig): { id: string; cases: number }[] {
  return cfg.circuits.map(({ id }) => {
    const v = verifyCircuit(getCircuit(id), { mode: cfg.outputMode });
    if (!v.ok) throw new Error(`${id}: compiled netlist disagrees with its reference model (${v.failures.length}/${v.cases} cases)`);
    return { id, cases: v.cases };
  });
}

/**
 * launch/config.json `keep` is minted once per token: it is added to the first mint of NAND (resp.
 * LATCH) only. Once the state records a mint of that token, keep no longer applies, so spending the
 * kept transistors never makes a re-run mint them again.
 */
export function effectiveKeep(keep: { nand: bigint; latch: bigint }, mints: readonly { id: 'NAND' | 'LATCH' }[]): { nand: bigint; latch: bigint } {
  return {
    nand: mints.some((m) => m.id === 'NAND') ? 0n : keep.nand,
    latch: mints.some((m) => m.id === 'LATCH') ? 0n : keep.latch,
  };
}

export interface PlanStep {
  kind: 'createCPU' | 'mint' | 'tapeout' | 'open' | 'withdraw';
  label: string;
  /** msg.value in wei. */
  value: bigint;
  gas: bigint;
}

export interface Plan {
  steps: PlanStep[];
  needNand: bigint;
  needLatch: bigint;
  mintNand: bigint;
  mintLatch: bigint;
  /** Sum of msg.value (exact, from live fees). */
  fees: bigint;
  gas: bigint;
  gasPrice: bigint;
  /** fees + gas * gasPrice. */
  gross: bigint;
  /** Mint revenue the creator (= deployer) pulls back with withdraw(). */
  refund: bigint;
  net: bigint;
}

export function buildPlan(p: {
  cfg: LaunchConfig;
  state: LaunchState;
  compiled: CompiledCircuit[];
  fees: TapeoutFees;
  mintPrice: bigint;
  balances: { nand: bigint; latch: bigint };
  openedAlready: Set<string>;
  skipOpen: boolean;
  owed: bigint;
  gasPrice: bigint;
}): Plan {
  const steps: PlanStep[] = [];
  const todo = p.compiled.filter((c) => !p.state.circuits[c.entry.id]);
  if (!p.state.cpu) steps.push({ kind: 'createCPU', label: `createCPU("${p.cfg.cpu.name}", "${p.cfg.cpu.symbol}", supply ${p.cfg.issuance.transistorSupply}, price ${p.cfg.issuance.mintPriceOkb} OKB)`, value: p.fees.deployFee, gas: CREATE_CPU_GAS });

  const needNand = todo.reduce((s, c) => s + BigInt(c.nand), 0n);
  const needLatch = todo.reduce((s, c) => s + BigInt(c.latch), 0n);
  // Tapeouts burn needNand/needLatch; cfg.keep stays in the deployer's wallet afterwards. keep is
  // minted once per token (effectiveKeep), never topped up again after it was spent.
  const keep = effectiveKeep(p.cfg.keep, p.state.mints);
  const wantNand = needNand + keep.nand;
  const wantLatch = needLatch + keep.latch;
  const mintNand = wantNand > p.balances.nand ? wantNand - p.balances.nand : 0n;
  const mintLatch = wantLatch > p.balances.latch ? wantLatch - p.balances.latch : 0n;
  const firstMint = p.state.mints.length === 0;
  if (mintNand > 0n) steps.push({ kind: 'mint', label: `mint ${mintNand} NAND`, value: mintNand * p.mintPrice + p.fees.protocolFee, gas: firstMint ? GAS.mintFirst : GAS.mint });
  if (mintLatch > 0n) steps.push({ kind: 'mint', label: `mint ${mintLatch} LATCH`, value: mintLatch * p.mintPrice + p.fees.protocolFee, gas: GAS.mint });

  for (const c of todo) {
    const gas = GAS.tapeoutBase + GAS.tapeoutPerGate * BigInt(c.nand + c.latch) + GAS.tapeoutPerRef * BigInt(c.ref);
    const what = c.ref > 0 ? `${c.nand} NAND + ${c.ref} REF -> ${c.circuit.deps.join(', ')}` : `${c.nand} NAND${c.latch ? ` + ${c.latch} LATCH` : ''}`;
    steps.push({ kind: 'tapeout', label: `tapeout ${c.entry.id} (${what})`, value: p.fees.tapeoutFee, gas });
  }

  if (!p.skipOpen) {
    for (const id of p.cfg.openAccounts) {
      if (!p.openedAlready.has(id)) steps.push({ kind: 'open', label: `open native account of ${id}`, value: p.fees.openFee, gas: GAS.open });
    }
  }

  const mintRevenue = (mintNand + mintLatch) * p.mintPrice;
  const refund = p.cfg.withdrawCreatorRevenue ? p.owed + mintRevenue : 0n;
  if (refund > 0n) steps.push({ kind: 'withdraw', label: `withdraw creator mint revenue (${fmt(refund)} OKB back)`, value: 0n, gas: 60_000n });

  const fees = steps.reduce((s, x) => s + x.value, 0n);
  const gas = steps.reduce((s, x) => s + x.gas, 0n);
  const gross = fees + gas * p.gasPrice;
  return { steps, needNand, needLatch, mintNand, mintLatch, fees, gas, gasPrice: p.gasPrice, gross, refund, net: gross - refund };
}

/** OKB with up to 8 decimals, trailing zeros trimmed. */
export function fmt(wei: bigint): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

export function printPlan(plan: Plan, circuits: Address | undefined, keep: { nand: bigint; latch: bigint }) {
  console.log('\nPlan' + (circuits ? ` (processor ${circuits})` : ''));
  if (plan.steps.length === 0) console.log('  nothing to do: every step is already on chain');
  plan.steps.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s.label.padEnd(64)} value ${fmt(s.value).padStart(10)} OKB   gas ~${s.gas}`));
  console.log(`\n  transistors burned by remaining tapeouts: ${plan.needNand} NAND, ${plan.needLatch} LATCH`);
  if (keep.nand > 0n || keep.latch > 0n) console.log(`  transistors kept in your wallet:          ${keep.nand} NAND, ${keep.latch} LATCH (keep, minted once per token)`);
  console.log(`  protocol + mint value (exact):  ${fmt(plan.fees)} OKB`);
  console.log(`  gas (estimate, ${plan.gas} gas @ ${Number(plan.gasPrice) / 1e9} gwei): ${fmt(plan.gas * plan.gasPrice)} OKB`);
  console.log(`  gross:                          ${fmt(plan.gross)} OKB`);
  console.log(`  creator revenue returned:      -${fmt(plan.refund)} OKB  (withdraw(); you are the creator)`);
  console.log(`  net cost:                       ${fmt(plan.net)} OKB`);
}
