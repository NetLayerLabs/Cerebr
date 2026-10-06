// End-to-end check of the keeper against an anvil fork of X Layer mainnet. Nothing is broadcast.
//
//   anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8605 --silent
//   forge build                                   # the CerebrAgent artifact in out/
//   cd agent && node scripts/fork-e2e.ts          # FORK_RPC=http://127.0.0.1:8605 by default
//
// It deploys CerebrAgent with the real policy circuit #8, funds a fresh hot wallet with 0.01 OKB, then runs
// the daemon's Runner for several cycles while it moves time and sets the next block's basefee
// (anvil_setNextBlockBaseFeePerGas) to drive different decisions. Every decision is replayed through the
// real circuits.eval() and the local netlist simulation. It also exercises the guards, DRY_RUN, the
// rate limit, and the brain-wallet checkpoint (the fork transfers #8 to the hot wallet and opens its account).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, parseEther, type Abi, type Address, type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { cerebrAgentAbi, checkRecord, goNoGoCircuit, type AgentRecord } from '../../sdk/src/neuro/agent.ts';
import { loadConfig, type AgentEnvConfig } from '../src/config.ts';
import { setLogSink } from '../src/log.ts';
import { Runner } from '../src/runner.ts';

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8605';
const CIRCUITS: Address = '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF';
const OPENER: Address = '0x536add8f30f03b69f6fbf29d425a816a0dc50106';
const POLICY = 8n;
const DEPLOYER: Address = '0x00000000000000000000000000000000000a6e17';
const RIVAL: Address = '0x00000000000000000000000000000000000b0b00';
const MAINNET_GAS_PRICE = 20_000_001n; // basefee 0.02 gwei + 1 wei tip, as measured
const VERBOSE = process.env.VERBOSE === '1';

const circuitsAbi = [
  { type: 'function', name: 'eval', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'bytes' }], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], outputs: [] },
] as const;
const openerAbi = [
  { type: 'function', name: 'FEE', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isOpened', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'open', stateMutability: 'payable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'address' }] },
] as const;

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const pc = createPublicClient({ transport: http(RPC, { timeout: 600_000, retryCount: 0 }) });
const rpc = (method: string, params: unknown[] = []) => pc.request({ method: method as any, params: params as any });

async function sendAs(from: Address, to: Address | undefined, data: Hex, value = 0n): Promise<Hex> {
  const hash = (await rpc('eth_sendTransaction', [{ from, to, data, value: `0x${value.toString(16)}`, gas: '0x7a1200' }])) as Hex;
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`tx from ${from} reverted: ${hash}`);
  return hash;
}

/** Mines `blocks` empty blocks (1s apart), then sets the next block's timestamp to the given UTC hour (if any)
 *  and its basefee. The previous block is also given that basefee so the keeper's fee math sees it. */
async function advance(blocks: number, opts: { hour?: number; basefee: bigint }): Promise<void> {
  if (blocks > 1) await rpc('anvil_mine', [`0x${(blocks - 1).toString(16)}`, '0x1']);
  await rpc('anvil_setNextBlockBaseFeePerGas', [`0x${opts.basefee.toString(16)}`]);
  await rpc('anvil_mine', ['0x1', '0x1']);
  const latest = await pc.getBlock({ blockTag: 'latest' });
  if (opts.hour !== undefined) {
    let t = (latest.timestamp / 86_400n) * 86_400n + BigInt(opts.hour) * 3600n + 60n;
    if (t <= latest.timestamp) t += 86_400n;
    await rpc('evm_setNextBlockTimestamp', [`0x${t.toString(16)}`]);
  }
  await rpc('anvil_setNextBlockBaseFeePerGas', [`0x${opts.basefee.toString(16)}`]);
}

async function readRecord(agent: Address, seq: bigint): Promise<AgentRecord> {
  const r = await pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'decisions', args: [seq, 1n] });
  return r[0] as AgentRecord;
}

async function main(): Promise<void> {
  const version = String(await rpc('web3_clientVersion'));
  if (!/anvil/i.test(version)) throw new Error(`FORK_RPC ${RPC} is not anvil (${version}); refusing`);
  const chainId = await pc.getChainId();
  console.log(`fork: ${RPC} chainId ${chainId} ${version} block ${await pc.getBlockNumber()}`);
  if (!VERBOSE) setLogSink(() => {});

  // ---------------------------------------------------------------- deploy
  // Agent A: the real policy circuit #8 with block constants compressed for the fork (anvil mines ~1 block/s
  // in fork mode, so 12 h of blocks is out of reach; the mainnet constants are covered by the forge fork tests
  // with vm.roll). Agent B: mainnet constants except minIntervalBlocks = 1, used to measure steady-state gas.
  const artifact = JSON.parse(readFileSync(new URL('../../out/CerebrAgent.sol/CerebrAgent.json', import.meta.url), 'utf8'));
  await rpc('anvil_setBalance', [DEPLOYER, `0x${parseEther('10').toString(16)}`]);
  const deployer = createWalletClient({ account: DEPLOYER, transport: http(RPC) });
  const deploy = async (c: Record<string, bigint | number>) => {
    const hash = await deployer.deployContract({
      abi: artifact.abi as Abi, bytecode: artifact.bytecode.object as Hex, args: [CIRCUITS, POLICY, OPENER, c], chain: null, gas: 8_000_000n,
    });
    return pc.waitForTransactionReceipt({ hash });
  };
  const base = { calmMaxBasefee: 50_000_000n, spikeBps: 15_000, windowStartHour: 13, windowEndHour: 21 };
  const deployReceipt = await deploy({ ...base, restBlocks: 40, refractoryBlocks: 10, minIntervalBlocks: 3 });
  const agent = deployReceipt.contractAddress!;
  check('deploy CerebrAgent(circuits, #8, opener, config) [fork timing: rest 40, refractory 10, interval 3]', deployReceipt.status === 'success', `${agent}, gas ${deployReceipt.gasUsed}`);
  const receiptB = await deploy({ ...base, restBlocks: 43_200, refractoryBlocks: 3_600, minIntervalBlocks: 1 });
  const agentB = receiptB.contractAddress!;

  // ---------------------------------------------------------------- hot wallet + guards
  const key = generatePrivateKey();
  const hot = privateKeyToAccount(key).address;
  await rpc('anvil_setBalance', [hot, `0x${parseEther('0.01').toString(16)}`]);
  const stateDir = mkdtempSync(join(tmpdir(), 'cerebr-agent-e2e-'));
  const env = (extra: Record<string, string>): NodeJS.ProcessEnv => ({
    NETWORK: 'fork', RPC_URL: RPC, AGENT_ADDRESS: agent, AGENT_PRIVATE_KEY: key, INTERVAL_SEC: '600',
    STATE_FILE: join(stateDir, 'state.json'), MIN_BALANCE_OKB: '0.001', ...extra,
  });

  let threw = '';
  try { loadConfig({ ...env({}), NETWORK: '' }); } catch (e) { threw = (e as Error).message; }
  check('guard: NETWORK must be explicit', threw.includes('NETWORK must be set'));
  threw = '';
  try { await Runner.create(loadConfig(env({ NETWORK: 'xlayer' }))); } catch (e) { threw = (e as Error).message; }
  check('guard: NETWORK=xlayer refuses a dev node', threw.includes('refusing'));
  threw = '';
  try { loadConfig({ ...env({}), AGENT_PRIVATE_KEY: '' }); } catch (e) { threw = (e as Error).message; }
  check('guard: a key is required unless DRY_RUN', threw.includes('required unless DRY_RUN'));
  const envCopy = env({});
  loadConfig(envCopy);
  check('the key is removed from the environment after loading', envCopy.AGENT_PRIVATE_KEY === undefined);
  threw = '';
  try {
    const poor = generatePrivateKey();
    const r = await Runner.create(loadConfig(env({ AGENT_PRIVATE_KEY: poor })));
    await r.preflight();
  } catch (e) { threw = (e as Error).message; }
  check('guard: refuses to start below MIN_BALANCE_OKB', threw.includes('fund it first'));

  // ---------------------------------------------------------------- DRY_RUN
  await advance(1, { hour: 14, basefee: 20_000_000n });
  const dry = await Runner.create(loadConfig(env({ DRY_RUN: '1' })));
  await dry.preflight();
  const nonce0 = await pc.getTransactionCount({ address: hot });
  const dryRes = await dry.tick();
  check('DRY_RUN simulates and sends nothing', dryRes.action === 'dry-run' && (await pc.getTransactionCount({ address: hot })) === nonce0);

  // ---------------------------------------------------------------- driven cycles
  const runner = await Runner.create(loadConfig(env({})));
  await runner.preflight();
  const balance0 = await pc.getBalance({ address: hot });
  const gasUsed: bigint[] = [];

  type Step = { name: string; blocks: number; hour?: number; basefee: bigint; expect: 'Go' | 'No-Go'; inputs: number };
  const steps: Step[] = [
    { name: '14:00 UTC, flat 0.02 gwei, never fired', blocks: 1, hour: 14, basefee: 20_000_000n, expect: 'Go', inputs: 0b00111 },
    { name: '+4 blocks: refractory', blocks: 3, basefee: 20_000_000n, expect: 'No-Go', inputs: 0b10011 },
    { name: '+11 blocks: calm + active', blocks: 10, basefee: 20_000_000n, expect: 'Go', inputs: 0b00011 },
    { name: '02:00 UTC, basefee 0.09 gwei: spike, not calm', blocks: 10, hour: 2, basefee: 90_000_000n, expect: 'No-Go', inputs: 0b01000 },
    { name: '03:00 UTC, back to 0.02 gwei: calm only', blocks: 10, hour: 3, basefee: 20_000_000n, expect: 'No-Go', inputs: 0b00001 },
    { name: 'rest elapsed, 04:00 UTC: calm + rested', blocks: 40, hour: 4, basefee: 20_000_000n, expect: 'Go', inputs: 0b00101 },
  ];
  for (const s of steps) {
    await advance(s.blocks, { hour: s.hour, basefee: s.basefee });
    const res = await runner.tick();
    const rec = res.seq ? await readRecord(agent, res.seq) : undefined;
    const evalOut = rec ? await pc.readContract({ address: CIRCUITS, abi: circuitsAbi, functionName: 'eval', args: [POLICY, `0x${rec.inputs.toString(16).padStart(2, '0')}`] }) : '0x';
    const [replayed, matches] = rec ? await pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'replay', args: [res.seq!] }) : [0, false];
    const cr = rec ? checkRecord(rec, runner.agentConfig) : undefined;
    if (res.gasUsed) gasUsed.push(res.gasUsed);
    check(
      `cycle "${s.name}" -> ${s.expect}`,
      res.action === 'acted' && res.verdict === s.expect && !!rec && rec.inputs === s.inputs && rec.basefee === s.basefee
        && Number(BigInt(evalOut)) === rec.outputs && goNoGoCircuit(rec.inputs) === rec.outputs && matches && replayed === rec.outputs
        && !!cr?.inputsOk && !!cr?.outputOk && res.verified === true,
      `seq ${res.seq} block ${rec?.blockNumber} basefee ${rec?.basefee} inputs 0b${rec?.inputs.toString(2).padStart(5, "0")} eval ${evalOut} gas ${res.gasUsed}`,
    );
  }

  // ---------------------------------------------------------------- rate limit and a rival keeper
  const again = await runner.tick();
  check('rate limit: an immediate second cycle is skipped', again.action === 'skipped' && /too soon/.test(again.reason ?? ''));
  await advance(3, { basefee: 20_000_000n });
  await rpc('anvil_setBalance', [RIVAL, `0x${parseEther('1').toString(16)}`]);
  await sendAs(RIVAL, agent, encodeFunctionData({ abi: cerebrAgentAbi, functionName: 'act' }));
  const afterRival = await runner.tick();
  check('a rival acting first makes the keeper skip, not fail', afterRival.action === 'skipped');

  // ---------------------------------------------------------------- steady-state gas (ring buffer wrapped)
  const actData = encodeFunctionData({ abi: cerebrAgentAbi, functionName: 'act' });
  const runnerB = await Runner.create(loadConfig(env({ AGENT_ADDRESS: agentB, STATE_FILE: join(stateDir, 'b.json') })));
  await runnerB.preflight();
  await advance(1, { hour: 15, basefee: 20_000_000n });
  const firstB = await runnerB.tick();
  for (let i = 0; i < 64; i++) await sendAs(RIVAL, agentB, actData); // one block each (minIntervalBlocks = 1)
  await advance(1, { basefee: 20_000_000n });
  const steady = await runnerB.tick();
  check('act after the ring buffer wrapped (agent B)', firstB.action === 'acted' && steady.action === 'acted' && steady.verified === true,
    `first ${firstB.gasUsed}, wrapped ${steady.gasUsed}`);

  // ---------------------------------------------------------------- brain-wallet checkpoint
  const owner = await pc.readContract({ address: CIRCUITS, abi: circuitsAbi, functionName: 'ownerOf', args: [POLICY] });
  await rpc('anvil_setBalance', [owner, `0x${parseEther('1').toString(16)}`]);
  await sendAs(owner, CIRCUITS, encodeFunctionData({ abi: circuitsAbi, functionName: 'transferFrom', args: [owner, hot, POLICY] }));
  if (!(await pc.readContract({ address: OPENER, abi: openerAbi, functionName: 'isOpened', args: [CIRCUITS, POLICY] }))) {
    const fee = await pc.readContract({ address: OPENER, abi: openerAbi, functionName: 'FEE' });
    await sendAs(RIVAL, OPENER, encodeFunctionData({ abi: openerAbi, functionName: 'open', args: [CIRCUITS, POLICY] }), fee);
  }
  const cpRunner = await Runner.create(loadConfig(env({ BRAIN_WALLET_CHECKPOINT: '1', STATE_FILE: join(stateDir, 'cp.json') })));
  await cpRunner.preflight();
  check('checkpoint eligibility (opened account, hot wallet owns #8)', cpRunner.checkpointEligible);
  await advance(3, { basefee: 20_000_000n });
  const balBeforeCp = await pc.getBalance({ address: hot });
  const cp = await cpRunner.tick();
  const cpRec = cp.seq ? await readRecord(agent, cp.seq) : undefined;
  const cpSpent = balBeforeCp - (await pc.getBalance({ address: hot }));
  check('brain-wallet checkpoint: account.execute -> act() flagged viaBrainWallet',
    cp.action === 'checkpoint' && !!cpRec?.viaBrainWallet && cpRec.caller.toLowerCase() === runner.brainWallet.toLowerCase() && cp.verified === true,
    `gas ${cp.gasUsed}, spent ${formatEther(cpSpent)} OKB incl. EXEC_FEE`);
  await advance(3, { basefee: 20_000_000n });
  const cp2 = await cpRunner.tick();
  check('checkpoint at most once per CHECKPOINT_INTERVAL_SEC (next cycle is a plain act)', cp2.action === 'acted');

  // ---------------------------------------------------------------- status + cost report
  const snap = runner.snapshot();
  check('status snapshot has no secrets', !JSON.stringify(snap, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)).includes(key.slice(2)));
  const stats = await pc.readContract({ address: agent, abi: cerebrAgentAbi, functionName: 'stats' });
  check('stats', stats.decisions === 9 && stats.brainWalletCount === 1, `decisions ${stats.decisions} go ${stats.goCount} noGo ${stats.noGoCount} abstain ${stats.abstainCount}`);

  const first = firstB.gasUsed ?? gasUsed[0];
  const steadyGas = steady.gasUsed ?? 0n;
  const perDay = (g: bigint, intervalSec: number) => g * MAINNET_GAS_PRICE * BigInt(Math.floor(86_400 / intervalSec));
  console.log('\n--- measured gas (tx gasUsed, incl. 21k intrinsic) ---');
  console.log(`deploy                     ${deployReceipt.gasUsed}  = ${formatEther(deployReceipt.gasUsed * MAINNET_GAS_PRICE)} OKB at 0.02 gwei`);
  console.log(`act, first fills of ring   ${gasUsed.join(', ')}`);
  console.log(`act, steady state          ${steadyGas}  = ${formatEther(steadyGas * MAINNET_GAS_PRICE)} OKB`);
  console.log(`checkpoint (execute->act)  ${cp.gasUsed} gas = ${formatEther((cp.gasUsed ?? 0n) * MAINNET_GAS_PRICE)} OKB + EXEC_FEE ${formatEther(cpRunner.execFee)} OKB (hot wallet spent ${formatEther(cpSpent)} OKB on the fork)`);
  for (const iv of [600, 1800, 3600]) {
    console.log(`per day @ ${String(iv / 60).padStart(2)} min: ${formatEther(perDay(steadyGas, iv))} OKB steady (${formatEther(perDay(first, iv))} OKB during the first 64)`
      + `; 0.01 OKB lasts ~${Number(parseEther('0.01') / perDay(steadyGas, iv))} days`);
  }
  console.log(`hot wallet spent in this run: ${formatEther(balance0 - (await pc.getBalance({ address: hot })))} OKB (9 acts + 1 checkpoint, at the fork's fee settings)`);

  rmSync(stateDir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL  fork e2e crashed:', e);
  process.exit(1);
});
