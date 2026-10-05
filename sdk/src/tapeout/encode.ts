// Pure helpers for talking to TapeOut circuits: bit packing for eval()/step(), a light netlist
// scanner (burn counts + the on-chain validity rules), and the fee / gas calculator.
// The full netlist builder and simulator live in ../neuro; this file only needs the wire format.

import type { Hex } from 'viem';

export type Bit = 0 | 1;
export type BitsLike = ArrayLike<number | boolean>;

/**
 * Packs bits LSB-first into bytes, the layout eval()/step() use for inputs, outputs and state:
 * bit i lives in byte i >> 3 at position i & 7. [1,0,0,0,0,0,0,0,1] -> 0x0101.
 */
export function packBits(bits: BitsLike): Hex {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytesToHex(bytes);
}

/** Unpacks the first n bits (LSB-first). Missing bytes read as 0, as on-chain. */
export function unpackBits(data: Hex | Uint8Array, n: number): Bit[] {
  const bytes = typeof data === 'string' ? hexToBytes(data) : data;
  const out: Bit[] = [];
  for (let i = 0; i < n; i++) out.push((((bytes[i >> 3] ?? 0) >> (i & 7)) & 1) as Bit);
  return out;
}

/** Input vector for an integer: bit i of `value` drives input i. */
export function bitsOfInt(value: number | bigint, n: number): Bit[] {
  const v = BigInt(value);
  return Array.from({ length: n }, (_, i) => Number((v >> BigInt(i)) & 1n) as Bit);
}

export function intOfBits(bits: BitsLike): bigint {
  let v = 0n;
  for (let i = bits.length - 1; i >= 0; i--) v = (v << 1n) | (bits[i] ? 1n : 0n);
  return v;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s as Hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error(`bad hex: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

// ---------------------------------------------------------------- netlist scan

export interface NetlistRef {
  /** Circuits contract of the referenced CPU (any CPU registered in the factory). */
  cpu: Hex;
  circuitId: bigint;
  nIns: number;
  nOut: number;
}

export interface NetlistStats {
  nand: number;
  latch: number;
  refs: NetlistRef[];
  /** Signals produced by elements (a REF counts nOut). Must be >= nOut for tapeout. */
  elementSignals: number;
  /** NAND / LATCH transistors tapeout() burns. REFs are free. */
  burn: { nand: bigint; latch: bigint };
  /** Elements in the netlist (NAND + LATCH + REF), i.e. what the local tapeout gas scales with. */
  elements: number;
  bytes: number;
}

/**
 * Scans a netlist and enforces the same rules as `tapeout()` that can be checked offline:
 * unknown opcodes / truncation, NAND and REF inputs must reference earlier signals
 * ("NAND: future signal"), nOut >= 1 ("no outputs"), and elementSignals >= nOut
 * ("too few signals for outputs": the outputs are the LAST nOut element signals, they can never
 * be a raw input or constant). REF pin counts and target registration are checked on-chain only.
 */
export function scanNetlist(netlist: Hex | Uint8Array, nIn: number, nOut: number): NetlistStats {
  const b = typeof netlist === 'string' ? hexToBytes(netlist) : netlist;
  let p = 0;
  const need = (n: number) => {
    if (p + n > b.length) throw new Error(`netlist truncated at byte ${p}`);
  };
  const u24 = () => {
    need(3);
    const v = (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
    p += 3;
    return v;
  };
  let next = 2 + nIn;
  let nand = 0;
  let latch = 0;
  const refs: NetlistRef[] = [];
  let elements = 0;
  while (p < b.length) {
    const op = b[p++];
    elements++;
    if (op === 0) {
      const x = u24();
      const y = u24();
      if (x >= next || y >= next) throw new Error(`NAND: future signal (signal ${next}: ${x}, ${y})`);
      next++;
      nand++;
    } else if (op === 1) {
      u24(); // d may point forward (feedback)
      next++;
      latch++;
    } else if (op === 2) {
      need(30);
      const cpu = bytesToHex(b.slice(p, p + 20));
      p += 20;
      let id = 0n;
      for (let i = 0; i < 8; i++) id = (id << 8n) | BigInt(b[p++]);
      const nIns = b[p++];
      const nO = b[p++];
      for (let i = 0; i < nIns; i++) {
        const s = u24();
        if (s >= next) throw new Error(`REF: future signal (${s})`);
      }
      refs.push({ cpu, circuitId: id, nIns, nOut: nO });
      next += nO;
    } else {
      throw new Error(`unknown opcode 0x${op.toString(16)} at byte ${p - 1}`);
    }
  }
  if (nOut < 1) throw new Error('no outputs');
  const elementSignals = next - 2 - nIn;
  if (elementSignals < nOut) throw new Error('too few signals for outputs');
  return {
    nand,
    latch,
    refs,
    elementSignals,
    burn: { nand: BigInt(nand), latch: BigInt(latch) },
    elements,
    bytes: b.length,
  };
}

// ---------------------------------------------------------------- costs

/** On-chain fee constants (read them with readFees(); these are the values observed 2026-10-04). */
export interface TapeoutFees {
  /** factory.deployFee(): exact-or-more msg.value for createCPU; the excess is NOT refunded. */
  deployFee: bigint;
  /** transistors.protocolFee(): flat per mint() call, on top of amount * mintPrice. */
  protocolFee: bigint;
  /** circuits.TAPEOUT_FEE(): msg.value of tapeout() must equal it exactly. */
  tapeoutFee: bigint;
  /** opener.FEE(): msg.value >= FEE for open(). */
  openFee: bigint;
  /** account.EXEC_FEE() / BATCH_FEE(): msg.value for execute / executeBatch (on top of `value`). */
  execFee: bigint;
  batchFee: bigint;
}

export const OBSERVED_FEES: TapeoutFees = {
  deployFee: 6_600_000_000_000_000n, // 0.0066 OKB
  protocolFee: 660_000_000_000_000n, // 0.00066 OKB
  tapeoutFee: 1_300_000_000_000_000n, // 0.0013 OKB
  openFee: 80_000_000_000_000_000n, // 0.08 OKB
  execFee: 1_300_000_000_000_000n, // 0.0013 OKB
  batchFee: 3_300_000_000_000_000n, // 0.0033 OKB
};

/** msg.value for transistors.mint(id, amount). Any excess stays in the contract (not owed to anyone). */
export function mintValue(amount: bigint, mintPrice: bigint, protocolFee: bigint): bigint {
  if (amount <= 0n) throw new Error('amount must be > 0');
  return amount * mintPrice + protocolFee;
}

/**
 * Gas model fitted on the fork (warm-ish storage, 2..30000 gates). Upper-bound-ish estimates for
 * UI quotes; always eth_estimateGas before sending.
 *   tapeout ~ 210k (250k first on a CPU) + 2.9k per NAND/LATCH + 20k per REF   (30000 gates = 87.7M gas, block limit 210M)
 *   eval    ~ 50k + 2.5k per flattened gate (gateCount)  (REF nesting adds call overhead)
 *   mint    ~ 70k (180k for the first mint into an empty CPU), createCPU ~ 715k, open ~ 175k
 */
export const GAS = {
  createCpu: 750_000n,
  mintFirst: 185_000n,
  mint: 75_000n,
  tapeoutBase: 250_000n, // first tapeout on a fresh CPU; later ones are ~40k cheaper
  tapeoutPerGate: 2_900n,
  tapeoutPerRef: 20_000n,
  evalBase: 50_000n,
  evalPerGate: 2_500n,
  open: 180_000n,
  execute: 120_000n,
} as const;

export function tapeoutGas(stats: Pick<NetlistStats, 'nand' | 'latch' | 'refs'>): bigint {
  return GAS.tapeoutBase + GAS.tapeoutPerGate * BigInt(stats.nand + stats.latch) + GAS.tapeoutPerRef * BigInt(stats.refs.length);
}

export function evalGas(gateCount: number | bigint): bigint {
  return GAS.evalBase + GAS.evalPerGate * BigInt(gateCount);
}

export interface TapeoutQuote {
  /** Transistors that must be in the author's wallet (burned). */
  burn: { nand: bigint; latch: bigint };
  /** msg.value of tapeout(). */
  value: bigint;
  gas: bigint;
  /** value + gas * gasPrice. */
  total: bigint;
  /** Cost to mint the burned transistors from scratch (one mint call per token id), for UI quotes. */
  mintCost: bigint;
}

/** Full cost of taping out `netlist`, optionally including minting the transistors it burns. */
export function quoteTapeout(
  netlist: Hex | Uint8Array,
  nIn: number,
  nOut: number,
  opts: { fees?: Pick<TapeoutFees, 'tapeoutFee' | 'protocolFee'>; mintPrice: bigint; gasPrice?: bigint },
): TapeoutQuote {
  const fees = { ...OBSERVED_FEES, ...opts.fees };
  const stats = scanNetlist(netlist, nIn, nOut);
  const gas = tapeoutGas(stats);
  const gasPrice = opts.gasPrice ?? 20_000_000n; // X Layer: ~0.02 gwei
  let mintCost = 0n;
  if (stats.burn.nand > 0n) mintCost += mintValue(stats.burn.nand, opts.mintPrice, fees.protocolFee);
  if (stats.burn.latch > 0n) mintCost += mintValue(stats.burn.latch, opts.mintPrice, fees.protocolFee);
  return { burn: stats.burn, value: fees.tapeoutFee, gas, total: fees.tapeoutFee + gas * gasPrice, mintCost };
}

export interface LaunchPlan {
  supply: bigint;
  mintPrice: bigint;
  /** Transistors minted by the creator (one NAND mint call + one LATCH mint call if needed). */
  mintNand: bigint;
  mintLatch: bigint;
  tapeouts: number;
  /** How many circuits get a native account opened. */
  opens: number;
  gasPrice?: bigint;
}

/**
 * Cost of a whole launch: createCPU + creator mints + N tapeouts + M account opens, in wei.
 * Note the creator gets amount * mintPrice back via transistors.withdraw() (pull payment), so the
 * net cost of the creator's own mints is just the protocol fee per mint call.
 */
export function quoteLaunch(plan: LaunchPlan, fees: TapeoutFees = OBSERVED_FEES) {
  const gasPrice = plan.gasPrice ?? 20_000_000n;
  const mintCalls = (plan.mintNand > 0n ? 1n : 0n) + (plan.mintLatch > 0n ? 1n : 0n);
  const mintGross = (plan.mintNand + plan.mintLatch) * plan.mintPrice + mintCalls * fees.protocolFee;
  const fixed = fees.deployFee + mintGross + BigInt(plan.tapeouts) * fees.tapeoutFee + BigInt(plan.opens) * fees.openFee;
  const gas = GAS.createCpu + GAS.mintFirst * mintCalls + 400_000n * BigInt(plan.tapeouts) + GAS.open * BigInt(plan.opens);
  const refundToCreator = (plan.mintNand + plan.mintLatch) * plan.mintPrice;
  return { fixed, gas, gasCost: gas * gasPrice, gross: fixed + gas * gasPrice, refundToCreator, net: fixed + gas * gasPrice - refundToCreator };
}
