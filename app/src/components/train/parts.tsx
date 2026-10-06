import { useEffect, useRef } from 'react'
import type { NeuronSpec } from '@cerebr/sdk'
import type { Shape } from '../../lib/train.ts'
import { Pins } from '../ui.tsx'
import { useI18n } from '../../i18n/index.tsx'

/**
 * The drawing surface: a pixel grid (click, or press and drag to paint; the first cell decides
 * whether the stroke lights or clears) or, for bit-vector shapes, a row of input pins.
 */
export function Pad({ shape, bits, onChange, labels, tone = 'in' }: { shape: Shape; bits: number[]; onChange: (b: number[]) => void; labels: string[]; tone?: 'in' | 'try' }) {
  const { t } = useI18n()
  const paint = useRef<number | null>(null)
  const cur = useRef(bits)
  cur.current = bits
  useEffect(() => {
    const up = () => (paint.current = null)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])
  if (shape.kind === 'bits') return <Pins labels={labels} bits={bits} onToggle={(i) => onChange(bits.map((v, j) => (j === i ? (v ? 0 : 1) : v)))} />

  const set = (i: number, v: number) => {
    if (cur.current[i] === v) return
    const next = cur.current.map((x, j) => (j === i ? v : x))
    cur.current = next
    onChange(next)
  }
  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const i = el?.dataset.px
    return i === undefined ? undefined : Number(i)
  }
  return (
    <div
      className={`train-pad g${shape.cols} ${tone}`}
      role="grid"
      aria-label={t('train.padAria', { r: shape.rows, c: shape.cols })}
      onPointerDown={(e) => {
        const i = cellAt(e.clientX, e.clientY)
        if (i === undefined) return
        ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
        paint.current = cur.current[i] ? 0 : 1
        set(i, paint.current)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (paint.current === null) return
        const i = cellAt(e.clientX, e.clientY)
        if (i !== undefined) set(i, paint.current)
      }}
    >
      {bits.map((b, i) => (
        <button
          key={i}
          type="button"
          data-px={i}
          className={`train-px ${b ? 'on' : ''}`}
          aria-pressed={!!b}
          aria-label={t('train.pxAria', { r: Math.floor(i / shape.cols), c: i % shape.cols })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              set(i, cur.current[i] ? 0 : 1)
            }
          }}
        />
      ))}
    </div>
  )
}

/** A small read-only drawing (a pixel grid, or the bits as 0/1). */
export function Thumb({ shape, bits }: { shape: Shape; bits: readonly number[] }) {
  if (shape.kind === 'bits') return <span className="train-bits mono">{bits.join('')}</span>
  return (
    <span className={`train-thumb g${shape.cols}`} aria-hidden>
      {bits.map((b, i) => (
        <i key={i} className={b ? 'on' : ''} />
      ))}
    </span>
  )
}

/** A neuron's weights as a heatmap in the input's shape: +1 accent, -1 warm, 0 grey; θ beside it. */
export function WeightMap({ shape, spec, name, active, caption }: { shape: Shape | { kind: 'bits'; n: number }; spec: NeuronSpec; name: string; active?: boolean; caption?: string }) {
  const { t } = useI18n()
  const cols = shape.kind === 'grid' ? shape.cols : spec.weights.length
  return (
    <div className={`train-neuron ${active === undefined ? '' : active ? 'fired' : 'idle'}`}>
      <div className="train-neuron-head">
        <b className="mono">{name}</b>
        <span className="mono tiny muted">{t('train.theta', { t: spec.theta })}</span>
      </div>
      <span className={`train-wmap ${shape.kind === 'grid' ? 'grid' : 'row'}`} style={{ gridTemplateColumns: `repeat(${cols}, var(--wcell))` }} role="img" aria-label={t('train.wAria', { name, w: spec.weights.join(' '), t: spec.theta })}>
        {spec.weights.map((w, i) => (
          <i key={i} className={w > 0 ? 'pos' : w < 0 ? 'neg' : 'zero'} title={`${w > 0 ? '+' : ''}${w}`}>
            {Math.abs(w) > 1 ? Math.abs(w) : ''}
          </i>
        ))}
      </span>
      {caption && <span className="tiny muted">{caption}</span>}
    </div>
  )
}
