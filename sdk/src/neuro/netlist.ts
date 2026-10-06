// TapeOut netlist builder / encoder / decoder.
//
// Byte format (mirrors TapeOut's shipped client, see sdk/reference/tapeout-netlist-src.js):
//   NAND  : u8 0, u24 a, u24 b
//   LATCH : u8 1, u24 d
//   REF   : u8 2, 20-byte cpu address, u64 circuitId, u8 nIns, u8 nOut, nIns x u24 input signal
// Signals: 0 = const0, 1 = const1, 2..2+nIn-1 = inputs, then every element appends its output(s)
// in order (a REF appends nOut signals). Elements may only read earlier signals, except a LATCH's
// d pin, which may point forward (feedback). The circuit's outputs are the LAST nOut signals.

export const OP = { NAND: 0, LATCH: 1, REF: 2 } as const;

export type Signal = number;

/** A resolved REF target: the referenced circuit's cpu address and its circuit id. */
export interface RefTarget {
  cpu: string;
  circuitId: bigint;
}

/** A REF whose target is only known after the referenced circuit has been taped out. */
export interface RefPlaceholder {
  placeholder: string;
}

export type RefSpec = RefTarget | RefPlaceholder;

export interface NandElement {
  op: typeof OP.NAND;
  a: Signal;
  b: Signal;
  out: Signal;
}

export interface LatchElement {
  op: typeof OP.LATCH;
  d: Signal;
  out: Signal;
}

export interface RefElement {
  op: typeof OP.REF;
  target: RefSpec;
  ins: Signal[];
  nOut: number;
  outs: Signal[];
}

export type Element = NandElement | LatchElement | RefElement;

/**
 * How the final outputs are made the last nOut signals.
 *  - 'buffered': append nOut inverters followed by nOut inverters of those (exactly what TapeOut's
 *    own graph compiler emits; costs 2 NAND per output).
 *  - 'direct': move output gates to the tail when the dependency order allows it, otherwise
 *    re-emit the driving NAND (1 gate) or a NOT-NOT pair (2 gates, for inputs / latches / REF pins).
 */
export type OutputMode = 'buffered' | 'direct';

export interface GateCounts {
  nand: number;
  latch: number;
  ref: number;
  /** Total elements (what TapeOut's compiler reports as gateCount). */
  elements: number;
  /** Total signals including consts and inputs. */
  signals: number;
}

/** A finalised netlist: elements numbered exactly as they will be on chain. */
export interface Netlist {
  nIn: number;
  nOut: number;
  /** Number of state bits (one per LATCH, plus the state of REF'd sequential sub-circuits - unknown here, so LATCH only). */
  nLatch: number;
  elements: Element[];
  counts: GateCounts;
  /** Placeholder names that must be resolved before encoding. */
  placeholders: string[];
}

export interface BuildOptions {
  mode?: OutputMode;
  /** Remove elements that do not reach an output (default true). Every gate costs a transistor. */
  prune?: boolean;
}

export function isPlaceholder(t: RefSpec): t is RefPlaceholder {
  return (t as RefPlaceholder).placeholder !== undefined;
}

export class NetlistBuilder {
  readonly nIn: number;
  readonly elements: Element[] = [];
  private nextSignal: number;
  private readonly drivers = new Map<Signal, Element>();

  constructor(nIn: number) {
    if (!Number.isInteger(nIn) || nIn < 0) throw new RangeError(`bad nIn ${nIn}`);
    this.nIn = nIn;
    this.nextSignal = 2 + nIn;
  }

  get ZERO(): Signal {
    return 0;
  }

  get ONE(): Signal {
    return 1;
  }

  get signalCount(): number {
    return this.nextSignal;
  }

  input(i: number): Signal {
    if (!Number.isInteger(i) || i < 0 || i >= this.nIn) throw new RangeError(`input ${i} out of range 0..${this.nIn - 1}`);
    return 2 + i;
  }

  inputs(): Signal[] {
    return Array.from({ length: this.nIn }, (_, i) => 2 + i);
  }

  /** The element driving a signal (undefined for consts and inputs). */
  driver(s: Signal): Element | undefined {
    return this.drivers.get(s);
  }

  nand(a: Signal, b: Signal): Signal {
    this.checkReadable(a);
    this.checkReadable(b);
    const out = this.nextSignal++;
    const el: NandElement = { op: OP.NAND, a, b, out };
    this.elements.push(el);
    this.drivers.set(out, el);
    return out;
  }

  latch(d: Signal): Signal {
    const out = this.nextSignal++;
    const el: LatchElement = { op: OP.LATCH, d, out };
    this.elements.push(el);
    this.drivers.set(out, el);
    return out;
  }

  /** A latch whose d pin is connected later (for feedback loops). */
  allocLatch(): { q: Signal; setD: (d: Signal) => void } {
    const out = this.nextSignal++;
    const el: LatchElement = { op: OP.LATCH, d: 0, out };
    this.elements.push(el);
    this.drivers.set(out, el);
    return { q: out, setD: (d: Signal) => { el.d = d; } };
  }

  ref(target: RefSpec, ins: Signal[], nOut: number): Signal[] {
    if (ins.length > 255 || nOut > 255 || nOut < 0) throw new RangeError(`REF pins out of u8 range: ${ins.length}/${nOut}`);
    for (const s of ins) this.checkReadable(s);
    const outs: Signal[] = [];
    for (let i = 0; i < nOut; i++) outs.push(this.nextSignal++);
    const t = isPlaceholder(target) ? { placeholder: target.placeholder } : { cpu: target.cpu, circuitId: BigInt(target.circuitId) };
    const el: RefElement = { op: OP.REF, target: t, ins: ins.slice(), nOut, outs };
    this.elements.push(el);
    for (const o of outs) this.drivers.set(o, el);
    return outs;
  }

  private checkReadable(s: Signal) {
    if (!Number.isInteger(s) || s < 0 || s >= this.nextSignal) throw new RangeError(`signal ${s} does not exist yet`);
  }

  /** Elements that (transitively) feed the given outputs, in builder order. */
  liveElements(outputs: Signal[]): Element[] {
    const live = new Set<Element>();
    const work = [...outputs];
    while (work.length) {
      const s = work.pop()!;
      const el = this.drivers.get(s);
      if (!el || live.has(el)) continue;
      live.add(el);
      if (el.op === OP.NAND) work.push(el.a, el.b);
      else if (el.op === OP.LATCH) work.push(el.d);
      else work.push(...el.ins);
    }
    return this.elements.filter((e) => live.has(e));
  }

  /** Finalise: prune dead logic, place outputs as the last nOut signals and renumber. */
  build(outputs: Signal[], opts: BuildOptions = {}): Netlist {
    const mode = opts.mode ?? 'buffered';
    if (outputs.length === 0) throw new Error('circuit has no outputs');
    if (outputs.length > 0xffffffff) throw new RangeError('too many outputs');
    for (const s of outputs) this.checkReadable(s);
    const body = opts.prune === false ? this.elements.slice() : this.liveElements(outputs);
    let tmp = this.nextSignal; // temporary ids for gates added during finalisation
    const tail: Element[] = [];
    const notGate = (a: Signal): NandElement => ({ op: OP.NAND, a, b: a, out: tmp++ });

    if (mode === 'buffered') {
      const firsts = outputs.map((s) => notGate(s));
      const seconds = firsts.map((g) => notGate(g.out));
      tail.push(...firsts, ...seconds);
    } else {
      const flatOuts = body.flatMap((e) => (e.op === OP.REF ? e.outs : [e.out]));
      const already = flatOuts.length >= outputs.length && outputs.every((s, i) => flatOuts[flatOuts.length - outputs.length + i] === s);
      if (!already) {
        // Candidates: distinct NAND gates driving an output, at their output position.
        const pos = new Map<Element, number>();
        outputs.forEach((s, i) => {
          const el = this.drivers.get(s);
          if (el && el.op === OP.NAND && !pos.has(el) && body.includes(el)) pos.set(el, i);
        });
        const consumers = new Map<Signal, Element[]>();
        const addConsumer = (s: Signal, e: Element) => {
          const list = consumers.get(s);
          if (list) list.push(e);
          else consumers.set(s, [e]);
        };
        for (const e of body) {
          if (e.op === OP.NAND) { addConsumer(e.a, e); addConsumer(e.b, e); }
          else if (e.op === OP.REF) for (const s of e.ins) addConsumer(s, e);
          // LATCH d reads are allowed to point forward, so they do not constrain order.
        }
        let changed = true;
        while (changed) {
          changed = false;
          for (const [el, p] of pos) {
            const users = consumers.get((el as NandElement).out) ?? [];
            if (users.some((u) => !pos.has(u) || pos.get(u)! <= p)) {
              pos.delete(el);
              changed = true;
            }
          }
        }
        const moved = new Set(pos.keys());
        const keptBody = body.filter((e) => !moved.has(e));
        body.length = 0;
        body.push(...keptBody);
        outputs.forEach((s, i) => {
          const el = this.drivers.get(s);
          if (el && pos.get(el) === i) {
            tail.push(el);
          } else if (el && el.op === OP.NAND) {
            tail.push({ op: OP.NAND, a: el.a, b: el.b, out: tmp++ }); // recompute: 1 gate
          } else if (s === 0) {
            tail.push({ op: OP.NAND, a: 1, b: 1, out: tmp++ });
          } else if (s === 1) {
            tail.push({ op: OP.NAND, a: 0, b: 0, out: tmp++ });
          } else {
            const inv = notGate(s);
            body.push(inv);
            tail.push(notGate(inv.out));
          }
        });
      }
    }
    return renumber(this.nIn, [...body, ...tail], outputs.length);
  }
}

function renumber(nIn: number, elements: Element[], nOut: number): Netlist {
  const map = new Map<Signal, Signal>();
  for (let s = 0; s < 2 + nIn; s++) map.set(s, s);
  let next = 2 + nIn;
  for (const e of elements) {
    if (e.op === OP.REF) for (const o of e.outs) map.set(o, next++);
    else map.set(e.out, next++);
  }
  const m = (s: Signal) => {
    const v = map.get(s);
    if (v === undefined) throw new Error(`internal: unmapped signal ${s}`);
    return v;
  };
  const out: Element[] = elements.map((e): Element => {
    if (e.op === OP.NAND) return { op: OP.NAND, a: m(e.a), b: m(e.b), out: m(e.out) };
    if (e.op === OP.LATCH) return { op: OP.LATCH, d: m(e.d), out: m(e.out) };
    return { op: OP.REF, target: e.target, ins: e.ins.map(m), nOut: e.nOut, outs: e.outs.map(m) };
  });
  return finalize(nIn, nOut, out);
}

/** Wrap already-numbered elements (e.g. from decode) as a Netlist. */
export function finalize(nIn: number, nOut: number, elements: Element[]): Netlist {
  const counts = countGates(nIn, elements);
  const placeholders = [...new Set(elements.flatMap((e) => (e.op === OP.REF && isPlaceholder(e.target) ? [e.target.placeholder] : [])))];
  if (counts.signals - 2 - nIn < nOut) throw new Error(`netlist has ${counts.signals - 2 - nIn} element outputs, fewer than nOut=${nOut}`);
  return { nIn, nOut, nLatch: counts.latch, elements, counts, placeholders };
}

export function countGates(nIn: number, elements: Element[]): GateCounts {
  let nand = 0, latch = 0, ref = 0, signals = 2 + nIn;
  for (const e of elements) {
    if (e.op === OP.NAND) { nand++; signals++; }
    else if (e.op === OP.LATCH) { latch++; signals++; }
    else { ref++; signals += e.nOut; }
  }
  return { nand, latch, ref, elements: elements.length, signals };
}

// ---------------------------------------------------------------- encoding

export type RefResolver = Record<string, RefTarget> | ((placeholder: string) => RefTarget | undefined);

function pushU24(out: number[], v: number) {
  if (!Number.isInteger(v)) throw new RangeError(`signal index is not an integer: ${v}`);
  if (v < 0 || v > 0xffffff) throw new RangeError(`signal index out of u24 range: ${v}`);
  out.push((v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}

function pushU64(out: number[], v: bigint) {
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${v}`);
  for (let i = 7; i >= 0; i--) out.push(Number((v >> BigInt(i * 8)) & 0xffn));
}

function pushAddress(out: number[], addr: string) {
  const h = String(addr).replace(/^0x/, '').toLowerCase();
  if (h.length !== 40 || /[^0-9a-f]/.test(h)) throw new Error(`bad address: ${addr}`);
  for (let i = 0; i < 40; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
}

export function resolveRef(target: RefSpec, refs?: RefResolver): RefTarget {
  if (!isPlaceholder(target)) return target;
  const r = typeof refs === 'function' ? refs(target.placeholder) : refs?.[target.placeholder];
  if (!r) throw new Error(`unresolved REF placeholder "${target.placeholder}"`);
  return { cpu: r.cpu, circuitId: BigInt(r.circuitId) };
}

/** Encode elements to TapeOut netlist bytes. Placeholders are resolved through `refs`. */
export function encode(netlist: Netlist | Element[], refs?: RefResolver): Uint8Array {
  const elements = Array.isArray(netlist) ? netlist : netlist.elements;
  const out: number[] = [];
  for (const e of elements) {
    if (e.op === OP.NAND) {
      out.push(OP.NAND);
      pushU24(out, e.a);
      pushU24(out, e.b);
    } else if (e.op === OP.LATCH) {
      out.push(OP.LATCH);
      pushU24(out, e.d);
    } else if (e.op === OP.REF) {
      const t = resolveRef(e.target, refs);
      out.push(OP.REF);
      pushAddress(out, t.cpu);
      pushU64(out, t.circuitId);
      if (e.ins.length > 255 || e.nOut > 255) throw new RangeError(`REF pins out of u8 range: ${e.ins.length}/${e.nOut}`);
      out.push(e.ins.length, e.nOut);
      for (const s of e.ins) pushU24(out, s);
    } else {
      throw new Error(`unknown op ${(e as { op: number }).op}`);
    }
  }
  return Uint8Array.from(out);
}

export function encodeHex(netlist: Netlist | Element[], refs?: RefResolver): `0x${string}` {
  return toHex(encode(netlist, refs));
}

/**
 * Decode netlist bytes, enforcing the same signal rules as TapeOut's on-chain tapeout():
 *  - NAND and REF inputs must reference signals strictly before the element's own outputs
 *    (a NAND reading its own output reverts "NAND: future signal", a REF input equal to one of its
 *    own outputs reverts "REF: future signal");
 *  - LATCH d may point forward (feedback) but must be < the total signal count
 *    ("LATCH d out of range").
 * TapeOut's shipped client decoder (sdk/reference/tapeout-netlist-src.js, f5) is laxer: it bounds
 * NAND/REF inputs only after allocating the element's outputs and never bounds LATCH d. This decoder
 * intentionally follows the contract, so it never accepts a netlist the chain would reject.
 */
export function decode(bytes: Uint8Array | string, nIn: number): Element[] {
  const b = typeof bytes === 'string' ? fromHex(bytes) : bytes;
  let p = 0;
  const need = (n: number) => {
    if (p + n > b.length) throw new Error(`netlist truncated at byte ${p}: need ${n}, have ${b.length - p}`);
  };
  const u8 = () => { need(1); return b[p++]; };
  const u24 = () => { need(3); const v = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2]; p += 3; return v; };
  const u64 = () => { need(8); let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[p++]); return v; };
  const addr = () => { need(20); let s = '0x'; for (let i = 0; i < 20; i++) s += b[p++].toString(16).padStart(2, '0'); return s; };

  const elements: Element[] = [];
  let next = 2 + nIn;
  // checked against `next` BEFORE the element's own outputs are allocated
  const ok = (s: number) => s >= 0 && s < next;
  while (p < b.length) {
    const op = u8();
    if (op === OP.NAND) {
      const a = u24(), bb = u24();
      if (!ok(a) || !ok(bb)) throw new Error(`NAND@${next}: input references future signal (a=${a},b=${bb})`);
      elements.push({ op: OP.NAND, a, b: bb, out: next++ });
    } else if (op === OP.LATCH) {
      const d = u24(), out = next++;
      elements.push({ op: OP.LATCH, d, out });
    } else if (op === OP.REF) {
      const cpu = addr(), circuitId = u64(), nIns = u8(), nOut = u8();
      const ins: number[] = [];
      for (let i = 0; i < nIns; i++) ins.push(u24());
      for (const s of ins) if (!ok(s)) throw new Error(`REF: input references future signal (${s})`);
      const outs: number[] = [];
      for (let i = 0; i < nOut; i++) outs.push(next++);
      elements.push({ op: OP.REF, target: { cpu, circuitId }, ins, nOut, outs });
    } else {
      throw new Error(`unknown opcode 0x${op.toString(16)} at byte ${p - 1}`);
    }
  }
  for (const e of elements) {
    if (e.op === OP.LATCH && e.d >= next) throw new Error(`LATCH@${e.out}: d out of range (${e.d} >= ${next} signals)`);
  }
  return elements;
}

export function decodeNetlist(bytes: Uint8Array | string, nIn: number, nOut: number): Netlist {
  return finalize(nIn, nOut, decode(bytes, nIn));
}

export function toHex(bytes: Uint8Array): `0x${string}` {
  let s = '0x';
  for (const x of bytes) s += x.toString(16).padStart(2, '0');
  return s as `0x${string}`;
}

export function fromHex(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, '');
  if (h.length % 2 || /[^0-9a-fA-F]/.test(h)) throw new Error('bad hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}
