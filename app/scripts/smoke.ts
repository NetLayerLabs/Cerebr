// End-to-end smoke test against a LOCAL anvil, using the same generated ABIs, chain definitions,
// deployment config and tokenURI decoder as the dApp.
//
//   RPC_URL=http://127.0.0.1:8545 node scripts/smoke.ts      (Node >= 23.6: runs .ts natively)
//
// Uses anvil's UNLOCKED account #4 through eth_sendTransaction (no private key in this script),
// exactly like the dApp's local "Anvil dev account" connector. Refuses to run on any chain but 31337.
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  parseEther,
  zeroHash,
  type Abi,
  type Address,
  type TransactionReceipt,
} from 'viem'
import {
  cerebrAccountAbi,
  cerebrCircuitAbi,
  cerebrLensAbi,
  cerebrProcessorAbi,
  erc6551RegistryAbi,
} from '../src/abi/index.ts'
import { ANVIL_ID, makeAnvil } from '../src/config/chains.ts'
import { getDeployment } from '../src/config/deployments.ts'
import { decodeTokenUri } from '../src/lib/tokenUri.ts'
import { minusBps, plusBps } from '../src/lib/format.ts'

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const USER: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' // anvil #4 (unlocked)
const SLIPPAGE_BPS = 50

const chain = makeAnvil(RPC)
const pub = createPublicClient({ chain, transport: http(RPC) })
const wallet = createWalletClient({ chain, transport: http(RPC), account: USER })

let passed = 0
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  passed++
  console.log(`  ok  ${msg}`)
}

const AUTO_REVEAL_FNS = new Set(['buyTransistors', 'tapeOutCircuit', 'tapeOutCircuitTier', 'fuseCircuits', 'processRevealQueue'])

async function tx(label: string, p: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }) {
  // Same path as the dApp's useTx: simulate (decoded errors) -> send -> wait.
  const { request } = await pub.simulateContract({ ...p, account: USER } as never)
  // Same auto-reveal gas pad as useTx: the queue's cost depends on the inclusion block, not the estimate block.
  if (AUTO_REVEAL_FNS.has(p.functionName)) {
    ;(request as { gas?: bigint }).gas = (await pub.estimateContractGas({ ...p, account: USER } as never)) + 80_000n
  }
  const hash = await wallet.writeContract(request as never)
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${label} reverted`)
  console.log(`  tx  ${label} (gas ${r.gasUsed})`)
  return r
}

function events(r: TransactionReceipt, abi: Abi, eventName: string, address: Address) {
  return r.logs
    .filter((l) => l.address.toLowerCase() === address.toLowerCase())
    .map((l) => {
      try {
        return decodeEventLog({ abi, data: l.data, topics: l.topics })
      } catch {
        return undefined
      }
    })
    .filter((e): e is NonNullable<typeof e> => !!e && e.eventName === eventName)
    .map((e) => e.args as unknown as Record<string, unknown>)
}

async function main() {
  const chainId = await pub.getChainId()
  if (chainId !== ANVIL_ID) throw new Error(`refusing to run on chain ${chainId}; local anvil (31337) only`)
  const d = getDeployment(ANVIL_ID)
  if (!d) throw new Error('no 31337 deployment in src/generated/deployments.ts; run LocalDemo + npm run sync')
  console.log(`smoke: ${RPC} lens ${d.lens}`)

  const read = <T>(address: Address, abi: Abi, functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address, abi, functionName, args } as never) as Promise<T>
  type PS = Awaited<ReturnType<typeof stateNow>>
  const stateNow = () => pub.readContract({ address: d.lens, abi: cerebrLensAbi, functionName: 'protocolState' })
  const cbr = () => pub.readContract({ address: d.processor, abi: cerebrProcessorAbi, functionName: 'balanceOf', args: [USER] })
  const view = (id: bigint) => pub.readContract({ address: d.lens, abi: cerebrLensAbi, functionName: 'circuitView', args: [id] })
  const invariant = (s: PS, label: string) =>
    check(s.balance >= s.reserveRequired + s.protocolFees, `invariant balance >= reserveRequired + fees (${label})`)

  // 0. Config consistency: generated deployment == what the lens reports.
  console.log('\n[0] config')
  const s0 = await stateNow()
  check(s0.processor === d.processor && s0.circuit === d.circuit, 'lens protocolState matches generated deployment')
  check(s0.erc6551Registry === d.erc6551Registry && s0.accountImplementation === d.accountImplementation, 'ERC-6551 addresses match')
  invariant(s0, 'start')

  // 1. Buy with an exact OKB budget (lens closed-form quote).
  console.log('\n[1] buy exact OKB')
  const budget = parseEther('0.02')
  const [amt, cost] = await pub.readContract({ address: d.lens, abi: cerebrLensAbi, functionName: 'quoteBuyExactOKB', args: [budget] })
  check(amt > 0n && cost <= budget, `quoteBuyExactOKB(0.02 OKB) -> ${amt} CBR-wei for ${cost} wei`)
  const nextCost = await read<bigint>(d.processor, cerebrProcessorAbi, 'quoteBuy', [amt + 1n])
  check(nextCost > budget, 'quote is maximal: quoteBuy(amount + 1) > budget')
  const cbr0 = await cbr()
  const okb0 = await pub.getBalance({ address: USER })
  const maxCost = plusBps(cost, SLIPPAGE_BPS)
  const rBuy = await tx('buyTransistors (exact OKB)', {
    address: d.processor, abi: cerebrProcessorAbi, functionName: 'buyTransistors', args: [amt, maxCost], value: maxCost,
  })
  check((await cbr()) - cbr0 === amt, 'received exactly the quoted CBR')
  const spent = okb0 - (await pub.getBalance({ address: USER })) - rBuy.gasUsed * rBuy.effectiveGasPrice
  check(spent === cost, 'paid exactly the quoted cost (excess msg.value refunded)')

  // 2. Buy an exact CBR amount (enough for 2 Basic tape-outs + a fusion + a sell).
  console.log('\n[2] buy exact CBR')
  const want = 17_000n * 10n ** 18n
  const c2 = await read<bigint>(d.processor, cerebrProcessorAbi, 'quoteBuy', [want])
  const rb2 = await tx('buyTransistors (exact CBR)', {
    address: d.processor, abi: cerebrProcessorAbi, functionName: 'buyTransistors', args: [want, plusBps(c2, SLIPPAGE_BPS)], value: plusBps(c2, SLIPPAGE_BPS),
  })
  const bought = events(rb2, cerebrProcessorAbi as Abi, 'TransistorsBought', d.processor)[0]
  check(bought && bought.amount === want && bought.cost === c2, 'TransistorsBought event: amount and cost')

  // 3. Sell with a min-refund guard.
  console.log('\n[3] sell')
  const sellAmt = 1_000n * 10n ** 18n + (amt % 10n ** 18n)
  const [, fee, net] = await read<readonly [bigint, bigint, bigint]>(d.lens, cerebrLensAbi, 'quoteSell', [sellAmt])
  const feesBefore = (await stateNow()).protocolFees
  const rs = await tx('sellTransistors', {
    address: d.processor, abi: cerebrProcessorAbi, functionName: 'sellTransistors', args: [sellAmt, minusBps(net, SLIPPAGE_BPS)],
  })
  const sold = events(rs, cerebrProcessorAbi as Abi, 'TransistorsSold', d.processor)[0]
  check(sold && sold.net === net && sold.fee === fee, 'TransistorsSold net/fee match quoteSell')
  check((await stateNow()).protocolFees - feesBefore === fee, '1% fee accrued to protocolFees')

  // 4. Tape out two Basic Circuits (canonical tapeOutCircuit()).
  console.log('\n[4] tape-out')
  const burnedBefore = (await stateNow()).totalCbrBurned
  const ids: bigint[] = []
  for (let i = 0; i < 2; i++) {
    const r = await tx('tapeOutCircuit', { address: d.processor, abi: cerebrProcessorAbi, functionName: 'tapeOutCircuit' })
    const ev = events(r, cerebrProcessorAbi as Abi, 'CircuitTapedOut', d.processor)[0]
    check(ev && ev.owner === USER && ev.tier === 0 && ev.cbrBurned === 5_000n * 10n ** 18n, `CircuitTapedOut #${ev?.tokenId} (Basic, 5,000 CBR)`)
    ids.push(ev.tokenId as bigint)
  }
  const sealedMeta = decodeTokenUri(await read<string>(d.circuit, cerebrCircuitAbi, 'tokenURI', [ids[0]]))
  check(sealedMeta && sealedMeta.attributes.some((a) => a.trait_type === 'Status' && a.value === 'Sealed'), 'unrevealed tokenURI decodes as a sealed wafer')
  check(atob(sealedMeta.image.split(',')[1]).includes('SEALED WAFER'), 'sealed SVG renders')

  // 5. Reveal (commit-reveal: needs commitBlock + 2). Revealing too early must fail.
  console.log('\n[5] reveal')
  const v0 = await view(ids[1])
  const bn = await pub.getBlockNumber()
  if (bn < v0.revealReadyBlock) {
    let early = false
    try {
      await pub.simulateContract({ address: d.circuit, abi: cerebrCircuitAbi, functionName: 'reveal', args: [ids[1]], account: USER })
    } catch (e) {
      early = String(e).includes('RevealTooEarly')
    }
    check(early, 'reveal before the ready block reverts RevealTooEarly')
    await pub.request({ method: 'anvil_mine' as never, params: ['0x2'] as never })
  }
  for (const id of ids) {
    const r = await tx(`reveal #${id}`, { address: d.circuit, abi: cerebrCircuitAbi, functionName: 'reveal', args: [id] })
    check(events(r, cerebrCircuitAbi as Abi, 'CircuitRevealed', d.circuit).length === 1, `CircuitRevealed #${id}`)
  }
  const rv = await view(ids[0])
  check(rv.revealed && rv.seed !== 0n && rv.traits.revealed && rv.traits.cores >= 8n, `traits: ${rv.traits.architecture} ${rv.traits.cores} cores ${rv.traits.rarity}`)
  const revealedMeta = decodeTokenUri(await read<string>(d.circuit, cerebrCircuitAbi, 'tokenURI', [ids[0]]))
  check(revealedMeta && revealedMeta.attributes.some((a) => a.trait_type === 'Rarity'), 'revealed tokenURI has Rarity attribute')

  // 6. Fuse the two Basics into a Pro.
  console.log('\n[6] fuse')
  const rf = await tx('fuseCircuits', { address: d.processor, abi: cerebrProcessorAbi, functionName: 'fuseCircuits', args: [ids[0], ids[1]] })
  const fused = events(rf, cerebrProcessorAbi as Abi, 'CircuitsFused', d.processor)[0]
  check(fused && fused.tier === 1 && fused.parentA === ids[0] && fused.parentB === ids[1], `CircuitsFused -> Pro #${fused?.childId}`)
  const child = fused.childId as bigint
  const cv = await view(child)
  check(cv.tier === 1 && !cv.revealed && !cv.tbaDeployed, 'child is sealed Pro with a counterfactual brain wallet')
  for (const id of ids) {
    check((await read<Address>(d.circuit, cerebrCircuitAbi, 'ownerOf', [id])) === cv.tba, `parent #${id} sits in the child's brain wallet`)
  }
  const s6 = await stateNow()
  check(s6.totalCbrBurned - burnedBefore === 15_000n * 10n ** 18n, 'totalCbrBurned += 5k + 5k (tape-outs) + 5k (fusion)')
  check(s6.surplusReserve > 0n, `surplus reserve live: ${s6.surplusReserve} wei`)
  invariant(s6, 'after fusion')

  // 7. Activate the child's brain wallet and pull a parent back out via nested execute.
  console.log('\n[7] brain wallet')
  await tx('createAccount (activate brain wallet)', {
    address: d.erc6551Registry, abi: erc6551RegistryAbi, functionName: 'createAccount',
    args: [d.accountImplementation, zeroHash, BigInt(ANVIL_ID), d.circuit, child],
  })
  check((await view(child)).tbaDeployed, 'brain wallet deployed at the counterfactual address')
  const owner = await read<Address>(cv.tba, cerebrAccountAbi, 'owner')
  check(owner === USER, 'brain wallet owner() == Circuit owner')
  const userStateTba = await pub.readContract({ address: d.lens, abi: cerebrLensAbi, functionName: 'userState', args: [cv.tba] })
  check(userStateTba.circuits.length === 2, 'lens.userState(tba) lists the 2 nested parents (dApp "Holds")')
  await tx('execute: withdraw parent from brain wallet', {
    address: cv.tba, abi: cerebrAccountAbi, functionName: 'execute',
    args: [d.circuit, 0n, encodeFunctionData({ abi: cerebrCircuitAbi, functionName: 'transferFrom', args: [cv.tba, USER, ids[0]] }), 0],
  })
  check((await read<Address>(d.circuit, cerebrCircuitAbi, 'ownerOf', [ids[0]])) === USER, `parent #${ids[0]} recovered to the owner`)

  // 8. Reveal the child too (permissionless) and check the user view the gallery renders.
  await pub.request({ method: 'anvil_mine' as never, params: ['0x2'] as never })
  await tx(`reveal child #${child}`, { address: d.circuit, abi: cerebrCircuitAbi, functionName: 'reveal', args: [child] })
  const us = await pub.readContract({ address: d.lens, abi: cerebrLensAbi, functionName: 'userState', args: [USER] })
  check(us.circuits.some((c) => c.id === child && c.revealed && c.tier === 1), 'userState shows the revealed Pro child')
  const pts = await pub.readContract({ address: d.lens, abi: cerebrLensAbi, functionName: 'curvePoints', args: [120n] })
  check(pts[0].length === 121 && pts[2] === (await stateNow()).totalSupply, 'curvePoints(120) for the chart')
  invariant(await stateNow(), 'end')

  console.log(`\nSMOKE PASSED (${passed} checks)`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
