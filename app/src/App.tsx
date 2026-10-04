import { useCallback, useState } from 'react'
import { useCerebr } from './hooks/useCerebr.ts'
import { Header } from './components/Header.tsx'
import { Stats } from './components/Stats.tsx'
import { CurveChart } from './components/CurveChart.tsx'
import { TradePanel } from './components/TradePanel.tsx'
import { TapeOutPanel } from './components/TapeOutPanel.tsx'
import { FusionPanel } from './components/FusionPanel.tsx'
import { Gallery } from './components/Gallery.tsx'
import { Footer } from './components/Footer.tsx'
import { Toasts } from './components/Toasts.tsx'

export function App() {
  const { deployment, chain, stateError, state } = useCerebr()
  const [preview, setPreview] = useState<bigint | undefined>()
  const onPreview = useCallback((d: bigint | undefined) => setPreview(d), [])

  return (
    <div className="shell">
      <div className="bg-grid" aria-hidden />
      <Header />
      <main>
        {!deployment ? (
          <div className="card notice">
            <h2>Not deployed on {chain?.name ?? 'this network'} yet</h2>
            <p className="muted">
              Pick another network, or run the local demo (<code>app/README.md</code>) and <code>npm run sync</code>.
            </p>
          </div>
        ) : stateError && !state ? (
          <div className="card notice">
            <h2>Can't reach the Cerebr lens</h2>
            <p className="muted small mono">{stateError.message.split('\n')[0]}</p>
          </div>
        ) : (
          <>
            <section className="hero">
              <h1>
                Mint compute. <span className="grad">Burn it into brains.</span>
              </h1>
              <p className="muted">
                Transistors ($CBR) are issued on a linear bonding curve backed by OKB. Tape-outs and fusion burn them for
                on-chain Neural Circuit NFTs, and every burn leaves its OKB locked in the reserve forever.
              </p>
            </section>
            <Stats />
            <section className="grid-2">
              <div className="card">
                <div className="card-head">
                  <h2>Bonding curve</h2>
                  <span className="small muted">price = base + slope × supply</span>
                </div>
                <CurveChart preview={preview} />
              </div>
              <TradePanel onPreview={onPreview} />
            </section>
            <section className="grid-2 tape">
              <TapeOutPanel />
              <FusionPanel />
            </section>
            <Gallery />
          </>
        )}
      </main>
      <Footer />
      <Toasts />
    </div>
  )
}
