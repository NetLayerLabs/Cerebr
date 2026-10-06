import { useEffect, useMemo, useState } from 'react'
import { run, type Program } from '@cerebr/sdk'
import type { CircuitRow } from '../hooks/useCpu.ts'
import { useI18n } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'
import '../views/market.css'

/**
 * Gate-level animation of one inference, rendered in PlaygroundView's result card when its
 * "Animate" toggle is on. `prog` is the circuit's loaded program (undefined while loading),
 * `inputs` the current input bits, `outputs` the onchain eval() / step() answer when it has arrived
 * (the replay starts when it does, so the picture is the onchain run). `state` is the carried state
 * for a stateful circuit (its latches read it); `seq` marks the clocked bench, which traces the
 * simulator until the first onchain step.
 *
 * Every signal's value comes from the SDK simulator (run().signals). Elements are placed by logic
 * depth and drawn as one SVG path per (layer, value) for cells and for wires, so even a ~600-gate
 * circuit is a few dozen DOM nodes and a replay only flips one class per layer.
 * Owned by the Market + Animation engineer (styles: .anim-* in views/market.css, strings: src/i18n/ns/anim.*).
 */
export function GateAnimation({
  c,
  prog,
  inputs,
  outputs,
  state,
  seq,
}: {
  c: CircuitRow
  prog?: Program
  inputs: number[]
  outputs?: number[]
  state?: number[]
  seq?: boolean
}) {
  const { t } = useI18n()
  const ct = useCircuitText()
  const reduced = useReducedMotion()
  const geo = useMemo(() => {
    if (!prog) return undefined
    try {
      return layout(prog, inputs, state ?? [])
    } catch {
      return null
    }
  }, [prog, inputs, state])

  const total = geo ? geo.depth + 1 : 0
  const ready = outputs !== undefined || !!seq
  const runKey = `${inputs.join('')}|${(state ?? []).join('')}|${outputs?.join('') ?? ''}`
  const [replay, setReplay] = useState(0)
  const [step, setStep] = useState(-1)
  useEffect(() => {
    if (!geo || !ready) {
      setStep(-1)
      return
    }
    if (reduced) {
      setStep(total)
      return
    }
    // ~1.4 s per run whatever the depth: deep circuits move faster per layer.
    const per = Math.max(18, Math.min(220, 1400 / (total + 1)))
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const s = Math.min(total, Math.floor((now - t0) / per))
      setStep(s)
      if (s < total) raf = requestAnimationFrame(tick)
    }
    setStep(0)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [geo, ready, reduced, total, runKey, replay])

  if (geo === null) return <div className="anim-stage anim-empty tiny muted">{t('anim.error')}</div>
  if (!geo) return <div className="anim-stage anim-skeleton" role="img" aria-label={t('anim.aria')} />

  const local = geo.outs.map((p) => p.v)
  const bits = (outputs ?? []).join('')
  const status = outputs
    ? outputs.every((v, i) => v === local[i])
      ? { cls: 'ok', text: t('anim.synced', { bits }) }
      : { cls: 'bad', text: t('anim.differs', { bits }) }
    : { cls: 'wait', text: seq ? t('anim.waitingStep') : t('anim.waiting') }
  const outLabels = ct.pins(c.label.outputs)
  const inLabels = ct.pins(c.label.inputs)
  const cls = (l: number) => `anim-layer${l <= step ? ' lit' : ''}${l === step ? ' front' : ''}`

  return (
    <div className="anim-stage">
      <div className="anim-head">
        <span className="anim-title">{t('anim.head')}</span>
        <span className="anim-meta mono">{t('anim.size', { g: geo.count, d: geo.depth })}</span>
        <span className="anim-meta mono anim-step">{t('anim.layer', { n: Math.max(0, Math.min(step, geo.depth)), total: geo.depth })}</span>
        <button className="chip anim-replay" disabled={!ready} onClick={() => setReplay((r) => r + 1)}>
          {t('anim.replay')}
        </button>
      </div>
      <svg className="anim-svg" viewBox={`0 0 ${geo.W} ${geo.H}`} role="img" aria-label={t('anim.aria')} preserveAspectRatio="xMidYMid meet">
        {geo.layers.map((L, i) => (
          <g key={`w${i}`} className={cls(i)}>
            {L.w0 && <path className="anim-w0" d={L.w0} />}
            {L.w1 && <path className="anim-w1" d={L.w1} />}
          </g>
        ))}
        {geo.layers.map((L, i) => (
          <g key={`c${i}`} className={cls(i)}>
            {L.r && <path className="anim-ref" d={L.r} />}
            {L.c0 && <path className="anim-c0" d={L.c0} />}
            {L.c1 && <path className="anim-c1" d={L.c1} />}
            {L.l0 && <path className="anim-c0 anim-latch" d={L.l0} />}
            {L.l1 && <path className="anim-c1 anim-latch" d={L.l1} />}
          </g>
        ))}
        <g className={cls(0)}>
          {geo.ins.map((p, i) => (
            <g key={i} className={`anim-pin ${p.v ? 'v1' : 'v0'}`}>
              <title>{p.konst ? p.label : `${inLabels[p.index] ?? p.index} = ${p.v}`}</title>
              <rect x={p.x - geo.pin / 2} y={p.y - geo.pin / 2} width={geo.pin} height={geo.pin} />
              {geo.pin >= 9 && (
                <text x={p.x} y={p.y} dy="0.35em">
                  {p.konst ? p.label : p.v}
                </text>
              )}
            </g>
          ))}
        </g>
        <g className={cls(total)}>
          {geo.outs.map((p, i) => (
            <g key={i} className={`anim-pin out ${p.v ? 'v1' : 'v0'}`}>
              <title>{`${outLabels[i] ?? i} = ${p.v}`}</title>
              <rect x={p.x - geo.pin / 2} y={p.y - geo.pin / 2} width={geo.pin} height={geo.pin} />
              {geo.pin >= 9 && (
                <text x={p.x} y={p.y} dy="0.35em">
                  {p.v}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
      <div className="anim-foot tiny">
        <span className={`anim-status ${status.cls}`}>{status.text}</span>
        <span className="anim-legend muted">
          <i className="anim-key v1" /> {t('anim.one')} <i className="anim-key v0" /> {t('anim.zero')}
          {state && state.length > 0 && <span className="mono"> · {t('anim.state', { bits: state.join('') })}</span>}
        </span>
      </div>
      {reduced && <div className="tiny muted">{t('anim.reduced')}</div>}
    </div>
  )
}

function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

// ------------------------------------------------------------------ layout (pure)

type Pin = { x: number; y: number; v: number; index: number; konst?: boolean; label?: string }
type Layer = { c0: string; c1: string; l0: string; l1: string; r: string; w0: string; w1: string }
type Geo = { W: number; H: number; depth: number; count: number; pin: number; layers: Layer[]; ins: Pin[]; outs: Pin[] }
type Item = { kind: 0 | 1 | 2; level: number; ins: number[]; outs: number[] }

const f = (n: number) => (Math.round(n * 10) / 10).toString()
const rect = (x: number, y: number, w: number, h: number) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`
const wire = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2
  return `M${f(x1)} ${f(y1)}C${f(mx)} ${f(y1)} ${f(mx)} ${f(y2)} ${f(x2)} ${f(y2)}`
}

/**
 * Places every top-level element by logic depth (inputs and constants at 0, a LATCH at 1 because it
 * reads the carried state, others 1 + their deepest input; a REF is one sub-die block) and builds
 * the per-layer SVG paths, coloured by the signal values the simulator computed.
 */
function layout(prog: Program, inputs: number[], state: number[]): Geo {
  const { nIn, nOut, nSignals } = prog
  const sig = run(prog, state, inputs).signals
  const level = new Int32Array(nSignals)
  const items: Item[] = []
  let p = 2 + nIn
  for (const pe of prog.elements) {
    const el = pe.el
    if (el.op === 0) {
      const lv = 1 + Math.max(level[el.a], level[el.b])
      level[p] = lv
      items.push({ kind: 0, level: lv, ins: [el.a, el.b], outs: [p++] })
    } else if (el.op === 1) {
      level[p] = 1
      items.push({ kind: 1, level: 1, ins: [], outs: [p++] })
    } else {
      const lv = 1 + Math.max(0, ...el.ins.map((s) => level[s]))
      const outs: number[] = []
      for (let i = 0; i < el.nOut; i++) (level[p] = lv, outs.push(p++))
      items.push({ kind: 2, level: lv, ins: el.ins, outs })
    }
  }
  const depth = Math.max(1, ...items.map((i) => i.level))
  const slots = new Array<number>(depth + 1).fill(0)
  for (const it of items) slots[it.level] += it.kind === 2 ? Math.max(1, it.outs.length) : 1

  // constants only appear when a gate reads them
  const usesConst = [false, false]
  for (const it of items) for (const s of it.ins) if (s < 2) usesConst[s] = true
  const pinCount = nIn + (usesConst[0] ? 1 : 0) + (usesConst[1] ? 1 : 0)
  const maxRows = Math.max(1, pinCount, nOut, ...slots)

  const W = 640
  const padL = 30
  const padR = 30
  const padY = 16
  const H = Math.round(Math.max(150, Math.min(440, maxRows * 9 + 2 * padY)))
  const innerH = H - 2 * padY
  const colW = (W - padL - padR) / depth
  const cellW = Math.max(3, Math.min(14, colW * 0.42))
  const cellH = Math.max(2.4, Math.min(11, (innerH / maxRows) * 0.62))
  const pin = Math.max(5, Math.min(13, (innerH / Math.max(pinCount, nOut)) * 0.7))

  const pos = new Map<number, { x: number; y: number }>()
  const ins: Pin[] = []
  const pinX = padL - 16
  const pinY = (k: number, n: number) => padY + ((k + 0.5) * innerH) / n
  let k = 0
  for (const s of [0, 1]) {
    if (!usesConst[s]) continue
    const y = pinY(k++, pinCount)
    pos.set(s, { x: pinX + pin / 2, y })
    ins.push({ x: pinX, y, v: s, index: -1, konst: true, label: String(s) })
  }
  for (let i = 0; i < nIn; i++) {
    const y = pinY(k++, pinCount)
    pos.set(2 + i, { x: pinX + pin / 2, y })
    ins.push({ x: pinX, y, v: sig[2 + i], index: i })
  }

  const layers: Layer[] = Array.from({ length: depth + 2 }, () => ({ c0: '', c1: '', l0: '', l1: '', r: '', w0: '', w1: '' }))
  const used = new Array<number>(depth + 1).fill(0)
  const placed: { it: Item; x: number; ys: number[]; top: number; bottom: number }[] = []
  for (const it of items) {
    const n = it.kind === 2 ? Math.max(1, it.outs.length) : 1
    const slotH = innerH / slots[it.level]
    const x = padL + (it.level - 0.5) * colW
    const first = used[it.level]
    used[it.level] += n
    const ys = Array.from({ length: n }, (_, j) => padY + (first + j + 0.5) * slotH)
    placed.push({ it, x, ys, top: padY + first * slotH, bottom: padY + (first + n) * slotH })
    it.outs.forEach((s, j) => pos.set(s, { x: x + cellW / 2, y: ys[Math.min(j, n - 1)] }))
  }

  for (const { it, x, ys, top, bottom } of placed) {
    const L = layers[it.level]
    if (it.kind === 2) {
      const pad = Math.min(2, (bottom - top) * 0.1)
      L.r += rect(x - cellW / 2, top + pad, cellW, bottom - top - 2 * pad)
      it.ins.forEach((s, j) => {
        const from = pos.get(s)
        if (!from) return
        const y = top + ((j + 0.5) * (bottom - top)) / it.ins.length
        const d = wire(from.x, from.y, x - cellW / 2, y)
        if (sig[s]) L.w1 += d
        else L.w0 += d
      })
      it.outs.forEach((s, j) => {
        const h = Math.min(cellH, ((bottom - top) / it.outs.length) * 0.6)
        const r = rect(x - cellW / 4, ys[j] - h / 2, cellW / 2, h)
        if (sig[s]) L.c1 += r
        else L.c0 += r
      })
      continue
    }
    const s = it.outs[0]
    const r = rect(x - cellW / 2, ys[0] - cellH / 2, cellW, cellH)
    if (it.kind === 1) {
      if (sig[s]) L.l1 += r
      else L.l0 += r
    } else {
      if (sig[s]) L.c1 += r
      else L.c0 += r
    }
    for (const a of it.ins) {
      const from = pos.get(a)
      if (!from) continue
      const d = wire(from.x, from.y, x - cellW / 2, ys[0])
      if (sig[a]) L.w1 += d
      else L.w0 += d
    }
  }

  // outputs: the last nOut signals, wired to pins on the right edge, lit last
  const outs: Pin[] = []
  const outX = W - padR + 16
  const last = layers[depth + 1]
  for (let i = 0; i < nOut; i++) {
    const s = nSignals - nOut + i
    const y = pinY(i, nOut)
    const from = pos.get(s)
    if (from) {
      const d = wire(from.x, from.y, outX - pin / 2, y)
      if (sig[s]) last.w1 += d
      else last.w0 += d
    }
    outs.push({ x: outX, y, v: sig[s], index: i })
  }
  return { W, H, depth, count: items.length, pin, layers, ins, outs }
}
