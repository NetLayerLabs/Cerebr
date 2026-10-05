import { useCpu, useNet } from './hooks/useCpu.ts'
import { VIEWS, href, useRoute } from './hooks/useRoute.ts'
import { Header } from './components/Header.tsx'
import { Footer } from './components/Footer.tsx'
import { Toasts } from './components/Toasts.tsx'
import { ProcessorView } from './views/ProcessorView.tsx'
import { StudioView } from './views/StudioView.tsx'
import { PlaygroundView } from './views/PlaygroundView.tsx'
import { GalleryView } from './views/GalleryView.tsx'

export function App() {
  const route = useRoute()
  const { chain, isFork } = useNet()
  const { cfg, cpu, error } = useCpu()

  return (
    <div className="shell">
      <div className="bg-grid" aria-hidden />
      <Header />
      <nav className="nav" aria-label="Sections">
        {VIEWS.map(([id, label]) => (
          <a key={id} href={href(id)} className={route.view === id ? 'on' : ''} aria-current={route.view === id ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <main>
        {!cfg ? (
          <div className="card notice">
            <h2>No Cerebr processor on {chain?.name ?? 'this network'} yet</h2>
            <p className="muted">
              {isFork ? (
                <>
                  Start a fork (<code>anvil --fork-url https://rpc.xlayer.tech --chain-id 31337</code>), run the launch
                  script against it, then <code>npm run sync</code>. Or open any TapeOut CPU with <code>?cpu=0x…</code>.
                </>
              ) : (
                <>
                  The processor is created through the TapeOut factory at launch. Pick the local fork, or open any TapeOut CPU
                  with <code>?cpu=0x…</code> (its circuits address).
                </>
              )}
            </p>
          </div>
        ) : error && !cpu ? (
          <div className="card notice">
            <h2>Can't read the processor from TapeOut</h2>
            <p className="muted small mono">{error.message.split('\n')[0]}</p>
          </div>
        ) : route.view === 'studio' ? (
          <StudioView key={route.arg} initial={route.arg} />
        ) : route.view === 'playground' ? (
          <PlaygroundView key={route.arg} circuitId={route.arg} />
        ) : route.view === 'gallery' ? (
          <GalleryView />
        ) : (
          <ProcessorView />
        )}
      </main>
      <Footer />
      <Toasts />
    </div>
  )
}
