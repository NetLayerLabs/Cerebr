// Genesis Drop rehearsal on a LOCAL anvil fork of X Layer. Never points at a public RPC.
//
//   anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8601 --silent
//   FORK_RPC=http://127.0.0.1:8601 node scripts/fork-drop.ts
//
// deploy TapeOut's drops contract (X Layer factory) -> impersonated Cerebr creator approves + creates
// a 400 NAND / 16 per claim drop -> 3 fresh addresses claim -> double claim / stranger cancel revert
// -> a claimer tapes out a 16-NAND neuron on the Cerebr circuits paying only the tape-out fee ->
// creator cancels and gets the rest back -> dust + cancelTo + approval revoke. Prints PASS/FAIL.

import { createPublicClient, createTestClient, createWalletClient, formatEther, http, parseEther, type Address } from 'viem';
import { NAND_ID, XLAYER, readFees, tapeout, transistorBalances, truthTable, xLayerFork } from '../src/tapeout/index.ts';
import {
  BSC_DROPS,
  XLAYER_DROPS,
  XLAYER_DROPS_CODEHASH,
  cancelDrop,
  claimDrop,
  claimedBy,
  createDrop,
  deployDrops,
  dropCount,
  dropsAbi,
  erc1155ApprovalAbi,
  explainDropError,
  hasClaimed,
  listDrops,
  readDrop,
  verifyDrops,
} from '../src/tapeout/drops.ts';
import { bitsOf, encodeHex, thresholdNeuronCircuit, verifyCircuit } from '../src/neuro/index.ts';

const rpc = process.env.FORK_RPC ?? 'http://127.0.0.1:8601';
const host = new URL(rpc).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing non-local RPC ${rpc}: forks only`);

const CREATOR: Address = '0xc742AdA2872a042dD36D2E706907b4036968960C';
const TRANSISTORS: Address = '0x84b5a5c6fE305319458113b87c09a2A241427D2D';
const CIRCUITS: Address = '0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF';
const DEPLOYER: Address = '0x00000000000000000000000000000000000ce8d0';
const USERS: Address[] = ['0x00000000000000000000000000000000000ce8d1', '0x00000000000000000000000000000000000ce8d2', '0x00000000000000000000000000000000000ce8d3'];
const AMOUNT = 400n;
const PER_CLAIM = 16n;

const transport = http(rpc);
const chain = xLayerFork(rpc, await createPublicClient({ transport }).getChainId());
const pc = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: 'anvil' });
const wallet = (account: Address) => createWalletClient({ chain, transport, account });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
async function expectRevert(name: string, fn: () => Promise<unknown>, want: string) {
  try {
    await fn();
    check(name, false, 'did not revert');
  } catch (e) {
    const msg = String((e as Error).message);
    check(name, msg.includes(want), `${want}${explainDropError(e) ? ` -> ${explainDropError(e)}` : ''}`);
  }
}
const nand = async (who: Address) => (await transistorBalances(pc, TRANSISTORS, who)).nand;

// The Genesis neuron: y = [x1 + x2 + x3 - 2*x0 >= 1], exactly 16 NAND (= one perClaim).
const genesisNeuron = thresholdNeuronCircuit([-2, 1, 1, 1], 1, {
  id: 'genesis-neuron',
  name: 'Genesis Neuron',
  inputs: ['inhibit', 'e0', 'e1', 'e2'],
});

async function main() {
  const chainId = await pc.getChainId();
  const block = await pc.getBlockNumber();
  check('fork of X Layer', chainId === 196 || chainId === 31337, `chainId ${chainId}, block ${block}`);
  check('no TapeOut drops contract on X Layer (BSC address has no code here)', !(await pc.getCode({ address: BSC_DROPS })) && XLAYER_DROPS === undefined);
  const gasPrice = await pc.getGasPrice();
  const fees = await readFees(pc, { circuits: CIRCUITS });

  // 1. deploy TapeOut's drops contract bound to the X Layer factory
  await test.setBalance({ address: DEPLOYER, value: parseEther('1') });
  const dep = await deployDrops(wallet(DEPLOYER), pc);
  const drops = dep.drops;
  const v = await verifyDrops(pc, drops);
  check('deploy drops (factory = X Layer factory, codehash pinned)', v.ok && v.codeHash === XLAYER_DROPS_CODEHASH, `${drops}, gas ${dep.receipt.gasUsed}`);
  check('nextDropId = 0 on a fresh contract', (await dropCount(pc, drops)) === 0n);

  // 2. creator approves + creates 400 NAND / 16 per claim
  const creatorNand0 = await nand(CREATOR);
  const creatorOkb0 = await pc.getBalance({ address: CREATOR });
  console.log(`creator ${CREATOR}: ${creatorNand0} NAND, ${formatEther(creatorOkb0)} OKB; gasPrice ${formatEther(gasPrice, 'gwei')} gwei`);
  const cw = wallet(CREATOR);
  await expectRevert('create without approval reverts ERC1155MissingApprovalForAll', () =>
    pc.simulateContract({ account: CREATOR, address: drops, abi: dropsAbi, functionName: 'create', args: [TRANSISTORS, 0, AMOUNT, PER_CLAIM] }), '0xe237d922');
  const created = await createDrop(cw, pc, { drops, transistors: TRANSISTORS, tokenId: Number(NAND_ID), amount: AMOUNT, perClaim: PER_CLAIM });
  check('setApprovalForAll(drops) sent', !!created.approval, `gas ${created.approval?.receipt.gasUsed}`);
  check('create 400 NAND / 16 per claim', created.dropId === 1n, `dropId ${created.dropId}, gas ${created.receipt.gasUsed}`);
  check('creator NAND debited, contract holds 400', (await nand(CREATOR)) === creatorNand0 - AMOUNT && (await nand(drops)) === AMOUNT);
  const d0 = await readDrop(pc, created.dropId, drops);
  check('readDrop', d0.creator === CREATOR && d0.perClaim === PER_CLAIM && d0.remaining === AMOUNT && d0.sharesLeft === 25n && d0.live && d0.claimedCount === 0n && d0.tokenId === 0);
  const listed = await listDrops(pc, { transistors: TRANSISTORS, liveOnly: true }, drops);
  check('listDrops by transistors (nextDropId + getDrops, no logs)', listed.length === 1 && listed[0].id === created.dropId);

  // 3. three fresh users claim. Each holds one tape-out fee plus a little gas money (anvil's gas price
  // is ~1 gwei vs ~0.02 gwei on X Layer, so the fork needs more gas money than mainnet would).
  const userBudget = fees.tapeoutFee + parseEther('0.002');
  for (const u of USERS) {
    await test.setBalance({ address: u, value: userBudget });
    check(`fresh user ${u.slice(-4)} has 0 NAND`, (await nand(u)) === 0n);
    const c = await claimDrop(wallet(u), pc, created.dropId, drops);
    check(`claim by ${u.slice(-4)}`, c.amount === PER_CLAIM && (await nand(u)) === PER_CLAIM && (await hasClaimed(pc, created.dropId, u, drops)), `gas ${c.receipt.gasUsed}`);
  }
  const d1 = await readDrop(pc, created.dropId, drops);
  check('remaining 352, claimedCount 3, 22 shares left', d1.remaining === AMOUNT - 3n * PER_CLAIM && d1.claimedCount === 3n && d1.sharesLeft === 22n);
  check('claimedBy batch view', (await claimedBy(pc, USERS[0], [created.dropId], drops))[0] === true && (await claimedBy(pc, CREATOR, [created.dropId], drops))[0] === false);

  // 4. negative paths
  await expectRevert('double claim reverts', () => claimDrop(wallet(USERS[0]), pc, created.dropId, drops), 'already claimed');
  await expectRevert('stranger cancel reverts', () => cancelDrop(wallet(USERS[1]), pc, created.dropId, { drops }), 'not creator');
  await expectRevert('claim unknown drop reverts', () => claimDrop(wallet(USERS[1]), pc, 99n, drops), 'no drop');
  await expectRevert('contract claimer without ERC-1155 receiver reverts', () =>
    pc.simulateContract({ account: XLAYER.multicall3, address: drops, abi: dropsAbi, functionName: 'claim', args: [created.dropId] }), '0x57f447ce');
  await expectRevert('direct ERC-1155 transfer into drops reverts', () =>
    pc.simulateContract({
      account: CREATOR, address: TRANSISTORS, functionName: 'safeTransferFrom', args: [CREATOR, drops, 0n, 1n, '0x'],
      abi: [{ type: 'function', name: 'safeTransferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'f', type: 'address' }, { name: 't', type: 'address' }, { name: 'i', type: 'uint256' }, { name: 'a', type: 'uint256' }, { name: 'd', type: 'bytes' }], outputs: [] }],
    }), 'direct transfer not accepted');

  // 5. a claimer tapes out a 16-NAND neuron, paying only the tape-out fee
  const ver = verifyCircuit(genesisNeuron);
  const nl = genesisNeuron.build();
  check('Genesis neuron compiles to 16 NAND and verifies', ver.ok && nl.counts.nand === 16 && nl.counts.latch === 0 && nl.counts.ref === 0, `${ver.cases} cases`);
  const u0 = USERS[0];
  const okbBefore = await pc.getBalance({ address: u0 });
  const t = await tapeout(wallet(u0), pc, { circuits: CIRCUITS, netlist: encodeHex(nl), nIn: nl.nIn, nOut: nl.nOut });
  const okbSpent = okbBefore - (await pc.getBalance({ address: u0 }));
  const gasCost = t.receipt.gasUsed * t.receipt.effectiveGasPrice;
  check('claimer tapes out the 16-NAND neuron', t.gateCount === 16 && (await nand(u0)) === 0n, `circuit #${t.circuitId}, gas ${t.receipt.gasUsed}, at 0.02 gwei = ${formatEther(t.receipt.gasUsed * 20_000_000n)} OKB`);
  check('claimer paid TAPEOUT_FEE + gas only', okbSpent === fees.tapeoutFee + gasCost, `${formatEther(fees.tapeoutFee)} + ${formatEther(gasCost)} gas`);
  const table = await truthTable(pc, CIRCUITS, t.circuitId);
  const want = Array.from({ length: 16 }, (_, k) => genesisNeuron.reference!(bitsOf(k, 4))[0]);
  check('on-chain truth table matches the neuron', table.map((r) => r[0]).join('') === want.join(''), table.map((r) => r[0]).join(''));

  // 6. creator cancels and recovers the rest
  const cancelled = await cancelDrop(cw, pc, created.dropId, { drops });
  check('cancel refunds remaining 352 to creator', cancelled.refunded === 352n && (await nand(CREATOR)) === creatorNand0 - 3n * PER_CLAIM && (await nand(drops)) === 0n, `gas ${cancelled.receipt.gasUsed}`);
  const d2 = await readDrop(pc, created.dropId, drops);
  check('drop marked cancelled, not live', d2.cancelled && !d2.live && d2.remaining === 0n);
  await expectRevert('claim after cancel reverts', () => claimDrop(wallet(USERS[1]), pc, created.dropId, drops), 'cancelled');
  await expectRevert('cancel twice reverts', () => cancelDrop(cw, pc, created.dropId, { drops }), 'already cancelled');

  // 7. dust, drained, cancelTo, approval revoke
  const dust = await createDrop(cw, pc, { drops, transistors: TRANSISTORS, tokenId: 0, amount: 20n, perClaim: 16n, revokeApproval: true });
  check('second create skips approval, revokes after', !dust.approval && !!dust.revoke && !(await pc.readContract({ address: TRANSISTORS, abi: erc1155ApprovalAbi, functionName: 'isApprovedForAll', args: [CREATOR, drops] })), `dropId ${dust.dropId}, create gas ${dust.receipt.gasUsed}`);
  await claimDrop(wallet(USERS[1]), pc, dust.dropId, drops);
  await expectRevert('remaining 4 < perClaim reverts drained', () => claimDrop(wallet(USERS[2]), pc, dust.dropId, drops), 'drained');
  const sink: Address = '0x00000000000000000000000000000000000ce8df';
  const ct = await cancelDrop(cw, pc, dust.dropId, { drops, to: sink });
  check('cancelTo returns dust to a chosen address', ct.refunded === 4n && (await nand(sink)) === 4n);
  check('dropCount = 2, listDrops newest first', (await dropCount(pc, drops)) === 2n && (await listDrops(pc, {}, drops)).map((d) => d.id).join(',') === '2,1');

  const okbSpentCreator = creatorOkb0 - (await pc.getBalance({ address: CREATOR }));
  console.log(`\ncreator OKB spent on gas for approve+create+cancel+create+revoke+cancelTo: ${formatEther(okbSpentCreator)} (no protocol fees)`);
  console.log(`${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}  (drops ${drops})`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error('FAIL ', e);
  process.exitCode = 1;
});
