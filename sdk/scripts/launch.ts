// Cerebr launch runbook: creates the Cerebr processor through the TapeOut factory, mints exactly
// the transistors the neural circuits burn, tapes them out in dependency order (REF placeholders
// resolved to the real circuit ids), verifies every circuit on chain against the simulator, opens
// the flagship circuits' native accounts and writes launch/out/<chainId>[.fork].json.
//
// Idempotent and resumable: launch/state.<chainId>[.fork].json is rewritten after every step and
// before waiting on every transaction. Re-running continues where it stopped.
//
//   Fork rehearsal (default network):
//     anvil --fork-url https://rpc.xlayer.tech --chain-id 31337 --auto-impersonate --port 8545   (or --chain-id 196)
//     node scripts/launch.ts --dry-run
//     node scripts/launch.ts --yes
//   Mainnet (see LAUNCH.md):
//     PRIVATE_KEY=... node scripts/launch.ts --network xlayer --dry-run
//     PRIVATE_KEY=... node scripts/launch.ts --network xlayer --yes
//
// Flags: --network fork|xlayer  --rpc <url>  --config <path>  --dry-run  --yes  --verify-only
//        --as <address> (fork: impersonate this wallet; mainnet dry run without a key)
//        --fund <okb> (fork: set the deployer balance)  --fresh (fork: archive old state)
//        --no-open  --allow-impl-change

import { parseArgs } from 'node:util';
import { getAddress, isAddress, parseAbi, parseEther, parseEventLogs, type Address } from 'viem';
import {
  LATCH_ID,
  LISTING_QUALITY,
  NAND_ID,
  OBSERVED_FEES,
  XLAYER,
  circuitsAbi,
  creatorOwed,
  explorerAddress,
  factoryAbi,
  listCircuits,
  openerAbi,
  readFees,
  transistorBalances,
  transistorsAbi,
  type TapeoutFees,
} from '../src/tapeout/index.ts';
import { DEFAULT_CONFIG, loadConfig } from './lib/config.ts';
import { FORK_CHAIN_IDS, FORK_DEPLOYER, connect, readImplementations, send, txRecord, verifyOnChain, type Net, type NetworkName } from './lib/chain.ts';
import { writeOut } from './lib/out.ts';
import { buildPlan, compile, deployedTargets, fmt, printPlan, verifyLocally, type CompiledCircuit } from './lib/plan.ts';
import { StateFile, type CircuitRecord } from './lib/state.ts';

const { values: args } = parseArgs({
  options: {
    network: { type: 'string', default: 'fork' },
    rpc: { type: 'string' },
    config: { type: 'string', default: DEFAULT_CONFIG },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    'verify-only': { type: 'boolean', default: false },
    as: { type: 'string' },
    fund: { type: 'string' },
    fresh: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
    'allow-impl-change': { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.network !== 'fork' && args.network !== 'xlayer') throw new Error('--network must be "fork" or "xlayer"');
const network: NetworkName = args.network;
const mainnet = network === 'xlayer';
const dryRun = args['dry-run'];
const verifyOnly = args['verify-only'];
const sends = !dryRun && !verifyOnly;
if (args.as !== undefined && !isAddress(args.as, { strict: false })) throw new Error('--as must be an address');
if (mainnet && (args.fund || args.fresh)) throw new Error('--fund and --fresh are fork-only');

const line = (s = '') => console.log(s);

async function main() {
  const cfg = loadConfig(args.config);
  line(`Cerebr launch  network=${network}${dryRun ? '  (dry run)' : verifyOnly ? '  (verify only)' : ''}  config=${cfg.path}`);

  if (mainnet && sends) {
    if (!process.env.PRIVATE_KEY) throw new Error('mainnet: set PRIVATE_KEY in the environment (never in a file the repo tracks)');
    if (!cfg.issuance.confirmed) throw new Error('mainnet: launch/config.json issuance.confirmed is false. Confirm transistorSupply and mintPriceOkb (TODO_USER) first.');
  }

  // 1. Compile + verify every circuit locally before touching a chain.
  const local = verifyLocally(cfg);
  line(`\nLocal check: ${local.length} circuits match their reference models exhaustively (${local.reduce((s, x) => s + x.cases, 0)} cases, mode ${cfg.outputMode})`);

  // 2. Connect with the safety rails.
  const net = await connect({ network, rpc: args.rpc, as: args.as as Address | undefined, needSigner: mainnet && sends });
  const chainId = await net.pc.getChainId();
  if (mainnet ? chainId !== XLAYER.chainId : !FORK_CHAIN_IDS.includes(chainId)) throw new Error(`chain id ${chainId}, expected X Layer ${XLAYER.chainId}${mainnet ? '' : ' or the local fork id 31337'}`);
  const head = await net.pc.getBlockNumber();
  line(`Chain: ${chainId} at block ${head} via ${mainnet ? net.rpc : `local fork ${net.rpc}`}`);
  line(`Deployer: ${net.deployer}${net.network === 'fork' && net.deployer === getAddress(FORK_DEPLOYER) ? ' (synthetic fork wallet)' : ''}`);

  let state = StateFile.open(network, chainId, net.deployer);
  if (args.fresh) {
    state.archive('--fresh');
    state = StateFile.open(network, chainId, net.deployer);
  }

  // Fork funding: --fund sets the balance; the synthetic wallet is topped up to 10 OKB when below 1.
  // Rehearsing as your real wallet (--as) without --fund uses its real forked balance.
  if (net.test) {
    const bal = await net.pc.getBalance({ address: net.deployer });
    if (args.fund) await net.test.setBalance({ address: net.deployer, value: parseEther(args.fund) });
    else if (net.deployer === getAddress(FORK_DEPLOYER) && bal < parseEther('1')) await net.test.setBalance({ address: net.deployer, value: parseEther('10') });
  }

  await resume(net, state);

  // 3. Preflight: implementation pins, fees, balances.
  const impl = await readImplementations(net.pc, cfg.pins);
  line(`\nTapeOut implementations: factory ${impl.factoryImpl}, transistors ${impl.transistorImpl}, circuits ${impl.circuitImpl}, sealed=${impl.sealed}`);
  if (impl.mismatches.length) {
    const msg = `TapeOut was upgraded since the pins were verified:\n  ${impl.mismatches.join('\n  ')}`;
    if (!args['allow-impl-change']) throw new Error(`${msg}\nRe-run the fork rehearsal against the new code, update launch/config.json pins, or pass --allow-impl-change.`);
    line(`WARNING ${msg}`);
  }
  if (cfg.scope) {
    // CerebrScope must be deployed and bound to the same TapeOut factory before the dApp is pointed at it.
    const factory = await net.pc
      .readContract({ address: cfg.scope, abi: parseAbi(['function FACTORY() view returns (address)']), functionName: 'FACTORY' })
      .catch(() => undefined);
    if (!factory || getAddress(factory) !== getAddress(XLAYER.factory)) throw new Error(`config scope ${cfg.scope} is not a CerebrScope bound to the TapeOut factory`);
    line(`CerebrScope: ${cfg.scope}`);
  }
  const fees = await readFees(net.pc, state.data.cpu);
  printFees(fees);

  let compiled = await reconcile(net, state, cfg);
  const balances = state.data.cpu ? await transistorBalances(net.pc, state.data.cpu.transistors, net.deployer) : { nand: 0n, latch: 0n };
  const opened = await openedSet(net, state, cfg.openAccounts);
  const owed = state.data.cpu ? await creatorOwed(net.pc, state.data.cpu.transistors, net.deployer) : 0n;
  const mintPrice = state.data.cpu
    ? await net.pc.readContract({ address: state.data.cpu.transistors, abi: transistorsAbi, functionName: 'mintPrice' })
    : cfg.issuance.mintPrice;
  const gasPrice = await net.pc.getGasPrice();
  const plan = buildPlan({ cfg, state: state.data, compiled, fees, mintPrice, balances, openedAlready: opened, skipOpen: args['no-open'], owed, gasPrice });

  printIssuance(cfg, state);
  printPlan(plan, state.data.cpu?.circuits, cfg.keep);

  const balance = await net.pc.getBalance({ address: net.deployer });
  const need = plan.gross + plan.gross / 10n;
  line(`\n  deployer balance: ${fmt(balance)} OKB  (needs ${fmt(need)} incl. 10% margin)`);
  if (balance < need && !verifyOnly) {
    const msg = `insufficient balance: fund ${net.deployer} with at least ${fmt(need - balance)} more OKB`;
    if (dryRun) line(`  WARNING ${msg}`);
    else throw new Error(msg);
  }

  if (dryRun) {
    line('\nDry run: nothing was sent.');
    return;
  }
  if (!verifyOnly && plan.steps.length > 0 && !args.yes) {
    line(`\nRe-run with --yes to execute these ${plan.steps.length} transactions${mainnet ? ' ON X LAYER MAINNET' : ' on the fork'}.`);
    process.exitCode = 2;
    return;
  }

  // 4. Execute.
  if (!verifyOnly) {
    state.data.balanceAtStart ??= balance.toString();
    state.save();
    await createCpu(net, state, cfg, fees);
    await mintDeficit(net, state, compiled, fees, cfg.keep);
    compiled = await tapeoutAll(net, state, cfg);
    if (!args['no-open']) await openAccounts(net, state, cfg.openAccounts, fees);
    if (cfg.withdrawCreatorRevenue) await withdraw(net, state);
  }

  // 5. Verify everything on chain (again) and write the output.
  if (!state.data.cpu) throw new Error('no processor in state: nothing to verify');
  compiled = compile(cfg, deployedTargets(state.data));
  line('\nVerification');
  let bad = 0;
  for (const c of compiled) {
    const rec = state.data.circuits[c.entry.id];
    if (!rec) {
      line(`  ${c.entry.id.padEnd(20)} not taped out`);
      continue;
    }
    if (!verifyOnly && rec.verified?.ok) {
      line(`  ${c.entry.id.padEnd(20)} #${rec.circuitId.padEnd(3)} OK (${rec.verified.cases} cases, verified at tapeout)`);
      continue;
    }
    const v = await verifyOnChain(net, state.data.cpu.circuits, rec, c.program!, c.hex!);
    rec.verified = { ok: v.ok, cases: v.cases, at: new Date().toISOString(), checks: v.ok ? v.checks : v.errors };
    state.save();
    if (!v.ok) bad++;
    line(`  ${c.entry.id.padEnd(20)} #${rec.circuitId.padEnd(3)} ${v.ok ? 'OK' : 'FAIL'} (${v.cases} cases) ${v.ok ? '' : v.errors.join('; ')}`);
  }

  const { path, out, cpu } = await writeOut(net, cfg, state.data, compiled, impl);
  if (!verifyOnly) state.data.done = new Date().toISOString();
  state.save();

  line('\nResult');
  line(`  processor (circuits):  ${cpu.circuits}  ${explorerAddress(cpu.circuits)}`);
  line(`  transistors:           ${cpu.transistors}`);
  line(`  creator / deployer:    ${cpu.creator}`);
  line(`  supply cap ${cpu.supplyCap}, minted ${cpu.minted}, price ${fmt(cpu.mintPrice)} OKB, circuits ${cpu.circuitCount}`);
  const held = await transistorBalances(net.pc, cpu.transistors, net.deployer);
  line(`  your transistors:      ${held.nand} NAND, ${held.latch} LATCH  (in ${net.deployer})`);
  line(`  listed in TapeOut app: ${out.processor.listedInTapeoutApp ? 'yes' : `no (needs supplyCap >= ${LISTING_QUALITY.minSupplyCap} and minted >= ${LISTING_QUALITY.minMinted})`}`);
  line(`  launch cost: value ${fmt(BigInt(out.costs.valuePaid))} + gas ${fmt(BigInt(out.costs.gasPaid))} - withdrawn ${fmt(BigInt(out.costs.withdrawn))} = net ${out.costs.netOkb} OKB`);
  if (state.data.balanceAtStart) line(`  balance delta since start: ${fmt(BigInt(state.data.balanceAtStart) - (await net.pc.getBalance({ address: net.deployer })))} OKB`);
  line(`  wrote ${path}`);
  line(`  state ${state.path}`);
  if (bad) {
    process.exitCode = 1;
    line(`\n${bad} circuit(s) FAILED verification`);
  } else line('\nALL CIRCUITS VERIFIED');
}

// ---------------------------------------------------------------- steps

/** Resolves a transaction that was sent but not confirmed by an interrupted run. */
async function resume(net: Net, state: StateFile) {
  const p = state.data.pending;
  if (p) {
    line(`\nResuming: waiting for pending ${p.step} ${p.hash}`);
    const r = await net.pc.waitForTransactionReceipt({ hash: p.hash, timeout: Number(process.env.RESUME_TIMEOUT_MS ?? 300_000) }).catch(() => undefined);
    // Without a receipt the transaction may still land: keep the record and stop, or the next step
    // would pay for the same action again (a second createCPU, a second mint).
    if (!r) {
      // Dropped for good only if the node no longer knows it and nothing from this wallet is in flight.
      const known = await net.pc.getTransaction({ hash: p.hash }).then(() => true, () => false);
      const [latest, pending] = await Promise.all([
        net.pc.getTransactionCount({ address: net.deployer, blockTag: 'latest' }),
        net.pc.getTransactionCount({ address: net.deployer, blockTag: 'pending' }),
      ]);
      if (known || pending > latest) throw new Error(`pending ${p.step} ${p.hash} is still unconfirmed (or the RPC failed). Nothing was sent; re-run once it is mined.`);
      line(`  ${p.hash} was dropped (unknown to the node, no transaction in flight); reconciling from chain state`);
    }
    if (r?.status === 'success' && p.step === 'createCPU' && !state.data.cpu) {
      const [ev] = parseEventLogs({ abi: factoryAbi, eventName: 'CPUCreated', logs: r.logs });
      if (ev) state.data.cpu = { circuits: ev.args.circuits, transistors: ev.args.transistors, tx: txRecord(r, (await net.pc.getTransaction({ hash: p.hash })).value) };
    }
    // Other steps are reconciled from chain state (balances, circuits, isOpened, owed).
    state.data.pending = undefined;
    state.save();
  }
  if (state.data.cpu) {
    const ok = await net.pc.readContract({ address: XLAYER.factory, abi: factoryAbi, functionName: 'isCPU', args: [state.data.cpu.circuits] }).catch(() => false);
    if (!ok) {
      if (net.network === 'xlayer') throw new Error(`state says the processor is ${state.data.cpu.circuits}, but the factory does not know it`);
      state.archive('the fork no longer has this processor (anvil restarted?)');
      state.data = StateFile.open(net.network, state.data.chainId, net.deployer).data;
      state.data.mints = [];
      state.data.circuits = {};
      state.data.accounts = {};
      state.data.withdrawals = [];
      state.data.cpu = undefined;
    } else line(`\nResuming processor ${state.data.cpu.circuits} (${Object.keys(state.data.circuits).length} circuits already taped out)`);
  }
  // A transaction from this wallet that is still in the mempool (sent by an earlier run whose state
  // was lost, or by another tool) would race the next send; refuse until it settles.
  if (sends) {
    const [latest, pending] = await Promise.all([
      net.pc.getTransactionCount({ address: net.deployer, blockTag: 'latest' }),
      net.pc.getTransactionCount({ address: net.deployer, blockTag: 'pending' }),
    ]);
    if (pending > latest) throw new Error(`${net.deployer} has ${pending - latest} unconfirmed transaction(s) in flight; wait for them before re-running`);
  }
}

/**
 * Adopts circuits that are already on our processor with byte-identical netlists (an earlier run
 * that died after the tapeout landed). Repeats because adopting a dependency makes its REF users
 * encodable.
 */
async function reconcile(net: Net, state: StateFile, cfg: ReturnType<typeof loadConfig>): Promise<CompiledCircuit[]> {
  let compiled = compile(cfg, deployedTargets(state.data));
  if (!state.data.cpu) return compiled;
  const onChain = await listCircuits(net.pc, state.data.cpu.circuits, { withNetlist: true });
  const known = new Set(Object.values(state.data.circuits).map((r) => r.circuitId));
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of compiled) {
      if (state.data.circuits[c.entry.id] || !c.hex) continue;
      const hit = onChain.find((x) => !known.has(x.id.toString()) && x.netlist?.toLowerCase() === c.hex!.toLowerCase() && x.owner.toLowerCase() === net.deployer.toLowerCase());
      if (!hit) continue;
      state.data.circuits[c.entry.id] = { circuitId: hit.id.toString(), netlist: c.hex, nIn: hit.nIn, nOut: hit.nOut, gateCount: hit.gateCount, nState: hit.nState, author: hit.owner, adopted: true };
      known.add(hit.id.toString());
      line(`  adopted ${c.entry.id} = circuit #${hit.id} (already on chain)`);
      changed = true;
    }
    if (changed) {
      state.save();
      compiled = compile(cfg, deployedTargets(state.data));
    }
  }
  return compiled;
}

async function createCpu(net: Net, state: StateFile, cfg: ReturnType<typeof loadConfig>, fees: TapeoutFees) {
  if (state.data.cpu) return;
  line(`\n[createCPU] ${cfg.cpu.name} (${cfg.cpu.symbol}) supply ${cfg.issuance.transistorSupply} @ ${cfg.issuance.mintPriceOkb} OKB, value ${fmt(fees.deployFee)} OKB`);
  const { request } = await net.pc.simulateContract({
    account: net.wc.account,
    address: XLAYER.factory,
    abi: factoryAbi,
    functionName: 'createCPU',
    args: [cfg.cpu.name, cfg.cpu.symbol, cfg.cpu.story, cfg.issuance.transistorSupply, cfg.issuance.mintPrice],
    value: fees.deployFee, // exactly: the factory keeps any excess
  });
  const r = await send(net, state, 'createCPU', request);
  const [ev] = parseEventLogs({ abi: factoryAbi, eventName: 'CPUCreated', logs: r.logs.filter((l) => l.address.toLowerCase() === XLAYER.factory.toLowerCase()) });
  if (!ev) throw new Error(`CPUCreated missing in ${r.transactionHash}`);
  if (ev.args.creator.toLowerCase() !== net.deployer.toLowerCase()) throw new Error('CPUCreated creator is not the deployer');
  state.data.cpu = { circuits: ev.args.circuits, transistors: ev.args.transistors, tx: txRecord(r, fees.deployFee) };
  state.save();
  line(`    circuits ${ev.args.circuits}  transistors ${ev.args.transistors}  gas ${r.gasUsed}`);
}

async function mintDeficit(net: Net, state: StateFile, compiled: CompiledCircuit[], fees: TapeoutFees, keep: { nand: bigint; latch: bigint }) {
  const cpu = state.data.cpu!;
  const todo = compiled.filter((c) => !state.data.circuits[c.entry.id]);
  // What the remaining tapeouts burn, plus the transistors the deployer keeps (launch/config.json keep).
  const need = { nand: todo.reduce((s, c) => s + BigInt(c.nand), 0n) + keep.nand, latch: todo.reduce((s, c) => s + BigInt(c.latch), 0n) + keep.latch };
  const have = await transistorBalances(net.pc, cpu.transistors, net.deployer);
  const price = await net.pc.readContract({ address: cpu.transistors, abi: transistorsAbi, functionName: 'mintPrice' });
  for (const [name, id, want, got] of [['NAND', NAND_ID, need.nand, have.nand], ['LATCH', LATCH_ID, need.latch, have.latch]] as const) {
    const amount = want - got;
    if (amount <= 0n) continue;
    const value = amount * price + fees.protocolFee;
    line(`\n[mint] ${amount} ${name} (have ${got}, need ${want}), value ${fmt(value)} OKB`);
    const { request } = await net.pc.simulateContract({ account: net.wc.account, address: cpu.transistors, abi: transistorsAbi, functionName: 'mint', args: [id, amount], value });
    const r = await send(net, state, `mint ${name}`, request);
    state.data.mints.push({ id: name, amount: amount.toString(), value: value.toString(), tx: txRecord(r, value) });
    state.save();
  }
}

async function tapeoutAll(net: Net, state: StateFile, cfg: ReturnType<typeof loadConfig>): Promise<CompiledCircuit[]> {
  const cpu = state.data.cpu!;
  const fee = await net.pc.readContract({ address: cpu.circuits, abi: circuitsAbi, functionName: 'TAPEOUT_FEE' });
  for (const entry of cfg.circuits) {
    if (state.data.circuits[entry.id]) continue;
    // Recompile so REF placeholders resolve to the circuit ids assigned so far.
    const c = compile(cfg, deployedTargets(state.data)).find((x) => x.entry.id === entry.id)!;
    if (!c.hex || !c.program) throw new Error(`${entry.id}: dependencies not taped out`);
    const deps = c.circuit.deps.map((d) => `${d}=#${state.data.circuits[d].circuitId}`).join(', ');
    line(`\n[tapeout] ${entry.id}: ${c.nand} NAND${c.latch ? ` + ${c.latch} LATCH` : ''}${c.ref ? ` + ${c.ref} REF (${deps})` : ''}, ${c.hex.length / 2 - 1} bytes`);
    const { request } = await net.pc.simulateContract({
      account: net.wc.account,
      address: cpu.circuits,
      abi: circuitsAbi,
      functionName: 'tapeout',
      args: [c.hex, c.netlist.nIn, c.netlist.nOut],
      value: fee, // must be exact
    });
    const r = await send(net, state, `tapeout ${entry.id}`, request);
    const [ev] = parseEventLogs({ abi: circuitsAbi, eventName: 'TapedOut', logs: r.logs.filter((l) => l.address.toLowerCase() === cpu.circuits.toLowerCase()) });
    if (!ev) throw new Error(`TapedOut missing in ${r.transactionHash}`);
    const rec: CircuitRecord = (state.data.circuits[entry.id] = {
      circuitId: ev.args.circuitId.toString(),
      netlist: c.hex,
      nIn: c.netlist.nIn,
      nOut: c.netlist.nOut,
      gateCount: ev.args.gateCount,
      nState: ev.args.nState,
      author: ev.args.author,
      tx: txRecord(r, fee),
    });
    state.save();
    const v = await verifyOnChain(net, cpu.circuits, rec, c.program, c.hex);
    rec.verified = { ok: v.ok, cases: v.cases, at: new Date().toISOString(), checks: v.ok ? v.checks : v.errors };
    state.save();
    line(`    circuit #${rec.circuitId}  gateCount ${rec.gateCount}  nState ${rec.nState}  gas ${r.gasUsed}  verify ${v.ok ? `OK (${v.cases} cases: ${v.checks.join(', ')})` : `FAIL ${v.errors.join('; ')}`}`);
    if (!v.ok) throw new Error(`${entry.id} failed on-chain verification; stopping before taping out anything that depends on it`);
  }
  return compile(cfg, deployedTargets(state.data));
}

async function openedSet(net: Net, state: StateFile, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!state.data.cpu) return out;
  for (const id of ids) {
    const rec = state.data.circuits[id];
    if (!rec) continue;
    const ok = await net.pc.readContract({ address: XLAYER.opener, abi: openerAbi, functionName: 'isOpened', args: [state.data.cpu.circuits, BigInt(rec.circuitId)] });
    if (ok) out.add(id);
  }
  return out;
}

async function openAccounts(net: Net, state: StateFile, ids: string[], fees: TapeoutFees) {
  const cpu = state.data.cpu!;
  for (const id of ids) {
    const tokenId = BigInt(state.data.circuits[id].circuitId);
    const isOpen = await net.pc.readContract({ address: XLAYER.opener, abi: openerAbi, functionName: 'isOpened', args: [cpu.circuits, tokenId] });
    if (isOpen) {
      if (!state.data.accounts[id]) {
        const account = await net.pc.readContract({ address: XLAYER.opener, abi: openerAbi, functionName: 'accountOf', args: [cpu.circuits, tokenId] });
        state.data.accounts[id] = { account };
        state.save();
      }
      continue;
    }
    line(`\n[open] native account of ${id} (#${tokenId}), value ${fmt(fees.openFee)} OKB`);
    const { request, result } = await net.pc.simulateContract({ account: net.wc.account, address: XLAYER.opener, abi: openerAbi, functionName: 'open', args: [cpu.circuits, tokenId], value: fees.openFee });
    const r = await send(net, state, `open ${id}`, request);
    state.data.accounts[id] = { account: result as Address, tx: txRecord(r, fees.openFee) };
    state.save();
    line(`    account ${result}`);
  }
}

async function withdraw(net: Net, state: StateFile) {
  const cpu = state.data.cpu!;
  const owed = await creatorOwed(net.pc, cpu.transistors, net.deployer);
  if (owed === 0n) return;
  line(`\n[withdraw] creator mint revenue ${fmt(owed)} OKB`);
  const { request } = await net.pc.simulateContract({ account: net.wc.account, address: cpu.transistors, abi: transistorsAbi, functionName: 'withdraw' });
  const r = await send(net, state, 'withdraw', request);
  state.data.withdrawals.push({ amount: owed.toString(), tx: txRecord(r) });
  state.save();
}

// ---------------------------------------------------------------- printing

function printFees(fees: TapeoutFees) {
  const rows: [keyof TapeoutFees, string][] = [['deployFee', 'createCPU'], ['protocolFee', 'per mint() call'], ['tapeoutFee', 'per tapeout (exact)'], ['openFee', 'per account open']];
  line('Live fees:');
  for (const [k, what] of rows) {
    const changed = fees[k] !== OBSERVED_FEES[k] ? `  (CHANGED: was ${fmt(OBSERVED_FEES[k])})` : '';
    line(`  ${k.padEnd(12)} ${fmt(fees[k]).padStart(9)} OKB  ${what}${changed}`);
  }
}

function printIssuance(cfg: ReturnType<typeof loadConfig>, state: StateFile) {
  line('\nIssuance terms (disclosed on chain at createCPU)');
  line(`  name / symbol       ${cfg.cpu.name} / ${cfg.cpu.symbol}`);
  line(`  transistor supply   ${cfg.issuance.transistorSupply} (cap shared by NAND id 0 and LATCH id 1)`);
  line(`  unit price          ${cfg.issuance.mintPriceOkb} OKB per transistor (+ TapeOut protocol fee per mint call)`);
  line(`  confirmed by user   ${cfg.issuance.confirmed ? 'yes' : 'NO (TODO_USER: fork rehearsal values)'}`);
  if (state.data.cpu) line(`  (processor already exists: on-chain terms are final)`);
}

main().catch((e) => {
  console.error(`\nERROR ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

