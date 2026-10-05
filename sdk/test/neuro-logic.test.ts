import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Logic, encode, prepare, run, bitsOf, valueOf, type Signal } from '../src/neuro/index.ts';

/** Build f over n fresh inputs; return the live NAND count and an evaluator. */
function circuit(n: number, f: (c: Logic, x: Signal[]) => Signal[]) {
  const c = new Logic(n);
  const outs = f(c, c.inputs());
  const gates = c.b.liveElements(outs).length;
  const nl = c.b.build(outs, { mode: 'buffered' });
  const prog = prepare(encode(nl), n, outs.length);
  return { gates, eval: (x: number[]) => Array.from(run(prog, [], x).outputs) };
}

function exhaustive(n: number, f: (c: Logic, x: Signal[]) => Signal[], model: (x: number[]) => number[], gates?: number) {
  const k = circuit(n, f);
  for (let v = 0; v < 1 << n; v++) {
    const x = bitsOf(v, n);
    assert.deepEqual(k.eval(x), model(x), `input ${x}`);
  }
  if (gates !== undefined) assert.equal(k.gates, gates);
  return k.gates;
}

test('basic gates: exhaustive truth tables and NAND counts', () => {
  exhaustive(1, (c, [a]) => [c.not(a)], ([a]) => [a ^ 1], 1);
  exhaustive(2, (c, [a, b]) => [c.nand(a, b)], ([a, b]) => [(a & b) ^ 1], 1);
  exhaustive(2, (c, [a, b]) => [c.and(a, b)], ([a, b]) => [a & b], 2);
  exhaustive(2, (c, [a, b]) => [c.or(a, b)], ([a, b]) => [a | b], 3);
  exhaustive(2, (c, [a, b]) => [c.nor(a, b)], ([a, b]) => [(a | b) ^ 1], 4);
  exhaustive(2, (c, [a, b]) => [c.xor(a, b)], ([a, b]) => [a ^ b], 4);
  exhaustive(2, (c, [a, b]) => [c.xnor(a, b)], ([a, b]) => [a ^ b ^ 1], 5);
  exhaustive(3, (c, [s, a, b]) => [c.mux(s, a, b)], ([s, a, b]) => [s ? b : a], 4);
});

test('arithmetic: adders, majority, popcount', () => {
  exhaustive(2, (c, [a, b]) => { const r = c.halfAdder(a, b); return [r.sum, r.carry]; }, ([a, b]) => bitsOf(a + b, 2), 5);
  exhaustive(3, (c, [a, b, d]) => { const r = c.fullAdder(a, b, d); return [r.sum, r.carry]; }, ([a, b, d]) => bitsOf(a + b + d, 2), 9);
  exhaustive(3, (c, [a, b, d]) => [c.majority3(a, b, d)], ([a, b, d]) => [a + b + d >= 2 ? 1 : 0], 6);
  for (const n of [1, 2, 3]) {
    // n-bit ripple adder: 9n - 4 gates (the first full adder folds to a half adder)
    exhaustive(2 * n, (c, x) => c.add(x.slice(0, n), x.slice(n)), (x) => bitsOf(valueOf(x.slice(0, n)) + valueOf(x.slice(n)), n + 1), 9 * n - 4);
  }
  for (let n = 1; n <= 9; n++) {
    exhaustive(n, (c, x) => c.popcount(x), (x) => bitsOf(x.reduce((a, b) => a + b, 0), Math.floor(Math.log2(n)) + 1));
  }
});

test('comparators: >= const, == const, equality, >=', () => {
  for (let k = -1; k <= 17; k++) {
    exhaustive(4, (c, x) => [c.geConst(x, k)], (x) => [valueOf(x) >= k ? 1 : 0]);
    exhaustive(4, (c, x) => [c.eqConst(x, k)], (x) => [valueOf(x) === k ? 1 : 0]);
  }
  exhaustive(6, (c, x) => [c.equal(x.slice(0, 3), x.slice(3))], (x) => [valueOf(x.slice(0, 3)) === valueOf(x.slice(3)) ? 1 : 0]);
  exhaustive(6, (c, x) => [c.ge(x.slice(0, 3), x.slice(3))], (x) => [valueOf(x.slice(0, 3)) >= valueOf(x.slice(3)) ? 1 : 0]);
  exhaustive(5, (c, x) => [c.andN(x), c.orN(x), c.xorN(x)], (x) => [x.every(Boolean) ? 1 : 0, x.some(Boolean) ? 1 : 0, x.reduce((a, b) => a ^ b, 0)]);
});

test('constant folding and structural hashing', () => {
  const c = new Logic(2);
  const [a, b] = c.inputs();
  assert.equal(c.nand(a, 0), 1);
  assert.equal(c.and(a, 1), a);
  assert.equal(c.or(a, 0), a);
  assert.equal(c.or(a, 1), 1);
  assert.equal(c.xor(a, a), 0);
  assert.equal(c.xor(a, 0), a);
  assert.equal(c.not(c.not(a)), a);
  assert.equal(c.nand(a, c.not(a)), 1);
  assert.equal(c.xor(a, c.not(a)), 1);
  assert.equal(c.mux(b, a, a), a);
  const before = c.b.elements.length;
  assert.equal(c.nand(a, b), c.nand(b, a));
  c.xor(a, b);
  c.xor(b, a);
  c.and(a, b); // reuses the XOR's NAND(a,b) + 1 inverter
  assert.equal(c.b.elements.length - before, 5);
});
