import { useEffect, useRef, useState } from 'react'
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from 'wagmi'
import type { Connector } from 'wagmi'
import { useNet } from '../hooks/useCpu.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { useToasts } from '../hooks/useToasts.tsx'
import { errorMessage } from '../lib/errors.ts'
import { BrandLockup } from './BrandLockup.tsx'
import { XLAYER_ADD_CHAIN } from '../config/chains.ts'
import { hasInjectedProvider, isMobile, metamaskDeepLink, okxDeepLink } from '../lib/wallets.ts'
import { Preferences } from './Preferences.tsx'
import { useT, type T } from '../i18n/index.tsx'

const isOkx = (c: Connector) => /okx/i.test(c.name) || c.id === 'okxWallet' || c.id === 'com.okex.wallet'

/** Injected wallets (OKX Wallet first). */
function useWalletOptions(t: T) {
  const all = useConnectors()
  const discoveredOkx = all.some((c) => c.id !== 'okxWallet' && isOkx(c))
  // EIP-6963 connectors carry the wallet's rdns as id; the two configured in wagmi.ts do not.
  const announced = all.some((c) => c.id !== 'okxWallet' && c.id !== 'injected')
  const okxInjected = typeof window !== 'undefined' && !!window.okxwallet
  return all
    .filter((c) => (c.id === 'okxWallet' ? !discoveredOkx : true)) // prefer the EIP-6963 entry when present
    .filter((c) => (c.id === 'injected' ? !announced : true)) // window.ethereum is one of the announced wallets
    .map((c) => ({
      connector: c,
      label: c.id === 'injected' ? t('hdr.browserWallet') : c.name,
      okx: isOkx(c),
      unavailable: c.id === 'okxWallet' && !okxInjected,
    }))
    .sort((a, b) => Number(b.okx) - Number(a.okx))
}

type MenuRow = {
  key: string
  label: string
  /** Wallet icon (EIP-6963 data URI); the glyph tile is the fallback. */
  icon?: string
  glyph: string
  tag: string
  accent?: boolean
  href?: string
  /** Deep links on mobile hand over to the wallet app in the same tab. */
  sameTab?: boolean
  /** Note shown as a divider above this row. */
  section?: string
  onClick?: () => void
}

/** Wallet picker in the datasheet style: caption bar, numbered rows with a status tag, safety note. */
function WalletMenu({ t, netName, live, rows }: { t: T; netName: string; live: boolean; rows: MenuRow[] }) {
  return (
    <div className="menu wm" role="menu">
      <div className="wm-head">
        <span>{t('hdr.menuTitle')}</span>
        <span className="wm-net">
          <span className={`dot ${live ? 'live' : ''}`} />
          {netName}
        </span>
      </div>
      <ul className="wm-list">
        {rows.map((r, i) => {
          const body = (
            <>
              <span className="wm-idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="wm-icon" aria-hidden>
                {r.icon ? <img src={r.icon} alt="" width={20} height={20} /> : <span className="wm-glyph">{r.glyph}</span>}
              </span>
              <span className="wm-name">{r.label}</span>
              <span className={`wm-tag ${r.accent ? 'acc' : ''}`}>{r.tag}</span>
              <span className="wm-go" aria-hidden>
                {r.href ? '↗' : '→'}
              </span>
            </>
          )
          return (
            <li key={r.key}>
              {r.section && <p className="wm-note">{r.section}</p>}
              {r.href ? (
                <a className="wm-row" role="menuitem" href={r.href} rel="noopener noreferrer" {...(r.sameTab ? {} : { target: '_blank' })}>
                  {body}
                </a>
              ) : (
                <button className="wm-row" role="menuitem" onClick={r.onClick}>
                  {body}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="wm-foot">{t('hdr.menuFoot')}</p>
    </div>
  )
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
        <BrandLockup height={28} />
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
              <WalletMenu
                t={t}
                netName={chain?.name ?? ''}
                live={blockNumber !== undefined}
                rows={[
                  ...(noWallet && mobile ? [] : options.filter((o) => !(noWallet && o.connector.id === 'injected'))).map(
                    (o): MenuRow =>
                      o.unavailable
                        ? { key: o.connector.uid, label: t('hdr.installOkx'), glyph: 'OKX', tag: t('hdr.tagInstall'), href: 'https://www.okx.com/web3' }
                        : {
                            key: o.connector.uid,
                            label: o.label,
                            icon: o.connector.icon,
                            glyph: o.connector.id === 'injected' ? '◇' : o.label.slice(0, 2).toUpperCase(),
                            tag: o.okx ? t('hdr.recommended') : o.connector.id === 'injected' ? t('hdr.tagInjected') : t('hdr.tagDetected'),
                            accent: o.okx,
                            onClick: () => {
                              setOpen(false)
                              connect({ connector: o.connector, chainId })
                            },
                          },
                  ),
                  ...(noWallet
                    ? deepLinks.map((d, i): MenuRow => ({ section: i === 0 ? t(mobile ? 'hdr.noWalletMobile' : 'hdr.noWalletDesktop') : undefined, key: d.key, label: d.label, glyph: d.key === 'okx' ? 'OKX' : 'MM', tag: t('hdr.tagApp'), href: d.href, accent: d.key === 'okx' && mobile, sameTab: mobile }))
                    : []),
                ]}
              />
            )}
            {connectError && <div className="error small">{errorMessage(connectError)}</div>}
          </div>
        )}
      </div>
    </header>
  )
}
