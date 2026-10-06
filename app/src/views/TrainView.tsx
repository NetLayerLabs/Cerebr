import { useCallback, useMemo, useRef, useState } from 'react'
import { TRAINING_PRESETS, compileTrained, predict, trainNetwork, type Example, type TrainedNetwork, type TrainingPreset } from '@cerebr/sdk'
import { useCircuits, useCpu, useNet } from '../hooks/useCpu.ts'
import { compileDesign } from '../lib/cerebr.ts'
import {
  SHAPES,
  bitsKey,
  blank,
  conflicts,
  designOf,
  findPreset,
  fires,
  inputLabels,
  nInOf,
  presetShape,
  shapeId,
  shapeOf,
  signature,
  toExamples,
  trainedLabel,
  type Item,
  type Shape,
} from '../lib/train.ts'
import { DieShot } from '../components/DieShot.tsx'
import { TapeoutFlow } from '../components/TapeoutFlow.tsx'
import { Pad, Thumb, WeightMap } from '../components/train/parts.tsx'
import { Row } from '../components/ui.tsx'
import { useI18n, type Key } from '../i18n/index.tsx'
import './train.css'

const DEFAULT_PRESET = 'diagonal'

type Model = { net: TrainedNetwork; ms: number; sig: string; shape: Shape }

let nextId = 1
const itemsOf = (ex: readonly Example[]): Item[] => ex.map((e) => ({ id: nextId++, x: [...e.x], y: e.y }))

/**
 * §03 Train (#train[/<presetId>]): draw examples on a pixel grid (or bit pins), file them as Fires /
 * Silent, train a threshold network in the browser (trainNetwork, prefer 'robust'), try it on new
 * drawings and the preset's held-out set, compile it to NAND (compileTrained verifies the netlist on
 * every input), then tape it out with the Studio's flow (TapeoutFlow) and run it onchain.
 */
export function TrainView({ arg }: { arg?: string }) {
  const { t, rich } = useI18n()
  const first = findPreset(arg) ?? findPreset(DEFAULT_PRESET)!
  const [preset, setPreset] = useState<TrainingPreset | undefined>(first)
  const [shape, setShape] = useState<Shape>(presetShape(first))
  const [items, setItems] = useState<Item[]>(() => itemsOf(first.examples))
  const [heldOut, setHeldOut] = useState<Example[]>(first.heldOut)
  const [pad, setPad] = useState<number[]>(() => blank(presetShape(first)))
  const [tryPad, setTryPad] = useState<number[]>(() => first.heldOut[0]?.x ?? blank(presetShape(first)))
  const [model, setModel] = useState<Model | undefined>()
  const [trainError, setTrainError] = useState<string | undefined>()
  const [locked, setLocked] = useState(false)
  const onRunning = useCallback((r: boolean) => setLocked(r), [])
  const modelRef = useRef<HTMLDivElement>(null)

  const labels = useMemo(() => inputLabels(shape), [shape])
  const sig = useMemo(() => signature(items), [items])
  const clash = useMemo(() => conflicts(items), [items])
  const nFire = items.filter((e) => e.y === 1).length
  const nSilent = items.length - nFire
  const stale = !!model && model.sig !== sig
  const padKey = bitsKey(pad)
  const inBucket = (y: 0 | 1) => items.some((e) => e.y === y && bitsKey(e.x) === padKey)

  function loadPreset(id: string) {
    const p = findPreset(id)
    if (locked) return
    if (!p) {
      setPreset(undefined)
      setItems([])
      setHeldOut([])
      setModel(undefined)
      setPad(blank(shape))
      setTryPad(blank(shape))
      replaceHash()
      return
    }
    const s = presetShape(p)
    setPreset(p)
    setShape(s)
    setItems(itemsOf(p.examples))
    setHeldOut(p.heldOut)
    setPad(blank(s))
    setTryPad(p.heldOut[0]?.x ?? blank(s))
    setModel(undefined)
    setTrainError(undefined)
    replaceHash(p.id)
  }

  function changeShape(id: string) {
    const s = shapeOf(id)
    if (locked || shapeId(s) === shapeId(shape)) return
    setShape(s)
    setPreset(undefined)
    setItems([])
    setHeldOut([])
    setModel(undefined)
    setTrainError(undefined)
    setPad(blank(s))
    setTryPad(blank(s))
    replaceHash()
  }

  const add = (y: 0 | 1) => {
    if (inBucket(y)) return
    setItems((xs) => [...xs, { id: nextId++, x: [...pad], y }])
  }

  function train() {
    if (locked || !nFire || !nSilent) return
    setTrainError(undefined)
    try {
      const t0 = performance.now()
      const net = trainNetwork(toExamples(items), { prefer: 'robust' })
      setModel({ net, ms: performance.now() - t0, sig, shape })
      requestAnimationFrame(() => {
        const el = modelRef.current
        if (el && el.getBoundingClientRect().top > window.innerHeight * 0.8) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <section className="hero">
        <h1>{rich('train.title', { em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{t('train.lede')}</p>
      </section>

      <section className="train-grid">
        {/* ---------------------------------------------------------------- examples */}
        <div className="card train-examples">
          <div className="card-head">
            <h2>{t('train.examples')}</h2>
            <select className="select train-preset" value={preset?.id ?? ''} onChange={(e) => loadPreset(e.target.value)} disabled={locked} aria-label={t('train.preset')}>
              <option value="">{t('train.presetBlank')}</option>
              {TRAINING_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`train.p.${p.id}` as Key)}
                </option>
              ))}
            </select>
          </div>
          {preset && <p className="small muted train-desc">{t(`train.p.${preset.id}.d` as Key)}</p>}
          <div className="editor-row train-shape">
            <span className="small muted">{t('train.inputs')}</span>
            <div className="chips">
              {SHAPES.map(({ id, shape: s }) => (
                <button key={id} className={`chip ${id === shapeId(shape) ? 'on' : ''}`} onClick={() => changeShape(id)} disabled={locked}>
                  {s.kind === 'grid' ? `${s.rows}×${s.cols}` : t('train.nBits', { n: s.n })}
                </button>
              ))}
            </div>
          </div>
          <div className="train-draw">
            <Pad shape={shape} bits={pad} onChange={setPad} labels={labels} />
            <div className="train-draw-side">
              <p className="small muted">{shape.kind === 'grid' ? t('train.padHelp') : t('train.padHelpBits')}</p>
              <div className="train-add">
                <button className="btn small train-add-fire" onClick={() => add(1)} disabled={inBucket(1)} title={inBucket(1) ? t('train.inFire') : undefined}>
                  {t('train.addFire')}
                </button>
                <button className="btn small train-add-silent" onClick={() => add(0)} disabled={inBucket(0)} title={inBucket(0) ? t('train.inSilent') : undefined}>
                  {t('train.addSilent')}
                </button>
              </div>
              <div className="train-add">
                <button className="btn small ghost" onClick={() => setPad(blank(shape))}>
                  {t('train.clear')}
                </button>
                <button className="btn small ghost" onClick={() => setPad(pad.map((v) => (v ? 0 : 1)))}>
                  {t('train.invert')}
                </button>
              </div>
              {(inBucket(1) || inBucket(0)) && <span className="tiny muted">{inBucket(1) ? t('train.inFire') : t('train.inSilent')}</span>}
            </div>
          </div>
          <div className="train-buckets">
            {([1, 0] as const).map((y) => {
              const list = items.filter((e) => e.y === y)
              return (
                <div key={y} className={`train-bucket ${y ? 'fire' : 'silent'}`}>
                  <div className="train-bucket-head">
                    <span className="train-dot" />
                    <span>{y ? t('train.fire') : t('train.silent')}</span>
                    <span className="mono muted">{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="tiny muted train-empty">{y ? t('train.emptyFire') : t('train.emptySilent')}</p>
                  ) : (
                    <ul className="train-thumbs">
                      {list.map((e) => (
                        <li key={e.id} className={clash.has(bitsKey(e.x)) ? 'clash' : ''}>
                          <button className="train-thumb-btn" onClick={() => setPad([...e.x])} title={t('train.load')} aria-label={t('train.load')}>
                            <Thumb shape={shape} bits={e.x} />
                          </button>
                          <button className="train-x" onClick={() => setItems((xs) => xs.filter((x) => x.id !== e.id))} title={t('train.remove')} aria-label={t('train.remove')}>
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          {clash.size > 0 && <div className="banner warn small train-banner">{t('train.conflict', { n: clash.size })}</div>}
          {items.length > 0 && (
            <div className="train-foot">
              <button className="btn small ghost" onClick={() => !locked && (setItems([]), setModel(undefined))} disabled={locked}>
                {t('train.clearAll')}
              </button>
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- model */}
        <div className="card train-model" ref={modelRef}>
          <div className="card-head">
            <h2>{t('train.model')}</h2>
            <span className="tiny muted mono">{t('train.mode')}</span>
          </div>
          <button className="btn primary big train-go" onClick={train} disabled={locked || !nFire || !nSilent}>
            {!model ? t('train.train', { n: items.length }) : stale ? t('train.retrainOn', { n: items.length }) : t('train.retrain')}
          </button>
          {(!nFire || !nSilent) && <p className="small muted">{t('train.needBoth')}</p>}
          {trainError && <div className="error small">{trainError}</div>}
          {!model ? (
            <p className="small muted train-intro">{t('train.intro')}</p>
          ) : (
            <ModelPanel m={model} stale={stale} tryBits={tryPad} />
          )}
        </div>
      </section>

      <section className="train-grid">
        {/* ---------------------------------------------------------------- try it */}
        <div className="card train-try">
          <div className="card-head">
            <h2>{t('train.try')}</h2>
            {model && <span className="tiny muted">{t('train.tryLive')}</span>}
          </div>
          <TryPanel model={model} shape={shape} labels={labels} bits={tryPad} setBits={setTryPad} heldOut={heldOut} />
        </div>

        {/* ---------------------------------------------------------------- compile + tape out */}
        <div className="card train-compile">
          <div className="card-head">
            <h2>{t('train.compile')}</h2>
          </div>
          {model ? <CompilePanel m={model} items={items} preset={preset} stale={stale} locked={locked} onRunning={onRunning} /> : <p className="small muted">{t('train.compileFirst')}</p>}
        </div>
      </section>
    </>
  )
}

/** Keep the URL shareable (#train/<preset>) without a hashchange (which would remount the view). */
function replaceHash(id?: string) {
  const h = id ? `#train/${id}` : '#train'
  if (window.location.hash !== h) window.history.replaceState(window.history.state, '', h)
}

const METHOD: Record<TrainedNetwork['neuron']['method'], Key> = {
  exact: 'train.m.exact',
  perceptron: 'train.m.perceptron',
  'local-search': 'train.m.local',
}

function ModelPanel({ m, stale, tryBits }: { m: Model; stale: boolean; tryBits: number[] }) {
  const { t } = useI18n()
  const { net, shape } = m
  const pct = Math.round(net.accuracy * 1000) / 10
  const margin = Math.floor(net.margin)
  const grid = shape.kind === 'grid'
  const hidden = net.structure === 'single' ? [] : net.layers[0]
  const out = net.layers[net.layers.length - 1][0]
  const sameShape = tryBits.length === net.nIn
  return (
    <div className={`train-result ${stale ? 'stale' : ''}`}>
      {stale && <div className="banner warn small">{t('train.stale')}</div>}
      <div className="train-badges">
        <span className="badge train-badge">{t(METHOD[net.neuron.method])}</span>
        {net.neuron.exhaustive && <span className="badge train-badge good">{t('train.proven')}</span>}
        <span className="badge train-badge">{net.structure === 'single' ? t('train.arch1') : t('train.arch2', { k: net.hidden, out: net.structure.toUpperCase() })}</span>
      </div>
      <dl className="quote">
        <Row k={t('train.accuracy')} v={t('train.accuracyV', { pct, errors: net.errors })} strong={net.converged} />
        <Row
          k={t('train.margin')}
          v={
            net.converged
              ? margin > 1
                ? margin === 2
                  ? t(grid ? 'train.toleratesOne' : 'train.toleratesBitsOne', { m: margin })
                  : t(grid ? 'train.tolerates' : 'train.toleratesBits', { n: margin - 1, m: margin })
                : t(grid ? 'train.marginOne' : 'train.marginOneBits')
              : '-'
          }
        />
        <Row k={t('train.time')} v={t('train.ms', { ms: m.ms < 1 ? '<1' : Math.round(m.ms) })} />
      </dl>
      {!net.converged && <div className="banner warn small">{t('train.notConverged', { n: net.errors })}</div>}
      {net.structure !== 'single' && (
        <div className="train-xor">
          <div className="train-xor-head">{t('train.xorTitle')}</div>
          <p className="small">
            {net.separable === false ? t('train.xorProven') : t('train.xorUnproven')} {t(net.structure === 'or' ? 'train.xorOr' : 'train.xorNor', { k: net.hidden })}
          </p>
        </div>
      )}
      <div className="train-weights-head">
        <span className="tiny muted">{t('train.weights')}</span>
        <span className="train-legend tiny">
          <span>
            <i className="pos" />
            {t('train.wPos')}
          </span>
          <span>
            <i className="zero" />
            {t('train.wZero')}
          </span>
          <span>
            <i className="neg" />
            {t('train.wNeg')}
          </span>
        </span>
      </div>
      {net.structure === 'single' ? (
        <div className="train-neurons">
          <WeightMap shape={shape} spec={out} name="y" active={sameShape && !stale ? fires(out, tryBits) : undefined} />
        </div>
      ) : (
        <>
          <div className="train-neurons">
            {hidden.map((h, i) => (
              <WeightMap key={i} shape={shape} spec={h} name={`h${i}`} active={sameShape && !stale ? fires(h, tryBits) : undefined} />
            ))}
          </div>
          <div className="train-out mono small">
            <span className="train-out-op">{net.structure.toUpperCase()}</span>
            <span className="muted">({hidden.map((_, i) => `h${i}`).join(', ')})</span>
            <span className="muted tiny">{t(net.structure === 'or' ? 'train.outOr' : 'train.outNor')}</span>
          </div>
        </>
      )}
      {sameShape && !stale && <p className="tiny muted">{t('train.litHint')}</p>}
    </div>
  )
}

function TryPanel({ model, shape, labels, bits, setBits, heldOut }: { model?: Model; shape: Shape; labels: string[]; bits: number[]; setBits: (b: number[]) => void; heldOut: Example[] }) {
  const { t } = useI18n()
  const live = model && model.net.nIn === nInOf(shape) ? model.net : undefined
  const y = live ? predict(live, bits) : undefined
  const scored = live ? heldOut.map((e) => ({ e, ok: predict(live, e.x) === e.y })) : []
  const correct = scored.filter((s) => s.ok).length
  return (
    <div className="train-try-body">
      <div className="train-draw">
        <Pad shape={shape} bits={bits} onChange={setBits} labels={labels} tone="try" />
        <div className="train-draw-side">
          <div className={`train-pred ${y === undefined ? '' : y ? 'fire' : 'silent'}`} aria-live="polite">
            <span className="tiny">{t('train.prediction')}</span>
            <b>{y === undefined ? '-' : y ? t('train.fire') : t('train.silent')}</b>
          </div>
          <p className="small muted">{live ? t('train.tryHelp') : t('train.tryFirst')}</p>
          <div className="train-add">
            <button className="btn small ghost" onClick={() => setBits(blank(shape))}>
              {t('train.clear')}
            </button>
          </div>
        </div>
      </div>
      {heldOut.length > 0 && (
        <div className="train-held">
          <div className="train-held-head">
            <span className="small">{t('train.heldOut')}</span>
            {live && <span className={`mono small ${correct === heldOut.length ? 'ok' : 'train-bad'}`}>{t('train.heldScore', { ok: correct, n: heldOut.length })}</span>}
          </div>
          <p className="tiny muted">{t('train.heldHelp')}</p>
          <ul className="train-thumbs held">
            {heldOut.map((e, i) => {
              const s = scored[i]
              return (
                <li key={i} className={s ? (s.ok ? 'right' : 'wrong') : ''}>
                  <button className="train-thumb-btn" onClick={() => setBits([...e.x])} title={t('train.load')} aria-label={t('train.load')}>
                    <Thumb shape={shape} bits={e.x} />
                    <span className={`train-want ${e.y ? 'fire' : 'silent'}`}>{e.y ? t('train.fireShort') : t('train.silentShort')}</span>
                    {s && <span className="train-mark">{s.ok ? '✓' : '✗'}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * `stale`: the examples changed since training. The tape-out is then hidden behind "retrain first",
 * so nobody pays for a network that no longer matches the examples on screen (unless a tape-out is
 * already running, `locked`, which must not be unmounted halfway).
 */
function CompilePanel({
  m,
  items,
  preset,
  stale,
  locked,
  onRunning,
}: {
  m: Model
  items: Item[]
  preset?: TrainingPreset
  stale: boolean
  locked: boolean
  onRunning: (r: boolean) => void
}) {
  const { t } = useI18n()
  const { cpu } = useCpu()
  const { cfg } = useNet()
  const { index } = useCircuits()
  const design = useMemo(() => designOf(m.net), [m.net])
  const compiled = useMemo(() => {
    try {
      return { c: compileDesign(design, { mode: 'direct', cpu: cfg?.circuits, index }) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [design, cfg?.circuits, index])
  // compileTrained re-simulates the netlist against the model on all 2^n inputs (n <= 16).
  const check = useMemo(() => compileTrained(m.net, { mode: 'direct', examples: toExamples(items) }), [m.net]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = useMemo(() => trainedLabel(m.net, m.shape, items, preset), [m.net]) // eslint-disable-line react-hooks/exhaustive-deps
  if ('error' in compiled) return <div className="error small">{compiled.error}</div>
  const c = compiled.c!
  const v = check.verification
  return (
    <div className={`compiled ${stale && !locked ? 'train-stale-compile' : ''}`}>
      <div className="compiled-top">
        <DieShot elements={c.netlist.elements} nIn={c.netlist.nIn} nOut={c.netlist.nOut} title={label.name} subtitle={t('train.dieSub')} />
        <div className="compiled-stats">
          <div className="counts">
            <span className="count nand">
              <b>{c.netlist.counts.nand}</b> NAND
            </span>
          </div>
          <span className={`train-verify ${v.ok ? 'good' : 'bad'}`}>
            {v.ok ? (v.exhaustive ? t('train.verified', { n: m.net.nIn, cases: v.cases }) : t('train.verifiedEx', { cases: v.cases })) : t('train.verifyFail', { n: v.failures.length })}
          </span>
          <dl className="quote">
            <Row k={t('st.pins')} v={t('st.pinsV', { i: c.netlist.nIn, o: c.netlist.nOut })} />
            <Row k={t('train.perNeuron')} v={check.neuronGates.map((l) => l.join(' + ')).join(' | ')} />
            <Row k={t('st.size')} v={c.hex ? t('st.sizeV', { n: (c.hex.length - 2) / 2 }) : '-'} />
          </dl>
        </div>
      </div>
      {stale && !locked ? (
        <div className="banner warn small">{t('train.staleTape')}</div>
      ) : cpu ? (
        v.ok ? (
          <TapeoutFlow key={`${c.hex}|${label.name}`} c={c} cpu={cpu} design={design} mode="direct" label={label} onRunning={onRunning} />
        ) : null
      ) : (
        <div className="skeleton" style={{ height: 200 }} />
      )}
    </div>
  )
}
