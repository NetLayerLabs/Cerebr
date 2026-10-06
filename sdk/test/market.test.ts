import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEventSelector, toFunctionSelector, type Address } from 'viem';
import {
  MAX_PRICE,
  XLAYER_MARKET,
  assertListablePrice,
  buyBlockReason,
  circuitMarketAbi,
  circuitMarketAbiHuman,
  explainMarketError,
  splitSale,
  type Listing,
} from '../src/tapeout/market.ts';

// Selectors present in the deployed implementation 0x38d688F4…3dB6E (cast selectors, 2026-10-06).
const DEPLOYED = new Set([
  '0x023b1fc9', '0x06d6e63f', '0x216f2f24', '0x24a9d853', '0x24b6434b', '0x2e112757', '0x3ccfd60b', '0x3d8886f1',
  '0x3fb27b85', '0x4f1ef286', '0x52d1902d', '0x5e60f358', '0x631f9852', '0x6816b596', '0x715018a6', '0x8da5cb5b',
  '0x964bc33f', '0xaaccf1ec', '0xad3cb1cc', '0xbeab7067', '0xc45a0155', '0xd55be8c6', '0xdbc73406', '0xde74e57b',
  '0xdf18e047', '0xf01e9a8b', '0xf2fde38b',
]);

test('every function in the market ABI exists in the deployed implementation', () => {
  for (const sig of circuitMarketAbiHuman.filter((s) => s.startsWith('function '))) {
    const sel = toFunctionSelector(sig);
    assert.ok(DEPLOYED.has(sel), `${sig} -> ${sel} not deployed`);
  }
});

test('event topics match the fork receipts', () => {
  const topics = Object.fromEntries(circuitMarketAbi.filter((x) => x.type === 'event').map((e) => [e.name, toEventSelector(e)]));
  assert.equal(topics.Listed, '0x723f73331eaee88eec7fc68ef60ab6ed15e4b90d0472b55eb92fa43910bab6dd');
  assert.equal(topics.Sold, '0x2938a0a3a4a7c19c3a1fe6ef25340b7acd26dfac11de87836084d42fccc18656');
  assert.equal(topics.PriceChanged, '0x8aa4fa52648a6d15edce8a179c792c86f3719d0cc3c572cf90f91948f0f2cb68');
  assert.equal(topics.Delisted, '0xd42ab404868acd93610bdba51d0b4ae458bc5b37febb299ae73fe44060fa9882');
});

test('X Layer market config', () => {
  assert.equal(XLAYER_MARKET.chainId, 196);
  assert.equal(XLAYER_MARKET.circuitMarket, '0xd89f358c48a7B632c9845af2a02A32eB90DD75DB');
  assert.equal(XLAYER_MARKET.transistorMarket, null);
});

test('splitSale floors the fee (fork: 0.01 OKB at 100 bps -> 0.0099 seller, 0.0001 fee)', () => {
  assert.deepEqual(splitSale(10n ** 16n, 100), { fee: 10n ** 14n, toSeller: 99n * 10n ** 14n });
  assert.deepEqual(splitSale(99n, 100), { fee: 0n, toSeller: 99n });
  assert.deepEqual(splitSale(1000n, 300n), { fee: 30n, toSeller: 970n });
  assert.deepEqual(splitSale(0n, 100), { fee: 0n, toSeller: 0n });
});

test('assertListablePrice rejects zero and > uint96', () => {
  assert.throws(() => assertListablePrice(0n), /zero price/);
  assert.throws(() => assertListablePrice(MAX_PRICE + 1n), /uint96/);
  assert.doesNotThrow(() => assertListablePrice(MAX_PRICE));
});

const seller = '0xc742AdA2872a042dD36D2E706907b4036968960C' as Address;
const buyer = '0x00000000000000000000000000000000cebbb001' as Address;
const listing = (o: Partial<Listing> = {}): Listing => ({
  id: 1n,
  seller,
  circuits: '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF',
  tokenId: 15n,
  price: 10n ** 16n,
  feeBps: 100,
  valid: true,
  ...o,
});

test('buyBlockReason blocks self-trading, stale and missing listings', () => {
  assert.equal(buyBlockReason(listing(), buyer), null);
  assert.equal(buyBlockReason(listing(), seller), 'own-listing');
  assert.equal(buyBlockReason(listing(), seller.toLowerCase() as Address), 'own-listing');
  assert.equal(buyBlockReason(listing({ valid: false }), buyer), 'stale');
  assert.equal(buyBlockReason(null, buyer), 'no-listing');
  assert.equal(buyBlockReason(listing({ id: 0n }), buyer), 'no-listing');
  assert.equal(buyBlockReason(listing(), undefined), 'not-connected');
});

test('explainMarketError maps fork revert reasons', () => {
  assert.match(explainMarketError(new Error('execution reverted: price changed')) ?? '', /changed the price/);
  assert.match(explainMarketError(new Error('execution reverted: own listing')) ?? '', /your own listing/);
  assert.match(explainMarketError(new Error('custom error 0x177e802f: ...')) ?? '', /stale/);
  assert.equal(explainMarketError(new Error('something else')), undefined);
});
