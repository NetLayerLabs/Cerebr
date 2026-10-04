import { useMemo, useRef, useState } from 'react'
import { useReadContract } from 'wagmi'
import { cerebrLensAbi } from '../abi/index.ts'
import { useCerebr } from '../hooks/useCerebr.ts'
import { compact, fmt } from '../lib/format.ts'

const W = 720
const H = 300
const PAD = { l: 64, r: 16, t: 18, b: 34 }
const SEGMENTS = 120n

/** Bonding curve price vs supply, with the current position and an optional trade preview. */
export function CurveChart({ preview }: { preview?: bigint }) {
  const { lens, chainId, state } = useCerebr()
  const { data } = useReadContract({
    address: lens,
    abi: cerebrLensAbi,
    functionName: 'curvePoints',
    args: [SEGMENTS],
    chainId,
    query: { enabled: !!lens, staleTime: Infinity },
  })
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const geo = useMemo(() => {
    if (!data) return undefined
    const [supplies, prices] = data
    const maxS = Number(supplies[supplies.length - 1])
    const maxP = Number(prices[prices.length - 1]) * 1.04
    const x = (s: number) => PAD.l + (s / maxS) * (W - PAD.l - PAD.r)
    const y = (p: number) => H - PAD.b - (p / maxP) * (H - PAD.t - PAD.b)
    const pts = supplies.map((s, i) => [x(Number(s)), y(Number(prices[i]))] as const)
    const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('')
    return { supplies, prices, maxS, maxP, x, y, line, base: Number(prices[0]), slopePerUnit: (Number(prices[prices.length - 1]) - Number(prices[0])) / maxS }
  }, [data])

  if (!geo || !state) return <div className="chart skeleton" style={{ aspectRatio: `${W}/${H}` }} />

  const priceAt = (s: number) => geo.base + geo.slopePerUnit * s
  const cur = Number(state.totalSupply)
  const area = (from: number, to: number) => {
    const n = 40
    let d = `M${geo.x(from)},${geo.y(0)}`
    for (let i = 0; i <= n; i++) {
      const s = from + ((to - from) * i) / n
      d += `L${geo.x(s).toFixed(1)},${geo.y(priceAt(s)).toFixed(1)}`
    }
    return d + `L${geo.x(to)},${geo.y(0)}Z`
  }
  const target = preview !== undefined ? Math.max(0, Math.min(geo.maxS, cur + Number(preview))) : undefined
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * geo.maxS)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * geo.maxP * 0.96)
  const hoverS = hover !== null ? hover : undefined

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return
    const px = ((e.clientX - r.left) / r.width) * W
    const s = ((px - PAD.l) / (W - PAD.l - PAD.r)) * geo.maxS
    setHover(s < 0 || s > geo.maxS ? null : s)
  }

  return (
    <div className="chart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Bonding curve">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3ddc97" stopOpacity=".45" />
            <stop offset="1" stopColor="#3ddc97" stopOpacity=".03" />
          </linearGradient>
          <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#3ddc97" />
            <stop offset="1" stopColor="#2bb3ff" />
          </linearGradient>
        </defs>
        {yTicks.map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(p)} y2={geo.y(p)} className="grid" />
            <text x={PAD.l - 8} y={geo.y(p) + 4} className="axis" textAnchor="end">
              {fmt(BigInt(Math.round(p)), 2)}
            </text>
          </g>
        ))}
        {xTicks.map((s) => (
          <text key={s} x={geo.x(s)} y={H - 12} className="axis" textAnchor="middle">
            {compact(BigInt(Math.round(s)))}
          </text>
        ))}
        <path d={area(0, cur)} fill="url(#fill)" />
        {target !== undefined && target !== cur && (
          <path d={area(Math.min(cur, target), Math.max(cur, target))} className={target > cur ? 'preview-buy' : 'preview-sell'} />
        )}
        <path d={geo.line} fill="none" stroke="url(#stroke)" strokeWidth="2.5" />
        <line x1={geo.x(cur)} x2={geo.x(cur)} y1={PAD.t} y2={H - PAD.b} className="cursor-line" />
        <circle cx={geo.x(cur)} cy={geo.y(priceAt(cur))} r="6" className="cursor-dot" />
        <circle cx={geo.x(cur)} cy={geo.y(priceAt(cur))} r="12" className="cursor-pulse" />
        {hoverS !== undefined && (
          <g pointerEvents="none">
            <line x1={geo.x(hoverS)} x2={geo.x(hoverS)} y1={PAD.t} y2={H - PAD.b} className="hover-line" />
            <circle cx={geo.x(hoverS)} cy={geo.y(priceAt(hoverS))} r="4" fill="#e6edf3" />
          </g>
        )}
        <text x={PAD.l} y={12} className="axis">OKB / CBR</text>
        <text x={W - PAD.r} y={H - 0} className="axis" textAnchor="end">supply (CBR)</text>
      </svg>
      <div className="chart-legend small">
        {hoverS !== undefined ? (
          <span className="mono">
            supply {compact(BigInt(Math.round(hoverS)))} → {fmt(BigInt(Math.round(priceAt(hoverS))), 4)} OKB
          </span>
        ) : (
          <span>
            <span className="swatch now" /> you are here: {compact(state.totalSupply)} CBR @ {fmt(state.currentPrice, 4)} OKB
          </span>
        )}
        <span className="muted">shaded = OKB reserve the curve owes holders</span>
      </div>
    </div>
  )
}
