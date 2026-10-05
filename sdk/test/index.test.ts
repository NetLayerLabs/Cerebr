// The package root exposes the compiler at the top level and the TapeOut client as `tapeout`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '../src/index.ts';

test('root exports neuro names and the tapeout namespace', () => {
  assert.equal(typeof sdk.getCircuit, 'function');
  assert.equal(typeof sdk.encodeHex, 'function');
  assert.equal(typeof sdk.tapeout.tapeout, 'function');
  assert.equal(typeof sdk.tapeout.evalCircuit, 'function');
  // neuro's packBits (Uint8Array) wins at the root; tapeout's (Hex) stays in its namespace.
  assert.ok(sdk.packBits([1, 0, 1]) instanceof Uint8Array);
  assert.equal(typeof sdk.tapeout.packBits([1, 0, 1]), 'string');
});
