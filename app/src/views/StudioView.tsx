import { useMemo, useState } from 'react'
import { useConnection, useGasPrice } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { CATALOG, canonicalNeuron, getCircuit, type NeuronSpec, type OutputMode } from '@cerebr/sdk'
import { LATCH_ID, NAND_ID } from '@cerebr/sdk/tapeout'
import { useBalances, useCircuits, useCpu, useNet, type CpuState } from '../hooks/useCpu.ts'
import { useTx } from '../hooks/useTx.ts'
import { useToasts } from '../hooks/useToasts.tsx'
import { href } from '../hooks/useRoute.ts'
import {
  addToIndex,
  compileDesign,
  flatGates,
  labelOfCatalog,
  labelOfNeuron,
  mintTx,
  planDesign,
  tapedOutId,
  tapeoutTx,
  type CircuitLabel,
  type Compiled,
  type Design,
} from '../lib/cerebr.ts'
import { saveLabel } from '../lib/labels.ts'
import { fmt } from '../lib/format.ts'
import { DieShot } from '../components/DieShot.tsx'
import { SequenceTrace, TruthTable } from '../components/TruthTable.tsx'
import { Row, Seg } from '../components/ui.tsx'

type Tab = 'catalog' | 'neuron' | 'network'
type NetState = { nIn: number; hidden: NeuronSpec[]; out: NeuronSpec; compose: 'ref' | 'inline' }

const NET_PRESETS: Record<string, { label: string; net: Omit<NetState, 'compose'> }> = {
  xor: {
    label: 'XOR',
    net: { nIn: 2, hidden: [{ weights: [1, 1], theta: 1 }, { weights: [-1, -1], theta: -1 }], out: { weights: [1, 1], theta: 2 } },
  },
  xnor: {
    label: 'XNOR',
    net: { nIn: 2, hidden: [{ weights: [1, 1], theta: 2 }, { weights: [-1, -1], theta: 0 }], out: { weights: [1, 1], theta: 1 } },
  },
  exactlyOne: {
    label: 'Exactly one of 3',
    net: { nIn: 3, hidden: [{ weights: [1, 1, 1], theta: 1 }, { weights: [-1, -1, -1], theta: -1 }], out: { weights: [1, 1], theta: 2 } },
  },
}

/** Spike pattern for the integrate-and-fire preview: [spike, inhibit] per clock step. */
const SPIKES = [[1, 0], [1, 0], [1, 0], [0, 0], [1, 0], [1, 0], [0, 1], [1, 0], [1, 0], [1, 0]]

export function StudioView({ initial }: { initial?: string }) {
  const { cpu } = useCpu()
  const { cfg } = useNet()
  const { index, circuits } = useCircuits()
  const start = initial
  const [tab, setTab] = useState<Tab>('catalog')
  const [catalogId, setCatalogId] = useState(start && CATALOG.some((c) => c.id === start) ? start : 'xor-net')
  const [neuron, setNeuron] = useState<NeuronSpec>({ weights: [1, 1, 1, -1], theta: 2 })
  const [net, setNet] = useState<NetState>({ ...NET_PRESETS.xor.net, compose: 'ref' })
  const [mode, setMode] = useState<OutputMode>('direct')

  const design: Design = useMemo(
    () =>
      tab === 'catalog'
        ? { kind: 'catalog', id: catalogId }
        : tab === 'neuron'
          ? { kind: 'neuron', weights: neuron.weights, theta: neuron.theta }
          : { kind: 'network', nIn: net.nIn, layers: [net.hidden, [net.out]], compose: net.compose },
    [tab, catalogId, neuron, net],
  )
  const compiled = useMemo(() => {
    try {
      return { c: compileDesign(design, { mode, cpu: cfg?.circuits, index }) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [design, mode, cfg?.circuits, index])

  const onChainIds = useMemo(() => {
    const m = new Map<string, bigint>()
    for (const c of circuits ?? []) if (c.label.catalogId && !m.has(c.label.catalogId)) m.set(c.label.catalogId, c.id)
    return m
  }, [circuits])

  return (
    <>
      <section className="hero">
        <h1>
          Circuit Studio: <span className="grad">neurons to NAND.</span>
        </h1>
        <p className="muted">
          Pick a neural circuit or design a threshold neuron. Cerebr compiles it to a TapeOut netlist, simulates every input
          pattern locally, and tapes it out on the processor: one NAND transistor burned per gate, and nothing for circuits
          reused by REF.
        </p>
      </section>
      <section className="grid-2 studio">
        <div className="card">
          <div className="card-head">
            <h2>Design</h2>
            <Seg value={tab} onChange={setTab} options={[['catalog', 'Catalog'], ['neuron', 'Neuron'], ['network', 'Network']]} small />
          </div>
          {tab === 'catalog' && <CatalogPicker value={catalogId} onChange={setCatalogId} onChain={onChainIds} />}
          {tab === 'neuron' && <NeuronEditor spec={neuron} onChange={setNeuron} />}
          {tab === 'network' && <NetworkEditor net={net} onChange={setNet} />}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Compiled netlist</h2>
            <Seg
              value={mode}
              onChange={setMode}
              small
              options={[
                ['direct', 'Direct'],
                ['buffered', 'Buffered'],
              ]}
            />
          </div>
          {'error' in compiled ? (
            <div className="error small">{compiled.error}</div>
          ) : cpu ? (
            <CompiledPanel c={compiled.c!} cpu={cpu} design={design} mode={mode} />
          ) : (
            <div className="skeleton" style={{ height: 320 }} />
          )}
        </div>
      </section>
      {'c' in compiled && compiled.c && (
        <section className="card">
          <div className="card-head">
            <h2>{compiled.c.kind === 'sequential' ? 'Clock trace (local simulator)' : 'Truth table (local simulator)'}</h2>
            <span className="small muted">the same simulator as TapeOut's client, run on the exact bytes that get taped out</span>
          </div>
          {compiled.c.kind === 'sequential' ? (
            <SequenceTrace
              program={compiled.c.program}
              inputs={compiled.c.label.inputs}
              outputs={compiled.c.label.outputs}
              state={design.kind === 'catalog' ? getCircuit(design.id).state : undefined}
              sequence={SPIKES}
              referenceStep={design.kind === 'catalog' ? getCircuit(design.id).referenceStep : undefined}
            />
          ) : (
            <TruthTable program={compiled.c.program} inputs={compiled.c.label.inputs} outputs={compiled.c.label.outputs} reference={compiled.c.reference} />
          )}
        </section>
      )}
    </>
  )
}

function CatalogPicker({ value, onChange, onChain }: { value: string; onChange: (id: string) => void; onChain: Map<string, bigint> }) {
  const c = getCircuit(value)
  return (
    <>
      <div className="catalog">
        {CATALOG.map((x) => {
          const nl = x.build({ mode: 'direct' })
          const id = onChain.get(x.id)
          return (
            <button key={x.id} className={`cat ${x.id === value ? 'on' : ''}`} onClick={() => onChange(x.id)}>
              <span className="cat-name">{x.name}</span>
              <span className="tiny muted mono">
                {x.inputs.length}→{x.outputs.length} · {nl.counts.ref ? `${nl.counts.ref} REF` : `${nl.counts.nand} NAND`}
                {nl.counts.latch ? ` +${nl.counts.latch} LATCH` : ''}
              </span>
              {id !== undefined && <span className="cat-live tiny">on chain #{id.toString()}</span>}
            </button>
          )
        })}
      </div>
      <div className="cat-detail">
        <p className="small">{c.description}</p>
        <p className="small muted story-line">{c.story}</p>
        {c.deps.length > 0 && (
          <p className="tiny muted">
            Reuses by REF: {c.deps.map((d) => getCircuit(d).name).join(', ')}. Missing ones are taped out first.
          </p>
        )}
      </div>
    </>
  )
}

const W: readonly (readonly [string, string])[] = [
  ['-1', '−1'],
  ['0', '0'],
  ['1', '+1'],
]

function WeightRow({ label, w, onChange }: { label: string; w: number; onChange: (w: number) => void }) {
  return (
    <div className="weight">
      <span className="mono small">{label}</span>
      <Seg value={String(w)} onChange={(v) => onChange(Number(v))} options={W} small />
    </div>
  )
}

function thetaRange(weights: number[]) {
  const lo = weights.reduce((a, w) => a + Math.min(0, w), 0)
  const hi = weights.reduce((a, w) => a + Math.max(0, w), 0)
  return { lo, hi: hi + 1 }
}

function Equation({ spec, inputs }: { spec: NeuronSpec; inputs?: string[] }) {
  const terms = spec.weights
    .map((w, i) => (w === 0 ? '' : `${w > 0 ? '+' : '−'} ${inputs?.[i] ?? `x${i}`}`))
    .filter(Boolean)
    .join(' ')
  const canon = canonicalNeuron(spec)
  const t = canon.trivial
  return (
    <div className="equation mono">
      y = [ {terms.replace(/^\+ /, '') || '0'} ≥ {spec.theta} ]
      {t && (
        <span className="tiny muted">
          {' '}
          → {t.kind === 'const' ? `always ${t.value}` : t.kind === 'wire' ? `just ${inputs?.[t.input] ?? `x${t.input}`}` : `NOT ${inputs?.[t.input] ?? `x${t.input}`}`}
        </span>
      )}
    </div>
  )
}

function NeuronEditor({ spec, onChange }: { spec: NeuronSpec; onChange: (s: NeuronSpec) => void }) {
  const n = spec.weights.length
  const { lo, hi } = thetaRange(spec.weights)
  const set = (weights: number[], theta = spec.theta) => {
    const r = thetaRange(weights)
    onChange({ weights, theta: Math.min(r.hi, Math.max(r.lo, theta)) })
  }
  return (
    <div className="editor">
      <p className="small muted">
        A binarized threshold neuron: each synapse is excitatory (+1), inhibitory (−1) or absent (0). It fires when the
        weighted sum of its inputs reaches θ.
      </p>
      <div className="editor-row">
        <span className="small muted">Inputs</span>
        <div className="chips">
          {[2, 3, 4, 5, 6].map((k) => (
            <button key={k} className={`chip ${k === n ? 'on' : ''}`} onClick={() => set(Array.from({ length: k }, (_, i) => spec.weights[i] ?? 1))}>
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="weights">
        {spec.weights.map((w, i) => (
          <WeightRow key={i} label={`x${i}`} w={w} onChange={(v) => set(spec.weights.map((x, j) => (j === i ? v : x)))} />
        ))}
      </div>
      <label className="theta">
        <span className="small muted">Threshold θ</span>
        <input type="range" min={lo} max={hi} step={1} value={spec.theta} onChange={(e) => set(spec.weights, Number(e.target.value))} />
        <span className="mono">{spec.theta}</span>
      </label>
      <Equation spec={spec} />
    </div>
  )
}

function NetworkEditor({ net, onChange }: { net: NetState; onChange: (n: NetState) => void }) {
  const hiddenLabels = net.hidden.map((_, i) => `h${i}`)
  const setHidden = (hidden: NeuronSpec[]) => {
    const weights = hidden.map((_, i) => net.out.weights[i] ?? 1)
    const r = thetaRange(weights)
    onChange({ ...net, hidden, out: { weights, theta: Math.min(r.hi, Math.max(r.lo, net.out.theta)) } })
  }
  const setNeuron = (i: number, s: NeuronSpec) => setHidden(net.hidden.map((h, j) => (j === i ? s : h)))
  const setIn = (nIn: number) =>
    setHidden(net.hidden.map((h) => clampTheta({ weights: Array.from({ length: nIn }, (_, i) => h.weights[i] ?? 0), theta: h.theta })))
  return (
    <div className="editor">
      <div className="editor-row">
        <span className="small muted">Preset</span>
        <div className="chips">
          {Object.entries(NET_PRESETS).map(([k, p]) => (
            <button key={k} className="chip" onClick={() => onChange({ ...p.net, compose: net.compose })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="editor-row">
        <span className="small muted">Inputs</span>
        <div className="chips">
          {[2, 3, 4].map((k) => (
            <button key={k} className={`chip ${k === net.nIn ? 'on' : ''}`} onClick={() => setIn(k)}>
              {k}
            </button>
          ))}
        </div>
        <span className="small muted">Hidden</span>
        <div className="chips">
          {[1, 2, 3, 4].map((k) => (
            <button
              key={k}
              className={`chip ${k === net.hidden.length ? 'on' : ''}`}
              onClick={() => setHidden(Array.from({ length: k }, (_, i) => net.hidden[i] ?? { weights: Array(net.nIn).fill(1), theta: 1 }))}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="layer">
        {net.hidden.map((h, i) => (
          <MiniNeuron key={i} name={`h${i}`} spec={h} inputs={Array.from({ length: net.nIn }, (_, j) => `x${j}`)} onChange={(s) => setNeuron(i, s)} />
        ))}
      </div>
      <div className="layer out">
        <MiniNeuron name="y" spec={net.out} inputs={hiddenLabels} onChange={(out) => onChange({ ...net, out })} />
      </div>
      <div className="editor-row">
        <span className="small muted">Wiring</span>
        <Seg
          value={net.compose}
          onChange={(compose) => onChange({ ...net, compose })}
          small
          options={[
            ['ref', 'REF taped-out neurons'],
            ['inline', 'Flatten to NAND'],
          ]}
        />
      </div>
      <p className="tiny muted">
        REF wiring reuses neuron circuits already on the processor (0 transistors each) and tapes out the missing ones first.
        Identical neurons share one circuit.
      </p>
    </div>
  )
}

function clampTheta(s: NeuronSpec): NeuronSpec {
  const r = thetaRange(s.weights)
  return { weights: s.weights, theta: Math.min(r.hi, Math.max(r.lo, s.theta)) }
}

function MiniNeuron({ name, spec, inputs, onChange }: { name: string; spec: NeuronSpec; inputs: string[]; onChange: (s: NeuronSpec) => void }) {
  const { lo, hi } = thetaRange(spec.weights)
  return (
    <div className="mini-neuron">
      <div className="mini-head">
        <b className="mono">{name}</b>
        <Equation spec={spec} inputs={inputs} />
      </div>
      <div className="mini-weights">
        {spec.weights.map((w, i) => (
          <WeightRow key={i} label={inputs[i]} w={w} onChange={(v) => onChange(clampTheta({ weights: spec.weights.map((x, j) => (j === i ? v : x)), theta: spec.theta }))} />
        ))}
      </div>
      <label className="theta">
        <span className="tiny muted">θ</span>
        <input type="range" min={lo} max={hi} step={1} value={spec.theta} onChange={(e) => onChange({ ...spec, theta: Number(e.target.value) })} />
        <span className="mono small">{spec.theta}</span>
      </label>
    </div>
  )
}

function CompiledPanel({ c, cpu, design, mode }: { c: Compiled; cpu: CpuState; design: Design; mode: OutputMode }) {
  const { chainId } = useNet()
  const { index } = useCircuits()
  const { isConnected } = useConnection()
  const { balances } = useBalances()
  const { send, busy } = useTx()
  const { push } = useToasts()
  const qc = useQueryClient()
  const { data: gasPrice } = useGasPrice({ chainId })
  const [progress, setProgress] = useState<{ step: number; of: number; done?: bigint } | undefined>()
  const have = balances ?? { nand: 0n, latch: 0n }
  const plan = planDesign(c, have, cpu)
  const flat = flatGates(c.program)
  const steps = [...plan.mints.map((m) => `Mint ${m.amount} ${m.label}`), ...plan.tapeouts.map((t) => `Tape out ${t.label}${t.dep ? ' (dependency)' : ''}`)]

  async function run() {
    if (!index) return
    const idx = new Map(index)
    let step = 0
    setProgress({ step, of: steps.length })
    for (const m of plan.mints) {
      const r = await send(`Mint ${m.amount} ${m.label}`, mintTx(cpu.transistors, m.id === NAND_ID ? NAND_ID : LATCH_ID, m.amount, cpu.mintPrice, cpu.protocolFee), { refresh: false })
      if (!r) return setProgress(undefined)
      setProgress({ step: ++step, of: steps.length })
    }
    // Dependencies first; each one's id goes into the index so the next compile REFs it.
    for (const d of c.deps.filter((x) => x.circuitId === undefined)) {
      const r = await send(`Tape out ${d.label.name}`, tapeoutTx(cpu.circuits, d.hex, d.netlist.nIn, d.netlist.nOut, cpu.tapeoutFee), { refresh: false })
      if (!r) return setProgress(undefined)
      const id = tapedOutId(r, cpu.circuits)
      addToIndex(idx, d.netlist, d.hex, id)
      saveLabel(chainId, cpu.circuits, id, d.label)
      setProgress({ step: ++step, of: steps.length })
    }
    const final = compileDesign(design, { mode, cpu: cpu.circuits, index: idx })
    if (!final.hex) {
      push({ kind: 'error', title: 'A dependency is still missing on chain' })
      return setProgress(undefined)
    }
    const r = await send(`Tape out ${final.label.name}`, tapeoutTx(cpu.circuits, final.hex, final.netlist.nIn, final.netlist.nOut, cpu.tapeoutFee), { refresh: false })
    if (!r) return setProgress(undefined)
    const id = tapedOutId(r, cpu.circuits)
    saveLabel(chainId, cpu.circuits, id, labelFor(design, final.label))
    setProgress({ step: ++step, of: steps.length, done: id })
    await qc.invalidateQueries()
  }

  return (
    <div className="compiled">
      <div className="compiled-top">
        <DieShot elements={c.netlist.elements} nIn={c.netlist.nIn} nOut={c.netlist.nOut} title={c.label.name} subtitle={mode === 'direct' ? 'direct outputs' : 'buffered outputs'} />
        <div className="compiled-stats">
          <div className="counts">
            <span className="count nand">
              <b>{c.netlist.counts.nand}</b> NAND
            </span>
            {c.netlist.counts.latch > 0 && (
              <span className="count latch">
                <b>{c.netlist.counts.latch}</b> LATCH
              </span>
            )}
            {c.netlist.counts.ref > 0 && (
              <span className="count ref">
                <b>{c.netlist.counts.ref}</b> REF
              </span>
            )}
          </div>
          <dl className="quote">
            <Row k="Pins" v={`${c.netlist.nIn} in → ${c.netlist.nOut} out`} />
            <Row k="Flattened gates" v={flat} />
            <Row k="Netlist size" v={c.hex ? `${(c.hex.length - 2) / 2} bytes` : 'after deps'} />
          </dl>
          {c.deps.length > 0 && (
            <div className="deps">
              <div className="tiny muted">REF dependencies</div>
              {c.deps.map((d) => (
                <div key={d.placeholder} className="dep small">
                  <span>{d.label.name}</span>
                  {d.circuitId !== undefined ? (
                    <span className="pill on">#{d.circuitId.toString()} on chain</span>
                  ) : (
                    <span className="pill">tape out first · {d.netlist.counts.nand} NAND</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <dl className="quote">
        <Row k="Transistors burned" v={`${plan.burn.nand} NAND${plan.burn.latch ? ` + ${plan.burn.latch} LATCH` : ''}`} />
        <Row k="You hold" v={isConnected ? `${have.nand} NAND · ${have.latch} LATCH` : 'connect a wallet'} />
        {plan.mints.map((m) => (
          <Row key={m.label} k={`Mint ${m.amount} ${m.label}`} v={`${fmt(m.value, 6)} OKB`} />
        ))}
        <Row k={`Tape-out fee × ${plan.tapeouts.length}`} v={`${fmt(plan.tapeoutValue, 6)} OKB`} />
        <Row k="Total (msg.value)" v={`${fmt(plan.total, 6)} OKB`} strong />
        <Row k="Network gas (est.)" v={gasPrice ? `~${fmt(plan.gas * gasPrice, 3)} OKB · ${(Number(plan.gas) / 1000).toFixed(0)}k gas` : `${(Number(plan.gas) / 1000).toFixed(0)}k gas`} />
      </dl>
      {c.existing !== undefined && (
        <div className="banner info small">
          This exact netlist is already taped out as <a href={href('playground', c.existing)}>#{c.existing.toString()}</a>. You can still tape out
          your own copy.
        </div>
      )}
      {plan.blocked && <div className="error small">{plan.blocked}</div>}
      {progress && (
        <ol className="steps small">
          {steps.map((s, i) => (
            <li key={s} className={i < progress.step ? 'done' : i === progress.step && !progress.done ? 'active' : ''}>
              {s}
            </li>
          ))}
        </ol>
      )}
      {progress?.done !== undefined ? (
        <div className="done-row">
          <span className="ok">✓ Taped out as circuit #{progress.done.toString()}</span>
          <a className="btn primary small" href={href('playground', progress.done)}>
            Run it on-chain →
          </a>
        </div>
      ) : (
        <button className="btn primary big" disabled={!!busy || !!plan.blocked || !index || (!!progress && !progress.done)} onClick={run}>
          {busy ? busy + '…' : steps.length > 1 ? `Tape out (${steps.length} transactions)` : 'Tape out'}
        </button>
      )}
    </div>
  )
}

function labelFor(design: Design, compiled: CircuitLabel): CircuitLabel {
  if (design.kind === 'catalog') return labelOfCatalog(getCircuit(design.id))
  if (design.kind === 'neuron') return labelOfNeuron({ weights: design.weights, theta: design.theta })
  return compiled
}
