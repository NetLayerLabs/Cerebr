import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFunctionSelector } from 'viem';
import {
  OBSERVED_FEES,
  accountAbi,
  bitsOfInt,
  circuitsAbi,
  factoryAbi,
  intOfBits,
  mintValue,
  openerAbi,
  packBits,
  quoteLaunch,
  quoteTapeout,
  scanNetlist,
  transistorsAbi,
  unpackBits,
} from '../src/tapeout/index.ts';

// XOR as taped out on X Layer (OnlyTestXLayer #1 and our fork CPU #1): 4 NAND, output = last signal.
const XOR = '0x00000002000003000000020000040000000300000400000005000006';

test('packBits / unpackBits are LSB-first per byte', () => {
  assert.equal(packBits([]), '0x');
  assert.equal(packBits([1]), '0x01');
  assert.equal(packBits([0, 1]), '0x02');
  assert.equal(packBits([1, 1, 1, 1, 1, 1, 1, 1, 1]), '0xff01');
  assert.equal(packBits([true, false, true]), '0x05');
  assert.deepEqual(unpackBits('0xfc01', 9), [0, 0, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(unpackBits('0x', 3), [0, 0, 0]); // missing bytes read as 0, like eval()
  assert.deepEqual(unpackBits(new Uint8Array([2]), 2), [0, 1]);
});

test('bitsOfInt / intOfBits round-trip', () => {
  for (const v of [0n, 1n, 5n, 255n, 256n, 0xabcdn]) assert.equal(intOfBits(bitsOfInt(v, 16)), v);
  assert.deepEqual(bitsOfInt(6, 3), [0, 1, 1]);
  assert.equal(packBits(bitsOfInt(3, 2)), '0x03');
});

test('scanNetlist counts burns and accepts the XOR netlist', () => {
  const s = scanNetlist(XOR, 2, 1);
  assert.equal(s.nand, 4);
  assert.equal(s.latch, 0);
  assert.equal(s.elementSignals, 4);
  assert.deepEqual(s.burn, { nand: 4n, latch: 0n });
});

test('scanNetlist: LATCH may point forward, NAND may not', () => {
  // toggle: q = LATCH(d = 7); 7 = q XOR in
  const toggle = '0x0100000700000003000002000000030000040000000200000400000005000006';
  const s = scanNetlist(toggle, 1, 1);
  assert.equal(s.latch, 1);
  assert.equal(s.nand, 4);
  assert.throws(() => scanNetlist('0x00000002000005', 2, 1), /future signal/);
});

test('scanNetlist mirrors tapeout() output rules', () => {
  assert.throws(() => scanNetlist('0x', 1, 1), /too few signals/); // outputs never come from inputs
  assert.throws(() => scanNetlist('0x00000002000003', 2, 2), /too few signals/);
  assert.throws(() => scanNetlist('0x00000002000002', 1, 0), /no outputs/);
  assert.throws(() => scanNetlist('0x07', 1, 1), /unknown opcode/);
  assert.throws(() => scanNetlist('0x00000002', 1, 1), /truncated/);
});

test('scanNetlist parses REF elements (free: no transistor burn)', () => {
  const cpu = 'b04eb79d1a5eecaabaaff7b77d7c27578ee693ff';
  // XOR3 = XOR(XOR(a,b),c) from two REFs to circuit #1
  const nl = `0x02${cpu}0000000000000001020100000200000302${cpu}00000000000000010201000005000004` as const;
  const s = scanNetlist(nl, 3, 1);
  assert.equal(s.refs.length, 2);
  assert.equal(s.refs[0].cpu, `0x${cpu}`);
  assert.equal(s.refs[0].circuitId, 1n);
  assert.deepEqual(s.burn, { nand: 0n, latch: 0n });
  assert.equal(s.elementSignals, 2);
});

test('cost formulas', () => {
  assert.equal(mintValue(4n, 66_000_000_000_000n, OBSERVED_FEES.protocolFee), 924_000_000_000_000n);
  assert.throws(() => mintValue(0n, 1n, 1n));
  const q = quoteTapeout(XOR, 2, 1, { mintPrice: 66_000_000_000_000n, gasPrice: 20_000_000n });
  assert.equal(q.value, OBSERVED_FEES.tapeoutFee);
  assert.deepEqual(q.burn, { nand: 4n, latch: 0n });
  assert.equal(q.mintCost, 924_000_000_000_000n);
  assert.ok(q.gas > 200_000n && q.gas < 300_000n);
  const l = quoteLaunch({ supply: 100_000n, mintPrice: 66_000_000_000_000n, mintNand: 1000n, mintLatch: 0n, tapeouts: 5, opens: 1 });
  // 0.0066 deploy + 0.066 mint + 0.00066 protocol + 5 * 0.0013 + 0.08 open
  assert.equal(l.fixed, 6_600_000_000_000_000n + 66_000_000_000_000_000n + 660_000_000_000_000n + 6_500_000_000_000_000n + 80_000_000_000_000_000n);
  assert.equal(l.refundToCreator, 66_000_000_000_000_000n);
});

test('ABI selectors match the live X Layer bytecode', () => {
  const sel = (abi: readonly unknown[], name: string) => {
    const item = (abi as { type: string; name?: string }[]).find((x) => x.type === 'function' && x.name === name);
    assert.ok(item, name);
    return toFunctionSelector(item as Parameters<typeof toFunctionSelector>[0]);
  };
  assert.equal(sel(factoryAbi, 'createCPU'), '0x47f9b5fd');
  assert.equal(sel(factoryAbi, 'cpus'), '0xd2c26963');
  assert.equal(sel(transistorsAbi, 'mint'), '0x1b2ef1ca');
  assert.equal(sel(transistorsAbi, 'balanceOfBatch'), '0x4e1273f4');
  assert.equal(sel(circuitsAbi, 'tapeout'), '0x7bd3ac1d');
  assert.equal(sel(circuitsAbi, 'eval'), '0x934d06ea');
  assert.equal(sel(circuitsAbi, 'step'), '0xe8281a1a');
  assert.equal(sel(circuitsAbi, 'circuitInfo'), '0x084d60f1');
  assert.equal(sel(openerAbi, 'open'), '0x0a0e5c9d');
  assert.equal(sel(openerAbi, 'accountOf'), '0x0c1905e5');
  assert.equal(sel(accountAbi, 'execute'), '0x51945447');
  assert.equal(sel(accountAbi, 'token'), '0xfc0c546a');
});
