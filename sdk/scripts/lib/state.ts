// Resumable launch state: launch/state.<chainId>[.fork].json, rewritten (atomically) after every
// step and before waiting on every transaction, so an interrupted run picks up where it stopped
// without repeating a paid action. Fork and mainnet share chainId 196, hence the `.fork` suffix.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Address, Hash, Hex } from 'viem';
import { LAUNCH_DIR } from './config.ts';

export interface TxRecord {
  hash: Hash;
  block: string;
  gasUsed: string;
  /** gasUsed * effectiveGasPrice, wei. */
  gasCost: string;
  /** msg.value, wei. */
  value: string;
}

export interface CircuitRecord {
  circuitId: string;
  netlist: Hex;
  nIn: number;
  nOut: number;
  /** From the TapedOut event. */
  gateCount: number;
  nState: number;
  author: Address;
  tx?: TxRecord;
  /** Set when it was found already on chain (resumed run) rather than taped out by this run. */
  adopted?: boolean;
  verified?: { ok: boolean; cases: number; at: string; checks: string[] };
}

export interface LaunchState {
  version: 1;
  network: 'fork' | 'xlayer';
  chainId: number;
  deployer: Address;
  startedAt: string;
  updatedAt: string;
  /** A sent-but-unconfirmed transaction. Resolved first on resume. */
  pending?: { step: string; hash: Hash; sentAt: string };
  cpu?: { circuits: Address; transistors: Address; tx: TxRecord };
  mints: { id: 'NAND' | 'LATCH'; amount: string; value: string; tx: TxRecord }[];
  circuits: Record<string, CircuitRecord>;
  accounts: Record<string, { account: Address; tx?: TxRecord }>;
  withdrawals: { amount: string; tx: TxRecord }[];
  balanceAtStart?: string;
  done?: string;
}

export function suffix(network: 'fork' | 'xlayer', chainId: number): string {
  return network === 'fork' ? `${chainId}.fork` : `${chainId}`;
}

export function statePath(network: 'fork' | 'xlayer', chainId: number): string {
  return resolve(LAUNCH_DIR, `state.${suffix(network, chainId)}.json`);
}

export function outPath(network: 'fork' | 'xlayer', chainId: number): string {
  return resolve(LAUNCH_DIR, 'out', `${suffix(network, chainId)}.json`);
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n';
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, toJson(value));
  renameSync(tmp, path);
}

export class StateFile {
  readonly path: string;
  data: LaunchState;

  constructor(path: string, data: LaunchState) {
    this.path = path;
    this.data = data;
  }

  static open(network: 'fork' | 'xlayer', chainId: number, deployer: Address): StateFile {
    const path = statePath(network, chainId);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8')) as LaunchState;
      if (data.chainId !== chainId || data.network !== network) throw new Error(`${path} belongs to ${data.network}/${data.chainId}`);
      if (data.deployer.toLowerCase() !== deployer.toLowerCase()) {
        throw new Error(`${path} was started by ${data.deployer}, not ${deployer}. Use that wallet, or archive the state file to start over.`);
      }
      return new StateFile(path, data);
    }
    const now = new Date().toISOString();
    return new StateFile(path, {
      version: 1, network, chainId, deployer, startedAt: now, updatedAt: now,
      mints: [], circuits: {}, accounts: {}, withdrawals: [],
    });
  }

  /** Moves the current file aside (fork only: a restarted anvil forgets everything). */
  archive(reason: string): string {
    const to = this.path.replace(/\.json$/, `.stale-${Date.now()}.json`);
    if (existsSync(this.path)) renameSync(this.path, to);
    console.log(`  state: archived ${this.path} -> ${to} (${reason})`);
    return to;
  }

  save() {
    this.data.updatedAt = new Date().toISOString();
    writeJson(this.path, this.data);
  }
}
