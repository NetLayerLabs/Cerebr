import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type Toast = { id: number; kind: 'pending' | 'success' | 'error'; title: string; body?: string; href?: string }

type Ctx = {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => number
  update: (id: number, t: Partial<Omit<Toast, 'id'>>) => void
  dismiss: (id: number) => void
}

const ToastCtx = createContext<Ctx | null>(null)
let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const autoDismiss = useCallback((id: number, kind: Toast['kind']) => {
    if (kind !== 'pending') setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 6000)
  }, [dismiss])
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId++
    setToasts((ts) => [...ts.slice(-4), { ...t, id }])
    autoDismiss(id, t.kind)
    return id
  }, [autoDismiss])
  const update = useCallback((id: number, t: Partial<Omit<Toast, 'id'>>) => {
    setToasts((ts) => ts.map((x) => (x.id === id ? { ...x, ...t } : x)))
    if (t.kind) autoDismiss(id, t.kind)
  }, [autoDismiss])
  const value = useMemo(() => ({ toasts, push, update, dismiss }), [toasts, push, update, dismiss])
  return <ToastCtx.Provider value={value}>{children}</ToastCtx.Provider>
}

export function useToasts() {
  const c = useContext(ToastCtx)
  if (!c) throw new Error('ToastProvider missing')
  return c
}
