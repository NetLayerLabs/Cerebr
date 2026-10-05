import { useEffect, useState } from 'react'

export const VIEWS = [
  ['processor', 'Processor'],
  ['studio', 'Circuit Studio'],
  ['playground', 'Inference'],
  ['gallery', 'Gallery'],
] as const
export type View = (typeof VIEWS)[number][0]

export type Route = { view: View; arg?: string }

function parse(): Route {
  const [v, arg] = window.location.hash.replace(/^#\/?/, '').split('/')
  const view = (VIEWS.find(([id]) => id === v)?.[0] ?? 'processor') as View
  return { view, arg: arg || undefined }
}

/** Hash routes inside /app: #processor, #studio, #playground/<circuitId>, #gallery. */
export function useRoute(): Route {
  const [r, setR] = useState(parse)
  useEffect(() => {
    const on = () => {
      setR(parse())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

export const href = (view: View, arg?: string | bigint) => `#${view}${arg !== undefined ? `/${arg}` : ''}`
