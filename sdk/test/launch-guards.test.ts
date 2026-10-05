// Launch-script safety rails that can be checked offline: keep is minted once per token, a finished
// mainnet launch refuses to send, an existing launch record blocks a second createCPU, and no error
// path echoes PRIVATE_KEY. (The on-chain halves are exercised on an anvil fork; see LAUNCH.md.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, redactSecrets } from '../scripts/lib/chain.ts';
import { doneGuard, recordedLaunch } from '../scripts/lib/guards.ts';
import { buildPlan, effectiveKeep } from '../scripts/lib/plan.ts';
import { getLaunchDir, setLaunchDir, type LaunchState } from '../scripts/lib/state.ts';
import { OBSERVED_FEES } from '../src/tapeout/index.ts';
import type { LaunchConfig } from '../scripts/lib/config.ts';

const keep = { nand: 1000n, latch: 100n };
const tx = { hash: '0x01', block: '1', gasUsed: '1', gasCost: '1', value: '1' } as const;
const mint = (id: 'NAND' | 'LATCH') => ({ id, amount: '1', value: '1', tx: tx as never });

test('keep is minted once per token', () => {
  assert.deepEqual(effectiveKeep(keep, []), keep);
  assert.deepEqual(effectiveKeep(keep, [mint('NAND')]), { nand: 0n, latch: 100n });
  assert.deepEqual(effectiveKeep(keep, [mint('LATCH')]), { nand: 1000n, latch: 0n });
  assert.deepEqual(effectiveKeep(keep, [mint('NAND'), mint('LATCH')]), { nand: 0n, latch: 0n });
});

function plan(mints: LaunchState['mints'], balances: { nand: bigint; latch: bigint }) {
  const cfg = { cpu: { name: 'C', symbol: 'C', story: 's' }, issuance: { transistorSupply: 1n, mintPriceOkb: '0', mintPrice: 1n, confirmed: true }, openAccounts: [], keep, withdrawCreatorRevenue: true } as unknown as LaunchConfig;
  const state = { cpu: { circuits: '0x1', transistors: '0x2', tx }, mints, circuits: {}, accounts: {}, withdrawals: [] } as unknown as LaunchState;
  return buildPlan({ cfg, state, compiled: [], fees: OBSERVED_FEES, mintPrice: 1n, balances, openedAlready: new Set(), skipOpen: true, owed: 0n, gasPrice: 1n });
}

test('a finished launch whose kept transistors were spent plans no mint', () => {
  // first run: keep is minted
  const first = plan([], { nand: 0n, latch: 0n });
  assert.equal(first.mintNand, 1000n);
  assert.equal(first.mintLatch, 100n);
  // after the launch (both tokens minted) the deployer moved every kept transistor away
  const after = plan([mint('NAND'), mint('LATCH')], { nand: 0n, latch: 0n });
  assert.equal(after.steps.length, 0);
  assert.equal(after.mintNand + after.mintLatch, 0n);
});

test('a done mainnet state refuses sending runs unless --continue-after-done', () => {
  const base = { mainnet: true, sends: true, done: '2026-10-05T21:31:44.181Z', statePath: 'launch/state.196.json', continueAfterDone: false };
  assert.match(doneGuard(base) ?? '', /completed at 2026-10-05.*--continue-after-done/s);
  assert.equal(doneGuard({ ...base, continueAfterDone: true }), undefined);
  assert.equal(doneGuard({ ...base, sends: false }), undefined); // --dry-run / --verify-only
  assert.equal(doneGuard({ ...base, mainnet: false }), undefined);
  assert.equal(doneGuard({ ...base, done: undefined }), undefined);
});

test('a mainnet launch record blocks createCPU planning', () => {
  const prev = getLaunchDir();
  const dir = mkdtempSync(join(tmpdir(), 'cerebr-launch-'));
  try {
    setLaunchDir(dir);
    assert.equal(recordedLaunch(196), undefined);
    mkdirSync(join(dir, 'out'));
    writeFileSync(join(dir, 'out', '196.fork.json'), '{}'); // fork records do not count
    assert.equal(recordedLaunch(196), undefined);
    writeFileSync(join(dir, 'out', '196.json'), JSON.stringify({ processor: { circuits: '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF', transistors: '0x84b5a5c6fE305319458113b87c09a2A241427D2D' } }));
    assert.equal(recordedLaunch(196)?.circuits, '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF');
  } finally {
    setLaunchDir(prev);
  }
});

test('an invalid PRIVATE_KEY is never echoed', async () => {
  const saved = process.env.PRIVATE_KEY;
  const keys = [
    'f'.repeat(64), // >= secp256k1 order: viem would echo it
    `0x${'f'.repeat(64)}`,
    '0'.repeat(64), // zero key
    'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141', // exactly the order
    'not-a-key-but-secret-material-123456',
  ];
  try {
    for (const k of keys) {
      process.env.PRIVATE_KEY = k;
      await assert.rejects(connect({ network: 'xlayer', rpc: 'https://rpc.xlayer.tech', needSigner: true }), (e: Error) => {
        const bare = k.replace(/^0x/, '');
        // viem/noble print an out-of-range key in decimal, so check that spelling too
        const spellings = [bare.toLowerCase(), ...(/^[0-9a-f]+$/i.test(bare) && BigInt(`0x${bare}`) > 0n ? [BigInt(`0x${bare}`).toString()] : [])];
        for (const sp of spellings) {
          assert.ok(!e.message.toLowerCase().includes(sp), `message leaks the key: ${e.message}`);
          assert.ok(!String(e.stack).toLowerCase().includes(sp), 'stack leaks the key');
        }
        assert.match(e.message, /PRIVATE_KEY is not a (valid secp256k1 private key|32-byte hex key)/);
        return true;
      });
    }
  } finally {
    if (saved === undefined) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = saved;
  }
});

test('redactSecrets scrubs PRIVATE_KEY in any spelling', () => {
  const key = 'ab'.repeat(32);
  const env = { PRIVATE_KEY: `0x${key}` } as NodeJS.ProcessEnv;
  const text = `a ${key} b 0x${key.toUpperCase()} c`;
  assert.equal(redactSecrets(text, env), 'a [redacted] b [redacted] c');
  assert.equal(redactSecrets(text, {} as NodeJS.ProcessEnv), text);
  assert.equal(redactSecrets(`got ${BigInt(`0x${key}`)}`, env), 'got [redacted]');
});
