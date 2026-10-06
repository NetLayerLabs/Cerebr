import { useEffect, useRef, useState } from 'react'
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import type { Connector } from 'wagmi'
import { useNet } from '../hooks/useCpu.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { useToasts } from '../hooks/useToasts.tsx'
import { errorMessage } from '../lib/errors.ts'
import { Logo } from './Logo.tsx'

const isOkx = (c: Connector) => /okx/i.test(c.name) || c.id === 'okxWallet' || c.id === 'com.okex.wallet'

/** Injected wallets (OKX Wallet first). */
function useWalletOptions() {
  const all = useConnectors()
  const discoveredOkx = all.some((c) => c.id !== 'okxWallet' && isOkx(c))
  const okxInjected = typeof window !== 'undefined' && !!window.okxwallet
  return all
    .filter((c) => (c.id === 'okxWallet' ? !discoveredOkx : true)) // prefer the EIP-6963 entry when present
    .map((c) => ({
      connector: c,
      label: c.id === 'injected' ? 'Browser wallet' : c.name,
      okx: isOkx(c),
      unavailable: c.id === 'okxWallet' && !okxInjected,
    }))
    .sort((a, b) => Number(b.okx) - Number(a.okx))
}

export function Header() {
  const { chainId, chain, blockNumber } = useNet()
  const { address, chainId: walletChainId, isConnected } = useConnection()
  const { mutate: switchChain } = useSwitchChain()
  const { push } = useToasts()
  const switchTo = (id: number) =>
    switchChain({ chainId: id }, { onError: (e) => push({ kind: 'error', title: 'Network not switched', body: errorMessage(e) }) })
  const { mutate: connect, error: connectError, isPending } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { data: bal } = useBalance({ address, chainId, query: { refetchInterval: 6_000 } })
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = useWalletOptions()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const wrongNetwork = isConnected && walletChainId !== chainId

  return (
    <header className="header">
      <a className="brand" href="/" title="Cerebr home">
        <Logo size={26} />
        <span className="brand-name">Cerebr</span>
        <span className="brand-tag">CRB-1</span>
      </a>

      <div className="header-right">
        <label className="chain-select" title="Network">
          <span className={`dot ${blockNumber !== undefined ? 'live' : ''}`} />
          <span>{chain?.name}</span>
        </label>

        {isConnected && address ? (
          <div className="wallet">
            {wrongNetwork ? (
              <button className="btn warn" onClick={() => switchTo(chainId)}>
                Switch to {chain?.name}
              </button>
            ) : (
              <span className="mono small muted">{bal ? `${fmt(bal.value, 4)} OKB` : ''}</span>
            )}
            <button className="btn ghost mono" onClick={() => disconnect()} title="Disconnect">
              {shortAddr(address)}
            </button>
          </div>
        ) : (
          <div className="connect" ref={menuRef}>
            <button className="btn primary" onClick={() => setOpen((o) => !o)} disabled={isPending}>
              {isPending ? 'Connecting…' : 'Connect wallet'}
            </button>
            {open && (
              <div className="menu">
                {options.map((o) =>
                  o.unavailable ? (
                    <a key={o.connector.uid} className="menu-item" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">
                      {o.label} <span className="muted small">install ↗</span>
                    </a>
                  ) : (
                    <button
                      key={o.connector.uid}
                      className={`menu-item ${o.okx ? 'okx' : ''}`}
                      onClick={() => {
                        setOpen(false)
                        connect({ connector: o.connector, chainId })
                      }}
                    >
                      {o.connector.icon && <img src={o.connector.icon} alt="" width={18} height={18} />}
                      {o.label}
                      {o.okx && <span className="tag">recommended</span>}
                    </button>
                  ),
                )}
              </div>
            )}
            {connectError && <div className="error small">{errorMessage(connectError)}</div>}
          </div>
        )}
      </div>
    </header>
  )
}
