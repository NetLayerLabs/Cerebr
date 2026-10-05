// The launch output consumed by the dApp, CerebrScope tooling and the submission:
// launch/out/<chainId>[.fork].json, schema "cerebr.launch/1" (documented in LAUNCH.md).

import type { Address, Hash, Hex } from 'viem';
import { LATCH_ID, NAND_ID, XLAYER, accountOf, explorerAddress, explorerTx, readCpu, type AccountInfo, type CpuInfo } from '../../src/tapeout/index.ts';
import type { LaunchConfig } from './config.ts';
import type { ImplReport, Net } from './chain.ts';
import { flatGateCount, fmt, type CompiledCircuit } from './plan.ts';
import { outPath, writeJson, type LaunchState } from './state.ts';

export interface LaunchOut {
  schema: 'cerebr.launch/1';
  network: 'xlayer' | 'fork';
  chainId: number;
  generatedAt: string;
  block: string;
  explorer: string;
  deployer: Address;
  tapeout: {
    factory: Address;
    opener: Address;
    registry: Address;
    accountImpl: Address;
    multicall3: Address;
    implementations: Omit<ImplReport, 'mismatches'>;
  };
  processor: {
    name: string;
    symbol: string;
    story: string;
    circuits: Address;
    transistors: Address;
    creator: Address;
    supplyCap: string;
    minted: string;
    mintPrice: string;
    mintPriceOkb: string;
    protocolFee: string;
    tapeoutFee: string;
    circuitCount: string;
    tokenIds: { NAND: string; LATCH: string };
    listedInTapeoutApp: boolean;
    createTx: Hash;
    createBlock: string;
    links: { circuits: string; transistors: string; createTx: string };
  };
  /** CerebrScope (on-chain die shots + metadata), when configured. */
  scope?: Address;
  outputMode: 'direct' | 'buffered';
  circuits: OutCircuit[];
  costs: {
    /** Sum of msg.value of every launch transaction, wei. */
    valuePaid: string;
    gasPaid: string;
    /** Mint revenue withdrawn back to the deployer (creator), wei. */
    withdrawn: string;
    /** valuePaid + gasPaid - withdrawn, wei. */
    net: string;
    netOkb: string;
  };
}

export interface OutCircuit {
  key: string;
  circuitId: string;
  name: string;
  description: string;
  story: string;
  kind: 'combinational' | 'sequential';
  flagship: boolean;
  inputs: string[];
  outputs: string[];
  state?: string[];
  layers?: { weights: number[]; theta: number; name?: string }[][];
  deps: { key: string; circuitId: string }[];
  nIn: number;
  nOut: number;
  nState: number;
  /** Flattened NAND + LATCH count (through REFs), as circuitInfo reports it. */
  gateCount: number;
  /** Elements in this circuit's own netlist and what tapeout burned. */
  elements: { nand: number; latch: number; ref: number };
  netlist: Hex;
  tx?: Hash;
  block?: string;
  /** The circuit's native TapeOut account (ERC-6551 via the opener). Deterministic even before open(). */
  account: { address: Address; opened: boolean; tx?: Hash };
  verified: { ok: boolean; cases: number; checks: string[]; at: string } | null;
  links: { tx?: string; account: string };
}

export async function writeOut(net: Net, cfg: LaunchConfig, state: LaunchState, compiled: CompiledCircuit[], impl: ImplReport): Promise<{ path: string; out: LaunchOut; cpu: CpuInfo }> {
  if (!state.cpu) throw new Error('no processor yet');
  const cpu = await readCpu(net.pc, state.cpu.circuits);
  const block = await net.pc.getBlockNumber();
  const idOf = (key: string) => state.circuits[key]?.circuitId ?? '';
  const accounts = new Map<string, AccountInfo>();
  for (const [key, rec] of Object.entries(state.circuits)) accounts.set(key, await accountOf(net.pc, cpu.circuits, BigInt(rec.circuitId)));

  const circuits: OutCircuit[] = compiled.filter((c) => state.circuits[c.entry.id]).map((c) => {
    const rec = state.circuits[c.entry.id];
    const acct = state.accounts[c.entry.id];
    const native = accounts.get(c.entry.id)!;
    return {
      key: c.entry.id,
      circuitId: rec.circuitId,
      name: c.circuit.name,
      description: c.circuit.description,
      story: c.circuit.story,
      kind: c.circuit.kind,
      flagship: c.entry.flagship === true,
      inputs: c.circuit.inputs,
      outputs: c.circuit.outputs,
      ...(c.circuit.state ? { state: c.circuit.state } : {}),
      ...(c.circuit.layers ? { layers: c.circuit.layers.map((l) => l.map((n) => ({ weights: n.weights, theta: n.theta, ...(n.name ? { name: n.name } : {}) }))) } : {}),
      deps: c.circuit.deps.map((d) => ({ key: d, circuitId: idOf(d) })),
      nIn: rec.nIn,
      nOut: rec.nOut,
      nState: rec.nState,
      gateCount: c.program ? flatGateCount(c.program) : rec.gateCount,
      elements: { nand: c.nand, latch: c.latch, ref: c.ref },
      netlist: rec.netlist,
      ...(rec.tx ? { tx: rec.tx.hash, block: rec.tx.block } : {}),
      account: { address: native.account, opened: native.opened, ...(acct?.tx ? { tx: acct.tx.hash } : {}) },
      verified: rec.verified ?? null,
      links: {
        ...(rec.tx ? { tx: explorerTx(rec.tx.hash) } : {}),
        account: explorerAddress(native.account),
      },
    };
  });

  const txs = [state.cpu.tx, ...state.mints.map((m) => m.tx), ...Object.values(state.circuits).flatMap((c) => (c.tx ? [c.tx] : [])),
    ...Object.values(state.accounts).flatMap((a) => (a.tx ? [a.tx] : [])), ...state.withdrawals.map((w) => w.tx)];
  const valuePaid = txs.reduce((s, t) => s + BigInt(t.value ?? '0'), 0n);
  const gasPaid = txs.reduce((s, t) => s + BigInt(t.gasCost ?? '0'), 0n);
  const withdrawn = state.withdrawals.reduce((s, w) => s + BigInt(w.amount), 0n);

  const { mismatches: _m, ...implementations } = impl;
  const out: LaunchOut = {
    schema: 'cerebr.launch/1',
    network: net.network,
    chainId: state.chainId,
    generatedAt: new Date().toISOString(),
    block: block.toString(),
    explorer: XLAYER.explorer,
    deployer: net.deployer,
    tapeout: { factory: XLAYER.factory, opener: XLAYER.opener, registry: XLAYER.registry, accountImpl: XLAYER.accountImpl, multicall3: XLAYER.multicall3, implementations },
    processor: {
      name: cpu.name,
      symbol: cpu.symbol,
      story: cpu.story,
      circuits: cpu.circuits,
      transistors: cpu.transistors,
      creator: cpu.creator,
      supplyCap: cpu.supplyCap.toString(),
      minted: cpu.minted.toString(),
      mintPrice: cpu.mintPrice.toString(),
      mintPriceOkb: fmt(cpu.mintPrice),
      protocolFee: cpu.protocolFee.toString(),
      tapeoutFee: cpu.tapeoutFee.toString(),
      circuitCount: cpu.circuitCount.toString(),
      tokenIds: { NAND: NAND_ID.toString(), LATCH: LATCH_ID.toString() },
      listedInTapeoutApp: cpu.supplyCap >= 10000n && cpu.minted >= 1n,
      createTx: state.cpu.tx.hash,
      createBlock: state.cpu.tx.block,
      links: { circuits: explorerAddress(cpu.circuits), transistors: explorerAddress(cpu.transistors), createTx: explorerTx(state.cpu.tx.hash) },
    },
    ...(cfg.scope ? { scope: cfg.scope } : {}),
    outputMode: cfg.outputMode,
    circuits,
    costs: {
      valuePaid: valuePaid.toString(),
      gasPaid: gasPaid.toString(),
      withdrawn: withdrawn.toString(),
      net: (valuePaid + gasPaid - withdrawn).toString(),
      netOkb: fmt(valuePaid + gasPaid - withdrawn),
    },
  };
  const path = outPath(net.network, state.chainId);
  writeJson(path, out);
  return { path, out, cpu };
}
