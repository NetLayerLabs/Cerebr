import { useMemo, useState } from 'react'
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
  /** Either decoded elements, or the onchain netlist bytes. */
  elements?: Element[]
  netlist?: `0x${string}`
  /** Onchain circuit id: CerebrScope's image is preferred when a scope is configured. */
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
  // The app draws every die shot in its own palette; CerebrScope's onchain SVG (same netlist,
  // rendered by the contract) is one click away. A broken onchain image (an owner can write labels
  // that make the SVG invalid XML) falls back to the local drawing.
  const [preferChain, setPreferChain] = useState(false)
  const [badOnchain, setBadOnchain] = useState<string | undefined>()
  const chainOk = !!onchain.data && onchain.data !== badOnchain
  const showOnchain = preferChain && chainOk
  const src = showOnchain ? onchain.data! : local
  return (
    <div className="art">
      {src ? (
        <img src={src} alt={p.title ?? 'circuit die shot'} loading="lazy" onError={showOnchain ? () => setBadOnchain(onchain.data!) : undefined} />
      ) : (
        <div className="art-ph" />
      )}
      {chainOk && (
        <button
          type="button"
          className={`art-tag${showOnchain ? ' on' : ''}`}
          onClick={() => setPreferChain((v) => !v)}
          title={showOnchain ? 'Showing the SVG rendered onchain by CerebrScope' : 'Show the SVG rendered onchain by CerebrScope'}
        >
          {showOnchain ? '● Scope SVG' : '○ Scope SVG'}
        </button>
      )}
    </div>
  )
}
