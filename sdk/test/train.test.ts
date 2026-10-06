import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitsOf, compileNeuron, evalNeuron, programOf, run, type NeuronSpec } from '../src/neuro/index.ts';
import {
  TRAINING_PRESETS, accuracyOf, bitsToGrid, compileTrained, getPreset, gridToBits, isLinearlySeparable, neuronGateCount,
  predict, separability, trainNetwork, trainNeuron, type Example,
} from '../src/neuro/train.ts';

const truthTable = (n: number, f: (x: number[]) => number): Example[] =>
  Array.from({ length: 2 ** n }, (_, k) => {
    const x = bitsOf(k, n);
    return { x, y: (f(x) ? 1 : 0) as 0 | 1 };
  });

const neuronTable = (spec: NeuronSpec) => truthTable(spec.weights.length, (x) => evalNeuron(spec, x));

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Runs fn and asserts it finished within ms. */
function timed<T>(ms: number, label: string, fn: () => T): T {
  const t0 = performance.now();
  const r = fn();
  const dt = performance.now() - t0;
  assert.ok(dt < ms, `${label} took ${dt.toFixed(0)} ms (limit ${ms})`);
  return r;
}

const l1 = (w: number[]) => w.reduce((a, v) => a + Math.abs(v), 0);

test('learns AND / OR / NAND / majority exactly, with minimal weights', () => {
  const cases: [string, NeuronSpec][] = [
    ['AND2', { weights: [1, 1], theta: 2 }],
    ['OR2', { weights: [1, 1], theta: 1 }],
    ['NAND2', { weights: [-1, -1], theta: -1 }],
    ['AND3', { weights: [1, 1, 1], theta: 3 }],
    ['OR4', { weights: [1, 1, 1, 1], theta: 1 }],
    ['MAJ3', { weights: [1, 1, 1], theta: 2 }],
    ['MAJ5', { weights: [1, 1, 1, 1, 1], theta: 3 }],
    ['go/no-go', { weights: [1, 1, 1, -1, -1], theta: 2 }],
  ];
  for (const [name, spec] of cases) {
    const r = timed(1000, name, () => trainNeuron(neuronTable(spec)));
    assert.equal(r.method, 'exact', name);
    assert.ok(r.converged && r.exhaustive, name);
    assert.equal(r.accuracy, 1, name);
    // full truth table: the learned neuron is the same Boolean function
    for (let k = 0; k < 2 ** spec.weights.length; k++) {
      const x = bitsOf(k, spec.weights.length);
      assert.equal(evalNeuron(r, x), evalNeuron(spec, x), `${name} @ ${x}`);
    }
    assert.ok(l1(r.weights) <= l1(spec.weights), `${name}: Σ|w| ${l1(r.weights)} > ${l1(spec.weights)}`);
  }
  // a constant label needs no synapses at all
  const always = trainNeuron(truthTable(3, () => 1));
  assert.deepEqual(always.weights, [0, 0, 0]);
  assert.equal(always.accuracy, 1);
});

test('random ternary threshold functions are recovered exactly (n = 4..7)', () => {
  const r = lcg(42);
  timed(1000, 'random ternary', () => {
    for (let t = 0; t < 30; t++) {
      const n = 4 + (t % 4);
      const weights = Array.from({ length: n }, () => Math.floor(r() * 3) - 1);
      const theta = Math.floor(r() * 5) - 2;
      const spec = { weights, theta };
      const data = neuronTable(spec);
      const nr = trainNeuron(data);
      assert.ok(nr.converged && nr.exhaustive, JSON.stringify(spec));
      assert.ok(l1(nr.weights) <= l1(weights), JSON.stringify({ spec, got: nr.weights }));
      assert.ok(isLinearlySeparable(data));
    }
  });
});

test('maxWeight: x0 AND (x1 OR x2) needs a weight of 2', () => {
  const data = truthTable(3, (x) => x[0] & (x[1] | x[2]));
  const s1 = separability(data);
  assert.equal(s1.separable, false);
  assert.equal(s1.proven, true);
  const nr = trainNeuron(data, { maxWeight: 2 });
  assert.ok(nr.converged);
  assert.deepEqual(nr.weights, [2, 1, 1]);
  assert.equal(nr.theta, 3);
  assert.throws(() => trainNeuron(data, { maxWeight: 0 }), /maxWeight/);
  assert.throws(() => trainNeuron(data, { maxWeight: 65 }), /maxWeight/);
});

test('XOR: proven not separable (even with |w| <= 4), learned by 2 layers', () => {
  const xor = truthTable(2, (x) => x[0] ^ x[1]);
  for (const maxWeight of [1, 2, 4]) {
    const s = separability(xor, { maxWeight });
    assert.equal(s.separable, false);
    assert.equal(s.proven, true);
    assert.equal(s.neuron.accuracy, 0.75); // the best single neuron gets 3 of 4
  }
  const net = trainNetwork(xor);
  assert.equal(net.separable, false);
  assert.equal(net.layers.length, 2);
  assert.equal(net.hidden, 2);
  assert.ok(net.converged);
  for (const e of xor) assert.equal(predict(net, e.x), e.y);
  const c = compileTrained(net, { mode: 'direct' });
  assert.ok(c.verification.ok && c.verification.exhaustive);
  assert.ok(c.gates <= 6, `xor gates ${c.gates}`); // as small as the catalog's hand-built xor-net
});

test('parity-3 and XNOR are learned with a hidden layer', () => {
  for (const [name, data] of [
    ['parity3', truthTable(3, (x) => x[0] ^ x[1] ^ x[2])],
    ['xnor', truthTable(2, (x) => 1 - (x[0] ^ x[1]))],
  ] as const) {
    const net = timed(1000, name, () => trainNetwork(data));
    assert.equal(net.separable, false, name);
    assert.equal(net.layers.length, 2, name);
    assert.ok(net.converged, name);
    assert.ok(net.hidden <= 4, `${name}: ${net.hidden} hidden`);
    assert.equal(accuracyOf(net, data), 1, name);
    assert.ok(compileTrained(net).verification.ok, name);
  }
});

test('trainNetwork returns a single neuron when one suffices', () => {
  const net = trainNetwork(truthTable(3, (x) => +(x[0] + x[1] + x[2] >= 2)));
  assert.equal(net.structure, 'single');
  assert.equal(net.layers.length, 1);
  assert.equal(net.hidden, 0);
  assert.deepEqual(net.layers[0][0].weights, [1, 1, 1]);
  assert.equal(net.layers[0][0].theta, 2);
});

test('presets: 100% train accuracy in both modes, expected architecture, compiled netlist verified', () => {
  for (const p of TRAINING_PRESETS) {
    for (const prefer of ['gates', 'robust'] as const) {
      const label = `${p.id}/${prefer}`;
      const net = timed(1000, label, () => trainNetwork(p.examples, { prefer }));
      assert.equal(net.prefer, prefer, label);
      assert.equal(net.accuracy, 1, label);
      assert.equal(net.structure === 'single' ? 'neuron' : 'network', p.expect, label);
      assert.equal(net.nIn, p.inputs.length, label);
      assert.ok(net.margin >= 1, label);
      if (p.grid) assert.equal(p.grid.rows * p.grid.cols, p.inputs.length, label);
      const c = timed(1000, `${label} compile`, () => compileTrained(net, { mode: 'direct' }));
      assert.ok(c.verification.ok, `${label}: ${JSON.stringify(c.verification.failures.slice(0, 3))}`);
      assert.equal(c.verification.cases, 2 ** p.inputs.length, label);
      assert.ok(c.gates <= 150, `${label}: ${c.gates} gates`);
      // compiled circuit classifies the training examples correctly too
      const prog = programOf(c.netlist);
      for (const e of p.examples) assert.equal(run(prog, [], e.x).outputs[0], e.y, label);
    }
  }
  assert.equal(getPreset('xor').expect, 'network');
  assert.throws(() => getPreset('nope'), /unknown/);
});

test('presets: held-out drawings are novel and robust mode classifies them (>= 90%)', () => {
  const withHeldOut = TRAINING_PRESETS.filter((p) => p.heldOut.length > 0);
  assert.ok(withHeldOut.length >= 5);
  for (const p of TRAINING_PRESETS) {
    if (p.grid) assert.ok(p.heldOut.length >= 8, `${p.id}: pixel presets need a held-out set`);
    const seen = new Set(p.examples.map((e) => e.x.join('')));
    for (const e of p.heldOut) {
      assert.equal(e.x.length, p.inputs.length, p.id);
      assert.ok(!seen.has(e.x.join('')), `${p.id}: held-out drawing ${e.x.join('')} is in the training set`);
    }
    assert.ok(p.heldOut.some((e) => e.y === 1) === p.heldOut.some((e) => e.y === 0), `${p.id}: held-out needs both labels`);
  }
  let gatesWorse = 0;
  for (const p of withHeldOut) {
    const robust = trainNetwork(p.examples, { prefer: 'robust' });
    const acc = accuracyOf(robust, p.heldOut);
    assert.ok(acc >= 0.9, `${p.id}: robust held-out accuracy ${acc}`);
    // the compiled circuit (what goes on chain) agrees with the model on the held-out drawings
    const prog = programOf(compileTrained(robust).netlist);
    for (const e of p.heldOut) assert.equal(run(prog, [], e.x).outputs[0], predict(robust, e.x), p.id);
    const cheap = trainNetwork(p.examples, { prefer: 'gates' });
    if (accuracyOf(cheap, p.heldOut) < acc) gatesWorse++;
  }
  assert.ok(gatesWorse >= 3, `robust should beat the gate-minimal model on several presets (${gatesWorse})`);
});

test('robust vs gates: robust never has a smaller margin, gates never more gates', () => {
  for (const p of TRAINING_PRESETS) {
    const g = trainNetwork(p.examples, { prefer: 'gates' });
    const r = trainNetwork(p.examples, { prefer: 'robust' });
    if (g.structure === 'single' && r.structure === 'single') {
      assert.ok(r.margin >= g.margin, `${p.id}: margin ${r.margin} < ${g.margin}`);
      assert.ok(compileTrained(g).gates <= compileTrained(r).gates, `${p.id}: gates mode is not cheaper`);
    }
  }
  // the textbook answers
  const lr = trainNeuron(getPreset('left-vs-right').examples, { prefer: 'robust' });
  assert.deepEqual(lr.weights, [1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1]);
  assert.equal(lr.margin, 4);
  const hv = trainNetwork(getPreset('horizontal-vs-vertical').examples, { prefer: 'robust' });
  assert.equal(hv.structure, 'or');
  assert.deepEqual(hv.layers[0].map((s) => s.weights.slice(0, 9).map((w, i) => (w > 0 ? Math.floor(i / 3) : -1)).filter((r) => r >= 0)),
    [[0, 0, 0], [1, 1, 1], [2, 2, 2]]); // one row detector per row
});

test('robust mode: exact on small n, still learns logic functions, deterministic', () => {
  for (const spec of [{ weights: [1, 1], theta: 2 }, { weights: [1, 1, 1], theta: 2 }, { weights: [1, 1, 1, -1, -1], theta: 2 }]) {
    const data = neuronTable(spec);
    const r = trainNeuron(data, { prefer: 'robust' });
    assert.equal(r.method, 'exact');
    assert.ok(r.exhaustive && r.converged);
    assert.equal(r.prefer, 'robust');
    for (const e of data) assert.equal(evalNeuron(r, e.x), e.y);
  }
  // non-separable stays proven non-separable, 2 layers still learn it
  const xor = truthTable(2, (x) => x[0] ^ x[1]);
  const s = separability(xor, { prefer: 'robust' });
  assert.equal(s.separable, false);
  assert.equal(s.proven, true);
  assert.ok(trainNetwork(xor, { prefer: 'robust' }).converged);
  // large n: local search, bounded, deterministic
  const r = lcg(3);
  const n = 12;
  const target = { weights: Array.from({ length: n }, () => Math.floor(r() * 3) - 1), theta: 1 };
  const data: Example[] = Array.from({ length: 200 }, () => {
    const x = Array.from({ length: n }, () => (r() < 0.5 ? 1 : 0));
    return { x, y: evalNeuron(target, x) as 0 | 1 };
  });
  const a = timed(1000, 'robust n=12', () => trainNeuron(data, { prefer: 'robust' }));
  assert.equal(a.method, 'local-search');
  assert.ok(a.converged);
  assert.deepEqual(a, trainNeuron(data, { prefer: 'robust' }));
  assert.throws(() => trainNeuron(data, { prefer: 'fast' as 'gates' }), /prefer/);
});

test('compiled netlist == model on every input (neurons and networks, both output modes)', () => {
  const r = lcg(7);
  timed(1000, 'compile verify', () => {
    for (let t = 0; t < 12; t++) {
      const n = 3 + (t % 5);
      // random labels: mostly not separable, so this exercises 2-layer networks too
      const data = truthTable(n, () => (r() < 0.5 ? 1 : 0));
      const model = t % 3 === 0 ? trainNeuron(data) : trainNetwork(data);
      for (const mode of ['direct', 'buffered'] as const) {
        const c = compileTrained(model, { mode });
        assert.ok(c.verification.ok && c.verification.exhaustive, `t=${t} ${mode}`);
        assert.equal(c.verification.cases, 2 ** n);
      }
      if (model.kind === 'network') assert.ok(model.converged, `random table t=${t} must be learnable by 2 layers`);
    }
  });
});

test('gate counts are what the compiler reports', () => {
  const nr = trainNeuron(neuronTable({ weights: [1, 1, 1], theta: 2 }));
  const c = compileTrained(nr, { mode: 'direct' });
  assert.equal(c.gates, compileNeuron({ weights: [1, 1, 1], theta: 2 }, { mode: 'direct' }).counts.nand);
  assert.equal(c.gates, 6); // the catalog's majority-3
  assert.equal(neuronGateCount([1, 0, 1, 0, 1], 2), 6);
  assert.deepEqual(c.neuronGates, [[6]]);
  assert.equal(compileTrained(nr).gates, 8); // buffered: +2 per output
});

test('deterministic: same seed, same result; perceptron path converges on separable data', () => {
  const r = lcg(3);
  const n = 12;
  const target = { weights: Array.from({ length: n }, () => Math.floor(r() * 3) - 1), theta: 1 };
  const data: Example[] = Array.from({ length: 200 }, () => {
    const x = Array.from({ length: n }, () => (r() < 0.5 ? 1 : 0));
    return { x, y: evalNeuron(target, x) as 0 | 1 };
  });
  const a = timed(1000, 'perceptron', () => trainNeuron(data, { method: 'perceptron', seed: 5 }));
  const b = trainNeuron(data, { method: 'perceptron', seed: 5 });
  assert.deepEqual(a, b);
  assert.equal(a.method, 'perceptron');
  assert.ok(a.converged, `perceptron accuracy ${a.accuracy}`);
  assert.ok(a.history.length >= 1 && a.history.every((h, i) => h.epoch === i + 1));
  // auto picks the exact search when it fits, the perceptron when it does not; either way 100%
  const auto = timed(1000, 'auto', () => trainNeuron(data));
  assert.ok(auto.converged);
  assert.deepEqual(trainNetwork(data, { seed: 9 }), trainNetwork(data, { seed: 9 }));
});

test('exact search is budget-bounded on large inputs (n = 20)', () => {
  const r = lcg(11);
  const n = 20;
  const data: Example[] = Array.from({ length: 60 }, () => ({
    x: Array.from({ length: n }, () => (r() < 0.5 ? 1 : 0)),
    y: (r() < 0.5 ? 1 : 0) as 0 | 1,
  }));
  const net = timed(1000, 'n=20 network', () => trainNetwork(data));
  assert.ok(net.converged, 'any consistent dataset is learnable by OR-of-prototypes');
  assert.equal(net.separable, null); // undecided: the exact search ran out of budget
  const c = timed(1000, 'n=20 compile', () => compileTrained(net, { mode: 'direct', examples: data }));
  assert.equal(c.verification.exhaustive, false);
  assert.equal(c.verification.cases, data.length);
  assert.ok(c.verification.ok);
  assert.throws(() => compileTrained(net, { exhaustiveLimit: 16 }), /too large/);
  const robust = timed(1000, 'n=20 robust network', () => trainNetwork(data, { prefer: 'robust' }));
  assert.ok(robust.converged);
  assert.ok(compileTrained(robust, { examples: data }).verification.ok);
});

test('4x4 horizontal vs vertical lines: needs 2 layers, found via prototypes', () => {
  const row = (i: number) => Array.from({ length: 4 }, (_, r) => (r === i ? '####' : '....'));
  const col = (i: number) => Array.from({ length: 4 }, () => [0, 1, 2, 3].map((c) => (c === i ? '#' : '.')).join(''));
  const data: Example[] = [0, 1, 2, 3].flatMap((i) => [{ x: gridToBits(row(i)), y: 1 as const }, { x: gridToBits(col(i)), y: 0 as const }]);
  const net = timed(1000, 'hv4', () => trainNetwork(data));
  assert.ok(net.converged);
  assert.equal(net.layers.length, 2);
  assert.ok(net.hidden <= 4);
  assert.ok(timed(1000, 'hv4 compile', () => compileTrained(net, { mode: 'direct' })).verification.ok);
});

test('contradictory labels: best effort, no crash', () => {
  const data: Example[] = [{ x: [1, 0], y: 1 }, { x: [1, 0], y: 0 }, { x: [0, 1], y: 1 }, { x: [0, 0], y: 0 }];
  const nr = trainNeuron(data);
  assert.equal(nr.accuracy, 0.75);
  assert.equal(nr.converged, false);
  const net = trainNetwork(data);
  assert.equal(net.accuracy, 0.75);
});

test('input validation', () => {
  assert.throws(() => trainNeuron([]), /at least one/);
  assert.throws(() => trainNeuron([{ x: [1, 0], y: 1 }, { x: [1], y: 0 }]), /inputs/);
  assert.throws(() => trainNeuron([{ x: [2, 0], y: 1 }]), /0\/1/);
  assert.throws(() => trainNeuron([{ x: [1, 0], y: 2 as 0 }]), /label/);
});

test('pixel helpers', () => {
  assert.deepEqual(gridToBits(['#.', '.#']), [1, 0, 0, 1]);
  assert.deepEqual(gridToBits([[1, 0], [false, true]]), [1, 0, 0, 1]);
  assert.deepEqual(gridToBits(['X 1', '*0.']), [1, 0, 1, 1, 0, 0]);
  assert.deepEqual(bitsToGrid([1, 0, 0, 1, 1, 1], 3), [[1, 0, 0], [1, 1, 1]]);
  assert.deepEqual(gridToBits(bitsToGrid([0, 1, 1, 0, 1, 0, 0, 0, 1], 3)), [0, 1, 1, 0, 1, 0, 0, 0, 1]);
  assert.throws(() => gridToBits(['##', '#']), /same width/);
  assert.throws(() => bitsToGrid([1, 0, 1], 2), /cannot split/);
});
