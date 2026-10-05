import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { decode, type Element } from '@cerebr/sdk'
import { dieShotSvg, svgDataUri } from '../lib/dieShot.ts'
import { scopeImage } from '../lib/scope.ts'
import { useNet } from '../hooks/useCpu.ts'

type Props = {
  nIn: number
  nOut: number
  title?: string
  subtitle?: string
  /** Either decoded elements, or the on-chain netlist bytes. */
  elements?: Element[]
  netlist?: `0x${string}`
  /** On-chain circuit id: CerebrScope's image is preferred when a scope is configured. */
  circuitId?: bigint
}

export function DieShot(p: Props) {
  const { cfg, pc, chainId } = useNet()
  const scope = cfg?.scope
  const onchain = useQuery({
    queryKey: ['cerebr', 'scope', chainId, scope, cfg?.circuits, p.circuitId?.toString()],
    enabled: !!scope && !!pc && !!cfg && p.circuitId !== undefined,
    staleTime: Infinity,
    queryFn: async () => (await scopeImage(pc!, scope!, cfg!.circuits, p.circuitId!)) ?? null,
  })
  const local = useMemo(() => {
    try {
      const els = p.elements ?? (p.netlist ? decode(p.netlist, p.nIn) : [])
      return svgDataUri(dieShotSvg(els, p.nIn, p.nOut, { title: p.title, subtitle: p.subtitle }))
    } catch {
      return undefined
    }
  }, [p.elements, p.netlist, p.nIn, p.nOut, p.title, p.subtitle])
  const src = onchain.data ?? local
  return (
    <div className="art">
      {src ? <img src={src} alt={p.title ?? 'circuit die shot'} loading="lazy" /> : <div className="art-ph" />}
      {onchain.data && <span className="art-tag">on-chain SVG</span>}
    </div>
  )
}
