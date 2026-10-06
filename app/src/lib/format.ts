import { formatUnits } from 'viem'

/** Format an 18-decimal amount with up to `sig` significant digits (no scientific notation). */
export function fmt(wei: bigint | undefined, sig = 4, decimals = 18): string {
  if (wei === undefined) return '-'
  const neg = wei < 0n
  const s = formatUnits(neg ? -wei : wei, decimals)
  const [int, frac = ''] = s.split('.')
  let out: string
  if (int !== '0') {
    const keep = Math.max(0, sig - int.length)
    const f = frac.slice(0, keep).replace(/0+$/, '')
    out = Number(int).toLocaleString('en-US') + (f ? '.' + f : '')
  } else {
    const lead = frac.match(/^0*/)?.[0].length ?? 0
    const f = frac.slice(0, lead + sig).replace(/0+$/, '')
    out = f ? '0.' + f : '0'
  }
  return (neg ? '-' : '') + out
}

/** The exact amount (every digit, trailing zeros trimmed): for prices a wallet will be charged. */
export function okb(wei: bigint, decimals = 18): string {
  const s = formatUnits(wei, decimals)
  const [int, frac] = s.split('.')
  return BigInt(int).toLocaleString('en-US') + (frac ? '.' + frac : '')
}

/** Compact amount: 1.25M, 950k, 12.5. */
export function compact(wei: bigint | undefined, decimals = 18): string {
  if (wei === undefined) return '-'
  const n = Number(formatUnits(wei, decimals))
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)
}

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

/** Parse a decimal string into 18-dec wei; undefined on invalid / empty input. */
export function parseAmount(v: string, decimals = 18): bigint | undefined {
  const t = v.trim()
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return undefined
  const [i, f = ''] = t.split('.')
  if (f.length > decimals) return undefined
  return BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

/** a * (10000 + bps) / 10000, rounded up. */
export const plusBps = (a: bigint, bps: number) => (a * BigInt(10_000 + bps) + 9_999n) / 10_000n
/** a * (10000 - bps) / 10000, rounded down. */
export const minusBps = (a: bigint, bps: number) => (a * BigInt(10_000 - bps)) / 10_000n
