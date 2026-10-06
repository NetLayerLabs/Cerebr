// TapeOut circuit marketplace on a LOCAL anvil fork of X Layer. Never points at a public RPC.
//
//   anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8602 --silent
//   FORK_RPC=http://127.0.0.1:8602 node scripts/fork-market.ts
//
// The Cerebr creator lists circuit #15, a separate synthetic buyer buys it (the creator never buys
// its own listing: self-trading is voided by the hackathon and blocked by the contract), and the
// script checks proceeds, the protocol fee, the brain wallet following the NFT, setPrice /
// expectedPrice, delist, stale listings and delistStale. Prints PASS/FAIL and a gas table.
// The fork state is reverted at the end.

import { createPublicClient, createTestClient, createWalletClient, formatEther, http, parseAbi, parseEther, parseEventLogs, type Address, type PublicClient } from 'viem';
import { XLAYER, accountOf, openAccount, readAccount, xLayerFork } from '../src/tapeout/index.ts';
import {
  BSC_MARKETS,
  XLAYER_MARKET,
  buyListing,
  cancelListing,
  circuitMarketAbi,
  explainMarketError,
  listCircuit,
  readListing,
  readListingById,
  readListings,
  readMarket,
  setPrice,
  splitSale,
} from '../src/tapeout/market.ts';

const rpc = process.env.FORK_RPC ?? 'http://127.0.0.1:8602';
const host = new URL(rpc).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing non-local RPC ${rpc}: forks only`);

const transport = http(rpc);
const chain = xLayerFork(rpc, await createPublicClient({ transport }).getChainId());
const pc = createPublicClient({ chain, transport }) as PublicClient;
const test = createTestClient({ chain, transport, mode: 'anvil' });
const wallet = (address: Address) => createWalletClient({ chain, transport, account: address });

const CIRCUITS: Address = '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF';
const CREATOR: Address = '0xc742AdA2872a042dD36D2E706907b4036968960C';
const BUYER: Address = '0x00000000000000000000000000000000cebbb001';
const OTHER: Address = '0x00000000000000000000000000000000cebbb002';
const KEEPER: Address = '0x00000000000000000000000000000000cebbb003';
const TOKEN = 15n;
const M = XLAYER_MARKET.circuitMarket;

const erc721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
]);

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const gas: [string, bigint][] = [];
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** eth_call that must revert; returns the revert text. */
async function reverts(from: Address, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return '';
  } catch (e) {
    return `${(e as Error).message}`;
  }
}
const simBuy = (from: Address, id: bigint, expected: bigint, value: bigint) =>
  reverts(from, () => pc.simulateContract({ account: from, address: M, abi: circuitMarketAbi, functionName: 'buy', args: [id, expected], value }));

async function transfer(from: Address, to: Address) {
  const h = await wallet(from).writeContract({ address: CIRCUITS, abi: erc721, functionName: 'transferFrom', args: [from, to, TOKEN], chain });
  await pc.waitForTransactionReceipt({ hash: h });
}

async function main() {
  const chainId = await pc.getChainId();
  check('fork of X Layer', chainId === 196 || chainId === 31337, `chainId ${chainId}, block ${await pc.getBlockNumber()}`);
  const snap = await test.snapshot();
  try {
    for (const a of [BUYER, OTHER, KEEPER, CREATOR]) await test.setBalance({ address: a, value: parseEther('1') });

    // ---- 0. deployment facts
    const code = await pc.getCode({ address: M });
    const implSlot = await pc.getStorageAt({ address: M, slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' });
    const impl = `0x${(implSlot ?? '0x').slice(-40)}`;
    const info = await readMarket(pc);
    check('circuit market has code (EIP-1967 UUPS proxy)', !!code && code.length > 2 && eq(impl, XLAYER_MARKET.circuitMarketImpl), `${(code!.length - 2) / 2} bytes, impl ${impl}`);
    check('market wired to the TapeOut factory', eq(await pc.readContract({ address: M, abi: parseAbi(['function factory() view returns (address)']), functionName: 'factory' }), XLAYER.factory));
    check('feeBps / MAX_FEE_BPS / protocolWallet', info.feeBps === 100 && info.maxFeeBps === 300 && eq(info.protocolWallet, '0x571d447f4f24688eC35Ccf07f1D6993655F6aF15'), `fee ${info.feeBps} bps, max ${info.maxFeeBps}, wallet ${info.protocolWallet}, owner ${info.owner}, sealed ${info.sealed}, nextListingId ${info.nextListingId}`);
    for (const [k, a] of Object.entries({ circuitMarket: BSC_MARKETS.circuitMarket, transistorBidMarket: BSC_MARKETS.transistorBidMarket })) {
      const c = await pc.getCode({ address: a });
      check(`BSC ${k} address has no code on X Layer (no transistor order book here)`, !c || c === '0x');
    }
    check('creator owns circuit #15', eq(await pc.readContract({ address: CIRCUITS, abi: erc721, functionName: 'ownerOf', args: [TOKEN] }), CREATOR));

    // brain wallet: open it on the fork (anyone may pay) so we can watch owner() follow the NFT
    let acct = await accountOf(pc, CIRCUITS, TOKEN);
    if (!acct.opened) await openAccount(wallet(KEEPER), pc, { circuits: CIRCUITS, tokenId: TOKEN });
    acct = await accountOf(pc, CIRCUITS, TOKEN);
    check('brain wallet owner = creator before sale', eq((await readAccount(pc, acct.account)).owner, CREATOR), acct.account);

    // ---- 1. list (needs approval)
    const p1 = parseEther('0.01');
    const noApproval = await reverts(CREATOR, () => pc.simulateContract({ account: CREATOR, address: M, abi: circuitMarketAbi, functionName: 'list', args: [CIRCUITS, TOKEN, p1] }));
    check('list without approval reverts "not approved"', noApproval.includes('not approved'));
    const notOwner = await reverts(BUYER, () => pc.simulateContract({ account: BUYER, address: M, abi: circuitMarketAbi, functionName: 'list', args: [CIRCUITS, TOKEN, p1] }));
    check('list by non-owner reverts "not owner"', notOwner.includes('not owner'));
    const l1 = await listCircuit(wallet(CREATOR), pc, { circuits: CIRCUITS, tokenId: TOKEN, price: p1 });
    gas.push(['approve(market, id)', l1.approval!.receipt.gasUsed], ['list (first ever listing)', l1.receipt.gasUsed]);
    const ev = parseEventLogs({ abi: circuitMarketAbi, logs: l1.receipt.logs, eventName: 'Listed' })[0];
    check('Listed event', !!ev && ev.args.id === l1.listingId && eq(ev.args.seller, CREATOR) && ev.args.tokenId === TOKEN && ev.args.price === p1, `listing id ${l1.listingId}`);
    let L = await readListing(pc, CIRCUITS, TOKEN);
    check('listingFor/listingView', !!L && L.id === l1.listingId && L.valid && L.price === p1 && L.feeBps === 100 && eq(L.seller, CREATOR));
    const batch = await readListings(pc, CIRCUITS, [14n, TOKEN]);
    check('readListings (multicall) for a gallery', batch[0] === null && batch[1]?.id === l1.listingId && batch[1]?.valid === true);
    check('approval-based: NFT stays with seller', eq(await pc.readContract({ address: CIRCUITS, abi: erc721, functionName: 'ownerOf', args: [TOKEN] }), CREATOR));

    // ---- 2. guards
    const own = await simBuy(CREATOR, l1.listingId, p1, p1);
    check('seller cannot buy own listing ("own listing")', own.includes('own listing'), explainMarketError(new Error(own)));
    check('buy with underpayment reverts "wrong value"', (await simBuy(BUYER, l1.listingId, p1, p1 - 1n)).includes('wrong value'));
    check('buy with overpayment reverts "wrong value"', (await simBuy(BUYER, l1.listingId, p1, p1 + 1n)).includes('wrong value'));

    // ---- 3. setPrice + expectedPrice guard
    const p2 = parseEther('0.012');
    const notSeller = await reverts(BUYER, () => pc.simulateContract({ account: BUYER, address: M, abi: circuitMarketAbi, functionName: 'setPrice', args: [l1.listingId, 1n] }));
    check('setPrice by non-seller reverts "not your listing"', notSeller.includes('not your listing'));
    const sp = await setPrice(wallet(CREATOR), pc, { listingId: l1.listingId, price: p2 });
    gas.push(['setPrice', sp.receipt.gasUsed]);
    check('PriceChanged event', parseEventLogs({ abi: circuitMarketAbi, logs: sp.receipt.logs, eventName: 'PriceChanged' })[0]?.args.price === p2);
    check('buy at the old price reverts "price changed" (front-running guard)', (await simBuy(BUYER, l1.listingId, p1, p1)).includes('price changed'));

    // ---- 4. fee snapshot: the owner raises feeBps after listing
    await test.impersonateAccount({ address: info.owner });
    await test.setBalance({ address: info.owner, value: parseEther('1') });
    const ownerAbi = parseAbi(['function setFeeBps(uint16)']);
    await pc.waitForTransactionReceipt({ hash: await wallet(info.owner).writeContract({ address: M, abi: ownerAbi, functionName: 'setFeeBps', args: [300], chain }) });
    L = await readListingById(pc, l1.listingId);
    check('feeBps is snapshotted per listing (owner set 300, listing keeps its fee)', L!.feeBps === 100, `listing feeBps ${L!.feeBps}, global ${(await readMarket(pc)).feeBps}`);

    // ---- 5. buy
    const pw = info.protocolWallet;
    const before = {
      seller: await pc.getBalance({ address: CREATOR }),
      market: await pc.getBalance({ address: M }),
      owed: await pc.readContract({ address: M, abi: circuitMarketAbi, functionName: 'owed', args: [pw] }),
    };
    const b = await buyListing(wallet(BUYER), pc, { listingId: l1.listingId, expectedPrice: p2 });
    gas.push(['buy', b.receipt.gasUsed]);
    const sold = parseEventLogs({ abi: circuitMarketAbi, logs: b.receipt.logs, eventName: 'Sold' })[0];
    const { fee, toSeller } = splitSale(p2, L!.feeBps);
    check('Sold event: paidToSeller and fee at the listing fee', !!sold && sold.args.paidToSeller === toSeller && sold.args.fee === fee, `paidToSeller ${formatEther(sold.args.paidToSeller)} fee ${formatEther(sold.args.fee)}`);
    check('NFT moved to buyer', eq(await pc.readContract({ address: CIRCUITS, abi: erc721, functionName: 'ownerOf', args: [TOKEN] }), BUYER));
    check('seller received price - fee (pushed)', (await pc.getBalance({ address: CREATOR })) - before.seller === toSeller);
    const owedAfter = await pc.readContract({ address: M, abi: circuitMarketAbi, functionName: 'owed', args: [pw] });
    check('fee accrues to owed(protocolWallet) and stays in the market (pull)', owedAfter - before.owed === fee && (await pc.getBalance({ address: M })) - before.market === fee);
    check('brain wallet owner() follows the NFT to the buyer', eq((await readAccount(pc, acct.account)).owner, BUYER));
    check('listing cleared after sale', (await readListing(pc, CIRCUITS, TOKEN)) === null && (await readListingById(pc, l1.listingId)) === null);
    check('buying the sold listing again reverts', (await simBuy(OTHER, l1.listingId, p2, p2)) !== '');
    // restore the global fee
    await pc.waitForTransactionReceipt({ hash: await wallet(info.owner).writeContract({ address: M, abi: ownerAbi, functionName: 'setFeeBps', args: [100], chain }) });

    // ---- 6. relist (setApprovalForAll path) and delist
    const r = await listCircuit(wallet(BUYER), pc, { circuits: CIRCUITS, tokenId: TOKEN, price: p1, approveAll: true });
    gas.push(['setApprovalForAll(market)', r.approval!.receipt.gasUsed], ['list (later listing)', r.receipt.gasUsed]);
    check('buyer relists with setApprovalForAll', (await readListing(pc, CIRCUITS, TOKEN))?.id === r.listingId);
    check('delist by non-seller reverts "not your listing"', (await reverts(OTHER, () => pc.simulateContract({ account: OTHER, address: M, abi: circuitMarketAbi, functionName: 'delist', args: [r.listingId] }))).includes('not your listing'));
    const d = await cancelListing(wallet(BUYER), pc, { listingId: r.listingId });
    gas.push(['delist', d.receipt.gasUsed]);
    const de = parseEventLogs({ abi: circuitMarketAbi, logs: d.receipt.logs, eventName: 'Delisted' })[0];
    check('delist clears the listing (Delisted stale=false)', (await readListing(pc, CIRCUITS, TOKEN)) === null && de?.args.stale === false);
    check('buying a delisted listing reverts', (await simBuy(OTHER, r.listingId, p1, p1)) !== '');

    // ---- 7. double listing: does a second list() supersede the first?
    const a1 = await listCircuit(wallet(BUYER), pc, { circuits: CIRCUITS, tokenId: TOKEN, price: p1 });
    const a2 = await listCircuit(wallet(BUYER), pc, { circuits: CIRCUITS, tokenId: TOKEN, price: p2 });
    const oldView = await readListingById(pc, a1.listingId);
    check('re-listing the same NFT replaces the old listing', (await readListing(pc, CIRCUITS, TOKEN))?.id === a2.listingId && (oldView === null || !oldView.valid), `old listing ${oldView ? `still stored, valid=${oldView.valid}` : 'cleared'}`);
    check('old listing cannot be bought', (await simBuy(OTHER, a1.listingId, p1, p1)) !== '');

    // ---- 8. transfer -> stale; transfer back; delistStale
    await transfer(BUYER, OTHER);
    L = await readListing(pc, CIRCUITS, TOKEN);
    check('listing goes stale (valid=false) after the NFT is transferred', !!L && !L.valid);
    const staleBuy = await simBuy(KEEPER, a2.listingId, p2, p2);
    check('buying a stale listing reverts (ERC721InsufficientApproval)', staleBuy !== '', explainMarketError(new Error(staleBuy)));
    await transfer(OTHER, BUYER);
    L = await readListing(pc, CIRCUITS, TOKEN);
    console.log(`INFO  after the NFT returns to the seller the old listing is valid=${L?.valid} (a forgotten listing can re-activate: cancel listings explicitly)`);
    await transfer(BUYER, OTHER);
    const ds = await cancelListing(wallet(KEEPER), pc, { listingId: a2.listingId, stale: true });
    gas.push(['delistStale (anyone)', ds.receipt.gasUsed]);
    check('anyone can delistStale a stale listing (Delisted stale=true)', (await readListing(pc, CIRCUITS, TOKEN)) === null && parseEventLogs({ abi: circuitMarketAbi, logs: ds.receipt.logs, eventName: 'Delisted' })[0]?.args.stale === true);

    // ---- 9. revoked approval -> stale
    const c1 = await listCircuit(wallet(OTHER), pc, { circuits: CIRCUITS, tokenId: TOKEN, price: p1, approveAll: true });
    await pc.waitForTransactionReceipt({ hash: await wallet(OTHER).writeContract({ address: CIRCUITS, abi: erc721, functionName: 'setApprovalForAll', args: [M, false], chain }) });
    check('revoking approval makes the listing invalid', (await readListingById(pc, c1.listingId))?.valid === false);
    const validDelist = await reverts(KEEPER, () => pc.simulateContract({ account: KEEPER, address: M, abi: circuitMarketAbi, functionName: 'delistStale', args: [a2.listingId] }));
    check('delistStale on an already-cleared listing reverts', validDelist !== '');
  } finally {
    await test.revert({ id: snap });
  }

  console.log('\nGas');
  for (const [k, v] of gas) console.log(`  ${k.padEnd(30)} ${v}`);
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  if (failures) process.exitCode = 1;
}

await main();
