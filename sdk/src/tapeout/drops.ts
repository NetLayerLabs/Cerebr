// TapeOut transistor drops ("空投池", the Airdrop contract) for Cerebr's Genesis Drop.
//
// Verified 2026-10-06 (see TAPEOUT.md "Drops"):
// * TapeOut's drops contract is deployed on BNB Chain ONLY (0x7Fd0…a672, chain 56). Its client
//   hardcodes chain 56 for the airdrop page, the X Layer chain config has no `airdrop` entry, the
//   BSC address has no code on X Layer, and a DropCreated log scan of X Layer from the factory
//   block (70,995,047) to 72,514,406 found zero drops from any contract.
// * The contract is TapeOut's own, published in their client (artifacts chunk, "DeployAirdrop":
//   no owner, not upgradeable, no fees, one constructor arg = the TapeOut factory). Compiling the
//   published creation code with the BSC factory reproduces the BSC runtime byte for byte, so
//   `DROPS_CREATION_CODE` below IS the BSC contract. Deployed with the X Layer factory it works
//   unchanged against X Layer CPUs (full lifecycle verified on an anvil fork: scripts/fork-drop.ts).
// * So on X Layer the Genesis Drop needs a one-time deployment of this exact code (`deployDrops`,
//   ~1.35M gas). Set `XLAYER_DROPS` once that is on mainnet. TapeOut's own UI will not list drops
//   on X Layer (its airdrop page only reads chain 56); Cerebr's app lists them via `listDrops`.
//
// Contract facts (fork-verified):
// * create(transistors, tokenId, amount, perClaim): pulls `amount` from msg.sender with
//   safeTransferFrom, so the creator must first setApprovalForAll(drops, true) on the transistors
//   contract (else ERC1155MissingApprovalForAll 0xe237d922). tokenId must be 0 (NAND) or 1 (LATCH)
//   ("bad tokenId"); perClaim > 0 ("perClaim = 0"); amount >= perClaim ("amount < perClaim").
//   `transistors` must be a factory CPU's transistors contract: a no-code address, a circuits contract or
//   the factory itself all revert without data (TapeOut says it checks factory registration).
//   `amount` need not be a multiple of perClaim: the remainder is dust that only cancel() returns.
// * claim(dropId): any address, once per drop ("already claimed"), receives exactly perClaim via
//   ERC-1155 safeTransferFrom (contracts without onERC1155Received revert ERC1155InvalidReceiver
//   0x57f447ce). Reverts "no drop", "cancelled", or "drained" when remaining < perClaim. No
//   allowlist, signature, captcha or fee: one claim per ADDRESS, so it is sybil-able by design.
//   The creator can claim their own drop.
// * cancel(dropId) / cancelTo(dropId, to): creator only ("not creator"), once ("already
//   cancelled"); refunds all `remaining` (including dust) to the creator / `to`.
// * Direct ERC-1155 transfers into the contract revert "direct transfer not accepted".
// * No fees at all: claimers pay only gas (~102k first claim). Ids start at 1; nextDropId() is the
//   LAST assigned id (= drop count), like circuits.nextId(). getDrops(from, count) clamps to the
//   existing range; the TapeOut client pages it 100 at a time.

import {
  encodeAbiParameters,
  keccak256,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem';
import { XLAYER } from './addresses.ts';
import type { Wallet, WriteResult } from './client.ts';

// ---------------------------------------------------------------- addresses

/**
 * Cerebr's deployment of TapeOut's drops contract on X Layer (chainId 196).
 * `undefined` until it is deployed to mainnet (see TAPEOUT.md "Drops" for the steps).
 */
/** Deployed on X Layer mainnet 2026-10-06 (tx 0xd0f4367f…8e02), code hash verified; Genesis Drop #1 = dropId 1. */
export const XLAYER_DROPS: Address | undefined = '0xf037a5543f19619a2291009ae1542b71d50ff9b9';

/** TapeOut's own drops contract on BNB Chain (chainId 56), factory 0x6822…F7e2. Reference only. */
export const BSC_DROPS: Address = '0x7Fd055496b638aD81f58B33Fd04d6e90bbC2a672';

/** keccak256 of the runtime code of a drops contract constructed with the X Layer factory. */
export const XLAYER_DROPS_CODEHASH: Hash = '0xcda217758f49a35b6af2e8b961d4b31d7cde6212f25a18a8a953c8620e73229d';
/** keccak256 of the runtime code of BSC_DROPS (the same creation code with the BSC factory). */
export const BSC_DROPS_CODEHASH: Hash = '0x5d887615d03261ef95eca58fa3e47fc5d6a9afca768c73ac7e8c8c71e8d6454a';
/** keccak256 of DROPS_CREATION_CODE (without constructor args). */
export const DROPS_CREATION_CODEHASH: Hash = '0xe461553c7ad37d08671ded6fcdea43afcd436ceac8e1df9d618102de60066c04';

export function requireDrops(drops: Address | undefined = XLAYER_DROPS): Address {
  if (!drops) throw new Error('no drops contract on X Layer yet: deploy it with deployDrops() and set XLAYER_DROPS');
  return drops;
}

// ---------------------------------------------------------------- ABI

const dropComponents = [
  { name: 'creator', type: 'address' },
  { name: 'perClaim', type: 'uint96' },
  { name: 'transistors', type: 'address' },
  { name: 'tokenId', type: 'uint8' },
  { name: 'cancelled', type: 'bool' },
  { name: 'remaining', type: 'uint128' },
  { name: 'claimedCount', type: 'uint128' },
] as const;

/** Full ABI of TapeOut's Airdrop contract, from the artifact in TapeOut's client bundle. */
export const dropsAbi = [
  { type: 'constructor', stateMutability: 'nonpayable', inputs: [{ name: 'factory_', type: 'address' }] },
  {
    type: 'event', name: 'Claimed', anonymous: false,
    inputs: [
      { name: 'dropId', type: 'uint256', indexed: true },
      { name: 'who', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'DropCancelled', anonymous: false,
    inputs: [
      { name: 'dropId', type: 'uint256', indexed: true },
      { name: 'refunded', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'DropCreated', anonymous: false,
    inputs: [
      { name: 'dropId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'transistors', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'perClaim', type: 'uint96', indexed: false },
    ],
  },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [{ name: 'dropId', type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'cancelTo', stateMutability: 'nonpayable',
    inputs: [{ name: 'dropId', type: 'uint256' }, { name: 'to', type: 'address' }], outputs: [],
  },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [{ name: 'dropId', type: 'uint256' }], outputs: [] },
  {
    type: 'function', name: 'claimed', stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'claimedBy', stateMutability: 'view',
    inputs: [{ name: 'who', type: 'address' }, { name: 'dropIds', type: 'uint256[]' }], outputs: [{ name: '', type: 'bool[]' }],
  },
  {
    type: 'function', name: 'create', stateMutability: 'nonpayable',
    inputs: [
      { name: 'transistors', type: 'address' },
      { name: 'tokenId', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
      { name: 'perClaim', type: 'uint96' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'drops', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: dropComponents },
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  {
    type: 'function', name: 'getDrops', stateMutability: 'view',
    inputs: [{ name: 'from', type: 'uint256' }, { name: 'count', type: 'uint256' }],
    outputs: [
      { name: 'ids', type: 'uint256[]' },
      { name: 'list', type: 'tuple[]', components: dropComponents },
    ],
  },
  { type: 'function', name: 'nextDropId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function', name: 'onERC1155BatchReceived', stateMutability: 'pure',
    inputs: [
      { name: '', type: 'address' }, { name: '', type: 'address' }, { name: '', type: 'uint256[]' },
      { name: '', type: 'uint256[]' }, { name: '', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
  {
    type: 'function', name: 'onERC1155Received', stateMutability: 'view',
    inputs: [
      { name: '', type: 'address' }, { name: '', type: 'address' }, { name: '', type: 'uint256' },
      { name: '', type: 'uint256' }, { name: '', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
  {
    type: 'function', name: 'supportsInterface', stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }], outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/** The ERC-1155 approval calls createDrop needs on the transistors contract. */
export const erc1155ApprovalAbi = [
  {
    type: 'function', name: 'isApprovedForAll', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'setApprovalForAll', stateMutability: 'nonpayable',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [],
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** Revert reasons observed on the fork, for mapping errors to UI messages. */
export const DROP_ERRORS = {
  'perClaim = 0': 'perClaim must be > 0',
  'amount < perClaim': 'amount must be at least perClaim',
  'bad tokenId': 'tokenId must be 0 (NAND) or 1 (LATCH)',
  'no drop': 'drop does not exist',
  drained: 'drop has fewer than perClaim transistors left',
  'already claimed': 'this address already claimed this drop',
  'not creator': 'only the drop creator can cancel',
  'already cancelled': 'drop already cancelled',
  cancelled: 'drop was cancelled',
  'direct transfer not accepted': 'transistors must enter through create()',
  '0xe237d922': 'ERC1155MissingApprovalForAll: approve the drops contract first',
  '0x03dee4c5': 'ERC1155InsufficientBalance: creator lacks the transistors',
  '0x57f447ce': 'ERC1155InvalidReceiver: claimer is a contract without onERC1155Received',
} as const;

// ---------------------------------------------------------------- pure helpers

export interface Drop {
  id: bigint;
  creator: Address;
  perClaim: bigint;
  transistors: Address;
  tokenId: number;
  cancelled: boolean;
  remaining: bigint;
  claimedCount: bigint;
  /** Claims still possible: remaining / perClaim. */
  sharesLeft: bigint;
  /** Not cancelled and at least one share left. */
  live: boolean;
}

type RawDrop = {
  creator: Address; perClaim: bigint; transistors: Address; tokenId: number;
  cancelled: boolean; remaining: bigint; claimedCount: bigint;
};

export function toDrop(id: bigint, d: RawDrop): Drop {
  const sharesLeft = d.perClaim > 0n ? d.remaining / d.perClaim : 0n;
  return { id, ...d, sharesLeft, live: !d.cancelled && sharesLeft > 0n && d.creator !== ZERO };
}

const ZERO = '0x0000000000000000000000000000000000000000';

export interface DropPlan {
  amount: bigint;
  perClaim: bigint;
  /** Number of addresses that can claim. */
  claims: bigint;
  /** amount % perClaim: never claimable, only returned by cancel(). */
  dust: bigint;
}

/** Plan a drop for `claims` claimers of `perClaim` each (amount = claims * perClaim, no dust). */
export function planDrop(perClaim: bigint, claims: bigint): DropPlan {
  if (perClaim <= 0n) throw new Error('perClaim must be > 0');
  if (claims <= 0n) throw new Error('claims must be > 0');
  if (perClaim >= 1n << 96n) throw new Error('perClaim exceeds uint96');
  return { amount: perClaim * claims, perClaim, claims, dust: 0n };
}

/** Split a fixed `amount` into perClaim shares. Mirrors the contract's create() checks. */
export function dropShares(amount: bigint, perClaim: bigint): DropPlan {
  if (perClaim <= 0n) throw new Error('perClaim = 0');
  if (amount < perClaim) throw new Error('amount < perClaim');
  if (perClaim >= 1n << 96n) throw new Error('perClaim exceeds uint96');
  if (amount >= 1n << 128n) throw new Error('amount exceeds uint128');
  return { amount, perClaim, claims: amount / perClaim, dust: amount % perClaim };
}

/** Creation calldata for deploying the drops contract bound to `factory`. */
export function dropsDeployData(factory: Address = XLAYER.factory): Hex {
  return `${DROPS_CREATION_CODE}${encodeAbiParameters([{ type: 'address' }], [factory]).slice(2)}` as Hex;
}

/** Map a revert message to one of DROP_ERRORS, if any. */
export function explainDropError(err: unknown): string | undefined {
  const msg = String((err as { shortMessage?: string; message?: string })?.message ?? err);
  for (const [k, v] of Object.entries(DROP_ERRORS)) if (msg.includes(k)) return v;
  return undefined;
}

// ---------------------------------------------------------------- reads

async function confirm(pc: PublicClient, hash: Hash): Promise<WriteResult> {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`);
  return { hash, receipt };
}

/** Number of drops ever created (= the last id; ids start at 1). */
export async function dropCount(pc: PublicClient, drops: Address = requireDrops()): Promise<bigint> {
  return pc.readContract({ address: drops, abi: dropsAbi, functionName: 'nextDropId' });
}

export async function readDrop(pc: PublicClient, dropId: bigint, drops: Address = requireDrops()): Promise<Drop> {
  const [creator, perClaim, transistors, tokenId, cancelled, remaining, claimedCount] = await pc.readContract({
    address: drops, abi: dropsAbi, functionName: 'drops', args: [dropId],
  });
  if (creator === ZERO) throw new Error(`no drop ${dropId}`);
  return toDrop(dropId, { creator, perClaim, transistors, tokenId, cancelled, remaining, claimedCount });
}

export interface ListDropsOptions {
  /** Only drops of this transistors contract (e.g. Cerebr's). */
  transistors?: Address;
  creator?: Address;
  /** Only live drops (not cancelled, at least one share left). */
  liveOnly?: boolean;
  /** Read the newest `limit` drops (default: all). */
  limit?: bigint;
  /** Page size for getDrops (TapeOut's client uses 100). */
  pageSize?: bigint;
}

/** List drops via nextDropId + getDrops pages (no eth_getLogs). Newest first. */
export async function listDrops(pc: PublicClient, opts: ListDropsOptions = {}, drops: Address = requireDrops()): Promise<Drop[]> {
  const total = await dropCount(pc, drops);
  if (total === 0n) return [];
  const page = opts.pageSize ?? 100n;
  const first = opts.limit && opts.limit < total ? total - opts.limit + 1n : 1n;
  const calls: Promise<readonly [readonly bigint[], readonly RawDrop[]]>[] = [];
  for (let from = first; from <= total; from += page) {
    const count = total - from + 1n < page ? total - from + 1n : page;
    calls.push(pc.readContract({ address: drops, abi: dropsAbi, functionName: 'getDrops', args: [from, count] }));
  }
  const lc = (a?: string) => a?.toLowerCase();
  const out: Drop[] = [];
  for (const [ids, list] of await Promise.all(calls)) {
    ids.forEach((id, i) => {
      const d = toDrop(id, list[i]);
      if (opts.transistors && lc(d.transistors) !== lc(opts.transistors)) return;
      if (opts.creator && lc(d.creator) !== lc(opts.creator)) return;
      if (opts.liveOnly && !d.live) return;
      out.push(d);
    });
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export async function hasClaimed(pc: PublicClient, dropId: bigint, who: Address, drops: Address = requireDrops()): Promise<boolean> {
  return pc.readContract({ address: drops, abi: dropsAbi, functionName: 'claimed', args: [dropId, who] });
}

/** Batch claimed-status for many drops (what TapeOut's client calls, 400 ids per call). */
export async function claimedBy(pc: PublicClient, who: Address, dropIds: readonly bigint[], drops: Address = requireDrops()): Promise<boolean[]> {
  const out: boolean[] = [];
  for (let i = 0; i < dropIds.length; i += 400) {
    out.push(...(await pc.readContract({ address: drops, abi: dropsAbi, functionName: 'claimedBy', args: [who, dropIds.slice(i, i + 400)] })));
  }
  return out;
}

export interface DropsVerification {
  ok: boolean;
  codeHash?: Hash;
  factory?: Address;
  why?: string;
}

/**
 * Check that `drops` is TapeOut's drops contract bound to `factory` (TapeOut's own client checks
 * only factory(); this also pins the runtime code hash when the factory is X Layer's).
 */
export async function verifyDrops(pc: PublicClient, drops: Address, factory: Address = XLAYER.factory): Promise<DropsVerification> {
  const code = await pc.getCode({ address: drops });
  if (!code || code === '0x') return { ok: false, why: 'no code at address' };
  const codeHash = keccak256(code);
  let f: Address;
  try {
    f = await pc.readContract({ address: drops, abi: dropsAbi, functionName: 'factory' });
  } catch {
    return { ok: false, codeHash, why: 'no factory(): not a TapeOut drops contract' };
  }
  if (f.toLowerCase() !== factory.toLowerCase()) return { ok: false, codeHash, factory: f, why: `factory() is ${f}, expected ${factory}` };
  if (factory.toLowerCase() === XLAYER.factory.toLowerCase() && codeHash !== XLAYER_DROPS_CODEHASH) {
    return { ok: false, codeHash, factory: f, why: 'runtime code differs from TapeOut drops bytecode' };
  }
  return { ok: true, codeHash, factory: f };
}

// ---------------------------------------------------------------- writes

/** Deploy TapeOut's drops contract (byte-identical to BSC's) bound to `factory`. ~1.35M gas. */
export async function deployDrops(wc: Wallet, pc: PublicClient, factory: Address = XLAYER.factory): Promise<WriteResult & { drops: Address }> {
  const hash = await wc.sendTransaction({ data: dropsDeployData(factory), chain: wc.chain });
  const res = await confirm(pc, hash);
  const drops = res.receipt.contractAddress;
  if (!drops) throw new Error(`no contract address in ${hash}`);
  const v = await verifyDrops(pc, drops, factory);
  if (!v.ok) throw new Error(`deployed drops failed verification: ${v.why}`);
  return { ...res, drops };
}

export interface CreateDropParams {
  transistors: Address;
  /** 0 = NAND, 1 = LATCH. */
  tokenId: number;
  amount: bigint;
  perClaim: bigint;
  drops?: Address;
  /** Revoke setApprovalForAll after create (one extra tx). Default false. */
  revokeApproval?: boolean;
}

export interface CreateDropResult extends WriteResult {
  dropId: bigint;
  /** The setApprovalForAll tx, when one was needed. */
  approval?: WriteResult;
  revoke?: WriteResult;
}

/** Approve the drops contract on the transistors (if needed), then create() the drop. */
export async function createDrop(wc: Wallet, pc: PublicClient, p: CreateDropParams): Promise<CreateDropResult> {
  const drops = requireDrops(p.drops);
  dropShares(p.amount, p.perClaim);
  if (p.tokenId !== 0 && p.tokenId !== 1) throw new Error('bad tokenId');
  const me = wc.account.address;
  const bal = await pc.readContract({ address: p.transistors, abi: erc1155ApprovalAbi, functionName: 'balanceOf', args: [me, BigInt(p.tokenId)] });
  if (bal < p.amount) throw new Error(`balance ${bal} < amount ${p.amount}`);

  let approval: WriteResult | undefined;
  const approved = await pc.readContract({ address: p.transistors, abi: erc1155ApprovalAbi, functionName: 'isApprovedForAll', args: [me, drops] });
  if (!approved) {
    const { request } = await pc.simulateContract({
      account: wc.account, address: p.transistors, abi: erc1155ApprovalAbi, functionName: 'setApprovalForAll', args: [drops, true],
    });
    approval = await confirm(pc, await wc.writeContract(request));
  }
  const { request } = await pc.simulateContract({
    account: wc.account, address: drops, abi: dropsAbi, functionName: 'create', args: [p.transistors, p.tokenId, p.amount, p.perClaim],
  });
  const res = await confirm(pc, await wc.writeContract(request));
  const [ev] = parseEventLogs({ abi: dropsAbi, eventName: 'DropCreated', logs: res.receipt.logs.filter((l) => l.address.toLowerCase() === drops.toLowerCase()) });
  if (!ev) throw new Error(`DropCreated not found in ${res.hash}`);

  let revoke: WriteResult | undefined;
  if (p.revokeApproval) {
    const r = await pc.simulateContract({
      account: wc.account, address: p.transistors, abi: erc1155ApprovalAbi, functionName: 'setApprovalForAll', args: [drops, false],
    });
    revoke = await confirm(pc, await wc.writeContract(r.request));
  }
  return { ...res, dropId: ev.args.dropId, approval, revoke };
}

/** Claim perClaim transistors from a drop (once per address). Returns the amount received. */
export async function claimDrop(wc: Wallet, pc: PublicClient, dropId: bigint, drops: Address = requireDrops()): Promise<WriteResult & { amount: bigint }> {
  const { request } = await pc.simulateContract({ account: wc.account, address: drops, abi: dropsAbi, functionName: 'claim', args: [dropId] });
  const res = await confirm(pc, await wc.writeContract(request));
  const [ev] = parseEventLogs({ abi: dropsAbi, eventName: 'Claimed', logs: res.receipt.logs.filter((l) => l.address.toLowerCase() === drops.toLowerCase()) });
  if (!ev) throw new Error(`Claimed not found in ${res.hash}`);
  return { ...res, amount: ev.args.amount };
}

/** Cancel a drop (creator only) and refund everything left, including dust, to the creator or `to`. */
export async function cancelDrop(
  wc: Wallet,
  pc: PublicClient,
  dropId: bigint,
  opts: { to?: Address; drops?: Address } = {},
): Promise<WriteResult & { refunded: bigint }> {
  const drops = requireDrops(opts.drops);
  let hash: Hash;
  if (opts.to) {
    const { request } = await pc.simulateContract({ account: wc.account, address: drops, abi: dropsAbi, functionName: 'cancelTo', args: [dropId, opts.to] });
    hash = await wc.writeContract(request);
  } else {
    const { request } = await pc.simulateContract({ account: wc.account, address: drops, abi: dropsAbi, functionName: 'cancel', args: [dropId] });
    hash = await wc.writeContract(request);
  }
  const res = await confirm(pc, hash);
  const [ev] = parseEventLogs({ abi: dropsAbi, eventName: 'DropCancelled', logs: res.receipt.logs.filter((l) => l.address.toLowerCase() === drops.toLowerCase()) });
  if (!ev) throw new Error(`DropCancelled not found in ${res.hash}`);
  return { ...res, refunded: ev.args.refunded };
}

// ---------------------------------------------------------------- bytecode

/**
 * Creation code of TapeOut's Airdrop contract (no constructor args), verbatim from TapeOut's client
 * (tapeout.net/assets/artifacts-BZhnQij0.js, `Airdrop.bytecode`). keccak256 = DROPS_CREATION_CODEHASH.
 */
export const DROPS_CREATION_CODE: Hex = '0x60a0346100b057601f6117b438819003918201601f19168301916001600160401b038311848410176100b4578084926020946040528339810103126100b057516001600160a01b0381168082036100b05760016003551561007c576080526040516116eb90816100c982396080518181816102c201526104db0152f35b60405162461bcd60e51b815260206004820152600c60248201526b7a65726f20666163746f727960a01b6044820152606490fd5b5f80fd5b634e487b7160e01b5f52604160045260245ffdfe6080806040526004361015610012575f80fd5b5f9060e05f3560e01c91826301ffc9a71461123e57508163120aa877146111f5578163379607f514610f6557816338a9b1f714610d8e57816340e58ee514610bb75781635eb3996814610b365781639bda24a314610a3557508063a88b00c5146103a7578063bc197c81146102f1578063c45a0155146102ac578063ce0ef3101461028f578063dda7de0a1461015c5763f23a6e61146100b0575f80fd5b346101595760a0366003190112610159576100c96112a7565b506100d2611291565b5060843567ffffffffffffffff8111610155576100f39036906004016113b7565b506002600354036101105760405163f23a6e6160e01b8152602090f35b60405162461bcd60e51b815260206004820152601c60248201527f646972656374207472616e73666572206e6f74206163636570746564000000006044820152606490fd5b5080fd5b80fd5b5034610159576040366003190112610159576101766112a7565b602480359167ffffffffffffffff9081841161028b573660238501121561028b57836004013591821161028b576005913660248260051b87010111610287578085926101c2889361133f565b956101d0604051978861131d565b8287526101dc8361133f565b6020968888019691601f19013688376001600160a01b0390931692855b8581106102465750505050505060405193838594850191818652518092526040850193925b82811061022d57505050500390f35b835115158552869550938101939281019260010161021e565b8084600192849c9a9b999c1b850101358b526002885260408b20865f52885260ff60405f205416610277828b611495565b90151590520198959796986101f9565b8580fd5b8480fd5b503461015957806003193601126101595760209054604051908152f35b50346101595780600319360112610159576040517f00000000000000000000000000000000000000000000000000000000000000006001600160a01b03168152602090f35b50346101595760a03660031901126101595761030b6112a7565b50610314611291565b5067ffffffffffffffff6044358181116103a357610336903690600401611357565b506064358181116103a35761034f903690600401611357565b50608435908111610155576103689036906004016113b7565b5060405162461bcd60e51b815260206004820152601260248201527118985d18da081b9bdd081858d8d95c1d195960721b6044820152606490fd5b8280fd5b5034610159576080366003190112610159576103c16112a7565b90602460ff81351681350361015557606435926001600160601b03841684036103a3576103f36002600354141561140d565b6002600355600160ff83351611610a03576001600160601b038416156109d0576001600160601b03841660443510610998576001600160801b036044351161096157604051635f48772d60e01b81526020816004816001600160a01b0386165afa9081156108a7578491610942575b506001600160a01b0381161561091057604051636fbd171960e01b81526020816004816001600160a01b0386165afa9081156107d15785916108e1575b506001600160a01b038381169116036108b257604051635f5a364f60e01b81526001600160a01b039182166004820152906020908290859082907f0000000000000000000000000000000000000000000000000000000000000000165afa9081156108a7578491610868575b501561082d57604051627eeac760e11b808252306004830152833560ff166024830152906020816044816001600160a01b0387165afa9081156107d15785916107fb575b506001600160a01b0383163b1561028b57604051637921219560e11b81528581806105836044358935303360048601611445565b0381836001600160a01b0389165af180156107f0579086916107dc575b5050604051918252306004830152833560ff1660248301526020826044816001600160a01b0387165afa9182156107d1578592610797575b506105e6906044359261147b565b10610762578254925f19841461074f576020946106f46001600160601b03926001870181556001600160801b0387816002604051610623816112e5565b3381528c810189891681528b604083019160018060a01b038d16835260ff6060850192351682526080840190898252604060a086019a88604435168c52600160c088019a828c52018152602060019052209460018060a01b03905116908d60a01b905160a01b16178455600184019260018060a01b0390511683549260ff60a01b905160a01b169160ff60a81b9051151560a81b169269ffffffffffffffffffff60b01b16171717905501935116821984541617835551166001600160801b0382549181199060801b169116179055565b60ff60405194351684526044358685015216604083015260018060a01b03169033907f75fa255e75853710e56e52e2d4fc2b59529067c14ddd24a7a306e3d67d32c3f860606001860192a46001600355600160405191018152f35b634e487b7160e01b815260116004529050fd5b60405162461bcd60e51b815260206004820152600e818401526d39b437b93a103a3930b739b332b960911b6044820152606490fd5b9091506020813d6020116107c9575b816107b36020938361131d565b810103126107c55751906105e66105d8565b5f80fd5b3d91506107a6565b6040513d87823e3d90fd5b6107e5906112bd565b61028b57845f6105a0565b6040513d88823e3d90fd5b90506020813d602011610825575b816108166020938361131d565b810103126107c557515f61054f565b3d9150610809565b60405162461bcd60e51b815260206004820152601481840152736e6f74206120726567697374657265642043505560601b6044820152606490fd5b90506020813d60201161089f575b816108836020938361131d565b8101031261089b5751801515810361089b575f61050b565b8380fd5b3d9150610876565b6040513d86823e3d90fd5b60405162461bcd60e51b815260206004820152600881850152670dad2e6dac2e8c6d60c31b6044820152606490fd5b610903915060203d602011610909575b6108fb818361131d565b810190611696565b5f61049f565b503d6108f1565b60405162461bcd60e51b815260206004820152600b818501526a6e6f20636972637569747360a81b6044820152606490fd5b61095b915060203d602011610909576108fb818361131d565b5f610462565b60405162461bcd60e51b8152602060048201526010818401526f616d6f756e7420746f6f206c6172676560801b6044820152606490fd5b60405162461bcd60e51b81526020600482015260118184015270616d6f756e74203c20706572436c61696d60781b6044820152606490fd5b60405162461bcd60e51b815260206004820152600c818401526b0706572436c61696d203d20360a41b6044820152606490fd5b60405162461bcd60e51b815260206004820152600b818401526a189859081d1bdad95b925960aa1b6044820152606490fd5b82346101595760403660031901126101595790610a566024356004356114bd565b90916040519260408401916040855281518093526060906060860193602080940190885b818110610b225750505085840383870152828086519586815201950196915b848310610aa65786860387f35b875180516001600160a01b039081168852818601516001600160601b031688870152604080830151909116908801528082015160ff168783015260808082015115159088015260a0808201516001600160801b039081169189019190915260c09182015116908701529683019694810194600190920191610a99565b825187529585019591850191600101610a7a565b823461015957602036600319011261015957604060e091600435815260016020522080549060ff60018060a01b0391600260018201549101549260405194818116865260a01c602086015281166040850152818160a01c16606085015260a81c16151560808301526001600160801b03811660a083015260801c60c0820152f35b8234610159576020806003193601126101555760043590610bdd6002600354141561140d565b60026003553315610d6057818352600181526040832080549091906001600160a01b039081163303610d2d57600183019081549360ff8560a81c16610cf457600201805460ff60a81b198616600160a81b17938490556001600160801b031981169091556001600160801b0316938692919085610c8a575b505050507fee24557ed18f80bf0717d3eef386db2452a0d0783f9ec985fd3355239628036f91604051908152a2600160035580f35b16803b156103a35784839160ff83610cbf9560405196879586948593637921219560e11b855260a01c16333060048601611445565b03925af18015610ce957610cd5575b8080610c55565b610cde906112bd565b61089b578385610cce565b6040513d84823e3d90fd5b60405162461bcd60e51b8152600481018590526011602482015270185b1c9958591e4818d85b98d95b1b1959607a1b6044820152606490fd5b60405162461bcd60e51b815260048101839052600b60248201526a3737ba1031b932b0ba37b960a91b6044820152606490fd5b6064906040519062461bcd60e51b8252600482015260076024820152667a65726f20746f60c81b6044820152fd5b823461015957604036600319011261015957600435610dab611291565b610dba6002600354141561140d565b60026003556001600160a01b039080821615610f365782845260016020526040842090828254163303610f03576001820180549360ff8560a81c16610eca57600293909301805460ff60a81b198616600160a81b17928390556001600160801b031981169091556001600160801b03169386939085610e69575b84877fee24557ed18f80bf0717d3eef386db2452a0d0783f9ec985fd3355239628036f602089604051908152a2600160035580f35b1691823b1561089b57849260ff858094610e9f60405197889687958694637921219560e11b865260a01c16903060048601611445565b03925af18015610ce957610eb6575b808080610e34565b610ebf906112bd565b6103a3578284610eae565b60405162461bcd60e51b8152602060048201526011602482015270185b1c9958591e4818d85b98d95b1b1959607a1b6044820152606490fd5b60405162461bcd60e51b815260206004820152600b60248201526a3737ba1031b932b0ba37b960a91b6044820152606490fd5b60405162461bcd60e51b81526020600482015260076024820152667a65726f20746f60c81b6044820152606490fd5b82346107c5576020806003193601126107c557600435610f8a6002600354141561140d565b60026003555f818152600183526040902080549092906001600160a01b0390818116156111c657600185019060ff825460a81c1661119557845f526002845260405f20335f52845260ff60405f20541661115e5760029060a01c95016001600160801b0386818354161061112f57855f526002855260405f20335f52855260405f20600160ff19825416179055815487828216039082821161111b576001600160801b0319169082161780835560801c60010190811161111b5781546001600160801b031660809190911b6001600160801b03191617905554908116803b156107c557845f9160ff8361109a9560405196879586948593637921219560e11b855260a01c16333060048601611445565b03925af18015611110576110dd575b507f4ec90e965519d92681267467f775ada5bd214aa92c0dc93d90a5e880ce9ed026906040519384523393a3600160035580f35b6110e89194506112bd565b5f927f4ec90e965519d92681267467f775ada5bd214aa92c0dc93d90a5e880ce9ed0266110a9565b6040513d5f823e3d90fd5b634e487b7160e01b5f52601160045260245ffd5b60405162461bcd60e51b8152600481018690526007602482015266191c985a5b995960ca1b6044820152606490fd5b60405162461bcd60e51b815260048101859052600f60248201526e185b1c9958591e4818db185a5b5959608a1b6044820152606490fd5b60405162461bcd60e51b815260048101859052600960248201526818d85b98d95b1b195960ba1b6044820152606490fd5b60405162461bcd60e51b815260048101849052600760248201526606e6f2064726f760cc1b6044820152606490fd5b346107c55760403660031901126107c55761120e611291565b6004355f52600260205260405f209060018060a01b03165f52602052602060ff60405f2054166040519015158152f35b346107c55760203660031901126107c5576004359063ffffffff60e01b82168092036107c557602091630271189760e51b8114908115611280575b5015158152f35b6301ffc9a760e01b14905083611279565b602435906001600160a01b03821682036107c557565b600435906001600160a01b03821682036107c557565b67ffffffffffffffff81116112d157604052565b634e487b7160e01b5f52604160045260245ffd5b60e0810190811067ffffffffffffffff8211176112d157604052565b6020810190811067ffffffffffffffff8211176112d157604052565b90601f8019910116810190811067ffffffffffffffff8211176112d157604052565b67ffffffffffffffff81116112d15760051b60200190565b9080601f830112156107c55760209082356113718161133f565b9361137f604051958661131d565b81855260208086019260051b8201019283116107c557602001905b8282106113a8575050505090565b8135815290830190830161139a565b81601f820112156107c55780359067ffffffffffffffff82116112d157604051926113ec601f8401601f19166020018561131d565b828452602083830101116107c557815f926020809301838601378301015290565b1561141457565b60405162461bcd60e51b81526020600482015260096024820152681c99595b9d1c985b9d60ba1b6044820152606490fd5b9260ff9160c0959360018060a01b038092168652166020850152166040830152606082015260a060808201525f60a08201520190565b9190820391821161111b57565b9190820180921161111b57565b80518210156114a95760209160051b010190565b634e487b7160e01b5f52603260045260245ffd5b915f54831561168d575b8084118015611685575b61165d57836114df9161147b565b916001906001840180941161111b57808411611655575b506115008361133f565b92604061150f8151958661131d565b81855261151b8261133f565b601f19916020918301368884013786976115348561133f565b936115418351958661131d565b85855261154d8661133f565b01835f5b8281106116175750505083975f5b868110611570575050505050505050565b8061157c899285611488565b6115868285611495565b526115918185611488565b5f52818652845f208551906115a5826112e5565b805490600260018060a01b0391828416855260a093841c8b860152868101549283168a86015260ff8084861c16606087015260809360a81c161515838601520154916001600160801b038316908401521c60c08201526116058289611495565b526116108188611495565b500161155f565b8451611622816112e5565b5f81525f838201525f868201525f60608201525f60808201525f60a08201525f60c0820152828289010152018490611551565b92505f6114f6565b509150506040519061166e82611301565b5f82526040519161167e83611301565b5f83529190565b5082156114d1565b600193506114c7565b908160209103126107c557516001600160a01b03811681036107c5579056fea2646970667358221220711d5cc8dff782eecefd1133f0f9c745447e397916d9e931779e9edb439fe51264736f6c63430008180033';
