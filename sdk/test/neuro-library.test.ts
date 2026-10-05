import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG, getCircuit, verifyCircuit, programFor, catalogResolver, catalogSummary, LOCAL_CPU,
  Logic, NetlistBuilder, encode, prepare, run, runSequence, truthTable, bitsOf,
  canonicalNeuron, compileNeuron, compileNetwork, evalNetwork, evalNeuron, neuronKey, refNetwork, threshold, MAX_NEURON_WEIGHT,
  type NeuronSpec, type CircuitResolver, type Program,
} from '../src/neuro/index.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

for (const mode of ['buffered', 'direct'] as const) {
  test(`catalog (${mode}): every circuit is exhaustively correct`, () => {
    for (const c of CATALOG) {
      const v = verifyCircuit(c, { mode });
      assert.ok(v.ok, `${c.id}: ${JSON.stringify(v.failures.slice(0, 3))}`);
      assert.ok(v.cases >= 4, c.id);
    }
  });
}

test('catalog: gate budgets', () => {
  const direct = Object.fromEntries(catalogSummary({ mode: 'direct' }).map((r) => [r.id, r]));
  const buffered = Object.fromEntries(catalogSummary({ mode: 'buffered' }).map((r) => [r.id, r]));
  const expected: Record<string, number> = {
    'and-neuron': 2, 'or-neuron': 3, 'nand-neuron': 1, 'majority-3': 6, 'majority-5': 24, 'threshold-neuron': 19,
    'line-cell': 4, 'any-of-3': 6, 'xor-net': 6, 'xor-net-ref': 0, 'line-detector': 37, 'line-detector-ref': 0,
    'adder-2bit': 14, 'spiking-neuron': 17,
  };
  for (const c of CATALOG) {
    assert.equal(direct[c.id].nand, expected[c.id], `${c.id} direct`);
    assert.equal(buffered[c.id].nand, expected[c.id] + 2 * direct[c.id].nOut, `${c.id} buffered`);
    assert.ok(buffered[c.id].nand <= 150, c.id);
  }
  assert.equal(direct['xor-net-ref'].ref, 3);
  assert.equal(direct['line-detector-ref'].ref, 11);
  assert.equal(direct['spiking-neuron'].latch, 2);
  assert.deepEqual(getCircuit('line-detector-ref').deps.sort(), ['any-of-3', 'line-cell', 'or-neuron']);
  assert.deepEqual(getCircuit('xor-net-ref').deps.sort(), ['and-neuron', 'nand-neuron', 'or-neuron']);
});

test('catalog: ids unique, labels match pins, deps exist and are not REF circuits themselves', () => {
  assert.equal(new Set(CATALOG.map((c) => c.id)).size, CATALOG.length);
  for (const c of CATALOG) {
    const nl = c.build();
    assert.equal(nl.nIn, c.inputs.length, c.id);
    assert.equal(nl.nOut, c.outputs.length, c.id);
    assert.deepEqual([...nl.placeholders].sort(), [...c.deps].sort(), c.id);
    for (const d of c.deps) assert.equal(getCircuit(d).deps.length, 0);
  }
});

test('REF-composed networks simulate identically to their flattened twins', () => {
  for (const [flat, viaRef] of [['xor-net', 'xor-net-ref'], ['line-detector', 'line-detector-ref']]) {
    for (const mode of ['buffered', 'direct'] as const) {
      assert.deepEqual(truthTable(programFor(getCircuit(viaRef), { mode })), truthTable(programFor(getCircuit(flat), { mode })));
    }
  }
});

test('line detector: spot checks', () => {
  const p = programFor(getCircuit('line-detector'), { mode: 'direct' });
  const img = (rows: string[]) => rows.join('').split('').map((ch) => (ch === '#' ? 1 : 0));
  const ev = (rows: string[]) => Array.from(run(p, [], img(rows)).outputs);
  assert.deepEqual(ev(['...', '###', '...']), [1, 0, 0]);
  assert.deepEqual(ev(['.#.', '.#.', '.#.']), [0, 1, 0]);
  assert.deepEqual(ev(['#..', '.#.', '..#']), [0, 0, 1]);
  assert.deepEqual(ev(['..#', '.#.', '#..']), [0, 0, 1]);
  assert.deepEqual(ev(['#.#', '.#.', '#.#']), [0, 0, 1]);
  assert.deepEqual(ev(['##.', '.#.', '..#']), [0, 0, 1]);
  assert.deepEqual(ev(['##.', '#..', '...']), [0, 0, 0]);
  assert.deepEqual(ev(['###', '#..', '#..']), [1, 1, 0]);
});

test('spiking neuron fires on every third spike and is reset by inhibit', () => {
  const p = programFor(getCircuit('spiking-neuron'));
  const seq = [[1, 0], [1, 0], [1, 0], [0, 0], [1, 0], [1, 0], [0, 1], [1, 0], [1, 0], [1, 0]];
  const { outputs } = runSequence(p, seq);
  assert.deepEqual(outputs.map((o) => o[0]), [0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
});

test('threshold neurons: random weights/thresholds, every strategy, exhaustive', () => {
  const r = rng(7);
  for (let i = 0; i < 120; i++) {
    const n = 1 + Math.floor(r() * 6);
    const weights = Array.from({ length: n }, () => Math.floor(r() * 7) - 3);
    const theta = Math.floor(r() * 9) - 4;
    const spec: NeuronSpec = { weights, theta };
    for (const strategy of ['auto', 'bdd', 'count'] as const) {
      const nl = compileNeuron(spec, { strategy, mode: 'direct' });
      const tt = truthTable(prepare(encode(nl), n, 1));
      tt.forEach((row, k) => assert.equal(row[0], evalNeuron(spec, bitsOf(k, n)), `${neuronKey(spec)} ${strategy} @${k}`));
    }
    const auto = compileNeuron(spec, { mode: 'direct' }).counts.nand;
    assert.ok(auto <= compileNeuron(spec, { strategy: 'bdd', mode: 'direct' }).counts.nand);
    assert.ok(auto <= compileNeuron(spec, { strategy: 'count', mode: 'direct' }).counts.nand + 0);
  }
});

test('threshold() inside a shared circuit reuses gates', () => {
  const c = new Logic(3);
  const x = c.inputs();
  const a = threshold(c, x, [1, 1, 1], 2);
  const b = threshold(c, x, [1, 1, 1], 2);
  assert.equal(a, b);
});

test('canonical neurons', () => {
  const k = canonicalNeuron({ weights: [0, -1, 2, 0, 1], theta: 1 });
  assert.deepEqual(k.spec.weights, [2, 1, -1]);
  assert.deepEqual(k.inputs, [2, 4, 1]);
  assert.equal(k.key, 'neuron(+2,+1,-1>=1)');
  assert.deepEqual(canonicalNeuron({ weights: [1, 1], theta: 0 }).trivial, { kind: 'const', value: 1 });
  assert.deepEqual(canonicalNeuron({ weights: [1, 1], theta: 3 }).trivial, { kind: 'const', value: 0 });
  assert.deepEqual(canonicalNeuron({ weights: [0, 1], theta: 1 }).trivial, { kind: 'wire', input: 1 });
  assert.deepEqual(canonicalNeuron({ weights: [-1, 0], theta: 0 }).trivial, { kind: 'not', input: 0 });
});

test('random networks: inline == REF-composed == reference model', () => {
  const r = rng(11);
  for (let i = 0; i < 40; i++) {
    const nIn = 2 + Math.floor(r() * 4);
    const layers: NeuronSpec[][] = [];
    let width = nIn;
    for (let l = 0; l < 1 + Math.floor(r() * 3); l++) {
      const next = 1 + Math.floor(r() * 4);
      layers.push(Array.from({ length: next }, () => ({
        weights: Array.from({ length: width }, () => Math.floor(r() * 3) - 1),
        theta: Math.floor(r() * 5) - 2,
      })));
      width = next;
    }
    const inline = compileNetwork(nIn, layers, { mode: 'buffered' });
    const b = new NetlistBuilder(nIn);
    const net = refNetwork(b, b.inputs(), layers);
    const viaRef = b.build(net.outputs, { mode: 'direct' });
    // tape out each dependency at a fake id and resolve REFs to it
    const ids = new Map([...net.deps.keys()].map((key, j) => [key, BigInt(100 + j)]));
    const progs = new Map<bigint, Program>();
    for (const [key, spec] of net.deps) {
      const nl = compileNeuron(spec);
      progs.set(ids.get(key)!, prepare(encode(nl), nl.nIn, 1));
    }
    const resolve: CircuitResolver = (cpu, id) => {
      assert.equal(cpu, LOCAL_CPU);
      return progs.get(id)!;
    };
    const pRef = prepare(encode(viaRef, (key) => ({ cpu: LOCAL_CPU, circuitId: ids.get(key)! })), nIn, width, resolve);
    const pInline = prepare(encode(inline), nIn, width);
    for (let v = 0; v < 1 << nIn; v++) {
      const x = bitsOf(v, nIn);
      const want = evalNetwork(layers, x);
      assert.deepEqual(Array.from(run(pInline, [], x).outputs), want);
      assert.deepEqual(Array.from(run(pRef, [], x).outputs), want);
    }
  }
});

test('catalogResolver maps deployed circuits to real targets', () => {
  const deployed = { 'or-neuron': { cpu: '0x' + 'ab'.repeat(20), circuitId: 3n } };
  const { refs } = catalogResolver({ deployed });
  assert.deepEqual(refs('or-neuron'), deployed['or-neuron']);
  assert.equal(refs('and-neuron').cpu, LOCAL_CPU);
  const bytes = encode(getCircuit('xor-net-ref').build({ mode: 'direct' }), refs);
  assert.ok(bytes.length > 0);
});

test('neuron compiler rejects unsafe or oversized weights instead of miscompiling or hanging', () => {
  const unsafe: NeuronSpec[] = [
    { weights: [2 ** 53, 1], theta: 1 }, // not a safe integer: would round to a different neuron
    { weights: [1, 1], theta: 2 ** 53 + 2 },
    { weights: [1.5, 1], theta: 1 },
    { weights: [Number.NaN], theta: 0 },
  ];
  for (const s of unsafe) {
    assert.throws(() => compileNeuron(s), /safe integers/);
    assert.throws(() => canonicalNeuron(s), /safe integers/);
  }
  const t0 = Date.now();
  for (const w of [MAX_NEURON_WEIGHT + 1, -(MAX_NEURON_WEIGHT + 1), 1e9, -(2 ** 52)]) {
    assert.throws(() => compileNeuron({ weights: [w, 1, 1], theta: 1 }), /out of range/);
    assert.throws(() => compileNeuron({ weights: [w, 1, 1], theta: 1 }, { strategy: 'count' }), /out of range/);
    const c = new Logic(3);
    assert.throws(() => threshold(c, c.inputs(), [1, w, 1], 1), /out of range/);
  }
  assert.ok(Date.now() - t0 < 1000, 'rejection is immediate');
  // threshold() validates arity as well
  const c = new Logic(2);
  assert.throws(() => threshold(c, c.inputs(), [1], 1), /weights for 2 inputs/);
});

test('neuron compiler is exact at the weight bound', () => {
  const W = MAX_NEURON_WEIGHT;
  const specs: NeuronSpec[] = [
    { weights: [W, -W, 3, 1], theta: 2 },
    { weights: [W, W - 1, -W, 1], theta: W },
    { weights: [-W, -W, 2], theta: -W },
  ];
  for (const spec of specs) {
    for (const strategy of ['auto', 'bdd', 'count'] as const) {
      const prog = prepare(encode(compileNeuron(spec, { strategy })), spec.weights.length, 1);
      for (let v = 0; v < 1 << spec.weights.length; v++) {
        const x = bitsOf(v, spec.weights.length);
        assert.equal(run(prog, [], x).outputs[0], evalNeuron(spec, x), `${neuronKey(spec)} ${strategy} x=${v}`);
      }
    }
  }
});
