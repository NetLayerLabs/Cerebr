// Client-side "die shot" of a TapeOut netlist: the chip package with its input / output pins, and
// every element of the netlist placed by logic depth (column = longest path from the inputs) with
// its real wiring. Same visual language as CerebrScope's onchain SVG: NAND = accent, LATCH = violet,
// REF = cyan sub-die, pins = amber. Pure (string in, string out), so Node scripts can use it too.

import type { Element } from '@cerebr/sdk'

export type DieShotOptions = {
  title?: string
  subtitle?: string
  /** Max wires drawn; bigger netlists show cells only. */
  maxWires?: number
}

const C = {
  bg: '#0a0b0d',
  pkg: '#15181c',
  die: '#0f1114',
  line: '#2b2f35',
  text: '#ecedee',
  muted: '#9ba1a9',
  nand: '#d4ff3f',
  latch: '#b8a2ff',
  ref: '#7cc8ff',
  pin: '#ff9a4a',
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const f = (n: number) => (Math.round(n * 10) / 10).toString()

type Cell = { x: number; y: number; w: number; h: number; el: Element; level: number }

export function dieShotSvg(elements: Element[], nIn: number, nOut: number, opts: DieShotOptions = {}): string {
  const S = 480
  const die = { x: 86, y: 94, w: 308, h: 296 }

  // ---- levels: inputs/consts at 0, latches start a new cycle (level 1), others = 1 + max(inputs)
  const level = new Map<number, number>()
  for (let s = 0; s < 2 + nIn; s++) level.set(s, 0)
  const cellsOf: { el: Element; level: number }[] = []
  for (const el of elements) {
    let lv = 1
    if (el.op === 0) lv = 1 + Math.max(level.get(el.a) ?? 0, level.get(el.b) ?? 0)
    else if (el.op === 2) lv = 1 + Math.max(0, ...el.ins.map((s) => level.get(s) ?? 0))
    if (el.op === 2) el.outs.forEach((o) => level.set(o, lv))
    else level.set(el.out, lv)
    cellsOf.push({ el, level: lv })
  }
  const cols = Math.max(1, ...cellsOf.map((c) => c.level))
  const perCol = new Map<number, number>()
  for (const c of cellsOf) perCol.set(c.level, (perCol.get(c.level) ?? 0) + (c.el.op === 2 ? Math.max(2, c.el.nOut) : 1))
  const rows = Math.max(1, ...perCol.values())
  const colW = die.w / cols
  const rowH = die.h / rows
  const unit = Math.max(2.5, Math.min(18, colW * 0.5, rowH * 0.62))

  // ---- place cells (centred column stacks)
  const used = new Map<number, number>()
  const cells: Cell[] = []
  const pos = new Map<number, { x: number; y: number }>()
  for (const c of cellsOf) {
    const span = c.el.op === 2 ? Math.max(2, c.el.nOut) : 1
    const k = used.get(c.level) ?? 0
    used.set(c.level, k + span)
    const total = perCol.get(c.level)!
    const top = die.y + (die.h - total * rowH) / 2
    const x = die.x + (c.level - 0.5) * colW
    const y = top + (k + span / 2) * rowH
    const h = c.el.op === 2 ? span * rowH * 0.78 : unit
    const w = c.el.op === 2 ? Math.max(unit * 1.4, Math.min(colW * 0.72, 40)) : unit
    const cell = { x, y, w, h, el: c.el, level: c.level }
    cells.push(cell)
    const el = c.el
    if (el.op === 2) el.outs.forEach((o, i) => pos.set(o, { x: x + w / 2, y: y - h / 2 + ((i + 0.5) * h) / el.nOut }))
    else pos.set(el.out, { x: x + w / 2, y })
  }

  // ---- pins
  const pinY = (i: number, n: number) => die.y + ((i + 0.5) * die.h) / Math.max(1, n)
  const inPin = (i: number) => ({ x: die.x - 4, y: pinY(i, nIn) })
  const total = 2 + nIn + cellsOf.reduce((s, c) => s + (c.el.op === 2 ? c.el.nOut : 1), 0)
  const outSignals = Array.from({ length: nOut }, (_, i) => total - nOut + i)
  const outPin = (i: number) => ({ x: die.x + die.w + 4, y: pinY(i, nOut) })
  const src = (s: number) => (s < 2 ? undefined : s < 2 + nIn ? inPin(s - 2) : pos.get(s))

  // ---- wires
  const wires: string[] = []
  const maxWires = opts.maxWires ?? 900
  const wire = (from: { x: number; y: number } | undefined, to: { x: number; y: number }, color: string, dashed = false) => {
    if (!from || wires.length >= maxWires) return
    const dx = Math.max(12, Math.abs(to.x - from.x) / 2)
    wires.push(
      `<path d="M${f(from.x)} ${f(from.y)}C${f(from.x + dx)} ${f(from.y)} ${f(to.x - dx)} ${f(to.y)} ${f(to.x)} ${f(to.y)}" stroke="${color}"${dashed ? ' stroke-dasharray="3 3"' : ''}/>`,
    )
  }
  for (const c of cells) {
    const left = { x: c.x - c.w / 2, y: c.y }
    if (c.el.op === 0) {
      wire(src(c.el.a), { ...left, y: c.y - c.h / 4 }, C.nand)
      wire(src(c.el.b), { ...left, y: c.y + c.h / 4 }, C.nand)
    } else if (c.el.op === 1) {
      wire(src(c.el.d), left, C.latch, true)
    } else {
      const el = c.el
      el.ins.forEach((s, i) => wire(src(s), { x: left.x, y: c.y - c.h / 2 + ((i + 0.5) * c.h) / el.ins.length }, C.ref))
    }
  }
  outSignals.forEach((s, i) => wire(src(s), outPin(i), C.pin))
  const wiresDrawn = wires.length < maxWires

  // ---- cells
  const glyphs = cells.map((c) => {
    const x = f(c.x - c.w / 2)
    const y = f(c.y - c.h / 2)
    if (c.el.op === 2) {
      const id = c.el.target && 'circuitId' in c.el.target ? `#${c.el.target.circuitId}` : 'REF'
      const fs = Math.max(5, Math.min(10, c.w / 4))
      return `<g><rect x="${x}" y="${y}" width="${f(c.w)}" height="${f(c.h)}" rx="3" fill="#101a22" stroke="${C.ref}" stroke-width="1.2"/>` +
        `<text x="${f(c.x)}" y="${f(c.y + fs / 3)}" font-size="${f(fs)}" fill="${C.ref}" text-anchor="middle">${esc(id)}</text></g>`
    }
    const color = c.el.op === 1 ? C.latch : C.nand
    return `<rect x="${x}" y="${y}" width="${f(c.w)}" height="${f(c.h)}" rx="${f(c.w * 0.22)}" fill="${color}" fill-opacity="0.82" stroke="${color}" stroke-width="0.6"/>`
  })

  // ---- package
  const pins: string[] = []
  const pinRect = (x: number, y: number, w: number, h: number, color: string, op = 0.9) =>
    pins.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1.5" fill="${color}" fill-opacity="${op}"/>`)
  const pinH = (n: number) => Math.max(2, Math.min(10, (die.h / Math.max(1, n)) * 0.5))
  for (let i = 0; i < nIn; i++) pinRect(20, pinY(i, nIn) - pinH(nIn) / 2, 32, pinH(nIn), C.pin)
  for (let i = 0; i < nOut; i++) pinRect(S - 52, pinY(i, nOut) - pinH(nOut) / 2, 32, pinH(nOut), C.pin)
  for (let i = 0; i < 12; i++) {
    const x = 92 + i * 27
    pinRect(x, 22, 8, 30, C.line, 1)
    pinRect(x, S - 52, 8, 30, C.line, 1)
  }

  const counts = { nand: 0, latch: 0, ref: 0 }
  for (const e of elements) e.op === 0 ? counts.nand++ : e.op === 1 ? counts.latch++ : counts.ref++
  const spec = [`${counts.nand} NAND`, counts.latch ? `${counts.latch} LATCH` : '', counts.ref ? `${counts.ref} REF` : '', `${nIn}→${nOut}`]
    .filter(Boolean)
    .join(' · ')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" font-family="ui-monospace,Menlo,monospace">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.nand}"/><stop offset="1" stop-color="${C.ref}"/></linearGradient>` +
    `<pattern id="p" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#ffffff" stroke-opacity="0.035"/></pattern></defs>` +
    `<rect width="${S}" height="${S}" fill="${C.bg}"/>` +
    pins.join('') +
    `<rect x="48" y="48" width="${S - 96}" height="${S - 96}" rx="4" fill="${C.pkg}" stroke="${C.line}" stroke-width="1.5"/>` +
    `<rect x="${die.x - 10}" y="${die.y - 10}" width="${die.w + 20}" height="${die.h + 20}" rx="2" fill="${C.die}" stroke="${C.line}"/>` +
    `<rect x="${die.x - 10}" y="${die.y - 10}" width="${die.w + 20}" height="${die.h + 20}" rx="2" fill="url(#p)"/>` +
    `<g fill="none" stroke-width="0.8" stroke-opacity="${wiresDrawn ? 0.42 : 0}">${wires.join('')}</g>` +
    `<g>${glyphs.join('')}</g>` +
    `<circle cx="66" cy="66" r="3.5" fill="none" stroke="${C.muted}"/>` +
    `<text x="${S / 2}" y="${S - 60}" font-size="9" fill="${C.muted}" text-anchor="middle" letter-spacing="1.5">${esc(spec.toUpperCase())}</text>` +
    `<text x="${S / 2}" y="73" font-size="10" fill="${C.text}" text-anchor="middle" letter-spacing="2" font-weight="700">${esc((opts.title ?? 'CEREBR').toUpperCase().slice(0, 34))}</text>` +
    (opts.subtitle ? `<text x="${S / 2}" y="${S - 6}" font-size="9" fill="${C.muted}" text-anchor="middle" letter-spacing="1">${esc(opts.subtitle.slice(0, 60))}</text>` : '') +
    `</svg>`
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
