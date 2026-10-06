import { useEffect, useRef, useState } from 'react'
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import type { Connector } from 'wagmi'
import { useNet } from '../hooks/useCpu.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { useToasts } from '../hooks/useToasts.tsx'
import { errorMessage } from '../lib/errors.ts'
import { Logo } from './Logo.tsx'
import { XLAYER_ADD_CHAIN } from '../config/chains.ts'
import { hasInjectedProvider, isMobile, metamaskDeepLink, okxDeepLink } from '../lib/wallets.ts'
import { Preferences } from './Preferences.tsx'
import { useT, type T } from '../i18n/index.tsx'

const isOkx = (c: Connector) => /okx/i.test(c.name) || c.id === 'okxWallet' || c.id === 'com.okex.wallet'

/** Injected wallets (OKX Wallet first). */
function useWalletOptions(t: T) {
  const all = useConnectors()
  const discoveredOkx = all.some((c) => c.id !== 'okxWallet' && isOkx(c))
  const okxInjected = typeof window !== 'undefined' && !!window.okxwallet
  return all
    .filter((c) => (c.id === 'okxWallet' ? !discoveredOkx : true)) // prefer the EIP-6963 entry when present
    .map((c) => ({
      connector: c,
      label: c.id === 'injected' ? t('hdr.browserWallet') : c.name,
      okx: isOkx(c),
      unavailable: c.id === 'okxWallet' && !okxInjected,
    }))
    .sort((a, b) => Number(b.okx) - Number(a.okx))
}

export function Header() {
  const { chainId, chain, blockNumber } = useNet()
  const t = useT()
  const { address, chainId: walletChainId, isConnected } = useConnection()
  const { mutate: switchChain } = useSwitchChain()
  const { push } = useToasts()
  const switchTo = (id: number) =>
    // addEthereumChainParameter: used by the connector's wallet_addEthereumChain fallback when the
    // wallet does not know X Layer yet (error 4902), e.g. a fresh mobile wallet.
    switchChain({ chainId: id, addEthereumChainParameter: XLAYER_ADD_CHAIN }, { onError: (e) => push({ kind: 'error', title: t('hdr.notSwitched'), body: errorMessage(e) }) })
  const { mutate: connect, error: connectError, isPending } = useConnect()
  const { mutate: disconnect } = useDisconnect()
  const { data: bal } = useBalance({ address, chainId, query: { refetchInterval: 6_000 } })
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = useWalletOptions(t)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const wrongNetwork = isConnected && walletChainId !== chainId
  // No extension / in-app provider and no EIP-6963 announcement: offer deep links into wallet apps.
  const noWallet = !hasInjectedProvider() && options.every((o) => o.connector.id === 'okxWallet' || o.connector.id === 'injected')
  const mobile = isMobile()
  const here = typeof window !== 'undefined' ? window.location : undefined
  const deepLinks = here
    ? [
        { key: 'okx', label: t('hdr.openOkx'), href: okxDeepLink(here.href) },
        { key: 'mm', label: t('hdr.openMm'), href: metamaskDeepLink(here) },
      ]
    : []

  return (
    <header className="header">
      <a className="brand" href="/" title={t('hdr.home')}>
        <Logo size={26} />
        <span className="brand-name">Cerebr</span>
        <span className="brand-tag">CRB-1</span>
      </a>

      <Preferences className="header-prefs" />

      <div className="header-right">
        <label className="chain-select" title={t('hdr.network')}>
          <span className={`dot ${blockNumber !== undefined ? 'live' : ''}`} />
          <span>{chain?.name}</span>
        </label>

        {isConnected && address ? (
          <div className="wallet">
            {wrongNetwork ? (
              <button className="btn warn" onClick={() => switchTo(chainId)}>
                {t('hdr.switchTo', { chain: chain?.name ?? '' })}
              </button>
            ) : (
              <span className="mono small muted">{bal ? `${fmt(bal.value, 4)} OKB` : ''}</span>
            )}
            <button className="btn ghost mono" onClick={() => disconnect()} title={t('hdr.disconnect')}>
              {shortAddr(address)}
            </button>
          </div>
        ) : (
          <div className="connect" ref={menuRef}>
            <button className="btn primary" onClick={() => setOpen((o) => !o)} disabled={isPending}>
              {isPending ? t('hdr.connecting') : t('hdr.connect')}
            </button>
            {open && (
              <div className="menu">
                {noWallet && mobile && (
                  <>
                    <p className="menu-note">{t('hdr.noWalletMobile')}</p>
                    {deepLinks.map((d) => (
                      <a key={d.key} className="menu-item okx" href={d.href} rel="noopener noreferrer">
                        {d.label} <span className="muted small">↗</span>
                      </a>
                    ))}
                  </>
                )}
                {!(noWallet && mobile) && options.filter((o) => !(noWallet && o.connector.id === 'injected')).map((o) =>
                  o.unavailable ? (
                    <a key={o.connector.uid} className="menu-item" href="https://www.okx.com/web3" target="_blank" rel="noreferrer">
                      {t('hdr.installOkx')} <span className="muted small">↗</span>
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
                      {o.okx && <span className="tag">{t('hdr.recommended')}</span>}
                    </button>
                  ),
                )}
                {noWallet && !mobile && (
                  <>
                    <p className="menu-note">{t('hdr.noWalletDesktop')}</p>
                    {deepLinks.map((d) => (
                      <a key={d.key} className="menu-item" href={d.href} target="_blank" rel="noopener noreferrer">
                        {d.label} <span className="muted small">↗</span>
                      </a>
                    ))}
                  </>
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
