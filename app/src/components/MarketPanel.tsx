import { useState, type ReactNode } from 'react'
import { useConnection } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { parseAbi, type Abi, type Address, type PublicClient } from 'viem'
import {
  MAX_PRICE,
  XLAYER_MARKET,
  buyBlockReason,
  circuitMarketAbi,
  isMarketApproved,
  readListingById,
  readListings,
  sameAddress,
  splitSale,
  type CircuitMarketConfig,
  type Listing,
} from '@cerebr/sdk/tapeout'
import { useCircuits, useNet, type CircuitRow } from '../hooks/useCpu.ts'
import { useInFlight, useTx, type TxParams } from '../hooks/useTx.ts'
import { useToasts } from '../hooks/useToasts.tsx'
import { TAPEOUT } from '../lib/cerebr.ts'
import { errorMessage } from '../lib/errors.ts'
import { fmt, okb, parseAmount } from '../lib/format.ts'
import { Addr } from './ui.tsx'
import { translate, useI18n, type Key } from '../i18n/index.tsx'
import '../views/market.css'

/**
 * Circuit marketplace (TapeOut CircuitMarket, address in useNet().contracts.market; SDK:
 * readListing(s), buyBlockReason, splitSale; see TAPEOUT.md §9). Owned by the Market engineer,
 * together with views/market.css, src/i18n/ns/market.* and the "MARKET" blocks in views/GalleryView.tsx.
 *
 * Writes go through useTx (simulate -> wallet -> receipt -> refresh). Each one is also simulated
 * here first, so the market's require() strings ("own listing", "price changed"…) come back as
 * translated copy instead of raw revert text.
 */

/**
 * Cerebr-controlled wallets: the deployment wallet (which also deployed NeuralArena and the drops) and the
 * Cerebr team test wallet. They never buy on the marketplace at all (TAPEOUT.md §9.4: no self-trading, no wash trading).
 */
const CEREBR_WALLETS: readonly Address[] = ['0xc742AdA2872a042dD36D2E706907b4036968960C', '0xcd0a2370f2dc12c1802707b7d9ab3fec891e3c02']

const erc721Abi = parseAbi(['function approve(address to, uint256 tokenId)'])

type Brain = { account: Address; balance: bigint }
type MarketData = {
  /** Global market fee (bps) for new listings; each listing keeps its own snapshot. */
  feeBps: number
  /** Listing by circuit id (string), only circuits that have one (valid or stale). */
  listings: Map<string, Listing>
}

const marketCfg = (market: Address, from: bigint): CircuitMarketConfig => ({ ...XLAYER_MARKET, circuitMarket: market, circuitMarketFrom: from })

/**
 * All listings (one multicall of listingFor, then listingView for the fee snapshot). Brain wallets
 * come from the Gallery's own query (passed in as `brain`), so they are not read twice.
 */
function useMarket() {
  const { chainId, cfg, contracts, pc } = useNet()
  const { circuits } = useCircuits()
  const ids = circuits?.map((c) => c.id)
  const idKey = ids?.join(',')
  const q = useQuery({
    queryKey: ['cerebr', 'market', chainId, contracts?.market, cfg?.circuits, idKey],
    enabled: !!pc && !!cfg && !!contracts && !!ids?.length,
    refetchInterval: 20_000,
    queryFn: async (): Promise<MarketData> => {
      const mc = marketCfg(contracts!.market, contracts!.marketFrom)
      const m = { address: mc.circuitMarket, abi: circuitMarketAbi } as const
      const [base, feeBps] = await Promise.all([readListings(pc!, cfg!.circuits, ids!, mc), pc!.readContract({ ...m, functionName: 'feeBps' })])
      const listed = base.filter((l): l is Listing => !!l)
      const views = listed.length
        ? await pc!.multicall({
            allowFailure: false,
            multicallAddress: TAPEOUT.multicall3,
            contracts: listed.map((l) => ({ ...m, functionName: 'listingView', args: [l.id] }) as const),
          })
        : []
      const listings = new Map<string, Listing>()
      listed.forEach((l, i) => {
        const [seller, , , price, fee, valid] = views[i] as readonly [Address, Address, bigint, bigint, number, boolean]
        listings.set(l.tokenId.toString(), { ...l, seller, price, feeBps: fee, valid })
      })
      return { feeBps: Number(feeBps), listings }
    },
  })
  return { ...q, mc: contracts ? marketCfg(contracts.market, contracts.marketFrom) : undefined }
}

/**
 * Ids (as strings) of circuits with a live (valid) listing; undefined while loading. GalleryView's
 * "For sale" filter reads this.
 */
export function useForSale(): Set<string> | undefined {
  const { circuits } = useCircuits()
  const { data, error } = useMarket()
  if (circuits && circuits.length === 0) return new Set()
  if (error) return new Set()
  if (!data) return undefined
  return new Set([...data.listings.values()].filter((l) => l.valid).map((l) => l.tokenId.toString()))
}

/** The market's require() strings (fork-verified, TAPEOUT.md §9.2) as translated copy. */
const MARKET_REVERTS: [string, Key][] = [
  ['not approved', 'market.err.notApproved'],
  ['not your listing', 'market.err.notYourListing'],
  ['not owner', 'market.err.notOwner'],
  ['zero price', 'market.err.zeroPrice'],
  ['own listing', 'market.err.ownListing'],
  ['price changed', 'market.err.priceChanged'],
  ['wrong value', 'market.err.wrongValue'],
  ['ERC721InsufficientApproval', 'market.err.stale'],
  ['0x177e802f', 'market.err.stale'],
]

function marketError(e: unknown): string {
  const raw = e instanceof Error ? `${e.message} ${(e as { shortMessage?: string }).shortMessage ?? ''}` : String(e)
  for (const [k, key] of MARKET_REVERTS) if (raw.includes(k)) return translate(key)
  return errorMessage(e)
}

/** useTx().send, preceded by our own simulation so market reverts read as friendly copy. */
function useMarketTx() {
  const { send, busy } = useTx()
  const { inFlight, guard } = useInFlight()
  const { pc } = useNet()
  const { address } = useConnection()
  const { push } = useToasts()
  const run = async (label: string, params: TxParams, opts?: { refresh?: boolean }) => {
    if (address && pc) {
      try {
        await pc.simulateContract({ ...params, account: address } as Parameters<PublicClient['simulateContract']>[0])
      } catch (e) {
        push({ kind: 'error', title: label, body: marketError(e) })
        return undefined
      }
    }
    return send(label, params, opts)
  }
  // `guard` wraps a whole click (fresh reads, pre-simulation, approve + list) so a double click
  // cannot send twice: useTx's own `busy` is only set once send() starts.
  return { run, guard, busy: busy || inFlight }
}

const pctOf = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Rendered inside every Gallery card: price / buy for others, list / reprice / delist for the owner. */
export function MarketPanel({ c, mine, brain }: { c: CircuitRow; mine: boolean; brain?: Brain }) {
  const { t } = useI18n()
  const { data, error, isLoading, mc } = useMarket()
  const id = c.id.toString()

  if (error) return <Frame>{<span className="tiny error">{t('market.readError')}</span>}</Frame>
  if (isLoading || !data || !mc) return <Frame>{<span className="tiny muted">{t('market.loading')}</span>}</Frame>

  const listing = data.listings.get(id)
  if (listing && !listing.valid) return <StaleListing listing={listing} mc={mc} />
  if (listing) return mine ? <OwnListing c={c} listing={listing} brain={brain} mc={mc} /> : <ForSale c={c} listing={listing} brain={brain} mc={mc} />
  if (mine) return <ListForm c={c} feeBps={data.feeBps} brain={brain} mc={mc} />
  return (
    <Frame>
      <span className="tiny muted">{t('market.notListed')}</span>
    </Frame>
  )
}

function Frame({ children, badge, state }: { children: ReactNode; badge?: ReactNode; state?: 'sale' | 'stale' | 'own' }) {
  const { t } = useI18n()
  return (
    <section className={`market-panel ${state ? `is-${state}` : ''}`}>
      <div className="market-head">
        <span className="market-title">{t('market.head')}</span>
        {badge}
      </div>
      {children}
    </section>
  )
}

/** Price, fee snapshot and seller proceeds of a listing, as hairline rows. */
function Terms({ listing, mine }: { listing: Listing; mine?: boolean }) {
  const { t } = useI18n()
  const { explorerAddr } = useNet()
  const { fee, toSeller } = splitSale(listing.price, listing.feeBps)
  return (
    <dl className="market-terms">
      <div>
        <dt>{t('market.price')}</dt>
        <dd className="market-price mono">{okb(listing.price)} OKB</dd>
      </div>
      {!mine && (
        <div>
          <dt>{t('market.seller')}</dt>
          <dd>
            <Addr a={listing.seller} href={explorerAddr(listing.seller)} />
          </dd>
        </div>
      )}
      <div title={t('market.feeSnap', { bps: listing.feeBps })}>
        <dt>{t('market.fee')}</dt>
        <dd className="mono">{t('market.feeVal', { pct: pctOf(listing.feeBps), fee: okb(fee) })}</dd>
      </div>
      <div>
        <dt>{mine ? t('market.youReceive') : t('market.toSeller')}</dt>
        <dd className="mono">{okb(toSeller)} OKB</dd>
      </div>
    </dl>
  )
}

function ForSale({ c, listing, brain, mc }: { c: CircuitRow; listing: Listing; brain?: Brain; mc: CircuitMarketConfig }) {
  const { t } = useI18n()
  const { address } = useConnection()
  const { pc, explorerAddr } = useNet()
  const { push } = useToasts()
  const { run, guard, busy } = useMarketTx()
  const policy = !!address && CEREBR_WALLETS.some((w) => sameAddress(w, address))
  const reason = buyBlockReason(listing, address)
  const why = policy ? t('market.block.policy') : reason === 'own-listing' ? t('market.block.own') : reason === 'not-connected' ? t('market.block.notConnected') : undefined

  async function buy() {
    if (!pc) return
    const label = t('market.buyTx', { id: c.id })
    // Re-read right before paying: the buyer pays exactly the price shown, and expectedPrice guards
    // against a setPrice front-run between this read and the transaction.
    const fresh = await readListingById(pc, listing.id, mc).catch(() => null)
    if (!fresh) return push({ kind: 'error', title: label, body: t('market.gone') })
    if (fresh.price !== listing.price) return push({ kind: 'error', title: label, body: t('market.priceChanged', { price: okb(fresh.price) }) })
    if (buyBlockReason(fresh, address)) return push({ kind: 'error', title: label, body: t('market.gone') })
    await run(label, { address: mc.circuitMarket, abi: circuitMarketAbi as Abi, functionName: 'buy', args: [listing.id, listing.price], value: listing.price })
  }

  return (
    <Frame state="sale" badge={<span className="market-badge sale">{t('market.forSale')}</span>}>
      <Terms listing={listing} />
      {brain && (
        <p className="market-note warn">
          <BrainLine brain={brain} k="market.brainGoes" href={explorerAddr(brain.account)} />
        </p>
      )}
      <button className="btn primary market-buy" disabled={!!busy || !!why} onClick={() => void guard(buy)}>
        {t('market.buy', { price: okb(listing.price) })}
      </button>
      {why && <p className="market-note block">{why}</p>}
      {!policy && <p className="market-note policy">{t('market.policy')}</p>}
    </Frame>
  )
}

/** A translated sentence with the brain wallet address rendered as an explorer link. */
function BrainLine({ brain, k, href }: { brain: Brain; k: Key; href?: string }) {
  const { rich } = useI18n()
  return <>{rich(k, { addr: <Addr a={brain.account} href={href} />, bal: fmt(brain.balance, 4) })}</>
}

function StaleListing({ listing, mc }: { listing: Listing; mc: CircuitMarketConfig }) {
  const { t } = useI18n()
  const { address } = useConnection()
  const { run, guard, busy } = useMarketTx()
  return (
    <Frame state="stale" badge={<span className="market-badge stale">{t('market.unavailable')}</span>}>
      <p className="market-note">{t('market.stale', { id: listing.id })}</p>
      <div className="market-actions">
        <button
          className="btn small"
          disabled={!!busy || !address}
          title={t('market.clearTitle')}
          onClick={() => void guard(() => run(t('market.clearTx', { id: listing.id }), { address: mc.circuitMarket, abi: circuitMarketAbi as Abi, functionName: 'delistStale', args: [listing.id] }))}
        >
          {t('market.clear')}
        </button>
      </div>
    </Frame>
  )
}

/** Inline OKB price input with live validation and the fee split. */
function PriceInput({ value, onChange, feeBps, autoFocus }: { value: string; onChange: (v: string) => void; feeBps: number; autoFocus?: boolean }) {
  const { t } = useI18n()
  const price = parseAmount(value)
  const err = value.trim() === '' ? undefined : price === undefined || price === 0n ? t('market.badPrice') : price > MAX_PRICE ? t('market.tooHigh') : undefined
  const split = price && !err ? splitSale(price, feeBps) : undefined
  return (
    <div className="market-price-input">
      <label className="market-label tiny muted">
        {t('market.priceLabel')}
        <input
          className="input"
          inputMode="decimal"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(',', '.'))}
          placeholder="0.05"
          spellCheck={false}
        />
      </label>
      {err ? (
        <span className="tiny error">{err}</span>
      ) : split ? (
        <span className="tiny muted mono">
          {t('market.fee')} {t('market.feeVal', { pct: pctOf(feeBps), fee: okb(split.fee) })} · {t('market.youReceive')} {okb(split.toSeller)} OKB
        </span>
      ) : null}
    </div>
  )
}

const validPrice = (v: string) => {
  const p = parseAmount(v)
  return p !== undefined && p > 0n && p <= MAX_PRICE ? p : undefined
}

function ListForm({ c, feeBps, brain, mc }: { c: CircuitRow; feeBps: number; brain?: Brain; mc: CircuitMarketConfig }) {
  const { t } = useI18n()
  const { address } = useConnection()
  const { cfg, pc, explorerAddr } = useNet()
  const { run, guard, busy } = useMarketTx()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const price = validPrice(value)
  const approved = useQuery({
    queryKey: ['cerebr', 'market-approved', mc.circuitMarket, cfg?.circuits, c.id.toString(), address],
    enabled: open && !!pc && !!cfg && !!address,
    queryFn: () => isMarketApproved(pc!, cfg!.circuits, c.id, address!, mc),
  })

  async function list() {
    if (!price || !cfg || !pc || !address) return
    const shown = okb(price)
    if (!(await isMarketApproved(pc, cfg.circuits, c.id, address, mc))) {
      const ok = await run(t('market.approveTx', { id: c.id }), { address: cfg.circuits, abi: erc721Abi as Abi, functionName: 'approve', args: [mc.circuitMarket, c.id] }, { refresh: false })
      if (!ok) return
      await approved.refetch()
    }
    const done = await run(t('market.listTx', { id: c.id, price: shown }), { address: mc.circuitMarket, abi: circuitMarketAbi as Abi, functionName: 'list', args: [cfg.circuits, c.id, price] })
    if (done) {
      setOpen(false)
      setValue('')
    }
  }

  if (!open) {
    return (
      <Frame>
        <div className="market-row">
          <span className="tiny muted">{t('market.notListed')}</span>
          <button className="btn small" disabled={!!busy} title={t('market.listTitle')} onClick={() => setOpen(true)}>
            {t('market.list')}
          </button>
        </div>
      </Frame>
    )
  }
  return (
    <Frame state="own">
      <form
        className="market-form"
        onSubmit={(e) => {
          e.preventDefault()
          void guard(list)
        }}
      >
        <PriceInput value={value} onChange={setValue} feeBps={feeBps} autoFocus />
        <p className="market-note">{approved.data ? t('market.approvedNote', { id: c.id }) : t('market.approveNote', { id: c.id })}</p>
        {brain && (
          <p className="market-note warn">
            <BrainLine brain={brain} k="market.warnBrain" href={explorerAddr(brain.account)} />
          </p>
        )}
        <p className="market-note warn">{t('market.warnTransfer')}</p>
        <div className="market-actions">
          <button className="btn small ghost" type="button" disabled={!!busy} onClick={() => setOpen(false)}>
            {t('market.cancel')}
          </button>
          <button className="btn small primary" type="submit" disabled={!!busy || !price}>
            {approved.data === false
              ? t('market.approveListBtn', { price: price ? okb(price) : '…' })
              : t('market.listBtn', { price: price ? okb(price) : '…' })}
          </button>
        </div>
      </form>
    </Frame>
  )
}

function OwnListing({ c, listing, brain, mc }: { c: CircuitRow; listing: Listing; brain?: Brain; mc: CircuitMarketConfig }) {
  const { t } = useI18n()
  const { address } = useConnection()
  const { explorerAddr } = useNet()
  const { run, guard, busy } = useMarketTx()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const price = validPrice(value)
  const isSeller = sameAddress(listing.seller, address)
  const m = { address: mc.circuitMarket, abi: circuitMarketAbi as Abi }

  return (
    <Frame state="own" badge={<span className="market-badge sale">{t('market.forSale')}</span>}>
      <div className="market-sub tiny muted">
        {t('market.yours')} · {t('market.listing', { id: listing.id })}
      </div>
      <Terms listing={listing} mine />
      {brain && (
        <p className="market-note warn">
          <BrainLine brain={brain} k="market.warnBrain" href={explorerAddr(brain.account)} />
        </p>
      )}
      <p className="market-note warn">{t('market.warnTransfer')}</p>
      {editing ? (
        <form
          className="market-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!price) return
            if (await guard(() => run(t('market.setPriceTx', { id: c.id, price: okb(price) }), { ...m, functionName: 'setPrice', args: [listing.id, price] }))) {
              setEditing(false)
              setValue('')
            }
          }}
        >
          <PriceInput value={value} onChange={setValue} feeBps={listing.feeBps} autoFocus />
          <div className="market-actions">
            <button className="btn small ghost" type="button" disabled={!!busy} onClick={() => setEditing(false)}>
              {t('market.cancel')}
            </button>
            <button className="btn small primary" type="submit" disabled={!!busy || !price || price === listing.price}>
              {t('market.save', { price: price ? okb(price) : '…' })}
            </button>
          </div>
        </form>
      ) : (
        <div className="market-actions">
          <button className="btn small" disabled={!!busy || !isSeller} onClick={() => setEditing(true)}>
            {t('market.changePrice')}
          </button>
          <button
            className="btn small"
            disabled={!!busy || !isSeller}
            onClick={() => void guard(() => run(t('market.delistTx', { id: c.id }), { ...m, functionName: 'delist', args: [listing.id] }))}
          >
            {t('market.delist')}
          </button>
        </div>
      )}
    </Frame>
  )
}
