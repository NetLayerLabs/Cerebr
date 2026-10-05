// Binarized neurons compiled to NAND netlists.
//
//   y = [ Σ_i w_i·x_i ≥ θ ]     x_i ∈ {0,1}, w_i ∈ ℤ (usually {-1,0,+1}), θ ∈ ℤ
//
// Two compilation strategies, picked per neuron by gate count ('auto'):
//  - 'bdd'  : the threshold function's decision diagram, one MUX per (input, partial-sum) node,
//             with constant folding collapsing the monotone branches (AND/OR chains);
//  - 'count': negative weights become complemented literals (w·x = |w|·(1-x) - |w|), literals are
//             summed by a carry-save popcount and compared against the shifted threshold.
// Both are also tried on the complementary neuron (y = NOT [Σ -w_i·x_i ≥ 1-θ]).
//
// Networks compose neurons either INLINE (one flattened netlist) or by REF to neuron circuits that
// were already taped out; for REF the neuron is canonicalised (zero weights dropped, weights sorted
// descending) so e.g. every 3-input AND-neuron in a layer shares one taped-out circuit.

import { Logic } from './logic.ts';
import { NetlistBuilder, type BuildOptions, type Netlist, type RefSpec, type Signal } from './netlist.ts';

export interface NeuronSpec {
  weights: number[];
  theta: number;
  name?: string;
}

export type ThresholdStrategy = 'auto' | 'bdd' | 'count';

function checkSpec(spec: NeuronSpec, nIn?: number) {
  if (!spec.weights.every(Number.isInteger) || !Number.isInteger(spec.theta)) throw new Error('neuron weights and theta must be integers');
  if (nIn !== undefined && spec.weights.length !== nIn) throw new Error(`neuron has ${spec.weights.length} weights for ${nIn} inputs`);
}

/** Reference model. */
export function evalNeuron(spec: NeuronSpec, x: ArrayLike<number>): number {
  let s = 0;
  spec.weights.forEach((w, i) => { if (x[i]) s += w; });
  return s >= spec.theta ? 1 : 0;
}

export function evalLayer(specs: NeuronSpec[], x: ArrayLike<number>): number[] {
  return specs.map((s) => evalNeuron(s, x));
}

export function evalNetwork(layers: NeuronSpec[][], x: ArrayLike<number>): number[] {
  let v = Array.from(x);
  for (const l of layers) v = evalLayer(l, v);
  return v;
}

type Strategy = (c: Logic, xs: Signal[], ws: number[], theta: number) => Signal;

const bdd: Strategy = (c, xs, ws, theta) => {
  const n = xs.length;
  // range of the sum of inputs i..n-1
  const lo = new Array<number>(n + 1).fill(0), hi = new Array<number>(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    lo[i] = lo[i + 1] + Math.min(0, ws[i]);
    hi[i] = hi[i + 1] + Math.max(0, ws[i]);
  }
  const memo = new Map<string, Signal>();
  const f = (i: number, need: number): Signal => {
    if (lo[i] >= need) return 1;
    if (hi[i] < need) return 0;
    const key = `${i}:${need}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const s = c.mux(xs[i], f(i + 1, need), f(i + 1, need - ws[i]));
    memo.set(key, s);
    return s;
  };
  return f(0, theta);
};

const count: Strategy = (c, xs, ws, theta) => {
  const lits: Signal[] = [];
  let t = theta;
  xs.forEach((x, i) => {
    const w = ws[i];
    const lit = w > 0 ? x : c.not(x);
    if (w < 0) t += -w;
    for (let k = 0; k < Math.abs(w); k++) lits.push(lit);
  });
  if (t <= 0) return 1;
  if (t > lits.length) return 0;
  return c.geConst(c.popcount(lits), t);
};

const dual = (s: Strategy): Strategy => (c, xs, ws, theta) => c.not(s(c, xs, ws.map((w) => -w), 1 - theta));

const STRATEGIES: Record<Exclude<ThresholdStrategy, 'auto'>, Strategy[]> = {
  bdd: [bdd, dual(bdd)],
  count: [count, dual(count)],
};

function cost(s: Strategy, ws: number[], theta: number): number {
  const c = new Logic(ws.length);
  const out = s(c, c.inputs(), ws, theta);
  return c.b.liveElements([out]).length;
}

/** Emit [Σ w_i·x_i ≥ θ] into an existing circuit. */
export function threshold(c: Logic, xs: Signal[], weights: number[], theta: number, strategy: ThresholdStrategy = 'auto'): Signal {
  const keep = weights.map((w, i) => i).filter((i) => weights[i] !== 0);
  const ws = keep.map((i) => weights[i]);
  const ins = keep.map((i) => xs[i]);
  const pool = strategy === 'auto' ? [...STRATEGIES.bdd, ...STRATEGIES.count] : STRATEGIES[strategy];
  let best = pool[0];
  if (pool.length > 1 && ws.length > 0) {
    let bestCost = Infinity;
    for (const s of pool) {
      const k = cost(s, ws, theta);
      if (k < bestCost) { bestCost = k; best = s; }
    }
  }
  return best(c, ins, ws, theta);
}

export function neuron(c: Logic, xs: Signal[], spec: NeuronSpec, strategy: ThresholdStrategy = 'auto'): Signal {
  checkSpec(spec, xs.length);
  return threshold(c, xs, spec.weights, spec.theta, strategy);
}

export function layer(c: Logic, xs: Signal[], specs: NeuronSpec[], strategy: ThresholdStrategy = 'auto'): Signal[] {
  return specs.map((s) => neuron(c, xs, s, strategy));
}

/** Inline (flattened) network: each layer reads the previous layer's outputs. */
export function network(c: Logic, xs: Signal[], layers: NeuronSpec[][], strategy: ThresholdStrategy = 'auto'): Signal[] {
  let v = xs;
  for (const l of layers) v = layer(c, v, l, strategy);
  return v;
}

/** Compile one neuron as a stand-alone circuit (nIn = weights.length, 1 output). */
export function compileNeuron(spec: NeuronSpec, opts: BuildOptions & { strategy?: ThresholdStrategy } = {}): Netlist {
  checkSpec(spec);
  const c = new Logic(spec.weights.length);
  const y = neuron(c, c.inputs(), spec, opts.strategy);
  return c.b.build([y], opts);
}

/** Compile a whole network inline. */
export function compileNetwork(nIn: number, layers: NeuronSpec[][], opts: BuildOptions & { strategy?: ThresholdStrategy } = {}): Netlist {
  const c = new Logic(nIn);
  return c.b.build(network(c, c.inputs(), layers, opts.strategy), opts);
}

// ------------------------------------------------------------------ REF composition

export interface CanonicalNeuron {
  /** Non-zero weights, sorted descending. */
  spec: NeuronSpec;
  /** inputs[k] = index (in the original neuron) feeding canonical input k. */
  inputs: number[];
  key: string;
  /** Set when the neuron needs no circuit: a constant, x, or NOT x. */
  trivial?: { kind: 'const'; value: 0 | 1 } | { kind: 'wire' | 'not'; input: number };
}

export function canonicalNeuron(spec: NeuronSpec): CanonicalNeuron {
  checkSpec(spec);
  const order = spec.weights.map((w, i) => i).filter((i) => spec.weights[i] !== 0);
  order.sort((i, j) => spec.weights[j] - spec.weights[i] || i - j);
  const weights = order.map((i) => spec.weights[i]);
  const canon: NeuronSpec = { weights, theta: spec.theta };
  const key = neuronKey(canon);
  const lo = weights.reduce((a, w) => a + Math.min(0, w), 0);
  const hi = weights.reduce((a, w) => a + Math.max(0, w), 0);
  let trivial: CanonicalNeuron['trivial'];
  if (lo >= spec.theta) trivial = { kind: 'const', value: 1 };
  else if (hi < spec.theta) trivial = { kind: 'const', value: 0 };
  else if (weights.length === 1) trivial = { kind: weights[0] > 0 ? 'wire' : 'not', input: order[0] };
  return { spec: canon, inputs: order, key, trivial };
}

/** Stable name of a neuron, e.g. "neuron(+1,+1,-1>=1)". */
export function neuronKey(spec: NeuronSpec): string {
  return `neuron(${spec.weights.map((w) => (w > 0 ? `+${w}` : `${w}`)).join(',')}>=${spec.theta})`;
}

/** Where a canonical neuron lives on chain; default: a placeholder named by its key. */
export type NeuronTarget = (canon: CanonicalNeuron) => RefSpec;

export const placeholderTarget: NeuronTarget = (canon) => ({ placeholder: canon.key });

export function refNeuron(b: NetlistBuilder, xs: Signal[], spec: NeuronSpec, target: NeuronTarget = placeholderTarget): Signal {
  checkSpec(spec, xs.length);
  const canon = canonicalNeuron(spec);
  const t = canon.trivial;
  if (t?.kind === 'const') return t.value;
  if (t?.kind === 'wire') return xs[t.input];
  if (t?.kind === 'not') return b.nand(xs[t.input], xs[t.input]);
  return b.ref(target(canon), canon.inputs.map((i) => xs[i]), 1)[0];
}

export interface RefNetwork {
  outputs: Signal[];
  /** Neuron circuits that must be taped out first, by placeholder key (canonical specs). */
  deps: Map<string, NeuronSpec>;
}

/** Network whose neurons are REFs to taped-out neuron circuits. */
export function refNetwork(b: NetlistBuilder, xs: Signal[], layers: NeuronSpec[][], target: NeuronTarget = placeholderTarget): RefNetwork {
  const deps = new Map<string, NeuronSpec>();
  const track: NeuronTarget = (canon) => {
    deps.set(canon.key, canon.spec);
    return target(canon);
  };
  let v = xs;
  for (const l of layers) v = l.map((s) => refNeuron(b, v, s, track));
  return { outputs: v, deps };
}
