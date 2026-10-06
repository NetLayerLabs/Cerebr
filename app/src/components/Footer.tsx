import { useCpu, useNet } from '../hooks/useCpu.ts'
import { TAPEOUT } from '../lib/cerebr.ts'
import { shortAddr } from '../lib/format.ts'
import { BuiltBy } from './BuiltBy.tsx'

export function Footer() {
  const { explorerAddr, chain, cfg } = useNet()
  const { cpu } = useCpu()
  const rows: [string, string | undefined][] = [
    ['TapeOut factory', TAPEOUT.factory],
    ['Cerebr transistors', cpu?.transistors ?? cfg?.transistors],
    ['Cerebr circuits', cfg?.circuits],
    ['Brain wallet opener', TAPEOUT.opener],
    ['CerebrScope', cfg?.scope],
  ]
  return (
    <footer className="footer">
      <div className="addrs">
        {rows.map(([k, a]) =>
          a ? (
            <a key={k} href={explorerAddr(a)} target="_blank" rel="noreferrer" className="small">
              <span className="muted">{k}</span> <span className="mono">{shortAddr(a)}</span>
            </a>
          ) : null,
        )}
      </div>
      <p className="tiny muted">
        Cerebr on {chain?.name ?? 'X Layer'} · A processor created through the TapeOut factory: transistors are TapeOut
        ERC-1155 NAND / LATCH, circuits are TapeOut ERC-721 netlists evaluated onchain. TapeOut's X Layer contracts are
        upgradeable and unaudited (test phase), so every fee shown here is read live before you sign.
      </p>
      <div className="footer-credit">
        <BuiltBy />
      </div>
    </footer>
  )
}
