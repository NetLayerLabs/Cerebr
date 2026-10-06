// viem client for TapeOut on X Layer. Every function takes a PublicClient (reads, receipts) and,
// for writes, a WalletClient with an account, so the same code serves Node scripts and the wagmi
// dApp (useWalletClient / usePublicClient).

import {
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from 'viem';
import { accountAbi, circuitsAbi, factoryAbi, openerAbi, transistorsAbi } from './abi.ts';
import { LATCH_ID, NAND_ID, XLAYER, type TapeoutConfig } from './addresses.ts';
import { bitsOfInt, packBits, unpackBits, type Bit, type BitsLike, type TapeoutFees } from './encode.ts';

export type Wallet = WalletClient<Transport, Chain | undefined, Account>;

export interface WriteResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

async function confirm(pc: PublicClient, hash: Hash): Promise<WriteResult> {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`transaction reverted: ${hash}`);
  return { hash, receipt };
}

// ---------------------------------------------------------------- factory

export interface FactoryInfo {
  factory: Address;
  deployFee: bigint;
  protocolFee: bigint;
  cpuCount: bigint;
  owner: Address;
  protocolWallet: Address;
}

export async function readFactory(pc: PublicClient, cfg: TapeoutConfig = XLAYER): Promise<FactoryInfo> {
  const c = { address: cfg.factory, abi: factoryAbi } as const;
  const [deployFee, protocolFee, cpuCount, owner, protocolWallet] = await Promise.all([
    pc.readContract({ ...c, functionName: 'deployFee' }),
    pc.readContract({ ...c, functionName: 'protocolFee' }),
    pc.readContract({ ...c, functionName: 'cpuCount' }),
    pc.readContract({ ...c, functionName: 'owner' }),
    pc.readContract({ ...c, functionName: 'protocolWallet' }),
  ]);
  return { factory: cfg.factory, deployFee, protocolFee, cpuCount, owner, protocolWallet };
}

/** Reads every fee a Cerebr flow pays. `cpu` is any registered CPU (fees are protocol-wide). */
export async function readFees(pc: PublicClient, cpu: { circuits: Address } | undefined, cfg: TapeoutConfig = XLAYER): Promise<TapeoutFees> {
  // TAPEOUT_FEE / EXEC_FEE / BATCH_FEE are compile-time constants of the beacon implementations;
  // the account implementation proxy (cfg.accountImpl, what opener.implementation() returns)
  // answers them directly. Everything is independent, so it is one round trip.
  const circuits = cpu?.circuits ?? (await pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'cpus', args: [0n] }));
  const [deployFee, protocolFee, openFee, execFee, batchFee, tapeoutFee] = await Promise.all([
    pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'deployFee' }),
    pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'protocolFee' }),
    pc.readContract({ address: cfg.opener, abi: openerAbi, functionName: 'FEE' }),
    pc.readContract({ address: cfg.accountImpl, abi: accountAbi, functionName: 'EXEC_FEE' }),
    pc.readContract({ address: cfg.accountImpl, abi: accountAbi, functionName: 'BATCH_FEE' }),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'TAPEOUT_FEE' }),
  ]);
  return { deployFee, protocolFee, tapeoutFee, openFee, execFee, batchFee };
}

export interface CreateCpuParams {
  name: string;
  symbol: string;
  story: string;
  /** Transistor supply cap (NAND + LATCH share it). The TapeOut app lists CPUs with >= 10000. */
  supply: bigint;
  /** Price per transistor in wei (creator revenue, withdrawn via transistors.withdraw()). */
  mintPrice: bigint;
  /** msg.value; defaults to factory.deployFee(). Overpaying is NOT refunded. */
  value?: bigint;
}

export interface CpuAddresses {
  transistors: Address;
  circuits: Address;
}

export async function createCpu(wc: Wallet, pc: PublicClient, p: CreateCpuParams, cfg: TapeoutConfig = XLAYER): Promise<WriteResult & CpuAddresses> {
  const value = p.value ?? (await pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'deployFee' }));
  const { request } = await pc.simulateContract({
    account: wc.account,
    address: cfg.factory,
    abi: factoryAbi,
    functionName: 'createCPU',
    args: [p.name, p.symbol, p.story, p.supply, p.mintPrice],
    value,
  });
  const res = await confirm(pc, await wc.writeContract(request));
  const logs = res.receipt.logs.filter((l) => l.address.toLowerCase() === cfg.factory.toLowerCase());
  const [ev] = parseEventLogs({ abi: factoryAbi, eventName: 'CPUCreated', logs });
  if (ev) return { ...res, transistors: ev.args.transistors, circuits: ev.args.circuits };
  throw new Error(`CPUCreated not found in ${res.hash}`);
}

// ---------------------------------------------------------------- CPU

export interface CpuInfo extends CpuAddresses {
  name: string;
  symbol: string;
  story: string;
  creator: Address;
  supplyCap: bigint;
  minted: bigint;
  remaining: bigint;
  mintPrice: bigint;
  protocolFee: bigint;
  tapeoutFee: bigint;
  /** Number of circuits taped out = highest circuit id (ids start at 1; nextId() is a misnomer). */
  circuitCount: bigint;
  registered: boolean;
}

/** Reads a CPU by either of its addresses (circuits or transistors). */
export async function readCpu(
  pc: PublicClient,
  address: Address,
  cfg: TapeoutConfig = XLAYER,
  /** Known circuits/transistors pair (e.g. from a launch record): everything is read in one round trip. */
  known?: { transistors?: Address },
): Promise<CpuInfo> {
  if (known?.transistors) {
    const t = { address: known.transistors, abi: transistorsAbi } as const;
    const [registered, transistors, name, symbol, story, creator, supplyCap, minted, mintPrice, protocolFee, tapeoutFee, circuitCount] = await Promise.all([
      pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'isCPU', args: [address] }),
      pc.readContract({ address, abi: circuitsAbi, functionName: 'transistors' }),
      pc.readContract({ ...t, functionName: 'cpuName' }),
      pc.readContract({ ...t, functionName: 'cpuSymbol' }),
      pc.readContract({ ...t, functionName: 'story' }),
      pc.readContract({ ...t, functionName: 'creator' }),
      pc.readContract({ ...t, functionName: 'supplyCap' }),
      pc.readContract({ ...t, functionName: 'minted' }),
      pc.readContract({ ...t, functionName: 'mintPrice' }),
      pc.readContract({ ...t, functionName: 'protocolFee' }),
      pc.readContract({ address, abi: circuitsAbi, functionName: 'TAPEOUT_FEE' }),
      pc.readContract({ address, abi: circuitsAbi, functionName: 'nextId' }),
    ]);
    // The hint is only a shortcut: if the chain disagrees, fall back to resolving from scratch.
    if (transistors.toLowerCase() === known.transistors.toLowerCase()) {
      return { circuits: address, transistors, name, symbol, story, creator, supplyCap, minted, remaining: supplyCap - minted, mintPrice, protocolFee, tapeoutFee, circuitCount, registered };
    }
  }
  // Usually `address` is the circuits contract: ask both questions in one round trip.
  let circuits = address;
  let [registered, transistors] = await Promise.all([
    pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'isCPU', args: [address] }),
    pc.readContract({ address, abi: circuitsAbi, functionName: 'transistors' }).catch(() => undefined),
  ]);
  if (!registered || !transistors) {
    // A transistors address (or an unregistered contract): resolve its circuits contract first.
    if (!registered) {
      circuits = await pc.readContract({ address, abi: transistorsAbi, functionName: 'circuits' });
      registered = await pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'isCPU', args: [circuits] });
    }
    transistors = await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'transistors' });
  }
  const t = { address: transistors, abi: transistorsAbi } as const;
  const [name, symbol, story, creator, supplyCap, minted, mintPrice, protocolFee, tapeoutFee, circuitCount] = await Promise.all([
    pc.readContract({ ...t, functionName: 'cpuName' }),
    pc.readContract({ ...t, functionName: 'cpuSymbol' }),
    pc.readContract({ ...t, functionName: 'story' }),
    pc.readContract({ ...t, functionName: 'creator' }),
    pc.readContract({ ...t, functionName: 'supplyCap' }),
    pc.readContract({ ...t, functionName: 'minted' }),
    pc.readContract({ ...t, functionName: 'mintPrice' }),
    pc.readContract({ ...t, functionName: 'protocolFee' }),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'TAPEOUT_FEE' }),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'nextId' }),
  ]);
  return { circuits, transistors, name, symbol, story, creator, supplyCap, minted, remaining: supplyCap - minted, mintPrice, protocolFee, tapeoutFee, circuitCount, registered };
}

/** Lists CPU circuits addresses registered in the factory (index order = creation order). */
export async function listCpus(pc: PublicClient, opts: { from?: bigint; count?: bigint } = {}, cfg: TapeoutConfig = XLAYER): Promise<Address[]> {
  const total = await pc.readContract({ address: cfg.factory, abi: factoryAbi, functionName: 'cpuCount' });
  const from = opts.from ?? 0n;
  const end = opts.count === undefined ? total : min(total, from + opts.count);
  const contracts = [];
  for (let i = from; i < end; i++) contracts.push({ address: cfg.factory, abi: factoryAbi, functionName: 'cpus', args: [i] } as const);
  if (contracts.length === 0) return [];
  return pc.multicall({ contracts, allowFailure: false, multicallAddress: cfg.multicall3 });
}

export interface MintParams {
  transistors: Address;
  /** NAND_ID (0) or LATCH_ID (1). */
  id: bigint;
  amount: bigint;
  /** Defaults to amount * mintPrice() + protocolFee(). */
  value?: bigint;
}

export async function mintTransistors(wc: Wallet, pc: PublicClient, p: MintParams): Promise<WriteResult> {
  if (p.id !== NAND_ID && p.id !== LATCH_ID) throw new Error('bad id: use NAND_ID (0) or LATCH_ID (1)');
  let value = p.value;
  if (value === undefined) {
    const [price, fee] = await Promise.all([
      pc.readContract({ address: p.transistors, abi: transistorsAbi, functionName: 'mintPrice' }),
      pc.readContract({ address: p.transistors, abi: transistorsAbi, functionName: 'protocolFee' }),
    ]);
    value = p.amount * price + fee;
  }
  const { request } = await pc.simulateContract({
    account: wc.account,
    address: p.transistors,
    abi: transistorsAbi,
    functionName: 'mint',
    args: [p.id, p.amount],
    value,
  });
  return confirm(pc, await wc.writeContract(request));
}

export async function transistorBalances(pc: PublicClient, transistors: Address, owner: Address): Promise<{ nand: bigint; latch: bigint }> {
  const [nand, latch] = await pc.readContract({
    address: transistors,
    abi: transistorsAbi,
    functionName: 'balanceOfBatch',
    args: [[owner, owner], [NAND_ID, LATCH_ID]],
  });
  return { nand, latch };
}

/** CPU creator: mint revenue owed (amount * mintPrice per mint) and the pull-payment withdraw. */
export async function creatorOwed(pc: PublicClient, transistors: Address, creator: Address): Promise<bigint> {
  return pc.readContract({ address: transistors, abi: transistorsAbi, functionName: 'owed', args: [creator] });
}

export async function withdrawCreatorRevenue(wc: Wallet, pc: PublicClient, transistors: Address): Promise<WriteResult> {
  const { request } = await pc.simulateContract({ account: wc.account, address: transistors, abi: transistorsAbi, functionName: 'withdraw' });
  return confirm(pc, await wc.writeContract(request));
}

// ---------------------------------------------------------------- circuits

export interface TapeoutParams {
  circuits: Address;
  netlist: Hex;
  nIn: number;
  nOut: number;
  /** Must equal TAPEOUT_FEE() exactly (overpaying reverts "tapeout fee"). */
  value?: bigint;
}

export interface TapeoutResult extends WriteResult {
  circuitId: bigint;
  gateCount: number;
  nState: number;
}

export async function tapeout(wc: Wallet, pc: PublicClient, p: TapeoutParams): Promise<TapeoutResult> {
  const value = p.value ?? (await pc.readContract({ address: p.circuits, abi: circuitsAbi, functionName: 'TAPEOUT_FEE' }));
  const { request } = await pc.simulateContract({
    account: wc.account,
    address: p.circuits,
    abi: circuitsAbi,
    functionName: 'tapeout',
    args: [p.netlist, p.nIn, p.nOut],
    value,
  });
  const res = await confirm(pc, await wc.writeContract(request));
  const logs = res.receipt.logs.filter((l) => l.address.toLowerCase() === p.circuits.toLowerCase());
  const [ev] = parseEventLogs({ abi: circuitsAbi, eventName: 'TapedOut', logs });
  if (ev) return { ...res, circuitId: ev.args.circuitId, gateCount: ev.args.gateCount, nState: ev.args.nState };
  throw new Error(`TapedOut not found in ${res.hash}`);
}

export interface CircuitInfo {
  circuits: Address;
  id: bigint;
  nIn: number;
  nOut: number;
  /** Number of LATCH bits (flattened through REFs). nState > 0 => use step(), eval() reverts. */
  nState: number;
  /** Flattened gate count: NAND + LATCH including everything reached through REFs. */
  gateCount: number;
  owner: Address;
}

export async function readCircuitInfo(pc: PublicClient, circuits: Address, id: bigint): Promise<CircuitInfo> {
  const [[nIn, nOut, nState, gateCount], owner] = await Promise.all([
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'circuitInfo', args: [id] }),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'ownerOf', args: [id] }),
  ]);
  return { circuits, id, nIn, nOut, nState, gateCount, owner };
}

export async function readCircuit(pc: PublicClient, circuits: Address, id: bigint): Promise<CircuitInfo & { netlist: Hex }> {
  const [info, netlist] = await Promise.all([
    readCircuitInfo(pc, circuits, id),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'netlist', args: [id] }),
  ]);
  return { ...info, netlist };
}

/** Batch-reads circuits [from, from+count) of a CPU through multicall3 (ids start at 1). */
export async function listCircuits(
  pc: PublicClient,
  circuits: Address,
  opts: { from?: bigint; count?: bigint; withNetlist?: boolean } = {},
  cfg: TapeoutConfig = XLAYER,
): Promise<(CircuitInfo & { netlist?: Hex })[]> {
  const total = await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'nextId' });
  const from = opts.from ?? 1n;
  const end = opts.count === undefined ? total + 1n : min(total + 1n, from + opts.count);
  const ids: bigint[] = [];
  for (let i = from; i < end; i++) ids.push(i);
  if (ids.length === 0) return [];
  const c = { address: circuits, abi: circuitsAbi } as const;
  const calls = ids.flatMap((id) => [
    { ...c, functionName: 'circuitInfo', args: [id] } as const,
    { ...c, functionName: 'ownerOf', args: [id] } as const,
    ...(opts.withNetlist ? [{ ...c, functionName: 'netlist', args: [id] } as const] : []),
  ]);
  const res = await pc.multicall({ contracts: calls, allowFailure: false, multicallAddress: cfg.multicall3 });
  const per = opts.withNetlist ? 3 : 2;
  return ids.map((id, k) => {
    const [nIn, nOut, nState, gateCount] = res[k * per] as readonly [number, number, number, number];
    const out: CircuitInfo & { netlist?: Hex } = { circuits, id, nIn, nOut, nState, gateCount, owner: res[k * per + 1] as Address };
    if (opts.withNetlist) out.netlist = res[k * per + 2] as Hex;
    return out;
  });
}

/**
 * Evaluates a combinational circuit on-chain (view call, free). `inputs` are bits (input i = bit i)
 * or an integer. Returns the nOut output bits. Reverts "has latch: use step" when nState > 0.
 */
export async function evalCircuit(
  pc: PublicClient,
  p: { circuits: Address; id: bigint; inputs: BitsLike | number | bigint; nIn?: number; nOut?: number },
): Promise<Bit[]> {
  let { nIn, nOut } = p;
  if (nIn === undefined || nOut === undefined) {
    const [i, o] = await pc.readContract({ address: p.circuits, abi: circuitsAbi, functionName: 'circuitInfo', args: [p.id] });
    nIn ??= i;
    nOut ??= o;
  }
  const bits = typeof p.inputs === 'number' || typeof p.inputs === 'bigint' ? bitsOfInt(p.inputs, nIn) : p.inputs;
  const out = await pc.readContract({ address: p.circuits, abi: circuitsAbi, functionName: 'eval', args: [p.id, packBits(bits)] });
  return unpackBits(out, nOut);
}

/**
 * One clock tick of a sequential circuit. Outputs are computed from the CURRENT state (latch q =
 * state bit), then every latch samples its d into newState. Empty state = all zeros.
 */
export async function stepCircuit(
  pc: PublicClient,
  p: { circuits: Address; id: bigint; state: BitsLike; inputs: BitsLike; nState?: number; nOut?: number },
): Promise<{ state: Bit[]; outputs: Bit[] }> {
  let { nState, nOut } = p;
  if (nState === undefined || nOut === undefined) {
    const [, o, s] = await pc.readContract({ address: p.circuits, abi: circuitsAbi, functionName: 'circuitInfo', args: [p.id] });
    nState ??= s;
    nOut ??= o;
  }
  const [state, outputs] = await pc.readContract({
    address: p.circuits,
    abi: circuitsAbi,
    functionName: 'step',
    args: [p.id, packBits(p.state), packBits(p.inputs)],
  });
  return { state: unpackBits(state, nState), outputs: unpackBits(outputs, nOut) };
}

/** Full truth table via eval (nIn <= 12). Row r = outputs for inputs bitsOfInt(r, nIn). */
export async function truthTable(pc: PublicClient, circuits: Address, id: bigint, cfg: TapeoutConfig = XLAYER): Promise<Bit[][]> {
  const [nIn, nOut, nState] = await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'circuitInfo', args: [id] });
  if (nState > 0) throw new Error('sequential circuit: use stepCircuit');
  if (nIn > 12) throw new Error('truthTable: nIn > 12');
  const contracts = Array.from({ length: 1 << nIn }, (_, r) => ({
    address: circuits,
    abi: circuitsAbi,
    functionName: 'eval',
    args: [id, packBits(bitsOfInt(r, nIn))],
  }) as const);
  const res = await pc.multicall({ contracts, allowFailure: false, multicallAddress: cfg.multicall3 });
  return res.map((out) => unpackBits(out as Hex, nOut));
}

// ---------------------------------------------------------------- native accounts (brain wallets)

export interface AccountInfo {
  /** Deterministic ERC-6551 address (registry salt 0); can receive funds before open(). */
  account: Address;
  opened: boolean;
  deployed: boolean;
}

export async function accountOf(pc: PublicClient, circuits: Address, tokenId: bigint, cfg: TapeoutConfig = XLAYER): Promise<AccountInfo> {
  const o = { address: cfg.opener, abi: openerAbi } as const;
  const [account, opened, deployed] = await Promise.all([
    pc.readContract({ ...o, functionName: 'accountOf', args: [circuits, tokenId] }),
    pc.readContract({ ...o, functionName: 'isOpened', args: [circuits, tokenId] }),
    pc.readContract({ ...o, functionName: 'isDeployed', args: [circuits, tokenId] }),
  ]);
  return { account, opened, deployed };
}

/**
 * Opens a circuit's native account: deploys it through the ERC-6551 registry and marks it paid.
 * Anyone may pay (not only the NFT owner); msg.value >= opener.FEE() (excess refunded).
 * Reverts AlreadyOpened / NotRegisteredCPU / ERC721NonexistentToken.
 */
export async function openAccount(
  wc: Wallet,
  pc: PublicClient,
  p: { circuits: Address; tokenId: bigint; value?: bigint },
  cfg: TapeoutConfig = XLAYER,
): Promise<WriteResult & { account: Address }> {
  const value = p.value ?? (await pc.readContract({ address: cfg.opener, abi: openerAbi, functionName: 'FEE' }));
  const { request, result } = await pc.simulateContract({
    account: wc.account,
    address: cfg.opener,
    abi: openerAbi,
    functionName: 'open',
    args: [p.circuits, p.tokenId],
    value,
  });
  const res = await confirm(pc, await wc.writeContract(request));
  return { ...res, account: result };
}

export async function readAccount(pc: PublicClient, account: Address) {
  const a = { address: account, abi: accountAbi } as const;
  const [[chainId, tokenContract, tokenId], owner, state, balance] = await Promise.all([
    pc.readContract({ ...a, functionName: 'token' }),
    pc.readContract({ ...a, functionName: 'owner' }),
    pc.readContract({ ...a, functionName: 'state' }),
    pc.getBalance({ address: account }),
  ]);
  return { account, chainId, circuits: tokenContract, tokenId, owner, state, balance };
}

/**
 * Executes a CALL from a circuit's account (only the circuit NFT owner may). `value` is spent from
 * the account's own balance; msg.value pays EXEC_FEE (excess refunded). operation is always 0
 * (CALL): other operations revert OnlyCall.
 */
export async function executeFromAccount(
  wc: Wallet,
  pc: PublicClient,
  p: { account: Address; to: Address; value?: bigint; data?: Hex; fee?: bigint },
): Promise<WriteResult> {
  const fee = p.fee ?? (await pc.readContract({ address: p.account, abi: accountAbi, functionName: 'EXEC_FEE' }));
  const { request } = await pc.simulateContract({
    account: wc.account,
    address: p.account,
    abi: accountAbi,
    functionName: 'execute',
    args: [p.to, p.value ?? 0n, p.data ?? '0x', 0],
    value: fee,
  });
  return confirm(pc, await wc.writeContract(request));
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
