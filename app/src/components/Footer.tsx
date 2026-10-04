import { useCerebr } from '../hooks/useCerebr.ts'
import { shortAddr } from '../lib/format.ts'

export function Footer() {
  const { state, explorerAddr, chain } = useCerebr()
  const rows: [string, string | undefined][] = state
    ? [
        ['Processor ($CBR)', state.processor],
        ['Circuit (NFT)', state.circuit],
        ['ERC-6551 registry', state.erc6551Registry],
        ['Account impl', state.accountImplementation],
      ]
    : []
  return (
    <footer className="footer">
      <div className="addrs">
        {rows.map(([k, a]) =>
          a ? (
            <a key={k} href={explorerAddr(a as `0x${string}`)} target="_blank" rel="noreferrer" className="small">
              <span className="muted">{k}</span> <span className="mono">{shortAddr(a)}</span>
            </a>
          ) : null,
        )}
      </div>
      <p className="tiny muted">
        Cerebr on {chain?.name ?? 'X Layer'} · Linear bonding curve, 1% sell fee, sells never pausable · The owner can only
        withdraw sell fees, never the curve reserve · Trait randomness: block hash after mint (sequencer-influenceable,
        cosmetic only).
      </p>
    </footer>
  )
}
