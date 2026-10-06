import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Landing scroll motion. Progressive enhancement: index.html adds `js-motion` to <html> only when
 * JS runs, IntersectionObserver exists and the user has not asked for reduced motion. Without that
 * class every element is simply visible. Elements opt in with `data-rv="<kind>"` and get `.in`
 * once (CSS in landing.css does the rest with transform / opacity / stroke-dashoffset only).
 */
export const motionOn = () => typeof document !== 'undefined' && document.documentElement.classList.contains('js-motion')

export function useLandingMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const on = motionOn()

    // Scroll progress line (nav) + a very small parallax on the hero figure: one rAF per scroll burst.
    const nav = el.querySelector<HTMLElement>('.ds-nav')
    const fig = on ? el.querySelector<HTMLElement>('.ds-hero-fig') : null
    let frame = 0
    const paint = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - innerHeight
      nav?.style.setProperty('--p', String(max > 0 ? Math.min(1, scrollY / max) : 0))
      if (fig && scrollY < innerHeight * 1.5) fig.style.transform = `translate3d(0, ${(scrollY * 0.06).toFixed(1)}px, 0)`
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll, { passive: true })
    paint()
    const cleanupScroll = () => {
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    if (!on) return cleanupScroll

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0 },
    )
    const watch = () => el.querySelectorAll('[data-rv]:not(.in)').forEach((x) => io.observe(x))
    watch()
    // Live data adds rows / figures later: observe those too (batched to one pass per frame).
    let pending = 0
    const mo = new MutationObserver(() => {
      if (!pending) pending = requestAnimationFrame(() => ((pending = 0), watch()))
    })
    mo.observe(el, { childList: true, subtree: true })
    const revealAll = () => el.querySelectorAll('[data-rv]').forEach((x) => x.classList.add('in'))
    addEventListener('beforeprint', revealAll)
    return () => {
      cleanupScroll()
      io.disconnect()
      mo.disconnect()
      if (pending) cancelAnimationFrame(pending)
      removeEventListener('beforeprint', revealAll)
    }
  }, [root])
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * An integer that counts up from 0 once, when it is on screen and its live value has arrived.
 * Later updates show directly. '…' until the value is known; no animation without js-motion.
 */
export function CountUp({ value }: { value?: bigint | number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [cur, setCur] = useState<number | undefined>()
  const done = useRef(false)
  const target = value === undefined ? undefined : Number(value)

  useEffect(() => {
    if (target === undefined || done.current || !ref.current) return
    if (!motionOn()) {
      done.current = true
      return
    }
    let raf = 0
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return
        io.disconnect()
        const t0 = performance.now()
        const dur = 900
        const tick = (now: number) => {
          const k = Math.min(1, (now - t0) / dur)
          setCur(target * (1 - Math.pow(1 - k, 3)))
          if (k < 1) raf = requestAnimationFrame(tick)
          else {
            done.current = true
            setCur(undefined)
          }
        }
        raf = requestAnimationFrame(tick)
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    setCur(0)
    io.observe(ref.current)
    return () => {
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [target])

  return <span ref={ref}>{target === undefined ? '…' : fmt(cur ?? target)}</span>
}
