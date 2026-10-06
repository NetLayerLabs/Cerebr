import { useCpu, useNet } from './hooks/useCpu.ts'
import { VIEWS, href, useRoute } from './hooks/useRoute.ts'
import { Header } from './components/Header.tsx'
import { SiteFooter } from './components/SiteFooter.tsx'
import { Toasts } from './components/Toasts.tsx'
import { ProcessorView } from './views/ProcessorView.tsx'
import { StudioView } from './views/StudioView.tsx'
import { PlaygroundView } from './views/PlaygroundView.tsx'
import { GalleryView } from './views/GalleryView.tsx'
import { useT } from './i18n/index.tsx'

export function App() {
  const route = useRoute()
  const { chain } = useNet()
  const { cfg, cpu, error } = useCpu()
  const t = useT()

  return (
    <div className="shell">
      <div className="bg-grid" aria-hidden />
      <Header />
      <nav className="nav" aria-label={t('nav.aria')}>
        {VIEWS.map(([id]) => (
          <a key={id} href={href(id)} className={route.view === id ? 'on' : ''} aria-current={route.view === id ? 'page' : undefined}>
            {t(`nav.${id}`)}
          </a>
        ))}
      </nav>
      <main>
        {!cfg ? (
          <div className="card notice">
            <h2>{t('app.noCpu', { chain: chain?.name ?? t('app.thisNetwork') })}</h2>
            <p className="muted">{t('app.noCpuBody')}</p>
          </div>
        ) : error && !cpu ? (
          <div className="card notice">
            <h2>{t('app.readFail')}</h2>
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
      <SiteFooter />
      <Toasts />
    </div>
  )
}
