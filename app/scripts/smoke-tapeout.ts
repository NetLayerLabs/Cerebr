// End-to-end smoke test of the dApp's TapeOut code paths on a LOCAL anvil fork of X Layer.
// It uses the same modules as the UI (src/lib/cerebr.ts transaction builders, planDesign,
// compileDesign, identifyCircuits, loadProgram) and the same simulate -> write -> receipt flow as
// hooks/useTx.ts. Never points at a public RPC; signs with anvil's unlocked dev account #2 (no key).
//
//   anvil --fork-url https://rpc.xlayer.tech --chain-id 31337 --port 8564
//   FORK_RPC=http://127.0.0.1:8564 node --import ./scripts/sdk-alias.mjs scripts/smoke-tapeout.ts
//
// Env: CPU=0x<circuits>  reuse an existing CPU on the fork instead of creating one
//      OUT=<file>        write a launch-style record ({chainId, fork, cpu, catalog}) for sync-cpu.mjs

import { writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Address, type Hex, type PublicClient } from 'viem'
import { CATALOG, bitsOf, decode, run, truthTable, type OutputMode } from '@cerebr/sdk'
import {
  createCpu,
  listCircuits,
  packBits,
  readCpu,
  readFees,
  transistorBalances,
  unpackBits,
  accountOf,
  circuitsAbi,
  type Wallet,
} from '@cerebr/sdk/tapeout'
import { makeXLayerFork } from '../src/config/chains.ts'
import {
  TAPEOUT,
  addToIndex,
  compileDesign,
  identifyCircuits,
  indexByNetlist,
  loadProgram,
  mintTx,
  openTx,
  planDesign,
  tapedOutId,
  tapeoutTx,
  type ChainCircuit,
  type Design,
  type TxParams,
} from '../src/lib/cerebr.ts'
import { dieShotSvg } from '../src/lib/dieShot.ts'

const rpc = process.env.FORK_RPC ?? 'http://127.0.0.1:8564'
const host = new URL(rpc).hostname
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`refusing non-local RPC ${rpc}: forks only`)

const chain = makeXLayerFork(rpc)
const pc = createPublicClient({ chain, transport: http(rpc) }) as PublicClient
// Anvil dev account #2 (unlocked). #0, #1 and #5 carry EIP-7702 delegations on X Layer mainnet, so
// on a fork they are contracts that reject ERC-1155 transistors (ERC1155InvalidReceiver).
const me = (process.env.ME ?? '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC') as Address
const wc = createWalletClient({ chain, transport: http(rpc), account: me }) as unknown as Wallet
const MODE: OutputMode = 'direct'

let failures = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

/** hooks/useTx.ts, minus React: simulate (decoded reverts) -> send -> wait for a successful receipt. */
async function send(label: string, p: TxParams) {
  const { request } = await pc.simulateContract({ ...p, account: me } as never)
  const hash = await wc.writeContract(request as never)
  const receipt = await pc.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label}: reverted (${hash})`)
  return receipt
}

// Tape-out order: REF variants after their dependencies (the studio handles this automatically too).
const ORDER = [
  'and-neuron', 'or-neuron', 'nand-neuron', 'xor-net', 'xor-net-ref', 'majority-3', 'threshold-neuron',
  'line-cell', 'any-of-3', 'line-detector', 'line-detector-ref', 'spiking-neuron',
]

async function main() {
  const chainId = await pc.getChainId()
  check('local fork reachable', chainId === chain.id, `chainId ${chainId}, block ${await pc.getBlockNumber()}`)
  const start = await pc.getBalance({ address: me })

  // 1. the processor: an existing one, or createCPU through the TapeOut factory
  let circuits = process.env.CPU as Address | undefined
  if (!circuits) {
    const created = await createCpu(wc, pc, {
      name: 'Cerebr',
      symbol: 'CRBR',
      story: 'A neural processor: threshold neurons, majority votes and a line detector, compiled to NAND and run on-chain.',
      supply: 100_000n,
      mintPrice: parseEther('0.000066'),
    })
    circuits = created.circuits
  }
  let cpu = await readCpu(pc, circuits)
  const fees = await readFees(pc, cpu)
  check('CPU registered in the TapeOut factory', cpu.registered, `circuits ${cpu.circuits} transistors ${cpu.transistors}`)
  const prices = { ...cpu }

  // 2. tape out the catalog through compileDesign + planDesign + mintTx/tapeoutTx (the studio's path)
  const existing = (await listCircuits(pc, circuits, { withNetlist: true })) as ChainCircuit[]
  const index = indexByNetlist(existing)
  const catalog: Record<string, string> = {}
  for (const id of ORDER) {
    const c = compileDesign({ kind: 'catalog', id }, { mode: MODE, cpu: circuits, index })
    if (c.existing !== undefined) {
      catalog[id] = c.existing.toString()
      continue
    }
    const have = await transistorBalances(pc, cpu.transistors, me)
    cpu = await readCpu(pc, circuits)
    const plan = planDesign(c, have, { ...prices, remaining: cpu.remaining })
    if (plan.blocked) throw new Error(plan.blocked)
    for (const m of plan.mints) await send(`mint ${m.label}`, mintTx(cpu.transistors, m.id, m.amount, cpu.mintPrice, cpu.protocolFee))
    for (const d of c.deps.filter((x) => x.circuitId === undefined)) {
      const r = await send(`tapeout ${d.placeholder}`, tapeoutTx(circuits, d.hex, d.netlist.nIn, d.netlist.nOut, cpu.tapeoutFee))
      addToIndex(index, d.netlist, d.hex, tapedOutId(r, circuits))
    }
    const final = compileDesign({ kind: 'catalog', id }, { mode: MODE, cpu: circuits, index })
    if (!final.hex) throw new Error(`${id}: dependencies still missing`)
    const r = await send(`tapeout ${id}`, tapeoutTx(circuits, final.hex, final.netlist.nIn, final.netlist.nOut, cpu.tapeoutFee))
    const cid = tapedOutId(r, circuits)
    addToIndex(index, final.netlist, final.hex, cid)
    catalog[id] = cid.toString()
    const after = await transistorBalances(pc, cpu.transistors, me)
    const burned = have.nand + plan.mints.filter((m) => m.label === 'NAND').reduce((s, m) => s + m.amount, 0n) - after.nand
    check(`tapeout ${id} -> #${cid}`, burned === plan.burn.nand, `burned ${burned} NAND (plan ${plan.burn.nand}), gas ${r.gasUsed} (est ${plan.gas})`)
  }

  // 2b. a studio network wired by REF, with one neuron not yet on chain: it is taped out first
  {
    const design = {
      kind: 'network',
      nIn: 3,
      layers: [[{ weights: [1, 1, 1], theta: 1 }, { weights: [-1, -1, -1], theta: -1 }], [{ weights: [1, 1], theta: 2 }]],
      compose: 'ref',
    } as const satisfies Design
    const c = compileDesign(design, { mode: MODE, cpu: circuits, index })
    const missing = c.deps.filter((d) => d.circuitId === undefined)
    const plan = planDesign(c, await transistorBalances(pc, cpu.transistors, me), { ...prices, remaining: cpu.remaining })
    for (const m of plan.mints) await send(`mint ${m.label}`, mintTx(cpu.transistors, m.id, m.amount, cpu.mintPrice, cpu.protocolFee))
    for (const d of missing) {
      const r = await send(`tapeout ${d.placeholder}`, tapeoutTx(circuits, d.hex, d.netlist.nIn, d.netlist.nOut, cpu.tapeoutFee))
      addToIndex(index, d.netlist, d.hex, tapedOutId(r, circuits))
    }
    const final = compileDesign(design, { mode: MODE, cpu: circuits, index })
    const r = await send('tapeout network', tapeoutTx(circuits, final.hex!, final.netlist.nIn, final.netlist.nOut, cpu.tapeoutFee))
    const id = tapedOutId(r, circuits)
    const got: number[] = []
    for (let k = 0; k < 8; k++) got.push(unpackBits(await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'eval', args: [id, packBits(bitsOf(k, 3))] }), 1)[0])
    check(
      'studio REF network: missing neuron taped out first, then the network',
      missing.length === 1 && plan.tapeouts.length === 2 && c.deps.length - missing.length === 2 && got.join('') === '01101000',
      `#${id}: deps on chain ${c.deps.length - missing.length}/${c.deps.length}, exactly-one-of-3 = ${got.join('')}`,
    )
  }

  // 3. the gallery's view: list + recognise every catalog circuit from its bytes alone
  const list = (await listCircuits(pc, circuits, { withNetlist: true })) as ChainCircuit[]
  const labels = identifyCircuits(circuits, list) // no launch record: bytes only
  for (const id of ORDER) {
    const got = labels.get(BigInt(catalog[id]))?.catalogId
    check(`identify #${catalog[id]} as ${id}`, got === id, got ?? 'unrecognised')
  }

  // 4. the playground's view: on-chain eval / step against the local simulator loaded from chain
  const cache = new Map()
  for (const c of list) {
    const prog = await loadProgram(pc, circuits, c.id, cache, c)
    const name = labels.get(c.id)?.catalogId ?? `#${c.id}`
    if (c.nState === 0) {
      const want = truthTable(prog)
      let ok = 0
      for (let from = 0; from < want.length; from += 64) {
        const ks = Array.from({ length: Math.min(64, want.length - from) }, (_, i) => from + i)
        const out = await pc.multicall({
          allowFailure: false,
          multicallAddress: TAPEOUT.multicall3,
          contracts: ks.map((k) => ({ address: circuits!, abi: circuitsAbi, functionName: 'eval', args: [c.id, packBits(bitsOf(k, c.nIn))] }) as const),
        })
        out.forEach((r, i) => (unpackBits(r as Hex, c.nOut).every((v, j) => v === want[ks[i]][j]) ? ok++ : 0))
      }
      const ref = CATALOG.find((x) => x.id === labels.get(c.id)?.catalogId)?.reference
      const modelOk = !ref || want.every((row, k) => ref(bitsOf(k, c.nIn)).every((v, j) => v === row[j]))
      check(`eval ${name}: chain = simulator = neural model`, ok === want.length && modelOk, `${ok}/${want.length} rows, gateCount ${c.gateCount}`)
    } else {
      let state = Array(c.nState).fill(0) as number[]
      let fires = ''
      let same = true
      for (const x of [[1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 1], [1, 0]]) {
        const [ns, out] = await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'step', args: [c.id, packBits(state), packBits(x)] })
        const local = run(prog, state, x)
        const o = unpackBits(out, c.nOut)
        same &&= o[0] === local.outputs[0] && unpackBits(ns, c.nState).join('') === Array.from(local.newState).join('')
        fires += o[0]
        state = unpackBits(ns, c.nState)
      }
      check(`step ${name}: chain = simulator`, same && fires === '00100100', `fire trace ${fires}`)
    }
  }

  // 5. the gallery's brain wallet: open the XOR net's native account through the opener
  const xor = BigInt(catalog['xor-net'])
  const before = await accountOf(pc, circuits, xor)
  if (!before.opened) await send('open', openTx(circuits, xor, fees.openFee))
  const after = await accountOf(pc, circuits, xor)
  check('open brain wallet (TapeOut opener)', after.opened && after.account === before.account, after.account)

  // 6. die shots render for every circuit
  const svgs = list.map((c) => dieShotSvg(decode(c.netlist, c.nIn), c.nIn, c.nOut, { title: labels.get(c.id)?.name }))
  check('die shots render', svgs.every((s) => s.startsWith('<svg') && s.includes('<rect')), `${svgs.length} circuits`)

  const spent = start - (await pc.getBalance({ address: me }))
  cpu = await readCpu(pc, circuits)
  console.log(`\nCPU ${cpu.name}: ${cpu.minted}/${cpu.supplyCap} minted, ${cpu.circuitCount} circuits; spent ${formatEther(spent)} OKB (fork)`)
  const record = { chainId, fork: true, cpu: { circuits: cpu.circuits, transistors: cpu.transistors }, catalog }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify(record))
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
