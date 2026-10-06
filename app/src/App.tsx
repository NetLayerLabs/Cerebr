import { useEffect, useRef } from 'react'
import { useCpu, useNet } from './hooks/useCpu.ts'
import { NavIcon } from './components/NavIcons.tsx'
import { VIEWS, href, useRoute } from './hooks/useRoute.ts'
import { Header } from './components/Header.tsx'
import { SiteFooter } from './components/SiteFooter.tsx'
import { Toasts } from './components/Toasts.tsx'
import { ProcessorView } from './views/ProcessorView.tsx'
import { StudioView } from './views/StudioView.tsx'
import { PlaygroundView } from './views/PlaygroundView.tsx'
import { GalleryView } from './views/GalleryView.tsx'
import { TrainView } from './views/TrainView.tsx'
import { ArenaView } from './views/ArenaView.tsx'
import { AgentView } from './views/AgentView.tsx'
import { useT } from './i18n/index.tsx'

export function App() {
  const route = useRoute()
  const { chain } = useNet()
  const { cfg, cpu, error } = useCpu()
  const t = useT()
  const navRef = useRef<HTMLElement>(null)
  // Narrow screens scroll the tab bar sideways: keep the current tab in view.
  useEffect(() => {
    const nav = navRef.current
    const on = nav?.querySelector<HTMLElement>('a.on')
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return
    const left = on.offsetLeft - nav.offsetLeft
    if (left < nav.scrollLeft || left + on.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, left - 16)
  }, [route.view])
  // While more tabs are hidden to the right, fade the right edge (data-more, see styles.css).
  useEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => {
      nav.dataset.more = String(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1)
    }
    update()
    nav.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(nav)
    return () => {
      nav.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="shell">
      <div className="bg-grid" aria-hidden />
      <Header />
      <nav className="nav" ref={navRef} aria-label={t('nav.aria')}>
        {VIEWS.map(([id]) => (
          <a key={id} href={href(id)} className={route.view === id ? 'on' : ''} aria-current={route.view === id ? 'page' : undefined}>
            <NavIcon view={id} />
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
        ) : route.view === 'train' ? (
          <TrainView key={route.arg} arg={route.arg} />
        ) : route.view === 'arena' ? (
          <ArenaView key={route.arg} arg={route.arg} />
        ) : route.view === 'agent' ? (
          <AgentView />
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
