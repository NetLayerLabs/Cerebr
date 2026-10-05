// Gate library on top of NetlistBuilder. Every NAND costs a transistor (and OKB), so the
// `Logic` wrapper folds constants, cancels double negation and hashes structurally: asking for
// the same NAND twice returns the existing gate.
//
// NAND costs (fresh inputs, no sharing):
//   not 1 · and 2 · or 3 · nor 4 · xor 4 · xnor 5 · mux 4 (3 when not(sel) already exists)
//   halfAdder 5 · fullAdder 9 · majority3 6 · rippleAdd(n) 9n-4 (no carry in)

import { NetlistBuilder, OP, type Signal } from './netlist.ts';

export class Logic {
  readonly b: NetlistBuilder;
  private readonly cache = new Map<string, Signal>();

  constructor(b: NetlistBuilder | number) {
    this.b = typeof b === 'number' ? new NetlistBuilder(b) : b;
  }

  get ZERO(): Signal {
    return 0;
  }

  get ONE(): Signal {
    return 1;
  }

  input(i: number): Signal {
    return this.b.input(i);
  }

  inputs(): Signal[] {
    return this.b.inputs();
  }

  const(v: boolean | number): Signal {
    return v ? 1 : 0;
  }

  /** If s is NAND(x, x), return x. */
  private inverseOf(s: Signal): Signal | undefined {
    if (s === 0) return 1;
    if (s === 1) return 0;
    const el = this.b.driver(s);
    if (el && el.op === OP.NAND && el.a === el.b) return el.a;
    return undefined;
  }

  private complementary(a: Signal, b: Signal): boolean {
    return this.inverseOf(a) === b || this.inverseOf(b) === a;
  }

  nand(a: Signal, b: Signal): Signal {
    if (a === 0 || b === 0) return 1;
    if (a === 1) return this.not(b);
    if (b === 1 || a === b) return this.not(a);
    if (this.complementary(a, b)) return 1;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const s = this.b.nand(a, b);
    this.cache.set(key, s);
    return s;
  }

  not(a: Signal): Signal {
    const inv = this.inverseOf(a);
    if (inv !== undefined) return inv;
    const key = `${a},${a}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const s = this.b.nand(a, a);
    this.cache.set(key, s);
    return s;
  }

  and(a: Signal, b: Signal): Signal {
    return this.not(this.nand(a, b));
  }

  or(a: Signal, b: Signal): Signal {
    return this.nand(this.not(a), this.not(b));
  }

  nor(a: Signal, b: Signal): Signal {
    return this.not(this.or(a, b));
  }

  xor(a: Signal, b: Signal): Signal {
    if (a === b) return 0;
    if (a === 0) return b;
    if (b === 0) return a;
    if (a === 1) return this.not(b);
    if (b === 1) return this.not(a);
    if (this.complementary(a, b)) return 1;
    const n = this.nand(a, b);
    return this.nand(this.nand(a, n), this.nand(b, n));
  }

  xnor(a: Signal, b: Signal): Signal {
    return this.not(this.xor(a, b));
  }

  /** sel ? whenOne : whenZero */
  mux(sel: Signal, whenZero: Signal, whenOne: Signal): Signal {
    if (sel === 0) return whenZero;
    if (sel === 1) return whenOne;
    if (whenZero === whenOne) return whenZero;
    return this.nand(this.nand(whenZero, this.not(sel)), this.nand(whenOne, sel));
  }

  andN(xs: Signal[]): Signal {
    return reduceTree(xs, 1, (a, b) => this.and(a, b));
  }

  orN(xs: Signal[]): Signal {
    return reduceTree(xs, 0, (a, b) => this.or(a, b));
  }

  xorN(xs: Signal[]): Signal {
    return reduceTree(xs, 0, (a, b) => this.xor(a, b));
  }

  /** a, b, c -> sum, carry. 5 NAND (the carry reuses the XOR's first NAND). */
  halfAdder(a: Signal, b: Signal): { sum: Signal; carry: Signal } {
    return { sum: this.xor(a, b), carry: this.and(a, b) };
  }

  /** Classic 9-NAND full adder. */
  fullAdder(a: Signal, b: Signal, c: Signal): { sum: Signal; carry: Signal } {
    const ab = this.xor(a, b);
    const sum = this.xor(ab, c);
    // carry = ab + c(a^b) = NAND(NAND(a,b), NAND(a^b, c)); both inner NANDs exist inside the XORs.
    const carry = this.nand(this.nand(a, b), this.nand(ab, c));
    return { sum, carry };
  }

  /** Majority of three, 6 NAND: the full adder's carry without its sum. */
  majority3(a: Signal, b: Signal, c: Signal): Signal {
    return this.fullAdder(a, b, c).carry;
  }

  /** LSB-first ripple-carry adder; result has max(len)+1 bits. */
  add(a: Signal[], b: Signal[], carryIn: Signal = 0): Signal[] {
    const n = Math.max(a.length, b.length);
    const out: Signal[] = [];
    let c = carryIn;
    for (let i = 0; i < n; i++) {
      const r = this.fullAdder(a[i] ?? 0, b[i] ?? 0, c);
      out.push(r.sum);
      c = r.carry;
    }
    out.push(c);
    return out;
  }

  /**
   * Population count (LSB-first bits) by carry-save column compression: full adders take three
   * bits of a column, half adders two, until each column holds one bit.
   */
  popcount(xs: Signal[]): Signal[] {
    const width = Math.max(1, bitLength(xs.length));
    const cols: Signal[][] = [xs.filter((x) => x !== 0)]; // constant ones fold away inside the adders
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      while (col.length > 1) {
        if (!cols[i + 1]) cols[i + 1] = [];
        const r = col.length >= 3 ? this.fullAdder(col.shift()!, col.shift()!, col.shift()!) : this.halfAdder(col.shift()!, col.shift()!);
        col.push(r.sum);
        cols[i + 1].push(r.carry);
      }
    }
    return Array.from({ length: width }, (_, i) => cols[i]?.[0] ?? 0);
  }

  /** [value(bits) >= k] for an unsigned LSB-first vector and an integer constant k. */
  geConst(bits: Signal[], k: number): Signal {
    if (k <= 0) return 1;
    if (k >= 2 ** bits.length) return 0;
    // g_i = [bits[0..i] >= k[0..i]]; an empty suffix compares equal (true).
    let g: Signal = 1;
    for (let i = 0; i < bits.length; i++) {
      g = (k >> i) & 1 ? this.and(bits[i], g) : this.or(bits[i], g);
    }
    return g;
  }

  /** [value(bits) == k] */
  eqConst(bits: Signal[], k: number): Signal {
    if (k < 0 || k >= 2 ** bits.length) return 0;
    return this.andN(bits.map((s, i) => ((k >> i) & 1 ? s : this.not(s))));
  }

  /** [a == b] for equal-length vectors. */
  equal(a: Signal[], b: Signal[]): Signal {
    const n = Math.max(a.length, b.length);
    return this.andN(Array.from({ length: n }, (_, i) => this.xnor(a[i] ?? 0, b[i] ?? 0)));
  }

  /** [a >= b] unsigned, LSB-first. */
  ge(a: Signal[], b: Signal[]): Signal {
    const n = Math.max(a.length, b.length);
    let g: Signal = 1;
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? 0, y = b[i] ?? 0;
      // at bit i: a>b -> 1, a<b -> 0, equal -> lower result
      g = this.mux(this.xor(x, y), g, x);
    }
    return g;
  }
}

function reduceTree(xs: Signal[], identity: Signal, op: (a: Signal, b: Signal) => Signal): Signal {
  if (xs.length === 0) return identity;
  let level = xs.slice();
  while (level.length > 1) {
    const next: Signal[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? op(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

export function bitLength(n: number): number {
  let b = 0;
  while (2 ** b <= n) b++;
  return b;
}
