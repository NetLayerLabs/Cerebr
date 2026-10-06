import { short } from './issuance.ts'
import { useT } from '../i18n/index.tsx'

/**
 * Hero illustration: a schematic of the live Cerebr processor drawn as a datasheet pinout. Pins are
 * the real TapeOut interface: writes on the left, view functions on the right. A read pin carries a
 * signal only once this page has actually called that function on X Layer. Chip text, the lit die
 * cells (one per taped-out circuit) and the address come from chain.
 */
const LEFT = ['mint(NAND)', 'mint(LATCH)', 'tapeout()', 'REF', 'open()']
const RIGHT = ['eval()', 'step()', 'circuitInfo()', 'netlist()', 'ownerOf()']
const COLS = 8
const ROWS = 6

export interface PinoutProps {
  name?: string
  symbol?: string
  /** Circuits taped out on this processor. */
  circuits?: number
  cpu?: string
  chainId?: number
  /** View functions this page has read successfully (lights their pins). */
  reads: ReadonlySet<string>
}

export function Pinout({ name, symbol, circuits, cpu, chainId, reads }: PinoutProps) {
  const body = { x: 150, y: 110, s: 260 }
  const pitch = body.s / (LEFT.length + 1)
  const pinY = (i: number) => body.y + pitch * (i + 1)
  const lit = Math.min(circuits ?? 0, COLS * ROWS)
  const n = LEFT.length + RIGHT.length
  const t = useT()
  return (
    <svg viewBox="0 0 560 480" className="ds-pinout" role="img" aria-label={t('l.pin.aria', { name: name ?? 'Cerebr' })}>
      <defs>
        <pattern id="dsDie" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M26 0H0V26" fill="none" className="ds-die-grid" />
        </pattern>
      </defs>

      {/* pins: the real TapeOut interface */}
      {LEFT.map((label, i) => (
        <g key={label} className="ds-pin-g" style={{ '--i': i } as React.CSSProperties}>
          <line x1={body.x - 46} y1={pinY(i)} x2={body.x} y2={pinY(i)} className="ds-pin" />
          <text x={body.x - 54} y={pinY(i) + 4} textAnchor="end" className="ds-pin-label">{label}</text>
          <text x={body.x + 12} y={pinY(i) + 3} className="ds-pin-num">{i + 1}</text>
        </g>
      ))}
      {RIGHT.map((label, i) => (
        <g key={label} className="ds-pin-g" style={{ '--i': i + 0.5 } as React.CSSProperties}>
          <line x1={body.x + body.s} y1={pinY(i)} x2={body.x + body.s + 46} y2={pinY(i)} className="ds-pin" />
          {reads.has(label) && <line x1={body.x + body.s} y1={pinY(i)} x2={body.x + body.s + 46} y2={pinY(i)} className="ds-pin-sig" pathLength={100} style={{ animationDelay: `${0.4 + i * 0.5}s` }} />}
          <text x={body.x + body.s + 54} y={pinY(i) + 4} className="ds-pin-label">{label}</text>
          <text x={body.x + body.s - 12} y={pinY(i) + 3} textAnchor="end" className="ds-pin-num">{n - i}</text>
        </g>
      ))}

      {/* package */}
      <rect x={body.x} y={body.y} width={body.s} height={body.s} rx="6" className="ds-body" />
      <rect x={body.x + 18} y={body.y + 18} width={body.s - 36} height={body.s - 96} fill="url(#dsDie)" className="ds-die" />
      <line x1={body.x + 18} y1={body.y + body.s - 70} x2={body.x + body.s - 18} y2={body.y + body.s - 70} className="ds-die-rule" />
      {Array.from({ length: lit }, (_, i) => (
        <rect
          key={i}
          x={body.x + 18 + (i % COLS) * 26 + 6}
          y={body.y + 18 + Math.floor(i / COLS) * 26 + 6}
          width="14"
          height="14"
          className="ds-cell"
          style={{ '--i': i, '--blink': `${(i * 0.37) % 3}s` } as React.CSSProperties}
        >
          <title>{t('l.pin.circuit', { n: i + 1 })}</title>
        </rect>
      ))}
      <circle cx={body.x + 16} cy={body.y + 16} r="4" className="ds-pin1" />
      <text x={body.x + body.s / 2} y={body.y + body.s - 38} textAnchor="middle" className="ds-chip-name">{name ? name.toUpperCase() : '…'}</text>
      <text x={body.x + body.s / 2} y={body.y + body.s - 20} textAnchor="middle" className="ds-chip-sub">
        {symbol ?? '…'} · {circuits !== undefined ? t(circuits === 1 ? 'l.pin.tapedOne' : 'l.pin.tapedMany', { n: circuits }) : '…'}
      </text>

      {/* dimension annotation */}
      <line x1={body.x} y1={body.y + body.s + 52} x2={body.x + body.s} y2={body.y + body.s + 52} className="ds-dim" />
      <line x1={body.x} y1={body.y + body.s + 46} x2={body.x} y2={body.y + body.s + 58} className="ds-dim" />
      <line x1={body.x + body.s} y1={body.y + body.s + 46} x2={body.x + body.s} y2={body.y + body.s + 58} className="ds-dim" />
      <text x={body.x + body.s / 2} y={body.y + body.s + 72} textAnchor="middle" className="ds-dim-label">
        {cpu ? short(cpu).toUpperCase().replace('0X', '0x') : '…'} · {t('l.pin.chain')} {chainId ?? '…'}
      </text>
      <text x={body.x - 46} y={body.y - 40} className="ds-dim-label">{t('l.pin.writes')}</text>
      <text x={body.x + body.s + 46} y={body.y - 40} textAnchor="end" className="ds-dim-label">{t('l.pin.reads')}</text>
    </svg>
  )
}

/**
 * Timing diagram of the integrate-and-fire circuit (#14). Waveforms come from the caller: the SDK
 * simulator run on #14's onchain netlist. Until they arrive only the grid is drawn.
 */
export function TimingDiagram({ spikes, counts, fires }: { spikes: number[]; counts?: number[]; fires?: number[] }) {
  const steps = spikes.length
  const t = useT()
  const x0 = 96
  const w = 36
  const rows = [
    { label: 'CLK', y: 30 },
    { label: 'SPIKE', y: 78 },
    { label: 'COUNT', y: 126 },
    { label: 'FIRE', y: 174 },
  ]
  const wave = (bits: number[], y: number) => {
    let d = `M${x0} ${bits[0] ? y - 14 : y + 6}`
    bits.forEach((b, i) => {
      const yy = b ? y - 14 : y + 6
      d += ` V${yy} H${x0 + (i + 1) * w}`
    })
    return d
  }
  const clk = Array.from({ length: steps * 2 }, (_, i) => (i % 2 === 0 ? 1 : 0))
  let clkD = `M${x0} ${30 + 6}`
  clk.forEach((b, i) => {
    const yy = b ? 30 - 14 : 30 + 6
    clkD += ` V${yy} H${x0 + ((i + 1) * w) / 2}`
  })
  return (
    <svg viewBox={`0 0 ${x0 + steps * w + 12} 200`} className="ds-timing" role="img" aria-label={t('l.timing.aria')}>
      {Array.from({ length: steps + 1 }, (_, i) => (
        <line key={i} x1={x0 + i * w} y1="8" x2={x0 + i * w} y2="190" className="ds-grid-v" />
      ))}
      {rows.map((r) => (
        <text key={r.label} x="0" y={r.y + 2} className="ds-wave-label">{r.label}</text>
      ))}
      <path d={clkD} className="ds-wave ds-trace" pathLength={100} style={{ '--d': '0ms' } as React.CSSProperties} />
      <path d={wave(spikes, 78)} className="ds-wave ds-trace" pathLength={100} style={{ '--d': '350ms' } as React.CSSProperties} />
      {!counts && (
        <text x={x0 + (steps * w) / 2} y="154" textAnchor="middle" className="ds-bus-v">
          {t('l.timing.sim', { id: 14 })}
        </text>
      )}
      {counts?.map((v, i) => (
        <g key={i} className="ds-count-g" style={{ '--i': i } as React.CSSProperties}>
          <path d={`M${x0 + i * w + 4} 126 L${x0 + i * w + 8} 116 H${x0 + (i + 1) * w - 4} L${x0 + (i + 1) * w} 126 L${x0 + (i + 1) * w - 4} 136 H${x0 + i * w + 8} Z`} className="ds-bus" />
          <text x={x0 + i * w + w / 2 + 2} y="130" textAnchor="middle" className="ds-bus-v">{v}</text>
        </g>
      ))}
      {fires && <path d={wave(fires, 174)} className="ds-wave ds-wave-acc ds-trace" pathLength={100} style={{ '--d': '1500ms' } as React.CSSProperties} />}
    </svg>
  )
}
