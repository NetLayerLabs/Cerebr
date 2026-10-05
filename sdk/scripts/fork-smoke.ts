// End-to-end TapeOut smoke test on a LOCAL anvil fork of X Layer. Never points at a public RPC.
//
//   anvil --fork-url https://rpc.xlayer.tech --port 8561 --auto-impersonate --chain-id 196
//   FORK_RPC=http://127.0.0.1:8561 node scripts/fork-smoke.ts
//
// createCPU -> mint NAND -> tapeout XOR (handwritten netlist) -> eval all 4 inputs ->
// REF-composed XOR3 -> open the circuit's native account -> execute from it. Prints PASS/FAIL.

import { createPublicClient, createTestClient, createWalletClient, formatEther, http, parseEther, type Address, type Hex } from 'viem';
import {
  NAND_ID,
  XLAYER,
  accountOf,
  createCpu,
  creatorOwed,
  evalCircuit,
  executeFromAccount,
  listCircuits,
  mintTransistors,
  openAccount,
  quoteTapeout,
  readAccount,
  readCpu,
  readFactory,
  readFees,
  scanNetlist,
  tapeout,
  transistorBalances,
  truthTable,
  xLayerFork,
} from '../src/tapeout/index.ts';

const rpc = process.env.FORK_RPC ?? 'http://127.0.0.1:8561';
const host = new URL(rpc).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing non-local RPC ${rpc}: forks only`);

const transport = http(rpc);
// Works on a fork started with --chain-id 196 or with the dApp's local id 31337.
const chain = xLayerFork(rpc, await createPublicClient({ transport }).getChainId());
const pc = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: 'anvil' });
const me: Address = '0xce7eb700000000000000000000000000000ce8e7';
const wc = createWalletClient({ chain, transport, account: me });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const u24 = (n: number) => n.toString(16).padStart(6, '0');
const nand = (a: number, b: number) => `00${u24(a)}${u24(b)}`;
const ref = (cpu: Address, id: bigint, ins: number[], nOut: number) =>
  `02${cpu.slice(2).toLowerCase()}${id.toString(16).padStart(16, '0')}${ins.length.toString(16).padStart(2, '0')}${nOut.toString(16).padStart(2, '0')}${ins.map(u24).join('')}`;

async function main() {
  const chainId = await pc.getChainId();
  check('fork of X Layer (chain id 196, or the dApp fork id 31337)', chainId === 196 || chainId === 31337, `chainId ${chainId}, block ${await pc.getBlockNumber()}`);
  await test.setBalance({ address: me, value: parseEther('10') });
  await test.impersonateAccount({ address: me });

  const factory = await readFactory(pc);
  const fees = await readFees(pc, undefined);
  console.log(`factory cpuCount=${factory.cpuCount} deployFee=${formatEther(fees.deployFee)} protocolFee=${formatEther(fees.protocolFee)} tapeoutFee=${formatEther(fees.tapeoutFee)} openFee=${formatEther(fees.openFee)} execFee=${formatEther(fees.execFee)}`);

  // 1. createCPU through the factory
  const mintPrice = parseEther('0.000066');
  const cpu = await createCpu(wc, pc, { name: 'Cerebr', symbol: 'CRBR', story: 'Cerebr fork smoke test', supply: 100_000n, mintPrice });
  const info = await readCpu(pc, cpu.circuits);
  check('createCPU registered', info.registered && info.transistors.toLowerCase() === cpu.transistors.toLowerCase(), `circuits ${cpu.circuits} transistors ${cpu.transistors}`);
  check('CPU params disclosed on-chain', info.supplyCap === 100_000n && info.mintPrice === mintPrice && info.creator.toLowerCase() === me.toLowerCase() && info.name === 'Cerebr');
  const readBack = await readCpu(pc, cpu.transistors);
  check('readCpu by transistors address', readBack.circuits.toLowerCase() === cpu.circuits.toLowerCase());

  // 2. mint NAND transistors
  await mintTransistors(wc, pc, { transistors: cpu.transistors, id: NAND_ID, amount: 10n });
  const bal = await transistorBalances(pc, cpu.transistors, me);
  check('mint 10 NAND', bal.nand === 10n && bal.latch === 0n);
  check('creator owed amount * mintPrice', (await creatorOwed(pc, cpu.transistors, me)) === 10n * mintPrice);

  // 3. tapeout XOR: s4 = nand(a,b), s5 = nand(a,s4), s6 = nand(b,s4), s7 = nand(s5,s6) -> output = last signal
  const xor = `0x${nand(2, 3)}${nand(2, 4)}${nand(3, 4)}${nand(5, 6)}` as Hex;
  const quote = quoteTapeout(xor, 2, 1, { mintPrice, fees });
  const t = await tapeout(wc, pc, { circuits: cpu.circuits, netlist: xor, nIn: 2, nOut: 1 });
  check('tapeout XOR', t.circuitId === 1n && t.gateCount === 4 && t.nState === 0, `id ${t.circuitId}, gas ${t.receipt.gasUsed} (quote ${quote.gas})`);
  check('4 NAND burned', (await transistorBalances(pc, cpu.transistors, me)).nand === 6n);

  // 4. eval all 4 inputs
  const got: number[] = [];
  for (let x = 0; x < 4; x++) got.push((await evalCircuit(pc, { circuits: cpu.circuits, id: t.circuitId, inputs: x }))[0]);
  check('eval XOR truth table [0,1,1,0]', got.join(',') === '0,1,1,0', got.join(','));
  const table = await truthTable(pc, cpu.circuits, t.circuitId);
  check('truthTable via multicall', table.map((r) => r[0]).join(',') === '0,1,1,0');

  // 5. REF composition: XOR3 = XOR(XOR(a,b), c) -- no transistors burned
  const xor3 = `0x${ref(cpu.circuits, t.circuitId, [2, 3], 1)}${ref(cpu.circuits, t.circuitId, [5, 4], 1)}` as Hex;
  check('scanNetlist REF burn = 0', scanNetlist(xor3, 3, 1).burn.nand === 0n);
  const t3 = await tapeout(wc, pc, { circuits: cpu.circuits, netlist: xor3, nIn: 3, nOut: 1 });
  const parity: number[] = [];
  for (let x = 0; x < 8; x++) parity.push((await evalCircuit(pc, { circuits: cpu.circuits, id: t3.circuitId, inputs: x }))[0]);
  check('REF XOR3 parity', parity.join('') === '01101001' && t3.gateCount === 8, `gateCount ${t3.gateCount} (flattened)`);
  check('REF burned nothing', (await transistorBalances(pc, cpu.transistors, me)).nand === 6n);
  const list = await listCircuits(pc, cpu.circuits, { withNetlist: true });
  check('listCircuits', list.length === 2 && list[0].netlist === xor && list[1].owner.toLowerCase() === me.toLowerCase());

  // 6. native account (brain wallet)
  const before = await accountOf(pc, cpu.circuits, t.circuitId);
  check('accountOf is counterfactual before open', !before.opened && !before.deployed);
  const opened = await openAccount(wc, pc, { circuits: cpu.circuits, tokenId: t.circuitId });
  const after = await accountOf(pc, cpu.circuits, t.circuitId);
  check('open account', after.opened && after.deployed && opened.account === after.account && after.account === before.account, after.account);
  const acct = await readAccount(pc, after.account);
  check('account token() / owner()', acct.chainId === BigInt(chainId) && acct.circuits.toLowerCase() === cpu.circuits.toLowerCase() && acct.tokenId === t.circuitId && acct.owner.toLowerCase() === me.toLowerCase());

  await wc.sendTransaction({ to: after.account, value: parseEther('0.01'), chain });
  const sink: Address = '0x000000000000000000000000000000000000dEaD';
  const sink0 = await pc.getBalance({ address: sink });
  await executeFromAccount(wc, pc, { account: after.account, to: sink, value: 12345n });
  check('execute from account', (await pc.getBalance({ address: sink })) - sink0 === 12345n);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}  (opener ${XLAYER.opener})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('FAIL ', e);
  process.exitCode = 1;
});
