// Pure Cerebr x TapeOut logic shared by the dApp and scripts/smoke-tapeout.ts (no React, no
// import.meta.env): transaction builders, tape-out planning, design compilation, recognising the
// catalog circuits already on chain, and loading onchain circuits into the local simulator.

import { parseEventLogs, type Abi, type Address, type Hex, type PublicClient, type TransactionReceipt } from 'viem'
import {
  CATALOG,
  LOCAL_CPU,
  compileNetwork,
  compileNeuron,
  decode,
  encodeHex,
  evalNeuron,
  evalNetwork,
  getCircuit,
  isPlaceholder,
  neuronKey,
  prepare,
  refNetwork,
  fromHex,
  NetlistBuilder,
  type BuildOptions,
  type CircuitResolver,
  type Element,
  type Netlist,
  type NeuralCircuit,
  type NeuronSpec,
  type OutputMode,
  type Program,
  type RefTarget,
} from '@cerebr/sdk'
import {
  LATCH_ID,
  NAND_ID,
  XLAYER,
  circuitsAbi,
  openerAbi,
  scanNetlist,
  tapeoutGas,
  transistorsAbi,
  type NetlistStats,
  type TapeoutConfig,
} from '@cerebr/sdk/tapeout'

/** One contract write, as useTx() and the smoke script send it (simulate -> write -> receipt). */
export type TxParams = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  value?: bigint
}

export const TAPEOUT = XLAYER

// ------------------------------------------------------------------ transactions

export function mintTx(transistors: Address, id: bigint, amount: bigint, mintPrice: bigint, protocolFee: bigint): TxParams {
  if (amount <= 0n) throw new Error('amount must be > 0')
  return { address: transistors, abi: transistorsAbi as Abi, functionName: 'mint', args: [id, amount], value: amount * mintPrice + protocolFee }
}

/** msg.value must equal TAPEOUT_FEE exactly: overpaying reverts "tapeout fee". */
export function tapeoutTx(circuits: Address, netlist: Hex, nIn: number, nOut: number, tapeoutFee: bigint): TxParams {
  return { address: circuits, abi: circuitsAbi as Abi, functionName: 'tapeout', args: [netlist, nIn, nOut], value: tapeoutFee }
}

/** Opens a circuit's native TapeOut account (brain wallet). Anyone may pay; excess is refunded. */
export function openTx(circuits: Address, tokenId: bigint, openFee: bigint, cfg: TapeoutConfig = TAPEOUT): TxParams {
  return { address: cfg.opener, abi: openerAbi as Abi, functionName: 'open', args: [circuits, tokenId], value: openFee }
}

export function withdrawTx(transistors: Address): TxParams {
  return { address: transistors, abi: transistorsAbi as Abi, functionName: 'withdraw' }
}

// ------------------------------------------------------------------ planning

export type Burn = { nand: bigint; latch: bigint }
export type Prices = { mintPrice: bigint; protocolFee: bigint; tapeoutFee: bigint; remaining: bigint }

export type MintStep = { id: bigint; label: 'NAND' | 'LATCH'; amount: bigint; value: bigint }

export type TapeoutPlan = {
  burn: Burn
  have: Burn
  /** Transistors to mint first (one mint call per kind). */
  mints: MintStep[]
  mintValue: bigint
  /** msg.value of tapeout(). */
  tapeoutValue: bigint
  /** Everything the wallet pays in msg.value, gas excluded. */
  total: bigint
  /** Gas estimate for the tape-out itself (always re-estimated before sending). */
  gas: bigint
  /** Set when the CPU cannot mint enough transistors. */
  blocked?: string
  /** The numbers behind `blocked` (for translated messages). */
  blockedBy?: { need: bigint; remaining: bigint }
}

export function planTapeout(stats: Pick<NetlistStats, 'nand' | 'latch' | 'refs'>, have: Burn, p: Prices): TapeoutPlan {
  const burn = { nand: BigInt(stats.nand), latch: BigInt(stats.latch) }
  const mints: MintStep[] = []
  const need = (b: bigint, h: bigint) => (b > h ? b - h : 0n)
  const n = need(burn.nand, have.nand)
  const l = need(burn.latch, have.latch)
  if (n > 0n) mints.push({ id: NAND_ID, label: 'NAND', amount: n, value: n * p.mintPrice + p.protocolFee })
  if (l > 0n) mints.push({ id: LATCH_ID, label: 'LATCH', amount: l, value: l * p.mintPrice + p.protocolFee })
  const mintValue = mints.reduce((s, m) => s + m.value, 0n)
  const blocked = n + l > p.remaining ? `Needs ${n + l} more transistors but only ${p.remaining} remain under the supply cap.` : undefined
  const blockedBy = blocked ? { need: n + l, remaining: p.remaining } : undefined
  return { burn, have, mints, mintValue, tapeoutValue: p.tapeoutFee, total: mintValue + p.tapeoutFee, gas: tapeoutGas(stats), blocked, blockedBy }
}

// ------------------------------------------------------------------ onchain circuits

export type ChainCircuit = {
  id: bigint
  nIn: number
  nOut: number
  nState: number
  gateCount: number
  owner: Address
  netlist: Hex
}

/**
 * What the app shows for a circuit: its CerebrScope label (onchain, set by the owner) first, then its
 * catalog entry recognised from the netlist bytes, then 'Circuit #N'. `catalogId` only ever comes
 * from the bytes match.
 */
export type CircuitLabel = {
  name: string
  description?: string
  inputs: string[]
  outputs: string[]
  catalogId?: string
}

export const pinLabels = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

export function labelOfCatalog(c: NeuralCircuit): CircuitLabel {
  return { name: c.name, description: c.description, inputs: c.inputs, outputs: c.outputs, catalogId: c.id }
}

export function labelOfNeuron(spec: NeuronSpec, name?: string): CircuitLabel {
  const terms = spec.weights.map((w, i) => `${w >= 0 ? '+' : '−'}${Math.abs(w) === 1 ? '' : Math.abs(w)}x${i}`).join(' ')
  return {
    name: name ?? 'Threshold Neuron',
    description: `y = [ ${terms || '0'} ≥ ${spec.theta} ]`,
    inputs: pinLabels('x', spec.weights.length),
    outputs: ['y'],
  }
}

export const fallbackLabel = (c: Pick<ChainCircuit, 'id' | 'nIn' | 'nOut'>): CircuitLabel => ({
  name: `Circuit #${c.id}`,
  inputs: pinLabels('x', c.nIn),
  outputs: pinLabels('y', c.nOut),
})

/**
 * The label shown for a circuit. Order: the onchain CerebrScope label (when it has a name), then the
 * catalog identification, then 'Circuit #N'. Pin names fall back per pin the same way.
 */
export function resolveLabel(
  c: Pick<ChainCircuit, 'id' | 'nIn' | 'nOut'>,
  onchain: { name: string; description: string; inputs: readonly string[]; outputs: readonly string[] } | undefined,
  catalog: CircuitLabel | undefined,
): CircuitLabel {
  const base = catalog ?? fallbackLabel(c)
  if (!onchain || !onchain.name.trim()) return base
  const pins = (own: readonly string[], fb: string[], prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => own[i]?.trim() || fb[i] || `${prefix}${i}`)
  return {
    name: onchain.name,
    description: onchain.description || catalog?.description,
    inputs: pins(onchain.inputs, base.inputs, 'x', c.nIn),
    outputs: pins(onchain.outputs, base.outputs, 'y', c.nOut),
    catalogId: catalog?.catalogId,
  }
}

const MODES: OutputMode[] = ['direct', 'buffered']
const pinKey = (nIn: number, nOut: number, hex: string) => `${nIn}:${nOut}:${hex.toLowerCase()}`
const targetKey = (cpu: string, id: bigint) => `${cpu.toLowerCase()}#${id}`

let catalogHexCache: Map<string, string> | undefined
/** pinKey(bytes) -> catalog id, for every flat (REF-free) catalog circuit in both output modes. */
function catalogHexes(): Map<string, string> {
  if (catalogHexCache) return catalogHexCache
  const m = new Map<string, string>()
  for (const c of CATALOG) {
    if (c.deps.length) continue
    for (const mode of MODES) {
      const nl = c.build({ mode })
      m.set(pinKey(nl.nIn, nl.nOut, encodeHex(nl)), c.id)
    }
  }
  return (catalogHexCache = m)
}

/**
 * Recognises catalog circuits among a CPU's circuits by their exact netlist bytes. REF-composed
 * catalog circuits match when every REF points at a circuit of this CPU recognised as the right
 * dependency (so a REF variant built on any copy of its neurons is still recognised).
 * `known` (catalog id -> circuit id from the launch record) takes precedence.
 */
export function identifyCircuits(cpu: Address, circuits: ChainCircuit[], known: Record<string, string> = {}): Map<bigint, CircuitLabel> {
  const out = new Map<bigint, CircuitLabel>()
  const byId = new Map<string, string>()
  for (const [catalogId, cid] of Object.entries(known)) {
    if (CATALOG.some((c) => c.id === catalogId)) byId.set(cid, catalogId)
  }
  const flat = catalogHexes()
  const refVariants = CATALOG.filter((c) => c.deps.length)
  const sorted = [...circuits].sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const c of sorted) {
    let catalogId = byId.get(c.id.toString()) ?? flat.get(pinKey(c.nIn, c.nOut, c.netlist))
    if (!catalogId) catalogId = matchRefVariant(cpu, c, refVariants, out)
    if (catalogId) out.set(c.id, labelOfCatalog(getCircuit(catalogId)))
  }
  return out
}

function matchRefVariant(cpu: Address, c: ChainCircuit, variants: NeuralCircuit[], known: Map<bigint, CircuitLabel>): string | undefined {
  let onchain: Element[]
  try {
    onchain = decode(c.netlist, c.nIn)
  } catch {
    return undefined
  }
  for (const v of variants) {
    if (v.inputs.length !== c.nIn || v.outputs.length !== c.nOut) continue
    for (const mode of MODES) {
      const nl = v.build({ mode })
      if (nl.elements.length !== onchain.length) continue
      const els = nl.elements.map((e, k): Element | undefined => {
        const o = onchain[k]
        if (e.op !== 2 || o.op !== 2 || !isPlaceholder(e.target) || isPlaceholder(o.target)) return e
        const t = o.target
        const ok = t.cpu.toLowerCase() === cpu.toLowerCase() && known.get(t.circuitId)?.catalogId === e.target.placeholder
        return ok ? { ...e, target: t } : undefined
      })
      if (els.some((e) => !e)) continue
      try {
        if (encodeHex(els as Element[]).toLowerCase() === c.netlist.toLowerCase()) return v.id
      } catch {
        // unresolved placeholder: not this variant
      }
    }
  }
  return undefined
}

/** Index of a CPU's circuits by exact bytes + pins, to find a design that is already taped out. */
export function indexByNetlist(circuits: ChainCircuit[]): Map<string, bigint> {
  const m = new Map<string, bigint>()
  for (const c of [...circuits].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const k = pinKey(c.nIn, c.nOut, c.netlist)
    if (!m.has(k)) m.set(k, c.id)
  }
  return m
}

export function findTapedOut(index: Map<string, bigint>, nl: Pick<Netlist, 'nIn' | 'nOut'>, hex: string): bigint | undefined {
  return index.get(pinKey(nl.nIn, nl.nOut, hex))
}

// ------------------------------------------------------------------ designs (studio)

export type Design =
  | { kind: 'catalog'; id: string }
  | { kind: 'neuron'; weights: number[]; theta: number }
  | { kind: 'network'; nIn: number; layers: NeuronSpec[][]; compose: 'ref' | 'inline' }

export type DepStatus = {
  placeholder: string
  label: CircuitLabel
  /** The dependency's own (REF-free) netlist, compiled in the chosen mode. */
  netlist: Netlist
  hex: Hex
  /** Where it already lives on our CPU, if taped out. */
  circuitId?: bigint
}

export type Compiled = {
  label: CircuitLabel
  kind: 'combinational' | 'sequential'
  netlist: Netlist
  deps: DepStatus[]
  /** Netlist bytes for tapeout(); undefined until every REF dependency is on chain. */
  hex?: Hex
  stats?: NetlistStats
  /** Local simulator program (REFs resolved to local copies of the dependencies). */
  program: Program
  /** Reference model (combinational): the neural network the netlist must match. */
  reference?: (x: number[]) => number[]
  /** Set when this exact design is already taped out on our CPU. */
  existing?: bigint
}

/**
 * Compiles a design to a TapeOut netlist. REF dependencies are looked up on our CPU (`index`);
 * for simulation they are linked to local copies, which have byte-identical netlists.
 */
export function compileDesign(design: Design, opts: { mode: OutputMode; cpu?: Address; index?: Map<string, bigint> }): Compiled {
  const build: BuildOptions = { mode: opts.mode }
  let label: CircuitLabel
  let netlist: Netlist
  let kind: Compiled['kind'] = 'combinational'
  let reference: Compiled['reference']
  let deps: { placeholder: string; label: CircuitLabel; variants: Netlist[] }[] = []

  if (design.kind === 'catalog') {
    const c = getCircuit(design.id)
    label = labelOfCatalog(c)
    netlist = c.build(build)
    kind = c.kind
    reference = c.reference
    deps = c.deps.map((id) => {
      const d = getCircuit(id)
      return { placeholder: id, label: labelOfCatalog(d), variants: MODES.map((mode) => d.build({ mode })) }
    })
  } else if (design.kind === 'neuron') {
    const spec = { weights: design.weights, theta: design.theta }
    label = labelOfNeuron(spec)
    netlist = compileNeuron(spec, build)
    reference = (x) => [evalNeuron(spec, x)]
  } else {
    const { nIn, layers } = design
    const outs = layers[layers.length - 1].length
    label = {
      name: design.compose === 'ref' ? 'Neural Network (REF-composed)' : 'Neural Network',
      description: `${nIn} inputs → ${layers.map((l) => l.length).join(' → ')} neurons`,
      inputs: pinLabels('x', nIn),
      outputs: pinLabels('y', outs),
    }
    reference = (x) => evalNetwork(layers, x)
    if (design.compose === 'ref') {
      const b = new NetlistBuilder(nIn)
      const r = refNetwork(b, b.inputs(), layers)
      netlist = b.build(r.outputs, build)
      deps = [...r.deps].map(([key, spec]) => ({
        placeholder: key,
        label: labelOfNeuron(spec, `Neuron ${neuronKey(spec).replace(/^neuron/, '')}`),
        variants: MODES.map((mode) => compileNeuron(spec, { mode })),
      }))
    } else {
      netlist = compileNetwork(nIn, layers, build)
    }
  }

  // Dependencies: prefer an onchain copy in either output mode; otherwise tape out the chosen mode.
  const depStatus: DepStatus[] = deps.map((d) => {
    const [own, other] = opts.mode === 'direct' ? d.variants : [d.variants[1], d.variants[0]]
    for (const v of [own, other]) {
      const hex = encodeHex(v)
      const id = opts.index && findTapedOut(opts.index, v, hex)
      if (id !== undefined) return { placeholder: d.placeholder, label: d.label, netlist: v, hex, circuitId: id }
    }
    return { placeholder: d.placeholder, label: d.label, netlist: own, hex: encodeHex(own) }
  })

  // Simulation: link each placeholder to a local copy.
  const local = new Map<string, { target: RefTarget; prog: Program }>()
  depStatus.forEach((d, i) => {
    local.set(d.placeholder, {
      target: { cpu: LOCAL_CPU, circuitId: BigInt(i + 1) },
      prog: prepare(fromHex(d.hex), d.netlist.nIn, d.netlist.nOut),
    })
  })
  const resolve: CircuitResolver = (_cpu, id) => {
    const hit = [...local.values()].find((l) => l.target.circuitId === id)
    if (!hit) throw new Error(`unknown REF #${id}`)
    return hit.prog
  }
  const localHex = encodeHex(netlist, (p) => local.get(p)?.target)
  const program = prepare(fromHex(localHex), netlist.nIn, netlist.nOut, resolve)

  let hex: Hex | undefined
  let stats: NetlistStats | undefined
  const ready = depStatus.every((d) => d.circuitId !== undefined)
  if (ready && (depStatus.length === 0 || opts.cpu)) {
    const onchain = new Map(depStatus.map((d) => [d.placeholder, { cpu: opts.cpu as string, circuitId: d.circuitId! }]))
    hex = encodeHex(netlist, (p) => onchain.get(p))
    stats = scanNetlist(hex, netlist.nIn, netlist.nOut)
  }
  const existing = hex && opts.index ? findTapedOut(opts.index, netlist, hex) : undefined
  return { label, kind, netlist, deps: depStatus, hex, stats, program, reference, existing }
}

export type DesignPlan = TapeoutPlan & {
  /** Tape-outs in order: missing dependencies first, then the design itself. */
  tapeouts: { label: string; netlist: Netlist; hex?: Hex; dep: boolean }[]
}

/**
 * Everything a design costs from the current balances: the missing NAND / LATCH for ALL its
 * tape-outs are minted up front (one mint call per kind, so the protocol fee is paid once), then
 * the dependencies are taped out, then the design.
 */
export function planDesign(c: Compiled, have: Burn, p: Prices): DesignPlan {
  const todo = c.deps.filter((d) => d.circuitId === undefined)
  const sum = (k: 'nand' | 'latch') => todo.reduce((s, d) => s + d.netlist.counts[k], 0) + c.netlist.counts[k]
  const refs = (n: number) => Array.from({ length: n }, () => ({ cpu: '0x' as Hex, circuitId: 0n, nIns: 0, nOut: 0 }))
  const base = planTapeout({ nand: sum('nand'), latch: sum('latch'), refs: [] }, have, p)
  const tapeouts = [
    ...todo.map((d) => ({ label: d.label.name, netlist: d.netlist, hex: d.hex, dep: true })),
    { label: c.label.name, netlist: c.netlist, hex: c.hex, dep: false },
  ]
  const gas = tapeouts.reduce((g, t) => g + tapeoutGas({ nand: t.netlist.counts.nand, latch: t.netlist.counts.latch, refs: refs(t.netlist.counts.ref) }), 0n)
  const tapeoutValue = p.tapeoutFee * BigInt(tapeouts.length)
  return { ...base, tapeouts, tapeoutValue, total: base.mintValue + tapeoutValue, gas }
}

/** The circuit id minted by a tapeout() receipt. */
export function tapedOutId(receipt: TransactionReceipt, circuits: Address): bigint {
  const logs = receipt.logs.filter((l) => l.address.toLowerCase() === circuits.toLowerCase())
  const [ev] = parseEventLogs({ abi: circuitsAbi, eventName: 'TapedOut', logs })
  if (!ev) throw new Error(`no TapedOut event in ${receipt.transactionHash}`)
  return ev.args.circuitId
}

/** Adds a freshly taped-out circuit to an index built by indexByNetlist(). */
export function addToIndex(index: Map<string, bigint>, nl: Pick<Netlist, 'nIn' | 'nOut'>, hex: string, id: bigint) {
  const k = pinKey(nl.nIn, nl.nOut, hex)
  if (!index.has(k)) index.set(k, id)
}

// ------------------------------------------------------------------ simulator for onchain circuits

type ProgramCache = Map<string, Promise<Program>>

/**
 * Loads an onchain circuit into the local simulator, fetching every circuit it REFs (on any CPU)
 * recursively. Results are cached per (cpu, id), so repeated loads cost no RPC.
 */
export function loadProgram(pc: PublicClient, circuits: Address, id: bigint, cache: ProgramCache = new Map(), known?: ChainCircuit): Promise<Program> {
  const key = targetKey(circuits, id)
  const hit = cache.get(key)
  if (hit) return hit
  const p = (async () => {
    const [info, netlist] = known
      ? [[known.nIn, known.nOut] as const, known.netlist]
      : await Promise.all([
          pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'circuitInfo', args: [id] }),
          pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'netlist', args: [id] }),
        ])
    const [nIn, nOut] = info
    const elements = decode(netlist, nIn)
    const subs = new Map<string, Program>()
    for (const e of elements) {
      if (e.op !== 2 || isPlaceholder(e.target)) continue
      const t = e.target
      subs.set(targetKey(t.cpu, t.circuitId), await loadProgram(pc, t.cpu as Address, t.circuitId, cache))
    }
    return prepare(fromHex(netlist), nIn, nOut, (cpu, cid) => {
      const s = subs.get(targetKey(cpu, cid))
      if (!s) throw new Error(`REF ${cpu}#${cid} not loaded`)
      return s
    })
  })()
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  return p
}

/** Flattened gate count of a program (what circuitInfo().gateCount reports). */
export function flatGates(prog: Program): number {
  let n = 0
  for (const pe of prog.elements) n += pe.el.op === 2 ? flatGates(pe.sub!) : 1
  return n
}
