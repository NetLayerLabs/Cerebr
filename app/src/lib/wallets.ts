/**
 * Mobile wallet support without WalletConnect: when the browser has no injected provider, offer
 * deep links that reopen the current page inside a wallet's in-app browser (which injects one).
 */

/** Phones and tablets (iPadOS reports a Mac UA, so also check touch points). */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Any EIP-1193 provider injected by an extension or an in-app browser. */
export function hasInjectedProvider(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as { ethereum?: unknown; okxwallet?: unknown }
  return !!w.ethereum || !!w.okxwallet
}

/**
 * OKX Wallet dApp deep link (OKX docs: okx://wallet/dapp/url?dappUrl=<encoded url>), wrapped in the
 * OKX universal link so it also works when the app is not installed (it then offers the download).
 */
export function okxDeepLink(href: string): string {
  return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(href)}`)}`
}

/** MetaMask dApp deep link: https://metamask.app.link/dapp/<host + path + query + hash> (no protocol). */
export function metamaskDeepLink(loc: Pick<Location, 'host' | 'pathname' | 'search' | 'hash'>): string {
  return `https://metamask.app.link/dapp/${loc.host}${loc.pathname}${loc.search}${loc.hash}`
}
