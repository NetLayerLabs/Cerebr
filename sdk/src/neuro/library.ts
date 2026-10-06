// The Cerebr catalog of neural circuits: each compiles to a TapeOut netlist, carries a reference
// model for exhaustive verification, and (for the REF variants) names the neuron circuits it
// reuses. Placeholders in REF variants are catalog ids: tape out the dependency first, then encode
// with refs = { [depId]: { cpu, circuitId } }.

import { Logic } from './logic.ts';
import { encode, NetlistBuilder, type BuildOptions, type Netlist, type RefTarget } from './netlist.ts';
import { canonicalNeuron, evalNetwork, evalNeuron, network, neuron, refNetwork, type NeuronSpec, type NeuronTarget } from './neuron.ts';
import { bitsOf, prepare, run, truthTable, type CircuitResolver, type Program } from './sim.ts';

export interface NeuralCircuit {
  id: string;
  name: string;
  description: string;
  /** Short narrative for the gallery / tape-out story field. */
  story: string;
  inputs: string[];
  outputs: string[];
  kind: 'combinational' | 'sequential';
  /** Catalog ids referenced by REF (must be taped out first). */
  deps: string[];
  /** The neuron layers, when the circuit is a pure threshold network. */
  layers?: NeuronSpec[][];
  /** State bit labels (LATCH order) for sequential circuits. */
  state?: string[];
  build(opts?: BuildOptions): Netlist;
  /** Reference behaviour (combinational). */
  reference?: (x: number[]) => number[];
  /** Reference behaviour (sequential). */
  referenceStep?: (state: number[], x: number[]) => { state: number[]; outputs: number[] };
}

const N = (weights: number[], theta: number, name?: string): NeuronSpec => ({ weights, theta, name });

function neuronCircuit(meta: Omit<NeuralCircuit, 'kind' | 'deps' | 'build' | 'reference' | 'layers'>, spec: NeuronSpec): NeuralCircuit {
  return {
    ...meta,
    kind: 'combinational',
    deps: [],
    layers: [[spec]],
    build: (opts) => {
      const c = new Logic(spec.weights.length);
      return c.b.build([neuron(c, c.inputs(), spec)], opts);
    },
    reference: (x) => [evalNeuron(spec, x)],
  };
}

function networkCircuit(meta: Omit<NeuralCircuit, 'kind' | 'deps' | 'build' | 'reference' | 'layers'>, nIn: number, layers: NeuronSpec[][]): NeuralCircuit {
  return {
    ...meta,
    kind: 'combinational',
    deps: [],
    layers,
    build: (opts) => {
      const c = new Logic(nIn);
      return c.b.build(network(c, c.inputs(), layers), opts);
    },
    reference: (x) => evalNetwork(layers, x),
  };
}

/** REF variant of a network: every neuron is a REF to a catalog neuron circuit. */
function refNetworkCircuit(meta: Omit<NeuralCircuit, 'kind' | 'deps' | 'build' | 'reference' | 'layers'>, nIn: number, layers: NeuronSpec[][]): NeuralCircuit {
  const target: NeuronTarget = (canon) => {
    const id = neuronCatalogId(canon.key);
    if (!id) throw new Error(`no catalog neuron circuit for ${canon.key}`);
    return { placeholder: id };
  };
  const deps = new Set<string>();
  for (const l of layers) for (const s of l) {
    const canon = canonicalNeuron(s);
    if (!canon.trivial) deps.add((target(canon) as { placeholder: string }).placeholder);
  }
  return {
    ...meta,
    kind: 'combinational',
    deps: [...deps],
    layers,
    build: (opts) => {
      const b = new NetlistBuilder(nIn);
      return b.build(refNetwork(b, b.inputs(), layers, target).outputs, opts);
    },
    reference: (x) => evalNetwork(layers, x),
  };
}

// --------------------------------------------------------------------- neurons

const AND2 = N([1, 1], 2, 'AND');
const OR2 = N([1, 1], 1, 'OR');
const NAND2 = N([-1, -1], -1, 'NAND');
const LINE3 = N([1, 1, 1], 3, 'line');
const ANY3 = N([1, 1, 1], 1, 'any');

export const andNeuron = neuronCircuit({
  id: 'and-neuron',
  name: 'AND Neuron',
  description: 'Two excitatory synapses (w=+1,+1), threshold 2: fires only when both inputs spike.',
  story: 'A coincidence detector - the neuron that only believes two witnesses at once.',
  inputs: ['x0', 'x1'],
  outputs: ['y'],
}, AND2);

export const orNeuron = neuronCircuit({
  id: 'or-neuron',
  name: 'OR Neuron',
  description: 'Two excitatory synapses (w=+1,+1), threshold 1: fires when either input spikes.',
  story: 'The most forgiving neuron: one signal is enough to wake it.',
  inputs: ['x0', 'x1'],
  outputs: ['y'],
}, OR2);

export const nandNeuron = neuronCircuit({
  id: 'nand-neuron',
  name: 'Inhibitory Neuron (NAND)',
  description: 'Two inhibitory synapses (w=-1,-1), threshold -1: silent only when both inputs spike.',
  story: 'Built from the very gate the processor mints - one NAND, one neuron.',
  inputs: ['x0', 'x1'],
  outputs: ['y'],
}, NAND2);

export const majority3 = neuronCircuit({
  id: 'majority-3',
  name: 'Majority-3',
  description: 'Three excitatory synapses, threshold 2: the vote of three inputs (6 NAND, a full adder carry).',
  story: 'Three voters, one decision. The smallest committee that can outvote a single faulty wire.',
  inputs: ['x0', 'x1', 'x2'],
  outputs: ['y'],
}, N([1, 1, 1], 2, 'MAJ3'));

export const majority5 = neuronCircuit({
  id: 'majority-5',
  name: 'Majority-5',
  description: 'Five excitatory synapses, threshold 3: majority vote of five inputs.',
  story: 'A five-member council on a chip; ties are impossible by construction.',
  inputs: ['x0', 'x1', 'x2', 'x3', 'x4'],
  outputs: ['y'],
}, N([1, 1, 1, 1, 1], 3, 'MAJ5'));

/** Build a catalog entry for any binarized threshold neuron. */
export function thresholdNeuronCircuit(weights: number[], theta: number, meta: Partial<Pick<NeuralCircuit, 'id' | 'name' | 'description' | 'story' | 'inputs'>> = {}): NeuralCircuit {
  const terms = weights.map((w, i) => `${w >= 0 ? '+' : ''}${w}·x${i}`).join(' ');
  return neuronCircuit({
    id: meta.id ?? canonicalNeuron({ weights, theta }).key,
    name: meta.name ?? 'Threshold Neuron',
    description: meta.description ?? `y = [ ${terms} ≥ ${theta} ]`,
    story: meta.story ?? 'A binarized neuron with integer synapses, compiled to NAND gates.',
    inputs: meta.inputs ?? weights.map((_, i) => `x${i}`),
    outputs: ['y'],
  }, N(weights, theta));
}

export const decisionNeuron = thresholdNeuronCircuit([1, 1, 1, -1, -1], 2, {
  id: 'threshold-neuron',
  name: 'Go/No-Go Neuron',
  description: 'Three excitatory (+1) and two inhibitory (-1) synapses, threshold 2: y = [e0+e1+e2 − i0 − i1 ≥ 2].',
  story: 'Excitation argues for, inhibition argues against; the neuron fires when the case is strong enough.',
  inputs: ['e0', 'e1', 'e2', 'i0', 'i1'],
});

export const lineCell = neuronCircuit({
  id: 'line-cell',
  name: 'Line Cell',
  description: 'Three excitatory synapses, threshold 3: fires when all three pixels of a stroke are lit.',
  story: 'A receptive field three pixels long - the first stage of the line detector.',
  inputs: ['p0', 'p1', 'p2'],
  outputs: ['y'],
}, LINE3);

export const anyOf3 = neuronCircuit({
  id: 'any-of-3',
  name: 'Any-of-3 Neuron',
  description: 'Three excitatory synapses, threshold 1: pools three feature detectors.',
  story: 'The pooling neuron: it does not care which detector fired, only that one did.',
  inputs: ['h0', 'h1', 'h2'],
  outputs: ['y'],
}, ANY3);

const NEURON_CIRCUITS = [andNeuron, orNeuron, nandNeuron, majority3, majority5, decisionNeuron, lineCell, anyOf3];

function neuronCatalogId(key: string): string | undefined {
  for (const c of NEURON_CIRCUITS) {
    const l = c.layers?.[0]?.[0];
    if (l && canonicalNeuron(l).key === key) return c.id;
  }
  return undefined;
}

// --------------------------------------------------------------------- networks

/** XOR: no single threshold neuron can compute it; one hidden layer can. */
const XOR_LAYERS: NeuronSpec[][] = [[OR2, NAND2], [AND2]];

const xorMeta = {
  name: 'The XOR Problem',
  description: 'Two-layer network: hidden OR-neuron and NAND-neuron, output AND-neuron. y = x0 XOR x1.',
  story: 'Minsky & Papert showed a single perceptron cannot learn XOR. Two layers can - here, in NAND gates, on chain.',
  inputs: ['x0', 'x1'],
  outputs: ['y'],
};

export const xorNet = networkCircuit({ id: 'xor-net', ...xorMeta }, 2, XOR_LAYERS);

export const xorNetRef = refNetworkCircuit({
  id: 'xor-net-ref',
  ...xorMeta,
  name: 'The XOR Problem (REF-composed)',
  description: 'The same 2-layer XOR network wired from the taped-out OR, NAND and AND neuron circuits by REF.',
}, 2, XOR_LAYERS);

/** 3x3 image, row-major: bit r*3+c is pixel (row r, column c). */
const PIXELS = Array.from({ length: 9 }, (_, i) => `r${Math.floor(i / 3)}c${i % 3}`);
const mask = (idx: number[]) => Array.from({ length: 9 }, (_, i) => (idx.includes(i) ? 1 : 0));
const LINE_HIDDEN: NeuronSpec[] = [
  N(mask([0, 1, 2]), 3, 'row0'), N(mask([3, 4, 5]), 3, 'row1'), N(mask([6, 7, 8]), 3, 'row2'),
  N(mask([0, 3, 6]), 3, 'col0'), N(mask([1, 4, 7]), 3, 'col1'), N(mask([2, 5, 8]), 3, 'col2'),
  N(mask([0, 4, 8]), 3, 'diag'), N(mask([2, 4, 6]), 3, 'anti'),
];
const pool = (idx: number[], name: string) => N(Array.from({ length: 8 }, (_, i) => (idx.includes(i) ? 1 : 0)), 1, name);
const LINE_LAYERS: NeuronSpec[][] = [LINE_HIDDEN, [pool([0, 1, 2], 'horizontal'), pool([3, 4, 5], 'vertical'), pool([6, 7], 'diagonal')]];

const lineMeta = {
  name: 'Line Detector',
  description: '3×3 binarized network: 8 line cells (3 rows, 3 columns, 2 diagonals; w=+1 on the stroke, θ=3) pooled by any-of neurons (θ=1). Outputs are multi-hot [horizontal, vertical, diagonal]; all zero means no line.',
  story: 'A miniature visual cortex: simple cells tuned to orientation, complex cells pooling them - 512 images, every answer on chain.',
  inputs: PIXELS,
  outputs: ['horizontal', 'vertical', 'diagonal'],
};

export const lineDetector = networkCircuit({ id: 'line-detector', ...lineMeta }, 9, LINE_LAYERS);

export const lineDetectorRef = refNetworkCircuit({
  id: 'line-detector-ref',
  ...lineMeta,
  name: 'Line Detector (REF-composed)',
  description: 'The line detector wired from one taped-out Line Cell (reused 8×), pooled by Any-of-3 (2×) and OR (1×) neurons, all by REF.',
}, 9, LINE_LAYERS);

export const adder2 = ((): NeuralCircuit => ({
  id: 'adder-2bit',
  name: '2-bit Adder',
  description: 'a + b for two 2-bit numbers (LSB-first): half adder + full adder, 3-bit sum.',
  story: 'Arithmetic is where neurons come from: a threshold neuron is a weighted sum and a compare.',
  inputs: ['a0', 'a1', 'b0', 'b1'],
  outputs: ['s0', 's1', 's2'],
  kind: 'combinational',
  deps: [],
  build: (opts) => {
    const c = new Logic(4);
    const [a0, a1, b0, b1] = c.inputs();
    return c.b.build(c.add([a0, a1], [b0, b1]).slice(0, 3), opts);
  },
  reference: (x) => bitsOf(x[0] + 2 * x[1] + x[2] + 2 * x[3], 3),
}))();

/**
 * Integrate-and-fire neuron with a 2-bit membrane potential P held in two LATCHes.
 * Each step: if `inhibit`, P := 0 and no spike. Otherwise P + spike reaching 3 fires and resets
 * P to 0; else P := P + spike. It fires on every third input spike.
 */
function spikingStep(state: number[], x: number[]) {
  const [p0, p1] = state;
  const [spike, inhibit] = x;
  const fire = spike & (inhibit ^ 1) & p1;
  const keep = (inhibit | fire) ^ 1;
  return { state: [keep & (p0 ^ spike), keep & (p1 | (p0 & spike))], outputs: [fire] };
}

export const spikingNeuron: NeuralCircuit = {
  id: 'spiking-neuron',
  name: 'Integrate-and-Fire Neuron',
  description: 'Sequential neuron with a 2-bit membrane potential in two LATCHes: integrates input spikes, fires on the third and resets; `inhibit` clears it. Run with step().',
  story: 'The neuron remembers. Its potential lives in latches between calls - a heartbeat of state on chain.',
  inputs: ['spike', 'inhibit'],
  outputs: ['fire'],
  state: ['p0', 'p1'],
  kind: 'sequential',
  deps: [],
  build: (opts) => {
    const c = new Logic(2);
    const [spike, inhibit] = c.inputs();
    const l0 = c.b.allocLatch();
    const l1 = c.b.allocLatch();
    const p0 = l0.q, p1 = l1.q;
    const fire = c.and(c.and(spike, c.not(inhibit)), p1);
    const keep = c.nor(inhibit, fire);
    l0.setD(c.and(keep, c.xor(p0, spike)));
    l1.setD(c.and(keep, c.or(p1, c.and(p0, spike))));
    return c.b.build([fire], opts);
  },
  referenceStep: spikingStep,
};

export const CATALOG: NeuralCircuit[] = [
  andNeuron, orNeuron, nandNeuron, majority3, majority5, decisionNeuron, lineCell, anyOf3,
  xorNet, xorNetRef, lineDetector, lineDetectorRef, adder2, spikingNeuron,
];

export function getCircuit(id: string): NeuralCircuit {
  const c = CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`unknown circuit ${id}`);
  return c;
}

// --------------------------------------------------------------------- simulation & verification

/** Fake address used to simulate REF composition before anything is taped out. */
export const LOCAL_CPU = '0x00000000000000000000000000000000000ce8b4';

/**
 * Resolve catalog circuits for simulation: each catalog id gets a local id (index + 1) on
 * LOCAL_CPU, or the real on-chain location if given in `deployed`.
 */
export function catalogResolver(opts: BuildOptions & { deployed?: Record<string, RefTarget> } = {}): {
  refs: (placeholder: string) => RefTarget;
  resolve: CircuitResolver;
} {
  const where = (id: string): RefTarget => opts.deployed?.[id] ?? { cpu: LOCAL_CPU, circuitId: BigInt(CATALOG.indexOf(getCircuit(id)) + 1) };
  const cache = new Map<string, Program>();
  const resolve: CircuitResolver = (cpu, circuitId) => {
    const entry = CATALOG.find((c) => {
      const w = where(c.id);
      return w.cpu.toLowerCase() === cpu.toLowerCase() && w.circuitId === circuitId;
    });
    if (!entry) throw new Error(`unknown REF ${cpu}#${circuitId}`);
    let p = cache.get(entry.id);
    if (!p) {
      const nl = entry.build(opts);
      p = prepare(encode(nl, where), nl.nIn, nl.nOut, resolve);
      cache.set(entry.id, p);
    }
    return p;
  };
  return { refs: where, resolve };
}

/** Compile a catalog circuit to a simulatable program (REFs resolved to local catalog copies). */
export function programFor(circuit: NeuralCircuit, opts: BuildOptions = {}): Program {
  const nl = circuit.build(opts);
  const { refs, resolve } = catalogResolver(opts);
  return prepare(encode(nl, refs), nl.nIn, nl.nOut, resolve);
}

export interface Verification {
  ok: boolean;
  cases: number;
  failures: { inputs: number[]; state?: number[]; got: number[]; want: number[] }[];
}

/** Exhaustively compare the compiled circuit with its reference model. */
export function verifyCircuit(circuit: NeuralCircuit, opts: BuildOptions = {}): Verification {
  const prog = programFor(circuit, opts);
  const failures: Verification['failures'] = [];
  let cases = 0;
  const nIn = circuit.inputs.length;
  if (prog.nIn !== nIn || prog.nOut !== circuit.outputs.length) throw new Error(`${circuit.id}: pin labels do not match netlist`);
  if (circuit.kind === 'combinational') {
    truthTable(prog).forEach((got, k) => {
      cases++;
      const x = bitsOf(k, nIn);
      const want = circuit.reference!(x);
      if (got.some((v, i) => v !== want[i])) failures.push({ inputs: x, got, want });
    });
  } else {
    for (let s = 0; s < 1 << prog.nState; s++) {
      const state = bitsOf(s, prog.nState);
      for (let k = 0; k < 1 << nIn; k++) {
        cases++;
        const x = bitsOf(k, nIn);
        const r = run(prog, state, x);
        const want = circuit.referenceStep!(state, x);
        const got = [...r.outputs, ...r.newState];
        const exp = [...want.outputs, ...want.state];
        if (got.some((v, i) => v !== exp[i])) failures.push({ inputs: x, state, got, want: exp });
      }
    }
  }
  return { ok: failures.length === 0, cases, failures };
}

export interface CatalogRow {
  id: string;
  name: string;
  nIn: number;
  nOut: number;
  nand: number;
  latch: number;
  ref: number;
  deps: string[];
}

export function catalogSummary(opts: BuildOptions = {}): CatalogRow[] {
  return CATALOG.map((c) => {
    const nl = c.build(opts);
    return { id: c.id, name: c.name, nIn: nl.nIn, nOut: nl.nOut, nand: nl.counts.nand, latch: nl.counts.latch, ref: nl.counts.ref, deps: c.deps };
  });
}
