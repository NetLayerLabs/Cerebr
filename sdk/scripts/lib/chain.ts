// Network setup with the safety rails, a transaction sender that records the hash in the state
// file before waiting, the preflight reads (implementation pins, fees) and on-chain verification.

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TestClient,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { run, type Program } from '../../src/neuro/index.ts';
import { circuitsAbi, factoryAbi, openerAbi, packBits, unpackBits, XLAYER, XLAYER_RPC, xLayer, xLayerFork, type Wallet } from '../../src/tapeout/index.ts';
import type { Pins } from './config.ts';
import { flatGateCount } from './plan.ts';
import type { CircuitRecord, StateFile } from './state.ts';

export type NetworkName = 'fork' | 'xlayer';

export interface Net {
  network: NetworkName;
  rpc: string;
  chain: Chain;
  pc: PublicClient;
  wc: Wallet;
  deployer: Address;
  /** Fork only: anvil cheat codes (impersonation, balances). */
  test?: TestClient;
}

/** Chain ids a local fork may report: X Layer's own, or the dApp's local-fork id. */
export const FORK_CHAIN_IDS = [XLAYER.chainId, 31337];

/** A synthetic, keyless address used on forks when no --as is given. */
export const FORK_DEPLOYER: Address = '0xce7eb70000000000000000000000000000c0ffee';

const isLoopback = (url: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);

export async function connect(o: { network: NetworkName; rpc?: string; as?: Address; needSigner: boolean }): Promise<Net> {
  if (o.network === 'fork') {
    const rpc = o.rpc ?? process.env.FORK_RPC ?? 'http://127.0.0.1:8545';
    if (!isLoopback(rpc)) throw new Error(`fork mode only talks to a local anvil; refusing ${rpc}`);
    const transport = http(rpc, { timeout: 120_000 });
    const probe = createPublicClient({ chain: xLayerFork(rpc), transport }) as PublicClient;
    const client = await probe.request({ method: 'web3_clientVersion' } as never).catch(() => '') as string;
    if (!/anvil/i.test(client)) throw new Error(`${rpc} is not an anvil node (web3_clientVersion "${client}"); fork mode refuses to send to anything else`);
    // A fork may keep X Layer's id (196) or use the dApp's local fork id (31337, so wallets never
    // confuse it with mainnet); the chain object must carry the node's real id for signing.
    const forkId = await probe.getChainId();
    if (!FORK_CHAIN_IDS.includes(forkId)) throw new Error(`fork chain id ${forkId}; expected one of ${FORK_CHAIN_IDS.join(', ')}`);
    const chain = xLayerFork(rpc, forkId);
    const pc = createPublicClient({ chain, transport }) as PublicClient;
    const deployer = getAddress(o.as ?? FORK_DEPLOYER);
    const test = createTestClient({ chain, transport, mode: 'anvil' });
    await test.impersonateAccount({ address: deployer });
    const wc = createWalletClient({ chain, transport, account: deployer }) as unknown as Wallet;
    return { network: 'fork', rpc, chain, pc, wc, deployer, test };
  }

  const rpc = o.rpc ?? process.env.XLAYER_RPC ?? XLAYER_RPC;
  if (isLoopback(rpc)) throw new Error('--network xlayer must point at X Layer itself; use --network fork for a local anvil');
  const transport = http(rpc, { timeout: 120_000, retryCount: 3 });
  const pc = createPublicClient({ chain: xLayer, transport }) as PublicClient;
  let deployer: Address;
  let wc: Wallet;
  const key = process.env.PRIVATE_KEY;
  if (key) {
    const hex = (key.startsWith('0x') ? key : `0x${key}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('PRIVATE_KEY is not a 32-byte hex key (value not shown)');
    let account: ReturnType<typeof privateKeyToAccount>;
    try {
      account = privateKeyToAccount(hex);
    } catch {
      // viem/noble echo the offending value (e.g. a key >= the curve order); never surface it
      throw new Error('PRIVATE_KEY is not a valid secp256k1 private key (value not shown)');
    }
    deployer = account.address;
    wc = createWalletClient({ chain: xLayer, transport, account });
  } else {
    if (o.needSigner) throw new Error('--network xlayer needs PRIVATE_KEY in the environment (see LAUNCH.md); it is never printed or written');
    if (!o.as) throw new Error('a mainnet dry run without PRIVATE_KEY needs --as <deployer address>');
    deployer = getAddress(o.as);
    wc = createWalletClient({ chain: xLayer, transport, account: deployer }) as unknown as Wallet;
  }
  return { network: 'xlayer', rpc, chain: xLayer, pc, wc, deployer };
}

/**
 * Removes secrets from text that is about to be printed (error messages, stack traces): the
 * PRIVATE_KEY value in any spelling (with or without 0x, any case) is replaced by [redacted].
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env.PRIVATE_KEY?.trim();
  if (!key) return text;
  const bare = key.replace(/^0x/i, '');
  if (bare.length < 8) return text;
  const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = text.replace(new RegExp(`(0x)?${esc}`, 'gi'), '[redacted]');
  // noble/viem report an out-of-range key as a decimal integer
  if (/^[0-9a-fA-F]+$/.test(bare)) out = out.split(BigInt(`0x${bare}`).toString()).join('[redacted]');
  return out;
}

/**
 * Sends a simulated contract write. The hash is written to the state file before waiting, so a
 * crash mid-wait is recovered on the next run instead of paying twice.
 */
// `request` is the `request` returned by publicClient.simulateContract (typed loosely on purpose).
export async function send(net: Net, state: StateFile, step: string, request: unknown): Promise<TransactionReceipt> {
  const hash = await net.wc.writeContract(request as Parameters<Wallet['writeContract']>[0]);
  state.data.pending = { step, hash, sentAt: new Date().toISOString() };
  state.save();
  console.log(`    tx ${hash}`);
  const receipt = await net.pc.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (receipt.status !== 'success') {
    state.data.pending = undefined;
    state.save();
    throw new Error(`${step}: transaction reverted (${hash})`);
  }
  state.data.pending = undefined;
  return receipt;
}

export const txRecord = (r: TransactionReceipt, value = 0n) => ({
  hash: r.transactionHash,
  block: r.blockNumber.toString(),
  gasUsed: r.gasUsed.toString(),
  gasCost: (r.gasUsed * r.effectiveGasPrice).toString(),
  value: value.toString(),
});

// ---------------------------------------------------------------- preflight

const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const beaconAbi = parseAbi(['function implementation() view returns (address)']);

export interface ImplReport {
  factoryImpl: Address;
  transistorImpl: Address;
  circuitImpl: Address;
  openerImplementation: Address;
  /** Beacon of the account proxy (openerImplementation), read from the proxy's bytecode immutable. */
  accountBeacon: Address;
  /** beacon.implementation(): the upgradeable logic every native account delegates to. */
  accountBeaconImpl: Address;
  openerCodeHash: Hex;
  sealed: boolean;
  mismatches: string[];
}

export async function readImplementations(pc: PublicClient, pins: Pins): Promise<ImplReport> {
  const slot = await pc.getStorageAt({ address: XLAYER.factory, slot: EIP1967_IMPL_SLOT });
  const factoryImpl = getAddress(`0x${(slot ?? '0x').slice(-40)}`);
  const [tBeacon, cBeacon, sealed, openerImplementation, openerCode] = await Promise.all([
    pc.readContract({ address: XLAYER.factory, abi: factoryAbi, functionName: 'transistorBeacon' }),
    pc.readContract({ address: XLAYER.factory, abi: factoryAbi, functionName: 'circuitBeacon' }),
    pc.readContract({ address: XLAYER.factory, abi: factoryAbi, functionName: 'isSealed' }),
    pc.readContract({ address: XLAYER.opener, abi: openerAbi, functionName: 'implementation' }),
    pc.getCode({ address: XLAYER.opener }),
  ]);
  const [transistorImpl, circuitImpl] = await Promise.all([
    pc.readContract({ address: tBeacon, abi: beaconAbi, functionName: 'implementation' }),
    pc.readContract({ address: cBeacon, abi: beaconAbi, functionName: 'implementation' }),
  ]);
  // The account proxy is a beacon proxy whose beacon is an immutable in its bytecode (no EIP-1967
  // beacon slot). Check that the proxy still embeds the known beacon, then read the beacon's
  // implementation: that is the upgradeable code behind every circuit's native account.
  const beaconMismatch: string[] = [];
  const accountBeacon = getAddress(XLAYER.accountBeacon ?? '0x0000000000000000000000000000000000000000');
  const proxyCode = (await pc.getCode({ address: openerImplementation })) ?? '0x';
  if (!proxyCode.toLowerCase().includes(accountBeacon.slice(2).toLowerCase())) {
    beaconMismatch.push(`accountBeacon: the account proxy ${openerImplementation} no longer embeds beacon ${accountBeacon}`);
  }
  const accountBeaconImpl = await pc
    .readContract({ address: accountBeacon, abi: beaconAbi, functionName: 'implementation' })
    .catch(() => '0x0000000000000000000000000000000000000000' as Address);
  const got = { factoryImpl, transistorImpl, circuitImpl, openerImplementation, accountBeaconImpl };
  const mismatches = (Object.keys(got) as (keyof typeof got)[])
    .filter((k) => got[k].toLowerCase() !== pins[k].toLowerCase())
    .map((k) => `${k}: pinned ${pins[k]}, on chain ${got[k]}`);
  mismatches.push(...beaconMismatch);
  return { ...got, accountBeacon, openerCodeHash: keccak256(openerCode ?? '0x'), sealed, mismatches };
}

// ---------------------------------------------------------------- on-chain verification

export interface OnChainCheck {
  ok: boolean;
  cases: number;
  checks: string[];
  errors: string[];
}

/** Compares a taped-out circuit with the compiled netlist and the simulator, exhaustively. */
export async function verifyOnChain(net: Net, circuits: Address, rec: CircuitRecord, prog: Program, expectedHex: Hex): Promise<OnChainCheck> {
  const { pc } = net;
  const id = BigInt(rec.circuitId);
  const checks: string[] = [];
  const errors: string[] = [];
  const expect = (name: string, ok: boolean, detail: string) => (ok ? checks.push(name) : errors.push(`${name}: ${detail}`));

  const [onChainNl, info, owner] = await Promise.all([
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'netlist', args: [id] }),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'circuitInfo', args: [id] }),
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'ownerOf', args: [id] }),
  ]);
  const [nIn, nOut, nState, gateCount] = info;
  const wantGates = flatGateCount(prog);
  expect('netlist bytes', onChainNl.toLowerCase() === expectedHex.toLowerCase(), `${onChainNl.length / 2 - 1} bytes on chain vs ${expectedHex.length / 2 - 1} compiled`);
  expect('circuitInfo', nIn === prog.nIn && nOut === prog.nOut && nState === prog.nState && gateCount === wantGates,
    `chain (${nIn},${nOut},${nState},${gateCount}) vs simulator (${prog.nIn},${prog.nOut},${prog.nState},${wantGates})`);
  expect('TapedOut event', rec.gateCount === wantGates && rec.nState === prog.nState && rec.author.toLowerCase() === net.deployer.toLowerCase(),
    `event gateCount ${rec.gateCount} nState ${rec.nState} author ${rec.author}`);
  expect('owner', owner.toLowerCase() === net.deployer.toLowerCase(), `owner ${owner}`);

  let cases = 0;
  const mismatch: string[] = [];
  const CHUNK = 32;
  if (prog.nState === 0) {
    const rows = 1 << prog.nIn;
    for (let start = 0; start < rows; start += CHUNK) {
      const ks = Array.from({ length: Math.min(CHUNK, rows - start) }, (_, j) => start + j);
      const res = await pc.multicall({
        contracts: ks.map((k) => ({ address: circuits, abi: circuitsAbi, functionName: 'eval', args: [id, packBits(bits(k, prog.nIn))] }) as const),
        allowFailure: false,
        multicallAddress: XLAYER.multicall3,
      });
      ks.forEach((k, j) => {
        cases++;
        const got = unpackBits(res[j] as Hex, prog.nOut).join('');
        const want = Array.from(run(prog, [], bits(k, prog.nIn)).outputs).join('');
        if (got !== want) mismatch.push(`in ${k}: chain ${got} sim ${want}`);
      });
    }
    expect(`eval == simulator (${cases} inputs)`, mismatch.length === 0, mismatch.slice(0, 4).join('; '));
  } else {
    const combos: [number, number][] = [];
    for (let s = 0; s < 1 << prog.nState; s++) for (let k = 0; k < 1 << prog.nIn; k++) combos.push([s, k]);
    for (let start = 0; start < combos.length; start += CHUNK) {
      const part = combos.slice(start, start + CHUNK);
      const res = await pc.multicall({
        contracts: part.map(([s, k]) => ({ address: circuits, abi: circuitsAbi, functionName: 'step', args: [id, packBits(bits(s, prog.nState)), packBits(bits(k, prog.nIn))] }) as const),
        allowFailure: false,
        multicallAddress: XLAYER.multicall3,
      });
      part.forEach(([s, k], j) => {
        cases++;
        const [newState, outputs] = res[j] as readonly [Hex, Hex];
        const got = unpackBits(outputs, prog.nOut).join('') + '/' + unpackBits(newState, prog.nState).join('');
        const r = run(prog, bits(s, prog.nState), bits(k, prog.nIn));
        const want = Array.from(r.outputs).join('') + '/' + Array.from(r.newState).join('');
        if (got !== want) mismatch.push(`state ${s} in ${k}: chain ${got} sim ${want}`);
      });
    }
    expect(`step == simulator (${cases} state x input cases)`, mismatch.length === 0, mismatch.slice(0, 4).join('; '));
  }
  return { ok: errors.length === 0, cases, checks, errors };
}

function bits(v: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (v >> i) & 1);
}
