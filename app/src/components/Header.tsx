import { useEffect, useRef, useState } from 'react'
import { useBalance, useChains, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import type { Connector } from 'wagmi'
import { FORK_CHAIN_ID } from '../config/chains.ts'
import { useNet } from '../hooks/useCpu.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { errorMessage } from '../lib/errors.ts'
import { Logo } from './Logo.tsx'

const isOkx = (c: Connector) => /okx/i.test(c.name) || c.id === 'okxWallet' || c.id === 'com.okex.wallet'

function useWalletOptions(chainId: number) {
  const all = useConnectors()
  const discoveredOkx = all.some((c) => c.id !== 'okxWallet' && isOkx(c))
  const okxInjected = typeof window !== 'undefined' && !!window.okxwallet
  return all
    .filter((c) => {
      if (c.id === 'okxWallet') return !discoveredOkx // prefer the EIP-6963 entry when present
      if (c.type === 'mock') return chainId === FORK_CHAIN_ID
      return true
    })
    .map((c) => ({
      connector: c,
      label: c.type === 'mock' ? 'Fork dev account #2 (local)' : c.id === 'injected' ? 'Browser wallet' : c.name,
      okx: isOkx(c),
      unavailable: c.id === 'okxWallet' && !okxInjected,
    }))
    .sort((a, b) => Number(b.okx) - Number(a.okx))
}

export function Header() {
  const { chainId, chain, blockNumber } = useNet()
  const chains = useChains()
  const { address, chainId: walletChainId, isConnected } = useConnection()
  const { mutate: switchChain } = useSwitchChain()
  const { mutate: connect, error: connectError, isPending } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { data: bal } = useBalance({ address, chainId, query: { refetchInterval: 6_000 } })
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = useWalletOptions(chainId)

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
        <Logo />
        <div>
          <div className="brand-name">CEREBR</div>
          <div className="brand-sub">neural processor · TapeOut · X Layer</div>
        </div>
      </a>

      <div className="header-right">
        <label className="chain-select" title="Network">
          <span className={`dot ${blockNumber !== undefined ? 'live' : ''}`} />
          {chains.length > 1 ? (
            <select value={chainId} onChange={(e) => switchChain({ chainId: Number(e.target.value) })}>
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span>{chains[0]?.name}</span>
          )}
        </label>

        {isConnected && address ? (
          <div className="wallet">
            {wrongNetwork ? (
              <button className="btn warn" onClick={() => switchChain({ chainId })}>
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
