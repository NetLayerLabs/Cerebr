// Pure helpers for the Train view (no React): input shapes, example buckets, the trained model's
// design for the compiler, and the onchain label written after the tape-out (English, like every
// other onchain label; the UI translates around it).
import { TRAINING_PRESETS, pixelLabels, type Example, type NeuronSpec, type TrainedNetwork, type TrainingPreset } from '@cerebr/sdk'
import { pinLabels, type CircuitLabel, type Design } from './cerebr.ts'

export type Shape = { kind: 'grid'; rows: number; cols: number } | { kind: 'bits'; n: number }

export const SHAPES: { id: string; shape: Shape }[] = [
  { id: '3x3', shape: { kind: 'grid', rows: 3, cols: 3 } },
  { id: '4x4', shape: { kind: 'grid', rows: 4, cols: 4 } },
  { id: '2', shape: { kind: 'bits', n: 2 } },
  { id: '3', shape: { kind: 'bits', n: 3 } },
  { id: '4', shape: { kind: 'bits', n: 4 } },
  { id: '5', shape: { kind: 'bits', n: 5 } },
]

export const shapeId = (s: Shape) => (s.kind === 'grid' ? `${s.rows}x${s.cols}` : String(s.n))
export const shapeOf = (id: string): Shape => SHAPES.find((s) => s.id === id)?.shape ?? SHAPES[0].shape
export const nInOf = (s: Shape) => (s.kind === 'grid' ? s.rows * s.cols : s.n)
export const inputLabels = (s: Shape) => (s.kind === 'grid' ? pixelLabels(s.rows, s.cols) : pinLabels('x', s.n))
export const blank = (s: Shape) => Array<number>(nInOf(s)).fill(0)

export function presetShape(p: TrainingPreset): Shape {
  return p.grid ? { kind: 'grid', rows: p.grid.rows, cols: p.grid.cols } : { kind: 'bits', n: p.inputs.length }
}

export const findPreset = (id: string | undefined) => TRAINING_PRESETS.find((p) => p.id === id)

/** A training example in a bucket, with a stable id for React keys. */
export type Item = { id: number; x: number[]; y: 0 | 1 }

export const bitsKey = (x: readonly number[]) => x.join('')

/** Keys drawn in BOTH buckets (the trainer cannot satisfy both labels). */
export function conflicts(items: readonly Item[]): Set<string> {
  const fire = new Set(items.filter((e) => e.y === 1).map((e) => bitsKey(e.x)))
  return new Set(items.filter((e) => e.y === 0 && fire.has(bitsKey(e.x))).map((e) => bitsKey(e.x)))
}

/** Training set signature: a model trained on another signature is stale. */
export const signature = (items: readonly Item[]) => items.map((e) => `${e.y}${bitsKey(e.x)}`).sort().join(',')

export const toExamples = (items: readonly Item[]): Example[] => items.map(({ x, y }) => ({ x, y }))

/** Does one neuron fire on x? (Σ w·x ≥ θ) */
export const fires = (n: NeuronSpec, x: readonly number[]) => n.weights.reduce((s, w, i) => s + (x[i] ? w : 0), 0) >= n.theta

/** The trained model as a Studio design: a flat (inline) network, compiled in 'direct' mode. */
export const designOf = (m: TrainedNetwork): Design => ({ kind: 'network', nIn: m.nIn, layers: m.layers, compose: 'inline' })

/**
 * The onchain label for a trained circuit. Grid inputs are named r{row}c{col} so the Inference view
 * shows a pixel pad for 3×3 circuits; the output is 'fire'.
 */
export function trainedLabel(m: TrainedNetwork, shape: Shape, items: readonly Item[], preset?: TrainingPreset): CircuitLabel {
  const pos = items.filter((e) => e.y === 1).length
  const arch = m.structure === 'single' ? `${m.nIn} inputs -> 1 neuron` : `${m.nIn} inputs -> ${m.hidden} hidden -> ${m.structure.toUpperCase()}`
  const what = shape.kind === 'grid' ? `${shape.rows}x${shape.cols} pixels` : `${shape.n} bits`
  return {
    name: preset?.name ?? (m.structure === 'single' ? 'Trained Neuron' : 'Trained Network'),
    description: `Trained in the browser (Cerebr trainer, robust) on ${items.length} examples (${pos} fire, ${items.length - pos} silent) over ${what}: ${arch}, margin ${Math.floor(m.margin)}.`,
    inputs: inputLabels(shape),
    outputs: ['fire'],
  }
}
