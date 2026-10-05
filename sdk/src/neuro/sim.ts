// Reference simulator, a faithful port of TapeOut's client simulator (p5 prepare / m5 run in
// sdk/reference/tapeout-netlist-src.js), plus the LSB-first bit packing used by eval()/step().

import { decode, OP, type Element, type Netlist, type RefResolver, type RefTarget, encode } from './netlist.ts';

/** A circuit as stored on chain: netlist bytes plus pin counts. */
export interface CircuitSource {
  netlist: Uint8Array;
  nIn: number;
  nOut: number;
}

/** Resolves a REF (cpu, circuitId) to the referenced circuit (a prepared Program or its source). */
export type CircuitResolver = (cpu: string, circuitId: bigint) => Program | CircuitSource;

interface PreparedElement {
  el: Element;
  stateAt: number;
  sub?: Program;
}

export interface Program {
  nIn: number;
  nOut: number;
  nSignals: number;
  nState: number;
  elements: PreparedElement[];
  netlist: Uint8Array;
}

export interface RunResult {
  outputs: Uint8Array;
  newState: Uint8Array;
  signals: Uint8Array;
}

const noResolver: CircuitResolver = () => {
  throw new Error('circuit contains REF; a resolve(cpu, circuitId) function is required');
};

/** Decode and link a netlist. Mirrors TapeOut's p5(). */
export function prepare(netlist: Uint8Array, nIn: number, nOut: number, resolve: CircuitResolver = noResolver): Program {
  const decoded = decode(netlist, nIn);
  let nSignals = 2 + nIn;
  let nState = 0;
  const elements: PreparedElement[] = [];
  for (const el of decoded) {
    if (el.op === OP.LATCH) {
      elements.push({ el, stateAt: nState });
      nState += 1;
      nSignals += 1;
    } else if (el.op === OP.REF) {
      const t = el.target as RefTarget;
      const r = resolve(t.cpu, t.circuitId);
      const sub = 'elements' in r ? r : prepare(r.netlist, r.nIn, r.nOut, resolve);
      if (el.ins.length !== sub.nIn || el.nOut !== sub.nOut) {
        throw new Error(`sub-circuit #${t.circuitId} pin mismatch: netlist says ${el.ins.length} in / ${el.nOut} out, circuit has ${sub.nIn} in / ${sub.nOut} out`);
      }
      elements.push({ el, stateAt: nState, sub });
      nState += sub.nState;
      nSignals += el.nOut;
    } else {
      elements.push({ el, stateAt: -1 });
      nSignals += 1;
    }
  }
  return { nIn, nOut, nSignals, nState, elements, netlist };
}

/** One evaluation step. Empty `state` means all-zero state. Mirrors TapeOut's m5(). */
export function run(prog: Program, state: ArrayLike<number>, inputs: ArrayLike<number>): RunResult {
  const { nIn, nOut, elements, nSignals, nState } = prog;
  const d = new Uint8Array(nSignals);
  const st = state.length ? state : new Uint8Array(nState);
  const newState = new Uint8Array(nState);
  d[0] = 0;
  d[1] = 1;
  for (let i = 0; i < nIn; i++) d[2 + i] = inputs[i] ? 1 : 0;
  let p = 2 + nIn;
  for (const pe of elements) {
    const el = pe.el;
    if (el.op === OP.NAND) {
      d[p++] = d[el.a] & d[el.b] ? 0 : 1;
    } else if (el.op === OP.LATCH) {
      d[el.out] = st[pe.stateAt];
      p++;
    } else {
      const sub = pe.sub!;
      const subIn = el.ins.map((s) => d[s]);
      const subState = Array.prototype.slice.call(st, pe.stateAt, pe.stateAt + sub.nState) as number[];
      const r = run(sub, subState, subIn);
      newState.set(r.newState, pe.stateAt);
      for (let i = 0; i < el.nOut; i++) d[p++] = r.outputs[i];
    }
  }
  for (const pe of elements) if (pe.el.op === OP.LATCH) newState[pe.stateAt] = d[pe.el.d];
  const outputs = new Uint8Array(nOut);
  for (let i = 0; i < nOut; i++) outputs[i] = d[nSignals - nOut + i];
  return { outputs, newState, signals: d };
}

/** Convenience: prepare a builder Netlist (resolving placeholders) for simulation. */
export function programOf(netlist: Netlist, opts: { refs?: RefResolver; resolve?: CircuitResolver } = {}): Program {
  return prepare(encode(netlist, opts.refs), netlist.nIn, netlist.nOut, opts.resolve);
}

/** Evaluate a combinational circuit on unpacked bits (state starts at zero). */
export function evalBits(prog: Program, inputs: ArrayLike<number>): number[] {
  return Array.from(run(prog, [], inputs).outputs);
}

/** Run a sequential circuit over a sequence of input vectors, starting from zero state. */
export function runSequence(prog: Program, seq: ArrayLike<number>[], init: ArrayLike<number> = []): { outputs: number[][]; state: number[] } {
  let state: ArrayLike<number> = init.length ? init : new Uint8Array(prog.nState);
  const outputs: number[][] = [];
  for (const inp of seq) {
    const r = run(prog, state, inp);
    outputs.push(Array.from(r.outputs));
    state = r.newState;
  }
  return { outputs, state: Array.from(state) };
}

/** Same calling convention as the contract's eval(id, bytes): packed in, packed out. */
export function evalPacked(prog: Program, packedInputs: Uint8Array): Uint8Array {
  return packBits(run(prog, [], unpackBits(packedInputs, prog.nIn)).outputs);
}

/** Same convention as the contract's step(id, state, inputs). */
export function stepPacked(prog: Program, packedState: Uint8Array, packedInputs: Uint8Array): { newState: Uint8Array; outputs: Uint8Array } {
  const state = packedState.length ? unpackBits(packedState, prog.nState) : new Uint8Array(0);
  const r = run(prog, state, unpackBits(packedInputs, prog.nIn));
  return { newState: packBits(r.newState), outputs: packBits(r.outputs) };
}

/** Unpack n bits, LSB-first within each byte (bit i = byte[i>>3] >> (i&7) & 1). */
export function unpackBits(bytes: ArrayLike<number>, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = ((bytes[i >> 3] ?? 0) >> (i & 7)) & 1;
  return out;
}

/** Pack bits LSB-first within each byte. */
export function packBits(bits: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8) || 0);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

/** Integer <-> bit vector (LSB-first) helpers. */
export function bitsOf(value: number | bigint, n: number): number[] {
  const v = BigInt(value);
  return Array.from({ length: n }, (_, i) => Number((v >> BigInt(i)) & 1n));
}

export function valueOf(bits: ArrayLike<number>): number {
  let v = 0;
  for (let i = bits.length - 1; i >= 0; i--) v = v * 2 + (bits[i] ? 1 : 0);
  return v;
}

/** Exhaustive truth table of a combinational program: row k = inputs bitsOf(k). */
export function truthTable(prog: Program): number[][] {
  if (prog.nIn > 20) throw new RangeError('truth table too large');
  const rows: number[][] = [];
  for (let k = 0; k < 1 << prog.nIn; k++) rows.push(evalBits(prog, bitsOf(k, prog.nIn)));
  return rows;
}
