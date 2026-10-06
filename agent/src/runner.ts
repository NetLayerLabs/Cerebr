// The keeper's core: one `tick()` = observe the agent, and if it may act, send act() from the hot wallet
// (or, once a day when enabled, a checkpoint through the policy circuit's brain wallet), then verify the
// recorded decision against the local netlist simulation. main.ts schedules ticks; the fork e2e drives
// them directly.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
  parseEventLogs,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PrivateKeyAccount,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  FALLBACK_NAMES,
  VERDICT_NAMES,
  cerebrAgentAbi,
  checkRecord,
  explainInputs,
  type AgentConfig,
  type AgentRecord,
} from '../../sdk/src/neuro/agent.ts';
import type { AgentEnvConfig } from './config.ts';
import { log } from './log.ts';

export const openerAbi = [
  { type: 'function', name: 'isOpened', stateMutability: 'view', inputs: [{ name: 'circuits', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

export const accountAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'EXEC_FEE', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function', name: 'execute', stateMutability: 'payable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }, { name: 'operation', type: 'uint8' }],
    outputs: [{ type: 'bytes' }],
  },
] as const;

const TAPEOUT_OPENER: Address = '0x536add8f30f03b69f6fbf29d425a816a0dc50106';
const ACT_DATA = encodeFunctionData({ abi: cerebrAgentAbi, functionName: 'act' });

export type TxKind = 'act' | 'checkpoint';

interface Inflight {
  kind: TxKind;
  hash: Hash;
  nonce: number;
  to: Address;
  data: Hex;
  value: string;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  sentAt: number;
  replacements: number;
}

interface Persisted {
  lastCheckpointAt: number;
  inflight?: Inflight;
  totals: { acts: number; checkpoints: number; feesWei: string };
}

export interface TickResult {
  action: 'acted' | 'checkpoint' | 'skipped' | 'dry-run' | 'pending';
  reason?: string;
  seq?: bigint;
  verdict?: string;
  hash?: Hash;
  gasUsed?: bigint;
  feeWei?: bigint;
  verified?: boolean;
}

export type Status = 'starting' | 'running' | 'low-balance' | 'error' | 'stopped';

/** Retries a read with exponential backoff (1s, 2s, 4s). */
export async function retry<T>(fn: () => Promise<T>, what: string, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) {
        log('warn', 'rpc.retry', { what, attempt: i + 1, error: e as Error });
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
  }
  throw last;
}

/** Decodes a CerebrAgent custom error out of any viem error (e.g. "TooSoon"), if there is one. */
export function revertName(err: unknown): string | undefined {
  let e: any = err;
  for (let depth = 0; e && depth < 10; depth++, e = e.cause) {
    const data = typeof e.data === 'string' ? e.data : typeof e.data?.data === 'string' ? e.data.data : undefined;
    if (data && data.startsWith('0x') && data.length >= 10) {
      try {
        return decodeErrorResult({ abi: cerebrAgentAbi, data: data as Hex }).errorName;
      } catch {
        return `revert(${data.slice(0, 10)})`;
      }
    }
    if (e.data?.errorName) return e.data.errorName;
  }
  return undefined;
}

function isDevNode(clientVersion: string): boolean {
  return /anvil|hardhat|ganache/i.test(clientVersion);
}

export class Runner {
  readonly cfg: AgentEnvConfig;
  readonly pc: PublicClient;
  readonly wc?: WalletClient;
  readonly account?: PrivateKeyAccount;
  readonly from: Address;
  readonly chain: Chain;
  readonly clientVersion: string;
  agentConfig!: AgentConfig;
  policyCircuitId!: bigint;
  circuits!: Address;
  brainWallet!: Address;
  status: Status = 'starting';
  balance = 0n;
  nextRunAt = 0;
  lastCycleAt = 0;
  consecutiveErrors = 0;
  counters = { cycles: 0, acts: 0, checkpoints: 0, skips: 0, errors: 0 };
  lastObservation: unknown;
  lastDecision: unknown;
  lastTx: unknown;
  lastError: string | undefined;
  checkpointEligible = false;
  execFee = 0n;
  private persisted: Persisted = { lastCheckpointAt: 0, totals: { acts: 0, checkpoints: 0, feesWei: '0' } };

  private constructor(cfg: AgentEnvConfig, pc: PublicClient, chain: Chain, clientVersion: string) {
    this.cfg = cfg;
    this.pc = pc;
    this.chain = chain;
    this.clientVersion = clientVersion;
    if (cfg.privateKey) {
      this.account = privateKeyToAccount(cfg.privateKey);
      this.wc = createWalletClient({ account: this.account, chain, transport: http(cfg.rpcUrl, { timeout: 20_000 }) });
    }
    this.from = this.account?.address ?? '0x0000000000000000000000000000000000000000';
  }

  /** Connects, applies the mainnet guard, reads the agent's immutable configuration. */
  static async create(cfg: AgentEnvConfig): Promise<Runner> {
    const probe = createPublicClient({ transport: http(cfg.rpcUrl, { timeout: 20_000, retryCount: 2 }) });
    const chainId = await retry(() => probe.getChainId(), 'chainId');
    const clientVersion = String(await retry(() => probe.request({ method: 'web3_clientVersion' as any }), 'clientVersion'));
    const dev = isDevNode(clientVersion);
    if (cfg.network === 'xlayer' && (chainId !== 196 || dev)) {
      throw new Error(`NETWORK=xlayer but the RPC is chainId ${chainId} (${clientVersion}); refusing to start`);
    }
    if (cfg.network === 'fork' && !dev) {
      throw new Error(`NETWORK=fork but the RPC is not a local dev node (${clientVersion}, chainId ${chainId}); refusing to send to a live chain`);
    }
    const chain = defineChain({
      id: chainId,
      name: cfg.network === 'xlayer' ? 'X Layer' : 'X Layer (fork)',
      nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
      rpcUrls: { default: { http: [cfg.rpcUrl] } },
    });
    const pc = createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 20_000, retryCount: 2 }) }) as PublicClient;
    const r = new Runner(cfg, pc, chain, clientVersion);
    await r.loadAgent();
    r.loadState();
    return r;
  }

  private async loadAgent(): Promise<void> {
    const a = { address: this.cfg.agent, abi: cerebrAgentAbi } as const;
    const code = await retry(() => this.pc.getCode({ address: this.cfg.agent }), 'agent code');
    if (!code || code === '0x') throw new Error(`AGENT_ADDRESS ${this.cfg.agent} has no code on this chain`);
    const [c, policyCircuitId, circuits, brainWallet] = await Promise.all([
      this.pc.readContract({ ...a, functionName: 'config' }),
      this.pc.readContract({ ...a, functionName: 'policyCircuitId' }),
      this.pc.readContract({ ...a, functionName: 'circuits' }),
      this.pc.readContract({ ...a, functionName: 'brainWallet' }),
    ]);
    this.agentConfig = {
      calmMaxBasefee: c.calmMaxBasefee,
      spikeBps: c.spikeBps,
      windowStartHour: c.windowStartHour,
      windowEndHour: c.windowEndHour,
      restBlocks: c.restBlocks,
      refractoryBlocks: c.refractoryBlocks,
      minIntervalBlocks: c.minIntervalBlocks,
    };
    this.policyCircuitId = policyCircuitId;
    this.circuits = circuits;
    this.brainWallet = brainWallet;
  }

  // ------------------------------------------------------------ persistence

  private loadState(): void {
    try {
      const p = JSON.parse(readFileSync(this.cfg.stateFile, 'utf8')) as Persisted;
      if (p && typeof p.lastCheckpointAt === 'number' && p.totals) this.persisted = p;
    } catch {
      /* first run */
    }
  }

  private saveState(): void {
    try {
      mkdirSync(dirname(this.cfg.stateFile), { recursive: true });
      const tmp = `${this.cfg.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.persisted, null, 2));
      renameSync(tmp, this.cfg.stateFile);
    } catch (e) {
      log('warn', 'state.save_failed', { error: e as Error });
    }
  }

  // ------------------------------------------------------------ startup checks

  /** Balance floor (unless DRY_RUN) and brain-wallet checkpoint eligibility. Throws to refuse starting. */
  async preflight(): Promise<void> {
    this.balance = await retry(() => this.pc.getBalance({ address: this.from }), 'balance');
    log('info', 'preflight', {
      network: this.cfg.network,
      chainId: this.chain.id,
      node: this.clientVersion,
      agent: this.cfg.agent,
      policyCircuitId: this.policyCircuitId,
      brainWallet: this.brainWallet,
      hotWallet: this.from,
      balanceOkb: formatEther(this.balance),
      dryRun: this.cfg.dryRun,
      intervalSec: this.cfg.intervalSec,
    });
    if (!this.cfg.dryRun && this.balance < this.cfg.minBalanceWei) {
      throw new Error(
        `hot wallet ${this.from} holds ${formatEther(this.balance)} OKB < MIN_BALANCE_OKB ${formatEther(this.cfg.minBalanceWei)}; fund it first`,
      );
    }
    if (this.cfg.brainWalletCheckpoint) await this.checkCheckpointEligibility(true);
  }

  async checkCheckpointEligibility(verbose = false): Promise<boolean> {
    this.checkpointEligible = false;
    if (this.brainWallet === '0x0000000000000000000000000000000000000000') {
      if (verbose) log('warn', 'checkpoint.disabled', { reason: 'agent was deployed without an opener (no brain wallet)' });
      return false;
    }
    const opened = await this.pc.readContract({ address: TAPEOUT_OPENER, abi: openerAbi, functionName: 'isOpened', args: [this.circuits, this.policyCircuitId] }).catch(() => false);
    if (!opened) {
      if (verbose) log('warn', 'checkpoint.disabled', { reason: `brain wallet ${this.brainWallet} of circuit #${this.policyCircuitId} is not opened (opener.open costs 0.08 OKB)` });
      return false;
    }
    const [owner, execFee] = await Promise.all([
      this.pc.readContract({ address: this.brainWallet, abi: accountAbi, functionName: 'owner' }),
      this.pc.readContract({ address: this.brainWallet, abi: accountAbi, functionName: 'EXEC_FEE' }),
    ]);
    this.execFee = execFee;
    if (owner.toLowerCase() !== this.from.toLowerCase()) {
      if (verbose) log('warn', 'checkpoint.disabled', { reason: `the hot wallet does not own circuit #${this.policyCircuitId} (owner ${owner})` });
      return false;
    }
    if (verbose) {
      log('warn', 'checkpoint.enabled', {
        brainWallet: this.brainWallet,
        execFeeOkb: formatEther(execFee),
        note: 'each checkpoint pays the TapeOut EXEC_FEE on top of gas; at one per day that is ~0.039 OKB per 30 days, ~3.5x the act() gas at 10-minute cycles',
      });
    }
    this.checkpointEligible = true;
    return true;
  }

  // ------------------------------------------------------------ one cycle

  async tick(): Promise<TickResult> {
    this.counters.cycles++;
    this.lastCycleAt = Date.now();
    try {
      const res = await this.tickInner();
      this.consecutiveErrors = 0;
      if (this.status === 'starting' || this.status === 'error') this.status = 'running';
      if (res.action === 'skipped') this.counters.skips++;
      return res;
    } catch (e) {
      this.counters.errors++;
      this.consecutiveErrors++;
      this.lastError = (e as Error).message?.split('\n')[0];
      this.status = 'error';
      log('error', 'cycle.error', { error: e as Error, consecutive: this.consecutiveErrors });
      throw e;
    }
  }

  private async tickInner(): Promise<TickResult> {
    const pending = await this.resolveInflight();
    if (pending) return pending;

    const block = await retry(() => this.pc.getBlock({ blockTag: 'latest' }), 'block');
    const baseFee = block.baseFeePerGas ?? 0n;
    // observeAt(latest basefee): a plain eth_call sees BASEFEE = 0 on X Layer.
    const [obs, latest, balance] = await Promise.all([
      retry(() => this.pc.readContract({ address: this.cfg.agent, abi: cerebrAgentAbi, functionName: 'observeAt', args: [baseFee] }), 'observe'),
      retry(() => this.pc.readContract({ address: this.cfg.agent, abi: cerebrAgentAbi, functionName: 'latestDecision' }), 'latestDecision'),
      retry(() => this.pc.getBalance({ address: this.from }), 'balance'),
    ]);
    this.balance = balance;
    this.lastObservation = { ...obs, pins: explainInputs(obs.inputs), verdictName: VERDICT_NAMES[obs.verdict], reasonName: FALLBACK_NAMES[obs.reason] };
    if (latest.seq !== 0) this.lastDecision = this.describe(latest);
    log('info', 'observe', {
      block: block.number,
      basefee: baseFee,
      ema: obs.ema,
      hourUtc: obs.hourUtc,
      inputs: obs.inputs,
      preview: VERDICT_NAMES[obs.verdict],
      canAct: obs.canAct,
      nextActBlock: obs.nextActBlock,
      balanceOkb: formatEther(balance),
    });

    if (!obs.canAct) return { action: 'skipped', reason: `too soon (next act block ${obs.nextActBlock})` };
    if (!this.cfg.dryRun && balance < this.cfg.minBalanceWei) {
      this.status = 'low-balance';
      log('error', 'balance.low', { balanceOkb: formatEther(balance), minOkb: formatEther(this.cfg.minBalanceWei), hotWallet: this.from });
      return { action: 'skipped', reason: 'balance below MIN_BALANCE_OKB' };
    }
    if (this.status === 'low-balance') this.status = 'running';

    let kind: TxKind = 'act';
    let to = this.cfg.agent;
    let data = ACT_DATA;
    let value = 0n;
    const checkpointDue = this.cfg.brainWalletCheckpoint && Date.now() / 1000 - this.persisted.lastCheckpointAt >= this.cfg.checkpointIntervalSec;
    if (checkpointDue && (await this.checkCheckpointEligibility()) && balance >= this.execFee + this.cfg.minBalanceWei) {
      kind = 'checkpoint';
      to = this.brainWallet;
      value = this.execFee;
      data = encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [this.cfg.agent, 0n, ACT_DATA, 0] });
    }

    // Simulate first: someone else may have acted in this block (the agent is permissionless).
    try {
      await this.pc.call({ account: this.from, to, data, value });
    } catch (e) {
      const name = revertName(e);
      if (name === 'TooSoon') return { action: 'skipped', reason: 'too soon (another caller acted first)' };
      throw new Error(`simulation of ${kind} failed: ${name ?? (e as Error).message.split('\n')[0]}`);
    }
    const estimate = await retry(() => this.pc.estimateGas({ account: this.from, to, data, value }), 'estimateGas');
    const gas = (estimate * this.cfg.gasMarginBps) / 10_000n;
    const prio = await this.pc.estimateMaxPriorityFeePerGas().catch(() => 1n);
    const maxPriorityFeePerGas = prio < 1n ? 1n : prio > this.cfg.maxPriorityFeeWei ? this.cfg.maxPriorityFeeWei || 1n : prio;
    const maxFeePerGas = baseFee * 2n + maxPriorityFeePerGas;
    if (maxFeePerGas > this.cfg.maxFeeWei) {
      log('warn', 'fee.cap', { maxFeePerGas, capWei: this.cfg.maxFeeWei });
      return { action: 'skipped', reason: 'fee above MAX_FEE_GWEI' };
    }
    if (this.cfg.dryRun || !this.wc || !this.account) {
      log('info', 'dry_run.would_send', { kind, to, value, gas, estimate, maxFeePerGas, maxPriorityFeePerGas, preview: VERDICT_NAMES[obs.verdict] });
      return { action: 'dry-run', reason: kind };
    }

    const nonce = await retry(() => this.pc.getTransactionCount({ address: this.from, blockTag: 'pending' }), 'nonce');
    const hash = await this.wc.sendTransaction({ account: this.account, chain: this.chain, to, data, value, gas, maxFeePerGas, maxPriorityFeePerGas, nonce });
    const inflight: Inflight = {
      kind, hash, nonce, to, data, value: value.toString(), gas: gas.toString(),
      maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString(), sentAt: Date.now(), replacements: 0,
    };
    this.persisted.inflight = inflight;
    this.saveState();
    log('info', 'tx.sent', { kind, hash, nonce, gas, maxFeePerGas });
    return this.awaitInflight(inflight);
  }

  /** Waits for the in-flight transaction up to TX_TIMEOUT_SEC; returns 'pending' if it is still out. */
  private async awaitInflight(f: Inflight): Promise<TickResult> {
    let receipt: TransactionReceipt;
    try {
      receipt = await this.pc.waitForTransactionReceipt({ hash: f.hash, timeout: this.cfg.txTimeoutSec * 1000, pollingInterval: 1000 });
    } catch {
      log('warn', 'tx.pending', { hash: f.hash, nonce: f.nonce, ageSec: Math.round((Date.now() - f.sentAt) / 1000) });
      return { action: 'pending', hash: f.hash };
    }
    return this.onReceipt(f, receipt);
  }

  /** Before a new cycle: settle a transaction left from the previous one (mined, replaced, or still stuck). */
  private async resolveInflight(): Promise<TickResult | undefined> {
    const f = this.persisted.inflight;
    if (!f) return undefined;
    const receipt = await this.pc.getTransactionReceipt({ hash: f.hash }).catch(() => undefined);
    if (receipt) {
      await this.onReceipt(f, receipt);
      return undefined;
    }
    const mined = await retry(() => this.pc.getTransactionCount({ address: this.from, blockTag: 'latest' }), 'nonce');
    if (mined > f.nonce) {
      log('warn', 'tx.superseded', { hash: f.hash, nonce: f.nonce });
      this.persisted.inflight = undefined;
      this.saveState();
      return undefined;
    }
    if (Date.now() - f.sentAt < this.cfg.txTimeoutSec * 1000) return this.awaitInflight(f);
    if (!this.wc || !this.account) return { action: 'pending', hash: f.hash };
    // Same nonce, +20% fees (the minimum bump nodes accept is 10%).
    const bump = (x: string) => (BigInt(x) * 12n) / 10n + 1n;
    const maxFeePerGas = bump(f.maxFeePerGas);
    if (maxFeePerGas > this.cfg.maxFeeWei) {
      log('error', 'tx.stuck', { hash: f.hash, nonce: f.nonce, note: 'replacement would exceed MAX_FEE_GWEI' });
      return { action: 'pending', hash: f.hash };
    }
    const next: Inflight = { ...f, maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: bump(f.maxPriorityFeePerGas).toString(), sentAt: Date.now(), replacements: f.replacements + 1 };
    next.hash = await this.wc.sendTransaction({
      account: this.account, chain: this.chain, to: f.to, data: f.data, value: BigInt(f.value), gas: BigInt(f.gas),
      maxFeePerGas, maxPriorityFeePerGas: BigInt(next.maxPriorityFeePerGas), nonce: f.nonce,
    });
    this.persisted.inflight = next;
    this.saveState();
    log('warn', 'tx.replaced', { old: f.hash, hash: next.hash, nonce: f.nonce, maxFeePerGas });
    return this.awaitInflight(next);
  }

  private async onReceipt(f: Inflight, receipt: TransactionReceipt): Promise<TickResult> {
    this.persisted.inflight = undefined;
    const feeWei = receipt.gasUsed * receipt.effectiveGasPrice + (f.kind === 'checkpoint' && receipt.status === 'success' ? BigInt(f.value) : 0n);
    this.persisted.totals.feesWei = (BigInt(this.persisted.totals.feesWei) + feeWei).toString();
    this.lastTx = { kind: f.kind, hash: receipt.transactionHash, status: receipt.status, block: receipt.blockNumber, gasUsed: receipt.gasUsed, feeWei };
    if (receipt.status !== 'success') {
      this.saveState();
      log('warn', 'tx.reverted', { kind: f.kind, hash: receipt.transactionHash, gasUsed: receipt.gasUsed, note: 'usually TooSoon: another caller acted in the same block' });
      return { action: 'skipped', reason: 'reverted', hash: receipt.transactionHash, gasUsed: receipt.gasUsed, feeWei };
    }
    if (f.kind === 'checkpoint') {
      this.persisted.lastCheckpointAt = Math.floor(Date.now() / 1000);
      this.persisted.totals.checkpoints++;
      this.counters.checkpoints++;
    } else {
      this.persisted.totals.acts++;
      this.counters.acts++;
    }
    this.saveState();

    const events = parseEventLogs({ abi: cerebrAgentAbi, logs: receipt.logs, eventName: 'Decision' }).filter((l) => l.address.toLowerCase() === this.cfg.agent.toLowerCase());
    const ev = events[0];
    if (!ev) {
      log('error', 'decision.missing', { hash: receipt.transactionHash });
      return { action: f.kind === 'act' ? 'acted' : 'checkpoint', hash: receipt.transactionHash, gasUsed: receipt.gasUsed, feeWei, verified: false };
    }
    const seq = ev.args.seq;
    const rec = await retry(() => this.pc.readContract({ address: this.cfg.agent, abi: cerebrAgentAbi, functionName: 'decisions', args: [seq, 1n] }), 'record');
    const record = rec[0] as AgentRecord | undefined;
    const check = record ? checkRecord(record, this.agentConfig) : undefined;
    const verified = !!check && check.inputsOk && check.outputOk;
    this.lastDecision = record ? this.describe(record) : this.lastDecision;
    log(verified ? 'info' : 'error', 'decision', {
      kind: f.kind,
      seq,
      verdict: VERDICT_NAMES[ev.args.verdict],
      inputs: ev.args.inputs,
      pins: explainInputs(ev.args.inputs),
      outputs: ev.args.outputs,
      basefee: ev.args.basefee,
      viaBrainWallet: ev.args.viaBrainWallet,
      hash: receipt.transactionHash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      feeOkb: formatEther(feeWei),
      verified,
    });
    return { action: f.kind === 'act' ? 'acted' : 'checkpoint', seq, verdict: VERDICT_NAMES[ev.args.verdict], hash: receipt.transactionHash, gasUsed: receipt.gasUsed, feeWei, verified };
  }

  private describe(r: AgentRecord) {
    return { ...r, verdictName: VERDICT_NAMES[r.verdict], reasonName: FALLBACK_NAMES[r.reason], pins: explainInputs(r.inputs) };
  }

  /** Waits for an in-flight transaction (bounded) so a shutdown does not orphan it silently. */
  async drain(maxMs = 30_000): Promise<void> {
    const f = this.persisted.inflight;
    if (!f) return;
    try {
      const receipt = await this.pc.waitForTransactionReceipt({ hash: f.hash, timeout: maxMs });
      await this.onReceipt(f, receipt);
    } catch {
      log('warn', 'shutdown.inflight', { hash: f.hash, note: 'still pending; it is saved in STATE_FILE and resolved on the next start' });
    }
  }

  /** Read-only snapshot for the status endpoint (no secrets). */
  snapshot() {
    return {
      status: this.status,
      network: this.cfg.network,
      chainId: this.chain.id,
      agent: this.cfg.agent,
      policyCircuitId: this.policyCircuitId,
      circuits: this.circuits,
      brainWallet: this.brainWallet,
      hotWallet: this.from,
      balanceOkb: formatEther(this.balance),
      dryRun: this.cfg.dryRun,
      intervalSec: this.cfg.intervalSec,
      checkpoint: { enabled: this.cfg.brainWalletCheckpoint, eligible: this.checkpointEligible, lastAt: this.persisted.lastCheckpointAt },
      lastCycleAt: this.lastCycleAt ? new Date(this.lastCycleAt).toISOString() : null,
      nextRunAt: this.nextRunAt ? new Date(this.nextRunAt).toISOString() : null,
      counters: this.counters,
      totals: this.persisted.totals,
      inflight: this.persisted.inflight ? { hash: this.persisted.inflight.hash, kind: this.persisted.inflight.kind } : null,
      lastTx: this.lastTx ?? null,
      lastDecision: this.lastDecision ?? null,
      observation: this.lastObservation ?? null,
      lastError: this.lastError ?? null,
    };
  }
}
