import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, keccak256, toFunctionSelector, type Address } from 'viem';
import {
  BSC_DROPS,
  DROPS_CREATION_CODE,
  DROPS_CREATION_CODEHASH,
  XLAYER_DROPS,
  dropShares,
  dropsAbi,
  dropsDeployData,
  explainDropError,
  planDrop,
  requireDrops,
  toDrop,
} from '../src/tapeout/drops.ts';
import { XLAYER } from '../src/tapeout/addresses.ts';

test('dropsAbi selectors match the live BSC bytecode (cast selectors)', () => {
  const want: Record<string, string> = {
    supportsInterface: '0x01ffc9a7',
    claimed: '0x120aa877',
    claim: '0x379607f5',
    cancelTo: '0x38a9b1f7',
    cancel: '0x40e58ee5',
    drops: '0x5eb39968',
    getDrops: '0x9bda24a3',
    create: '0xa88b00c5',
    onERC1155BatchReceived: '0xbc197c81',
    factory: '0xc45a0155',
    nextDropId: '0xce0ef310',
    claimedBy: '0xdda7de0a',
    onERC1155Received: '0xf23a6e61',
  };
  const fns = dropsAbi.filter((x) => x.type === 'function');
  assert.equal(fns.length, Object.keys(want).length);
  for (const f of fns) assert.equal(toFunctionSelector(f), want[f.name], f.name);
});

test('event topics match the TapeOut bundle signatures', () => {
  assert.equal(
    encodeEventTopics({ abi: dropsAbi, eventName: 'DropCreated' })[0],
    '0x75fa255e75853710e56e52e2d4fc2b59529067c14ddd24a7a306e3d67d32c3f8',
  );
  assert.equal(encodeEventTopics({ abi: dropsAbi, eventName: 'Claimed' })[0], keccak256(new TextEncoder().encode('Claimed(uint256,address,uint256)')));
  assert.equal(encodeEventTopics({ abi: dropsAbi, eventName: 'DropCancelled' })[0], keccak256(new TextEncoder().encode('DropCancelled(uint256,uint256)')));
});

test('creation code is the pinned TapeOut artifact', () => {
  assert.equal(keccak256(DROPS_CREATION_CODE), DROPS_CREATION_CODEHASH);
  const data = dropsDeployData();
  assert.equal(data.length, DROPS_CREATION_CODE.length + 64);
  assert.ok(data.toLowerCase().endsWith(XLAYER.factory.slice(2).toLowerCase()));
});

test('dropShares mirrors create() checks and dust', () => {
  assert.deepEqual(dropShares(400n, 16n), { amount: 400n, perClaim: 16n, claims: 25n, dust: 0n });
  assert.deepEqual(dropShares(400n, 17n), { amount: 400n, perClaim: 17n, claims: 23n, dust: 9n });
  assert.deepEqual(dropShares(20n, 16n), { amount: 20n, perClaim: 16n, claims: 1n, dust: 4n });
  assert.throws(() => dropShares(400n, 0n), /perClaim = 0/);
  assert.throws(() => dropShares(15n, 16n), /amount < perClaim/);
  assert.throws(() => dropShares(1n << 128n, 16n), /uint128/);
  assert.throws(() => dropShares(1n << 100n, 1n << 96n), /uint96/);
});

test('planDrop', () => {
  assert.deepEqual(planDrop(16n, 50n), { amount: 800n, perClaim: 16n, claims: 50n, dust: 0n });
  assert.throws(() => planDrop(0n, 1n));
  assert.throws(() => planDrop(16n, 0n));
});

test('toDrop derives sharesLeft / live', () => {
  const base = {
    creator: '0xc742AdA2872a042dD36D2E706907b4036968960C' as Address,
    perClaim: 16n,
    transistors: '0x84b5a5c6fE305319458113b87c09a2A241427D2D' as Address,
    tokenId: 0,
    cancelled: false,
    remaining: 36n,
    claimedCount: 3n,
  };
  const d = toDrop(1n, base);
  assert.equal(d.sharesLeft, 2n);
  assert.equal(d.live, true);
  assert.equal(toDrop(1n, { ...base, remaining: 4n }).live, false); // "drained": remaining < perClaim
  assert.equal(toDrop(1n, { ...base, cancelled: true }).live, false);
  assert.equal(toDrop(9n, { ...base, creator: '0x0000000000000000000000000000000000000000' }).live, false);
});

test('addresses and error mapping', () => {
  assert.equal(XLAYER_DROPS, undefined); // not deployed on X Layer: TapeOut ships drops on BSC only
  assert.equal(BSC_DROPS, '0x7Fd055496b638aD81f58B33Fd04d6e90bbC2a672');
  assert.throws(() => requireDrops(), /deployDrops/);
  assert.equal(requireDrops(BSC_DROPS), BSC_DROPS);
  assert.match(explainDropError(new Error('execution reverted: already claimed')) ?? '', /already claimed/);
  assert.match(explainDropError(new Error('custom error 0xe237d922: ...')) ?? '', /approve/);
  assert.match(explainDropError(new Error('reverted: already cancelled')) ?? '', /already cancelled/);
  assert.equal(explainDropError(new Error('something else')), undefined);
});
