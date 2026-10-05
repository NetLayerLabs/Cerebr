// Cross-checks the netlist encoder/decoder/simulator against TapeOut's own shipped client code
// (sdk/reference/tapeout-netlist-src.js), loaded verbatim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NetlistBuilder, OP, decode, encode, toHex, fromHex, finalize, type Element,
  prepare, run, packBits, unpackBits, evalPacked, stepPacked, type CircuitResolver, type Program,
} from '../src/neuro/index.ts';

// ---------------------------------------------------------------- load the reference implementation
const src = readFileSync(new URL('../reference/tapeout-netlist-src.js', import.meta.url), 'utf8');
const body = src.slice(0, src.indexOf('const aJ=1500'));
const ref = new Function(`${body}; return { ht, sJ, d5, f5, h5, p5, m5, oJ, iJ };`)() as {
  sJ: new (nIn: number) => any;
  d5: (els: any[]) => Uint8Array;
  f5: (bytes: Uint8Array, nIn: number) => any[];
  h5: (graph: { nodes: any[]; edges: any[] }) => { netlist: Uint8Array; nIn: number; nOut: number; nNand: number };
  p5: (bytes: Uint8Array, nIn: number, nOut: number, resolve?: (cpu: string, id: bigint) => any) => any;
  m5: (prog: any, state: Uint8Array, inputs: Uint8Array) => { newState: Uint8Array; outputs: Uint8Array; signals: Uint8Array };
  oJ: (bytes: Uint8Array, n: number) => Uint8Array;
  iJ: (bits: ArrayLike<number>) => Uint8Array;
};

// ---------------------------------------------------------------- deterministic RNG
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CPU_A = '0x1111111111111111111111111111111111111111';
const CPU_B = '0xabcdef0123456789abcdef0123456789abcdef01';

/** Sub-circuits that random netlists may REF (one combinational, one with a latch). */
function subCircuits() {
  const xor = new NetlistBuilder(2);
  const n = xor.nand(2, 3);
  const x = xor.nand(xor.nand(2, n), xor.nand(3, n));
  const subXor = { netlist: encode(xor.build([x, n], { mode: 'direct' })), nIn: 2, nOut: 2 };
  const tog = new NetlistBuilder(1); // toggle flip-flop: q' = q xor t
  const l = tog.allocLatch();
  const m = tog.nand(l.q, 2);
  const nx = tog.nand(tog.nand(l.q, m), tog.nand(2, m));
  l.setD(nx);
  const subTog = { netlist: encode(tog.build([l.q], { mode: 'buffered' })), nIn: 1, nOut: 1 };
  return { [`${CPU_A}:7`]: subXor, [`${CPU_B}:${2n ** 63n}`]: subTog } as Record<string, { netlist: Uint8Array; nIn: number; nOut: number }>;
}
const SUBS = subCircuits();
const subTargets = [
  { cpu: CPU_A, circuitId: 7n, nIn: 2, nOut: 2 },
  { cpu: CPU_B, circuitId: 2n ** 63n, nIn: 1, nOut: 1 },
];

function randomElements(r: () => number, nIn: number, count: number, allowRef = true): Element[] {
  const els: Element[] = [];
  let next = 2 + nIn;
  const pick = () => Math.floor(r() * next);
  for (let i = 0; i < count; i++) {
    const k = r();
    if (k < 0.7) {
      const a = pick(), b = pick();
      els.push({ op: OP.NAND, a, b, out: next++ });
    } else if (k < 0.85 || !allowRef) {
      // LATCH d may point anywhere (forward feedback included), as the decoder allows
      els.push({ op: OP.LATCH, d: Math.floor(r() * (2 + nIn + count)), out: next++ });
    } else {
      const t = subTargets[Math.floor(r() * subTargets.length)];
      const ins = Array.from({ length: t.nIn }, pick);
      const outs = Array.from({ length: t.nOut }, () => next++);
      els.push({ op: OP.REF, target: { cpu: t.cpu, circuitId: t.circuitId }, ins, nOut: t.nOut, outs });
    }
  }
  return els;
}

const toRefFormat = (els: Element[]) =>
  els.map((e) => (e.op === OP.REF ? { op: e.op, cpu: (e.target as any).cpu, circuitId: (e.target as any).circuitId, ins: e.ins, nOut: e.nOut, outs: e.outs } : e));

const myResolve: CircuitResolver = (cpu, id) => SUBS[`${cpu}:${id}`];
const refCache = new Map<string, any>();
const refResolve = (cpu: string, id: bigint) => {
  const k = `${cpu}:${id}`;
  if (!refCache.has(k)) refCache.set(k, ref.p5(SUBS[k].netlist, SUBS[k].nIn, SUBS[k].nOut, refResolve));
  return refCache.get(k);
};

// ---------------------------------------------------------------- tests

test('encode is byte-identical to TapeOut d5 on random netlists', () => {
  const r = rng(1);
  for (let i = 0; i < 300; i++) {
    const nIn = Math.floor(r() * 6);
    const els = randomElements(r, nIn, 1 + Math.floor(r() * 40));
    assert.deepEqual(encode(els), ref.d5(toRefFormat(els)));
  }
});

test('decode matches TapeOut f5 and round-trips', () => {
  const r = rng(2);
  for (let i = 0; i < 300; i++) {
    const nIn = Math.floor(r() * 6);
    const els = randomElements(r, nIn, 1 + Math.floor(r() * 40));
    const bytes = encode(els);
    const mine = decode(bytes, nIn);
    assert.deepEqual(toRefFormat(mine), ref.f5(bytes, nIn));
    assert.deepEqual(encode(mine), bytes);
    assert.deepEqual(decode(toHex(bytes), nIn), mine);
  }
});

test('decode rejects what TapeOut rejects', () => {
  const bad = [
    Uint8Array.from([0, 0, 0, 9, 0, 0, 0]), // NAND reads future signal 9 (nIn=1 -> next is 3)
    Uint8Array.from([0, 0, 0]), // truncated
    Uint8Array.from([7]), // unknown opcode
  ];
  for (const b of bad) {
    assert.throws(() => decode(b, 1));
    assert.throws(() => ref.f5(b, 1));
  }
  // quirk kept for fidelity: a NAND may name its own output index
  assert.doesNotThrow(() => decode(Uint8Array.from([0, 0, 0, 3, 0, 0, 2]), 1));
  assert.doesNotThrow(() => ref.f5(Uint8Array.from([0, 0, 0, 3, 0, 0, 2]), 1));
});

test('simulator matches TapeOut p5/m5 (outputs, newState, every signal) on random netlists', () => {
  const r = rng(3);
  for (let i = 0; i < 400; i++) {
    const nIn = Math.floor(r() * 6);
    const els = randomElements(r, nIn, 1 + Math.floor(r() * 50));
    const bytes = encode(els);
    const nSig = finalize(nIn, 0, els).counts.signals;
    const nOut = 1 + Math.floor(r() * Math.min(4, nSig - 2 - nIn));
    const mine = prepare(bytes, nIn, nOut, myResolve);
    const theirs = ref.p5(bytes, nIn, nOut, refResolve);
    assert.equal(mine.nState, theirs.nState);
    assert.equal(mine.nSignals, theirs.nSignals);
    let s1: Uint8Array = new Uint8Array(0), s2: Uint8Array = new Uint8Array(0);
    for (let step = 0; step < 4; step++) {
      const inputs = Uint8Array.from({ length: nIn }, () => (r() < 0.5 ? 1 : 0));
      const a = run(mine, s1, inputs);
      const b = ref.m5(theirs, s2, inputs);
      assert.deepEqual(a.signals, b.signals);
      assert.deepEqual(a.outputs, b.outputs);
      assert.deepEqual(a.newState, b.newState);
      s1 = a.newState;
      s2 = b.newState;
    }
  }
});

test('bit packing matches TapeOut oJ/iJ (LSB-first)', () => {
  const r = rng(4);
  for (let n = 0; n < 40; n++) {
    const bits = Uint8Array.from({ length: n }, () => (r() < 0.5 ? 1 : 0));
    const packed = packBits(bits);
    assert.deepEqual(packed, ref.iJ(bits));
    assert.deepEqual(unpackBits(packed, n), ref.oJ(packed, n));
    assert.deepEqual(unpackBits(packed, n), bits);
  }
  assert.deepEqual(packBits([0, 1, 1, 0]), Uint8Array.from([0b0110]));
  assert.deepEqual(packBits([1, 0, 0, 0, 0, 0, 0, 0, 1]), Uint8Array.from([1, 1]));
});

test('builder: buffered outputs are byte-identical to TapeOut graph compiler h5', () => {
  // XOR + carry drawn as a graph, the way the TapeOut editor stores it
  const nodes = [
    { id: 'i0', type: 'input', index: 0 }, { id: 'i1', type: 'input', index: 1 },
    { id: 'n', type: 'nand' }, { id: 'p', type: 'nand' }, { id: 'q', type: 'nand' }, { id: 'x', type: 'nand' },
    { id: 'o0', type: 'output', index: 0 }, { id: 'o1', type: 'output', index: 1 },
  ];
  const e = (source: string, target: string, targetHandle: string) => ({ source, target, targetHandle });
  const edges = [
    e('i0', 'n', 'a'), e('i1', 'n', 'b'), e('i0', 'p', 'a'), e('n', 'p', 'b'), e('i1', 'q', 'a'), e('n', 'q', 'b'),
    e('p', 'x', 'a'), e('q', 'x', 'b'), e('x', 'o0', 'in'), e('n', 'o1', 'in'),
  ];
  const theirs = ref.h5({ nodes, edges });
  const b = new NetlistBuilder(2);
  const n = b.nand(2, 3);
  const x = b.nand(b.nand(2, n), b.nand(3, n));
  const mine = b.build([x, n], { mode: 'buffered' });
  assert.deepEqual(encode(mine), theirs.netlist);
  assert.equal(mine.counts.nand, theirs.nNand);
});

test('builder: direct and buffered modes compute the same function', () => {
  const r = rng(5);
  for (let i = 0; i < 200; i++) {
    const nIn = 1 + Math.floor(r() * 5);
    const b = new NetlistBuilder(nIn);
    const sigs = [0, 1, ...b.inputs()];
    for (let k = 0; k < 5 + Math.floor(r() * 25); k++) {
      const pick = () => sigs[Math.floor(r() * sigs.length)];
      sigs.push(r() < 0.9 ? b.nand(pick(), pick()) : b.latch(pick()));
    }
    // random outputs, including duplicates, inputs and constants
    const outs = Array.from({ length: 1 + Math.floor(r() * 4) }, () => sigs[Math.floor(r() * sigs.length)]);
    const progs = (['buffered', 'direct'] as const).map((mode) => {
      const nl = b.build(outs, { mode });
      return prepare(encode(nl), nIn, outs.length);
    });
    for (let v = 0; v < 1 << nIn; v++) {
      const inputs = Array.from({ length: nIn }, (_, j) => (v >> j) & 1);
      const st = new Uint8Array(progs[0].nState).map(() => (r() < 0.5 ? 1 : 0));
      const [a, c] = progs.map((p) => run(p, st, inputs));
      assert.deepEqual(a.outputs, c.outputs);
      assert.deepEqual(a.newState, c.newState);
    }
  }
});

test('builder: direct mode moves final gates instead of buffering', () => {
  const b = new NetlistBuilder(2);
  const n = b.nand(2, 3);
  const x = b.nand(b.nand(2, n), b.nand(3, n));
  assert.equal(b.build([x], { mode: 'direct' }).counts.nand, 4);
  assert.equal(b.build([x], { mode: 'buffered' }).counts.nand, 6);
  // n also feeds internal gates, so as an output it is recomputed (1 extra gate) in either order
  assert.equal(b.build([n, x], { mode: 'direct' }).counts.nand, 5);
  assert.equal(b.build([x, n], { mode: 'direct' }).counts.nand, 5);
  // a gate feeding only a later output stays in place: outputs [a, y] with y = NAND(a, a)
  const c = new NetlistBuilder(1);
  const a = c.nand(2, 0 + 1);
  const yy = c.nand(a, a);
  assert.equal(c.build([a, yy], { mode: 'direct' }).counts.nand, 2);
  assert.equal(c.build([yy, a], { mode: 'direct' }).counts.nand, 3);
  // a pass-through input costs a NOT-NOT pair, a constant one gate
  assert.equal(b.build([2], { mode: 'direct' }).counts.nand, 2);
  assert.equal(b.build([1], { mode: 'direct' }).counts.nand, 1);
  // dead logic is pruned
  b.nand(n, n);
  assert.equal(b.build([x], { mode: 'direct' }).counts.nand, 4);
  assert.equal(b.build([x], { mode: 'direct', prune: false }).counts.nand, 5);
});

test('packed eval / step helpers', () => {
  const b = new NetlistBuilder(2);
  const n = b.nand(2, 3);
  const x = b.nand(b.nand(2, n), b.nand(3, n));
  const p = prepare(encode(b.build([x])), 2, 1);
  assert.deepEqual([0, 1, 2, 3].map((v) => evalPacked(p, Uint8Array.from([v]))[0]), [0, 1, 1, 0]);
  const s = stepPacked(p, new Uint8Array(0), Uint8Array.from([1]));
  assert.deepEqual(s.outputs, Uint8Array.from([1]));
});

test('REF placeholders must be resolved to encode', () => {
  const b = new NetlistBuilder(2);
  const [y] = b.ref({ placeholder: 'or-neuron' }, [2, 3], 1);
  const nl = b.build([y], { mode: 'direct' });
  assert.deepEqual(nl.placeholders, ['or-neuron']);
  assert.throws(() => encode(nl), /unresolved/);
  const bytes = encode(nl, { 'or-neuron': { cpu: CPU_A, circuitId: 5n } });
  assert.equal(toHex(bytes), `0x02${CPU_A.slice(2)}00000000000000050201000002000003`);
  assert.deepEqual(fromHex(toHex(bytes)), bytes);
  const prog: Program = prepare(bytes, 2, 1, () => orCircuit());
  assert.deepEqual([0, 1, 2, 3].map((v) => run(prog, [], [v & 1, v >> 1]).outputs[0]), [0, 1, 1, 1]);
});

function orCircuit() {
  const b = new NetlistBuilder(2);
  const y = b.nand(b.nand(2, 2), b.nand(3, 3));
  return { netlist: encode(b.build([y], { mode: 'direct' })), nIn: 2, nOut: 1 };
}
