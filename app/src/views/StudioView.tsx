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
import { MAX_LABEL_NAME, byteLength, fitLabel, setLabelTx, type OnchainLabel } from '../lib/scope.ts'
import { fmt } from '../lib/format.ts'
import { DieShot } from '../components/DieShot.tsx'
import { SequenceTrace, TruthTable } from '../components/TruthTable.tsx'
import { Row, Seg } from '../components/ui.tsx'
import { useI18n, type Key } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'

type Tab = 'catalog' | 'neuron' | 'network'
type NetState = { nIn: number; hidden: NeuronSpec[]; out: NeuronSpec; compose: 'ref' | 'inline' }

const NET_PRESETS: Record<string, { label: string; labelKey?: Key; net: Omit<NetState, 'compose'> }> = {
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
    labelKey: 'st.exactlyOne',
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
  const { t, rich } = useI18n()
  const ct = useCircuitText()

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
        <h1>{rich('st.title', { em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{rich('st.lede')}</p>
      </section>
      <section className="grid-2 studio">
        <div className="card">
          <div className="card-head">
            <h2>{t('st.design')}</h2>
            <Seg
              value={tab}
              onChange={setTab}
              options={[
                ['catalog', t('st.tab.catalog')],
                ['neuron', t('st.tab.neuron')],
                ['network', t('st.tab.network')],
              ]}
              small
            />
          </div>
          {tab === 'catalog' && <CatalogPicker value={catalogId} onChange={setCatalogId} onChain={onChainIds} />}
          {tab === 'neuron' && <NeuronEditor spec={neuron} onChange={setNeuron} />}
          {tab === 'network' && <NetworkEditor net={net} onChange={setNet} />}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>{t('st.compiled')}</h2>
            <Seg
              value={mode}
              onChange={setMode}
              small
              options={[
                ['direct', t('st.direct')],
                ['buffered', t('st.buffered')],
              ]}
            />
          </div>
          {'error' in compiled ? (
            <div className="error small">{compiled.error}</div>
          ) : cpu ? (
            <CompiledPanel key={`${JSON.stringify(design)}|${mode}`} c={compiled.c!} cpu={cpu} design={design} mode={mode} />
          ) : (
            <div className="skeleton" style={{ height: 320 }} />
          )}
        </div>
      </section>
      {'c' in compiled && compiled.c && (
        <section className="card">
          <div className="card-head">
            <h2>{compiled.c.kind === 'sequential' ? t('st.clockTrace') : t('st.truthTable')}</h2>
            <span className="small muted">{t('st.sameSim')}</span>
          </div>
          {compiled.c.kind === 'sequential' ? (
            <SequenceTrace
              program={compiled.c.program}
              inputs={ct.pins(compiled.c.label.inputs)}
              outputs={ct.pins(compiled.c.label.outputs)}
              state={design.kind === 'catalog' ? getCircuit(design.id).state : undefined}
              sequence={SPIKES}
              referenceStep={design.kind === 'catalog' ? getCircuit(design.id).referenceStep : undefined}
            />
          ) : (
            <TruthTable program={compiled.c.program} inputs={ct.pins(compiled.c.label.inputs)} outputs={ct.pins(compiled.c.label.outputs)} reference={compiled.c.reference} />
          )}
        </section>
      )}
    </>
  )
}

function CatalogPicker({ value, onChange, onChain }: { value: string; onChange: (id: string) => void; onChain: Map<string, bigint> }) {
  const c = getCircuit(value)
  const { t } = useI18n()
  const ct = useCircuitText()
  return (
    <>
      <div className="catalog">
        {CATALOG.map((x) => {
          const nl = x.build({ mode: 'direct' })
          const id = onChain.get(x.id)
          return (
            <button key={x.id} className={`cat ${x.id === value ? 'on' : ''}`} onClick={() => onChange(x.id)}>
              <span className="cat-name">{ct.name(x.name)}</span>
              <span className="tiny muted mono">
                {x.inputs.length}→{x.outputs.length} · {nl.counts.ref ? `${nl.counts.ref} REF` : `${nl.counts.nand} NAND`}
                {nl.counts.latch ? ` +${nl.counts.latch} LATCH` : ''}
              </span>
              {id !== undefined && <span className="cat-live tiny">{t('st.onchainN', { id: id.toString() })}</span>}
            </button>
          )
        })}
      </div>
      <div className="cat-detail">
        <p className="small">{ct.description(c.description)}</p>
        <p className="small muted story-line">{ct.story(c.story)}</p>
        {c.deps.length > 0 && (
          <p className="tiny muted">
            {t('st.reuses', { names: c.deps.map((d) => ct.name(getCircuit(d).name)).join(t('st.listSep')) })}
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
  const tr = canon.trivial
  const { t } = useI18n()
  return (
    <div className="equation mono">
      y = [ {terms.replace(/^\+ /, '') || '0'} ≥ {spec.theta} ]
      {tr && (
        <span className="tiny muted">
          {' '}
          →{' '}
          {tr.kind === 'const'
            ? t('st.always', { v: tr.value })
            : tr.kind === 'wire'
              ? t('st.just', { x: inputs?.[tr.input] ?? `x${tr.input}` })
              : `NOT ${inputs?.[tr.input] ?? `x${tr.input}`}`}
        </span>
      )}
    </div>
  )
}

function NeuronEditor({ spec, onChange }: { spec: NeuronSpec; onChange: (s: NeuronSpec) => void }) {
  const n = spec.weights.length
  const { lo, hi } = thetaRange(spec.weights)
  const { t } = useI18n()
  const set = (weights: number[], theta = spec.theta) => {
    const r = thetaRange(weights)
    onChange({ weights, theta: Math.min(r.hi, Math.max(r.lo, theta)) })
  }
  return (
    <div className="editor">
      <p className="small muted">{t('st.neuronHelp')}</p>
      <div className="editor-row">
        <span className="small muted">{t('st.inputs')}</span>
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
        <span className="small muted">{t('st.threshold')}</span>
        <input type="range" min={lo} max={hi} step={1} value={spec.theta} onChange={(e) => set(spec.weights, Number(e.target.value))} />
        <span className="mono">{spec.theta}</span>
      </label>
      <Equation spec={spec} />
    </div>
  )
}

function NetworkEditor({ net, onChange }: { net: NetState; onChange: (n: NetState) => void }) {
  const hiddenLabels = net.hidden.map((_, i) => `h${i}`)
  const { t } = useI18n()
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
        <span className="small muted">{t('st.preset')}</span>
        <div className="chips">
          {Object.entries(NET_PRESETS).map(([k, p]) => (
            <button key={k} className="chip" onClick={() => onChange({ ...p.net, compose: net.compose })}>
              {p.labelKey ? t(p.labelKey) : p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="editor-row">
        <span className="small muted">{t('st.inputs')}</span>
        <div className="chips">
          {[2, 3, 4].map((k) => (
            <button key={k} className={`chip ${k === net.nIn ? 'on' : ''}`} onClick={() => setIn(k)}>
              {k}
            </button>
          ))}
        </div>
        <span className="small muted">{t('st.hidden')}</span>
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
        <span className="small muted">{t('st.wiring')}</span>
        <Seg
          value={net.compose}
          onChange={(compose) => onChange({ ...net, compose })}
          small
          options={[
            ['ref', t('st.wireRef')],
            ['inline', t('st.wireFlat')],
          ]}
        />
      </div>
      <p className="tiny muted">{t('st.refHelp')}</p>
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

type Naming = 'pending' | 'done' | 'failed' | 'skipped'

function CompiledPanel({ c, cpu, design, mode }: { c: Compiled; cpu: CpuState; design: Design; mode: OutputMode }) {
  const { chainId, cfg } = useNet()
  const { index, circuits } = useCircuits()
  const { isConnected } = useConnection()
  const { balances } = useBalances()
  const { send, busy } = useTx()
  const { push } = useToasts()
  const qc = useQueryClient()
  const { data: gasPrice } = useGasPrice({ chainId })
  const { t, rich } = useI18n()
  const ct = useCircuitText()
  const [progress, setProgress] = useState<{ step: number; of: number; done?: bigint } | undefined>()
  // The name written onchain (CerebrScope.setLabel) right after the tape-out. Editable before it.
  const [name, setName] = useState(c.label.name)
  const [naming, setNaming] = useState<{ state: Naming; label: OnchainLabel } | undefined>()
  const scope = cfg?.scope
  const nameBytes = byteLength(name.trim())
  const nameError = nameBytes > MAX_LABEL_NAME ? t('st.nameTooLong', { n: nameBytes, max: MAX_LABEL_NAME }) : undefined
  const have = balances ?? { nand: 0n, latch: 0n }
  const plan = planDesign(c, have, cpu)
  const flat = flatGates(c.program)
  const steps = [
    ...plan.mints.map((m) => t('st.stepMint', { n: m.amount, label: m.label })),
    ...plan.tapeouts.map((x) => t(x.dep ? 'st.stepTapeDep' : 'st.stepTape', { name: ct.name(x.label) })),
    ...(scope ? [t('st.stepName')] : []),
  ]
  const nameOf = (id: bigint) => circuits?.find((x) => x.id === id)?.label.name

  // Every exit refetches balances and the circuit index (awaited), so a retry plans from chain
  // state: no second mint for transistors already bought, no second tapeout of a landed dependency.
  async function stop() {
    await qc.invalidateQueries()
    setProgress(undefined)
  }

  /** CerebrScope.setLabel for the circuit just taped out. A rejection keeps the circuit: it can be retried or skipped. */
  async function nameIt(id: bigint, label: OnchainLabel) {
    if (!scope) return
    setNaming({ state: 'pending', label })
    const r = await send(t('st.nameTx', { id }), setLabelTx(scope, cpu.circuits, id, label))
    setNaming({ state: r ? 'done' : 'failed', label })
    if (r) setProgress((p) => (p ? { ...p, step: p.of } : p))
  }

  async function run() {
    if (!index || !balances || nameError) return
    const idx = new Map(index)
    let step = 0
    setProgress({ step, of: steps.length })
    for (const m of plan.mints) {
      const r = await send(t('st.stepMint', { n: m.amount, label: m.label }), mintTx(cpu.transistors, m.id === NAND_ID ? NAND_ID : LATCH_ID, m.amount, cpu.mintPrice, cpu.protocolFee), { refresh: false })
      if (!r) return stop()
      setProgress({ step: ++step, of: steps.length })
    }
    // Dependencies first; each one's id goes into the index so the next compile REFs it.
    for (const d of c.deps.filter((x) => x.circuitId === undefined)) {
      const r = await send(t('st.stepTape', { name: ct.name(d.label.name) }), tapeoutTx(cpu.circuits, d.hex, d.netlist.nIn, d.netlist.nOut, cpu.tapeoutFee), { refresh: false })
      if (!r) return stop()
      addToIndex(idx, d.netlist, d.hex, tapedOutId(r, cpu.circuits))
      setProgress({ step: ++step, of: steps.length })
    }
    const final = compileDesign(design, { mode, cpu: cpu.circuits, index: idx })
    if (!final.hex) {
      push({ kind: 'error', title: t('st.depMissing') })
      return stop()
    }
    const r = await send(t('st.stepTape', { name: ct.name(final.label.name) }), tapeoutTx(cpu.circuits, final.hex, final.netlist.nIn, final.netlist.nOut, cpu.tapeoutFee), { refresh: false })
    if (!r) return stop()
    const id = tapedOutId(r, cpu.circuits)
    setProgress({ step: ++step, of: steps.length, done: id })
    await qc.invalidateQueries()
    const base = labelFor(design, final.label)
    await nameIt(id, fitLabel({ ...base, name: name.trim() || base.name }, final.netlist.nIn, final.netlist.nOut))
  }

  return (
    <div className="compiled">
      <div className="compiled-top">
        <DieShot elements={c.netlist.elements} nIn={c.netlist.nIn} nOut={c.netlist.nOut} title={ct.name(c.label.name)} subtitle={mode === 'direct' ? t('st.directOut') : t('st.bufferedOut')} />
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
            <Row k={t('st.pins')} v={t('st.pinsV', { i: c.netlist.nIn, o: c.netlist.nOut })} />
            <Row k={t('st.flatGates')} v={flat} />
            <Row k={t('st.size')} v={c.hex ? t('st.sizeV', { n: (c.hex.length - 2) / 2 }) : t('st.afterDeps')} />
          </dl>
          {c.deps.length > 0 && (
            <div className="deps">
              <div className="tiny muted">{t('st.refDeps')}</div>
              {c.deps.map((d) => (
                <div key={d.placeholder} className="dep small">
                  <span>{ct.name((d.circuitId !== undefined && nameOf(d.circuitId)) || d.label.name)}</span>
                  {d.circuitId !== undefined ? (
                    <span className="pill on">{t('st.depOnchain', { id: d.circuitId.toString() })}</span>
                  ) : (
                    <span className="pill">{t('st.depFirst', { n: d.netlist.counts.nand })}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <dl className="quote">
        <Row k={t('st.burned')} v={`${plan.burn.nand} NAND${plan.burn.latch ? ` + ${plan.burn.latch} LATCH` : ''}`} />
        <Row k={t('st.youHold')} v={isConnected ? `${have.nand} NAND · ${have.latch} LATCH` : t('common.connectWallet')} />
        {plan.mints.map((m) => (
          <Row key={m.label} k={t('st.stepMint', { n: m.amount, label: m.label })} v={`${fmt(m.value, 6)} OKB`} />
        ))}
        <Row k={t('st.feeTimes', { n: plan.tapeouts.length })} v={`${fmt(plan.tapeoutValue, 6)} OKB`} />
        <Row k={t('st.total')} v={`${fmt(plan.total, 6)} OKB`} strong />
        <Row
          k={t('st.gas')}
          v={gasPrice ? `~${fmt(plan.gas * gasPrice, 3)} OKB · ${t('st.gasK', { k: (Number(plan.gas) / 1000).toFixed(0) })}` : t('st.gasK', { k: (Number(plan.gas) / 1000).toFixed(0) })}
        />
      </dl>
      {c.existing !== undefined && (
        <div className="banner info small">
          {rich('st.existing', { id: c.existing.toString(), a: (x) => <a href={href('playground', c.existing!)}>{x}</a> })}
        </div>
      )}
      {plan.blocked && <div className="error small">{plan.blockedBy ? t('st.blocked', { need: plan.blockedBy.need, remaining: plan.blockedBy.remaining }) : plan.blocked}</div>}
      {scope && progress?.done === undefined && (
        <label className="name-field">
          <span className="small muted">{t('st.nameLabel')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={c.label.name} disabled={!!progress} spellCheck={false} />
          <span className={`tiny mono ${nameError ? 'error' : 'muted'}`}>
            {nameError ?? t('st.nameHint', { n: nameBytes, max: MAX_LABEL_NAME })}
          </span>
        </label>
      )}
      {progress && (
        <ol className="steps small">
          {steps.map((s, i) => {
            const isNameStep = scope && i === steps.length - 1
            const skipped = isNameStep && naming?.state === 'skipped'
            const active = i === progress.step && (progress.done === undefined || (isNameStep && naming?.state !== 'done' && !skipped))
            return (
              <li key={s} className={i < progress.step ? 'done' : skipped ? 'skipped' : active ? 'active' : ''}>
                {s}
                {skipped ? t('st.skipped') : ''}
              </li>
            )
          })}
        </ol>
      )}
      {progress?.done !== undefined ? (
        <>
          <div className="done-row">
            <span className="ok">{t('st.done', { id: progress.done.toString() })}</span>
            <a className="btn primary small" href={href('playground', progress.done)}>
              {t('st.runIt')}
            </a>
          </div>
          {naming && <NamingStatus id={progress.done} naming={naming} busy={!!busy} onRetry={() => nameIt(progress.done!, naming.label)} onSkip={() => setNaming({ ...naming, state: 'skipped' })} />}
        </>
      ) : (
        <button className="btn primary big" disabled={!!busy || !!plan.blocked || !!nameError || !index || !balances || (!!progress && !progress.done)} onClick={run}>
          {busy ? busy + '…' : steps.length > 1 ? t('st.tapeN', { n: steps.length }) : t('st.tape1')}
        </button>
      )}
    </div>
  )
}

function NamingStatus({ id, naming, busy, onRetry, onSkip }: { id: bigint; naming: { state: Naming; label: OnchainLabel }; busy: boolean; onRetry: () => void; onSkip: () => void }) {
  const { t, rich } = useI18n()
  if (naming.state === 'pending') return <div className="banner info small">{t('st.namingPending', { id: id.toString(), name: naming.label.name })}</div>
  if (naming.state === 'done') return <div className="banner info small ok">{t('st.namingDone', { name: naming.label.name })}</div>
  if (naming.state === 'skipped')
    return <div className="banner info small muted">{rich('st.namingSkipped', { a: (x) => <a href={href('gallery')}>{x}</a> })}</div>
  return (
    <div className="banner info small naming-retry">
      <span>{t('st.namingFailed', { id: id.toString() })}</span>
      <span className="naming-actions">
        <button className="btn small primary" disabled={busy} onClick={onRetry}>
          {t('st.nameIt')}
        </button>
        <button className="btn small ghost" disabled={busy} onClick={onSkip}>
          {t('st.skip')}
        </button>
      </span>
    </div>
  )
}

function labelFor(design: Design, compiled: CircuitLabel): CircuitLabel {
  if (design.kind === 'catalog') return labelOfCatalog(getCircuit(design.id))
  if (design.kind === 'neuron') return labelOfNeuron({ weights: design.weights, theta: design.theta })
  return compiled
}
