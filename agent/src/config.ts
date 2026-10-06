// Environment parsing for the Cerebr Agent keeper. Everything is validated up front; the private key is
// read once, turned into a viem account and removed from process.env. It is never logged.

import { readFileSync } from 'node:fs';
import { isAddress, parseEther, type Address, type Hex } from 'viem';

export type Network = 'xlayer' | 'fork';

export interface AgentEnvConfig {
  network: Network;
  rpcUrl: string;
  agent: Address;
  /** Hex private key of the hot wallet (absent in DRY_RUN without a key). Never log this object raw. */
  privateKey?: Hex;
  dryRun: boolean;
  intervalSec: number;
  /** Refuse to start (and stop sending) below this balance. */
  minBalanceWei: bigint;
  /** gas limit = estimate * gasMarginBps / 10000. */
  gasMarginBps: bigint;
  /** Hard cap on maxFeePerGas; above it the cycle is skipped (X Layer runs at ~0.02 gwei). */
  maxFeeWei: bigint;
  /** Cap on the priority fee (X Layer suggests 1 wei; dev nodes suggest 1 gwei). */
  maxPriorityFeeWei: bigint;
  /** Replace a transaction still pending after this long (same nonce, +20% fees). */
  txTimeoutSec: number;
  brainWalletCheckpoint: boolean;
  checkpointIntervalSec: number;
  healthHost: string;
  healthPort: number;
  stateFile: string;
  /** Stop after this many cycles (0 = forever). */
  maxCycles: number;
}

export const XLAYER_RPC = 'https://rpc.xlayer.tech';

function num(env: NodeJS.ProcessEnv, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${key} must be a number in [${min}, ${max}]`);
  return v;
}

function bool(env: NodeJS.ProcessEnv, key: string): boolean {
  const v = (env[key] ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function readKey(env: NodeJS.ProcessEnv): Hex | undefined {
  let raw = env.AGENT_PRIVATE_KEY;
  if (!raw && env.AGENT_PRIVATE_KEY_FILE) raw = readFileSync(env.AGENT_PRIVATE_KEY_FILE, 'utf8');
  delete env.AGENT_PRIVATE_KEY; // keep it out of child processes and later dumps of the environment
  if (!raw) return undefined;
  raw = raw.trim();
  if (!raw.startsWith('0x')) raw = `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('AGENT_PRIVATE_KEY is not a 32-byte hex key');
  return raw as Hex;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentEnvConfig {
  const network = env.NETWORK as Network | undefined;
  if (network !== 'xlayer' && network !== 'fork') {
    throw new Error('NETWORK must be set explicitly: NETWORK=xlayer (mainnet, real OKB) or NETWORK=fork (local anvil)');
  }
  const rpcUrl = env.RPC_URL || (network === 'xlayer' ? XLAYER_RPC : 'http://127.0.0.1:8605');
  const agent = env.AGENT_ADDRESS ?? '';
  if (!isAddress(agent)) throw new Error('AGENT_ADDRESS must be the deployed CerebrAgent address');
  const dryRun = bool(env, 'DRY_RUN');
  const privateKey = readKey(env);
  if (!privateKey && !dryRun) throw new Error('AGENT_PRIVATE_KEY (or AGENT_PRIVATE_KEY_FILE) is required unless DRY_RUN=1');
  return {
    network,
    rpcUrl,
    agent,
    privateKey,
    dryRun,
    intervalSec: num(env, 'INTERVAL_SEC', 600, 5, 7 * 86_400),
    minBalanceWei: parseEther(env.MIN_BALANCE_OKB || '0.001'),
    gasMarginBps: BigInt(num(env, 'GAS_MARGIN_BPS', 12_000, 10_000, 30_000)),
    maxFeeWei: BigInt(Math.round(num(env, 'MAX_FEE_GWEI', 1, 0.001, 1_000) * 1e9)),
    maxPriorityFeeWei: BigInt(Math.round(num(env, 'MAX_PRIORITY_FEE_GWEI', 0.001, 0, 100) * 1e9)),
    txTimeoutSec: num(env, 'TX_TIMEOUT_SEC', 120, 10, 3600),
    brainWalletCheckpoint: bool(env, 'BRAIN_WALLET_CHECKPOINT'),
    checkpointIntervalSec: num(env, 'CHECKPOINT_INTERVAL_SEC', 86_400, 3600, 30 * 86_400),
    healthHost: env.HEALTH_HOST || '127.0.0.1',
    healthPort: num(env, 'HEALTH_PORT', 8787, 0, 65_535),
    stateFile: env.STATE_FILE || './data/state.json',
    maxCycles: num(env, 'MAX_CYCLES', 0, 0, 1e9),
  };
}

/** The config with the key replaced, for logs and the status endpoint. */
export function publicConfig(c: AgentEnvConfig): Omit<AgentEnvConfig, 'privateKey'> & { privateKey: string } {
  return { ...c, privateKey: c.privateKey ? '[redacted]' : '[none]' };
}
