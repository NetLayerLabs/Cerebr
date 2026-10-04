import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './wagmi.ts'
import { ToastProvider } from './hooks/useToasts.tsx'
import { Landing } from './landing/Landing.tsx'
import './styles.css'

// Landing page at '/', the dApp at '/app' (code-split so the landing page loads fast).
const App = lazy(() => import('./App.tsx').then((m) => ({ default: m.App })))
const isApp = /^\/app(\/|$)/.test(window.location.pathname)

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {isApp ? (
            <Suspense fallback={null}>
              <App />
            </Suspense>
          ) : (
            <Landing />
          )}
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
