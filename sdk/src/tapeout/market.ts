// TapeOut's native circuit marketplace on X Layer (chainId 196). See TAPEOUT.md "Marketplace" for
// the evidence behind every value here (verified on an anvil fork at block ~72.51M, 2026-10-06).
//
// The TapeOut client bundle only wires its markets to BSC (`circuitMarket` / `market` / `askMarket`
// exist in the chain-56 config; the chain-196 config has `features: { containers }` only). The
// X Layer circuit market was found as CREATE nonce 5 of the TapeOut deployer/protocolWallet
// (0x571d…aF15), deployed at block 70,995,076 right after the factory, with the same ABI as the BSC
// circuit market. It has never been used (nextListingId() was 0). There is NO transistor order book
// (placeAsk / placeBid) on X Layer.
//
// Mechanics (fork-verified):
//  * Approval-based, not escrow: the NFT stays in the seller's wallet. `list` requires
//    `approve(market, id)` or `setApprovalForAll(market, true)` first ("not approved").
//  * A listing is `valid` only while seller still owns the NFT and the market is still approved.
//    Transfer the NFT (or revoke approval) and it goes stale; anyone may `delistStale(id)`.
//  * `buy(id, expectedPrice)` requires msg.value == price exactly ("wrong value") and
//    expectedPrice == price ("price changed"): a front-running guard against setPrice.
//    The seller cannot buy their own listing ("own listing").
//  * Fee: `feeBps` (100 = 1%, MAX_FEE_BPS 300) is snapshotted into each listing at list time.
//    Seller proceeds (price - fee) are pushed in the same tx; the fee accrues to
//    `owed(protocolWallet)` (pulled with `withdraw()`).
//  * The circuit's ERC-6551 brain wallet follows the NFT (account owner() = NFT owner).

import {
  parseAbi,
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from 'viem';

type Wallet = WalletClient<Transport, Chain | undefined, Account>;

export interface MarketWriteResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

// ---------------------------------------------------------------- addresses

export interface CircuitMarketConfig {
  chainId: number;
  /** UUPS proxy (EIP-1967), owner 0xB3D8…3138, isSealed() = false. */
  circuitMarket: Address;
  /** Implementation behind the proxy at verification time. */
  circuitMarketImpl: Address;
  /** First block worth scanning for market events. */
  circuitMarketFrom: bigint;
  /** No TapeOut transistor order book is deployed on X Layer. */
  transistorMarket: null;
}

export const XLAYER_MARKET: CircuitMarketConfig = {
  chainId: 196,
  circuitMarket: '0xd89f358c48a7B632c9845af2a02A32eB90DD75DB',
  circuitMarketImpl: '0x38d688F4793a9Bf270c2c99492c9a1e45163dB6E',
  circuitMarketFrom: 70995076n,
  transistorMarket: null,
};

/** For reference only (BSC, chainId 56, from TapeOut's bundle): not usable on X Layer. */
export const BSC_MARKETS = {
  chainId: 56,
  circuitMarket: '0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f',
  transistorBidMarket: '0xA6a80C1919a8326022d7c601a488888C13aA16E4',
} as const;

// ---------------------------------------------------------------- ABI

export const circuitMarketAbiHuman = [
  'function list(address circuits, uint256 tokenId, uint96 price) returns (uint256)',
  'function buy(uint256 id, uint96 expectedPrice) payable',
  'function setPrice(uint256 id, uint96 price)',
  'function delist(uint256 id)',
  'function delistStale(uint256 id)',
  'function listingOf(address circuits, uint256 tokenId) view returns (uint256 id)',
  'function listingFor(address circuits, uint256 tokenId) view returns (uint256 id, address seller, uint96 price, bool valid)',
  'function listingView(uint256 id) view returns (address seller, address circuits, uint256 tokenId, uint96 price, uint16 feeBps, bool valid)',
  'function nextListingId() view returns (uint256)',
  'function feeBps() view returns (uint16)',
  'function MAX_FEE_BPS() view returns (uint16)',
  'function protocolWallet() view returns (address)',
  'function owed(address) view returns (uint256)',
  'function withdraw()',
  'function factory() view returns (address)',
  'function owner() view returns (address)',
  'function isSealed() view returns (bool)',
  'event Listed(uint256 indexed id, address indexed seller, address indexed circuits, uint256 tokenId, uint256 price)',
  'event Sold(uint256 indexed id, address indexed buyer, address indexed circuits, uint256 tokenId, uint256 paidToSeller, uint256 fee)',
  'event PriceChanged(uint256 indexed id, uint256 price)',
  'event Delisted(uint256 indexed id, address indexed by, bool stale)',
] as const;

export const circuitMarketAbi = parseAbi(circuitMarketAbiHuman);

const erc721ApprovalAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
]);

/** Revert reasons seen on the fork, mapped to UI copy. */
export const MARKET_ERRORS: Record<string, string> = {
  'not approved': 'Approve the marketplace for this circuit first.',
  'not owner': 'Only the circuit owner can list it.',
  'zero price': 'Price must be greater than zero.',
  'own listing': 'You cannot buy your own listing.',
  'price changed': 'The seller changed the price. Review the new price and try again.',
  'wrong value': 'Payment must equal the listing price exactly.',
  'not your listing': 'Only the seller can change or cancel this listing.',
  ERC721InsufficientApproval: 'This listing is stale: the seller moved the circuit or revoked approval.',
};

/** Maps a viem/RPC error to friendly copy (undefined if not a known market revert). */
export function explainMarketError(err: unknown): string | undefined {
  const msg = err instanceof Error ? `${err.message} ${(err as { shortMessage?: string }).shortMessage ?? ''}` : String(err);
  for (const [k, v] of Object.entries(MARKET_ERRORS)) if (msg.includes(k) || (k === 'ERC721InsufficientApproval' && msg.includes('0x177e802f'))) return v;
  return undefined;
}

// ---------------------------------------------------------------- pure helpers

export const BPS = 10_000n;

/** Fee and seller proceeds for a sale at `price` with the listing's snapshotted `feeBps` (floor). */
export function splitSale(price: bigint, feeBps: number | bigint): { fee: bigint; toSeller: bigint } {
  if (price < 0n) throw new Error('negative price');
  const fee = (price * BigInt(feeBps)) / BPS;
  return { fee, toSeller: price - fee };
}

/** Largest price that fits the market's uint96 price field. */
export const MAX_PRICE = (1n << 96n) - 1n;

export function assertListablePrice(price: bigint): void {
  if (price <= 0n) throw new Error('zero price');
  if (price > MAX_PRICE) throw new Error('price exceeds uint96');
}

/** Address equality helper (checksum-insensitive). */
export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface Listing {
  id: bigint;
  seller: Address;
  circuits: Address;
  tokenId: bigint;
  price: bigint;
  feeBps: number;
  /** True only while the seller still owns the NFT and the market is still approved. */
  valid: boolean;
}

export type BuyBlockReason = 'no-listing' | 'stale' | 'own-listing' | 'not-connected' | null;

/**
 * UI gate for the Buy button. Blocks buying your own listing (the contract also reverts "own
 * listing"; the hackathon voids self-trading, and Cerebr never trades with itself), stale listings
 * and missing listings.
 */
export function buyBlockReason(listing: Listing | null, viewer: Address | null | undefined): BuyBlockReason {
  if (!listing || listing.id === 0n) return 'no-listing';
  if (!viewer) return 'not-connected';
  if (sameAddress(listing.seller, viewer)) return 'own-listing';
  if (!listing.valid) return 'stale';
  return null;
}

// ---------------------------------------------------------------- reads

const mk = (cfg: CircuitMarketConfig) => ({ address: cfg.circuitMarket, abi: circuitMarketAbi }) as const;

/** Reads a listing by id. Returns null for ids that were never created, sold or delisted. */
export async function readListingById(pc: PublicClient, id: bigint, cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<Listing | null> {
  if (id === 0n) return null;
  const [seller, circuits, tokenId, price, feeBps, valid] = await pc.readContract({ ...mk(cfg), functionName: 'listingView', args: [id] });
  if (/^0x0{40}$/i.test(seller)) return null;
  return { id, seller, circuits, tokenId, price, feeBps, valid };
}

/** The current listing for a circuit NFT (null if none). One round trip via listingFor + listingView. */
export async function readListing(pc: PublicClient, circuits: Address, tokenId: bigint, cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<Listing | null> {
  const [id] = await pc.readContract({ ...mk(cfg), functionName: 'listingFor', args: [circuits, tokenId] });
  return readListingById(pc, id, cfg);
}

/** Batch read for a gallery (multicall). Order matches `tokenIds`. */
export async function readListings(pc: PublicClient, circuits: Address, tokenIds: bigint[], cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<(Listing | null)[]> {
  if (!tokenIds.length) return [];
  const res = await pc.multicall({
    contracts: tokenIds.map((tokenId) => ({ ...mk(cfg), functionName: 'listingFor' as const, args: [circuits, tokenId] as const })),
    allowFailure: false,
  });
  return res.map(([id, seller, price, valid], i) =>
    id === 0n ? null : { id, seller, circuits, tokenId: tokenIds[i], price, feeBps: -1, valid },
  );
}

export interface MarketInfo {
  market: Address;
  feeBps: number;
  maxFeeBps: number;
  protocolWallet: Address;
  nextListingId: bigint;
  owner: Address;
  sealed: boolean;
}

export async function readMarket(pc: PublicClient, cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<MarketInfo> {
  const c = mk(cfg);
  const [feeBps, maxFeeBps, protocolWallet, nextListingId, owner, sealed] = await Promise.all([
    pc.readContract({ ...c, functionName: 'feeBps' }),
    pc.readContract({ ...c, functionName: 'MAX_FEE_BPS' }),
    pc.readContract({ ...c, functionName: 'protocolWallet' }),
    pc.readContract({ ...c, functionName: 'nextListingId' }),
    pc.readContract({ ...c, functionName: 'owner' }),
    pc.readContract({ ...c, functionName: 'isSealed' }),
  ]);
  return { market: cfg.circuitMarket, feeBps, maxFeeBps, protocolWallet, nextListingId, owner, sealed };
}

/** Whether `owner` has approved the market for `tokenId` (single approve or setApprovalForAll). */
export async function isMarketApproved(pc: PublicClient, circuits: Address, tokenId: bigint, owner: Address, cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<boolean> {
  const [single, all] = await Promise.all([
    pc.readContract({ address: circuits, abi: erc721ApprovalAbi, functionName: 'getApproved', args: [tokenId] }),
    pc.readContract({ address: circuits, abi: erc721ApprovalAbi, functionName: 'isApprovedForAll', args: [owner, cfg.circuitMarket] }),
  ]);
  return all || sameAddress(single, cfg.circuitMarket);
}

/** Scans market events (X Layer RPC caps eth_getLogs at 100 blocks; pass a narrow range or use an indexer). */
export async function getMarketEvents(pc: PublicClient, fromBlock: bigint, toBlock: bigint, cfg: CircuitMarketConfig = XLAYER_MARKET) {
  const logs = await pc.getLogs({ address: cfg.circuitMarket, fromBlock, toBlock });
  return parseEventLogs({ abi: circuitMarketAbi, logs });
}

// ---------------------------------------------------------------- writes

async function confirm(pc: PublicClient, hash: Hash): Promise<MarketWriteResult> {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`);
  return { hash, receipt };
}

/**
 * Lists a circuit NFT. Sends an approval first when needed: `approve(market, id)` by default (one
 * NFT), or `setApprovalForAll` when `approveAll` is set. The NFT stays in the seller's wallet.
 */
export async function listCircuit(
  wc: Wallet,
  pc: PublicClient,
  p: { circuits: Address; tokenId: bigint; price: bigint; approveAll?: boolean },
  cfg: CircuitMarketConfig = XLAYER_MARKET,
): Promise<MarketWriteResult & { listingId: bigint; approval?: MarketWriteResult }> {
  assertListablePrice(p.price);
  const me = wc.account.address;
  let approval: MarketWriteResult | undefined;
  if (!(await isMarketApproved(pc, p.circuits, p.tokenId, me, cfg))) {
    const hash = p.approveAll
      ? await wc.writeContract((await pc.simulateContract({ account: wc.account, address: p.circuits, abi: erc721ApprovalAbi, functionName: 'setApprovalForAll', args: [cfg.circuitMarket, true] })).request)
      : await wc.writeContract((await pc.simulateContract({ account: wc.account, address: p.circuits, abi: erc721ApprovalAbi, functionName: 'approve', args: [cfg.circuitMarket, p.tokenId] })).request);
    approval = await confirm(pc, hash);
  }
  const { request, result } = await pc.simulateContract({
    account: wc.account,
    ...mk(cfg),
    functionName: 'list',
    args: [p.circuits, p.tokenId, p.price],
  });
  const res = await confirm(pc, await wc.writeContract(request));
  return { ...res, listingId: result, approval };
}

export async function setPrice(wc: Wallet, pc: PublicClient, p: { listingId: bigint; price: bigint }, cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<MarketWriteResult> {
  assertListablePrice(p.price);
  const { request } = await pc.simulateContract({ account: wc.account, ...mk(cfg), functionName: 'setPrice', args: [p.listingId, p.price] });
  return confirm(pc, await wc.writeContract(request));
}

/** Seller cancels (`delist`). For a stale listing anyone may call `delistStale` (`stale: true`). */
export async function cancelListing(wc: Wallet, pc: PublicClient, p: { listingId: bigint; stale?: boolean }, cfg: CircuitMarketConfig = XLAYER_MARKET): Promise<MarketWriteResult> {
  const { request } = await pc.simulateContract({
    account: wc.account,
    ...mk(cfg),
    functionName: p.stale ? 'delistStale' : 'delist',
    args: [p.listingId],
  });
  return confirm(pc, await wc.writeContract(request));
}

/**
 * Buys a listing. `expectedPrice` is the price the buyer saw; the contract reverts "price changed"
 * if the seller repriced since. msg.value is exactly expectedPrice. Refuses to buy your own listing
 * client-side (the contract also reverts "own listing").
 */
export async function buyListing(
  wc: Wallet,
  pc: PublicClient,
  p: { listingId: bigint; expectedPrice: bigint },
  cfg: CircuitMarketConfig = XLAYER_MARKET,
): Promise<MarketWriteResult> {
  const listing = await readListingById(pc, p.listingId, cfg);
  const blocked = buyBlockReason(listing, wc.account.address);
  if (blocked) throw new Error(`cannot buy listing ${p.listingId}: ${blocked}`);
  const { request } = await pc.simulateContract({
    account: wc.account,
    ...mk(cfg),
    functionName: 'buy',
    args: [p.listingId, p.expectedPrice],
    value: p.expectedPrice,
  });
  return confirm(pc, await wc.writeContract(request));
}
