import { useMemo, useState } from 'react'
import { useConnection } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { parseAbi, type Address } from 'viem'
import { openerAbi } from '@cerebr/sdk/tapeout'
import { useCircuits, useCpu, useNet, type CircuitRow } from '../hooks/useCpu.ts'
import { useTx } from '../hooks/useTx.ts'
import { href } from '../hooks/useRoute.ts'
import { TAPEOUT, openTx } from '../lib/cerebr.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { MAX_LABEL_NAME, byteLength, fitLabel, setLabelTx } from '../lib/scope.ts'
import { DieShot } from '../components/DieShot.tsx'
import { Addr, Seg } from '../components/ui.tsx'
import { MarketPanel, useForSale } from '../components/MarketPanel.tsx'
import { useI18n } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'

const multicall3Abi = parseAbi(['function getEthBalance(address addr) view returns (uint256 balance)'])

type Wallet = { account: Address; opened: boolean; balance: bigint }

/** Native TapeOut accounts ("brain wallets") of every circuit, in two multicalls. */
function useBrainWallets(rows: CircuitRow[] | undefined) {
  const { chainId, cfg, pc } = useNet()
  return useQuery({
    queryKey: ['cerebr', 'wallets', chainId, cfg?.circuits, rows?.length],
    enabled: !!pc && !!cfg && !!rows?.length,
    refetchInterval: 20_000,
    queryFn: async () => {
      const o = { address: TAPEOUT.opener, abi: openerAbi } as const
      const res = await pc!.multicall({
        allowFailure: false,
        multicallAddress: TAPEOUT.multicall3,
        contracts: rows!.flatMap((r) => [
          { ...o, functionName: 'accountOf', args: [cfg!.circuits, r.id] } as const,
          { ...o, functionName: 'isOpened', args: [cfg!.circuits, r.id] } as const,
        ]),
      })
      const accounts = rows!.map((_, i) => res[2 * i] as Address)
      const balances = await pc!.multicall({
        allowFailure: false,
        multicallAddress: TAPEOUT.multicall3,
        contracts: accounts.map((a) => ({ address: TAPEOUT.multicall3, abi: multicall3Abi, functionName: 'getEthBalance', args: [a] }) as const),
      })
      const m = new Map<string, Wallet>()
      rows!.forEach((r, i) => m.set(r.id.toString(), { account: accounts[i], opened: res[2 * i + 1] as boolean, balance: balances[i] as bigint }))
      return m
    },
  })
}

export function GalleryView() {
  const { circuits, isLoading } = useCircuits()
  const { address } = useConnection()
  const [filter, setFilter] = useState<'all' | 'mine' | 'sale'>('all')
  const wallets = useBrainWallets(circuits)
  const { t, rich } = useI18n()
  // ---- MARKET (owned by the Market engineer): ids of listed circuits, from components/MarketPanel.tsx.
  const forSale = useForSale()
  // ---- /MARKET
  const shown = useMemo(() => {
    const list = [...(circuits ?? [])].reverse()
    if (filter === 'mine') return address ? list.filter((c) => c.owner.toLowerCase() === address.toLowerCase()) : []
    // ---- MARKET: the "For sale" filter.
    if (filter === 'sale') return forSale ? list.filter((c) => forSale.has(c.id.toString())) : []
    // ---- /MARKET
    return list
  }, [circuits, filter, address, forSale])

  return (
    <section className="gallery-wrap">
      <section className="hero">
        <h1>{rich('gal.title', { em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{t('gal.lede')}</p>
      </section>
      <div className="section-head">
        <h2>{t('gal.circuits')}</h2>
        <span className="small muted">{circuits ? t('gal.count', { n: circuits.length }) : ''}</span>
        <Seg
          value={filter}
          onChange={setFilter}
          options={[
            ['all', t('gal.all')],
            ['mine', t('gal.mine')],
            ['sale', t('market.forSale')], // MARKET
          ]}
          small
        />
      </div>
      {isLoading && (
        <div className="gallery">
          <div className="circuit skeleton" />
          <div className="circuit skeleton" />
          <div className="circuit skeleton" />
        </div>
      )}
      {!isLoading && shown.length === 0 && !(filter === 'sale' && !forSale) && (
        <div className="empty">
          {filter === 'mine' ? (address ? t('gal.noneMine') : t('gal.connect')) : filter === 'sale' ? t('market.noneForSale') : t('gal.none')}{' '}
          <a href={href('studio')}>{t('gal.tapeOne')}</a>
        </div>
      )}
      <div className="gallery">
        {shown.map((c) => (
          <CircuitCard key={c.id.toString()} c={c} wallet={wallets.data?.get(c.id.toString())} />
        ))}
      </div>
    </section>
  )
}

function CircuitCard({ c, wallet }: { c: CircuitRow; wallet?: Wallet }) {
  const { address } = useConnection()
  const { explorerAddr, cfg } = useNet()
  const { cpu } = useCpu()
  const { send, busy } = useTx()
  const { t } = useI18n()
  const ct = useCircuitText()
  const mine = !!address && c.owner.toLowerCase() === address.toLowerCase()
  const counts = useMemo(() => {
    let nand = 0
    let latch = 0
    let ref = 0
    const b = c.netlist.length
    for (let p = 2; p < b; ) {
      const op = c.netlist.slice(p, p + 2)
      if (op === '00') (nand++, (p += 14))
      else if (op === '01') (latch++, (p += 8))
      else if (op === '02') {
        ref++
        const nIns = parseInt(c.netlist.slice(p + 58, p + 60), 16)
        p += 62 + nIns * 6
      } else break
    }
    return { nand, latch, ref }
  }, [c.netlist])

  return (
    <article className="circuit">
      <DieShot netlist={c.netlist} nIn={c.nIn} nOut={c.nOut} title={ct.name(c.label.name)} subtitle={`CEREBR · #${c.id}`} circuitId={c.id} />
      <div className="circuit-body">
        <div className="circuit-title">
          <span className="mono">#{c.id.toString()}</span>
          <span>{ct.name(c.label.name)}</span>
          {c.nState > 0 && <span className="badge latch-badge">{t('gal.stateful')}</span>}
          {counts.ref > 0 && <span className="badge ref-badge">REF ×{counts.ref}</span>}
        </div>
        <div className="traits small">
          <span className="mono">
            {c.nIn}→{c.nOut}
          </span>
          <span className="mono">{c.gateCount === 1 ? t('gal.gate') : t('gal.gates', { n: c.gateCount })}</span>
          {counts.ref > 0 && <span className="mono">{t('gal.ownNand', { n: counts.nand })}</span>}
          <span>
            {t('gal.owner')} {mine ? <b className="you">{t('gal.you')}</b> : <span className="mono">{shortAddr(c.owner)}</span>}
          </span>
        </div>
        <div className="tba">
          <div className="tba-head small">
            <span className="muted">{t('gal.brainWallet')}</span>
            {wallet ? <Addr a={wallet.account} href={explorerAddr(wallet.account)} /> : <span className="muted">…</span>}
          </div>
          <div className="tba-row small">
            <span className="mono">
              {wallet ? `${fmt(wallet.balance, 4)} OKB` : ''}{' '}
              <span className={`pill ${wallet?.opened ? 'on' : ''}`}>{wallet ? (wallet.opened ? t('gal.open') : t('gal.notOpened')) : '…'}</span>
            </span>
            {wallet && !wallet.opened && cpu && mine && (
              <button
                className="btn small"
                disabled={!!busy}
                title={t('gal.openTitle')}
                onClick={() => send(t('gal.openTx', { id: c.id }), openTx(cpu.circuits, c.id, cpu.fees.openFee))}
              >
                {t('gal.openBtn', { fee: fmt(cpu.fees.openFee, 3) })}
              </button>
            )}
          </div>
        </div>
        {mine && !c.onchain && cfg?.scope && cpu && <NameOnchain c={c} />}
        {/* ---- MARKET (owned by the Market engineer): listing / buying, components/MarketPanel.tsx. */}
        <MarketPanel c={c} mine={mine} brain={wallet} />
        {/* ---- /MARKET */}
        <div className="card-actions">
          <a className="btn small" href={href('playground', c.id)}>
            {t('gal.run')}
          </a>
        </div>
      </div>
    </article>
  )
}

/**
 * Writes a label for a circuit the connected wallet owns that has none onchain yet
 * (CerebrScope.setLabel). A recognised catalog circuit gets its catalog name, description and pin
 * names in one click; anything else asks for a name first.
 */
function NameOnchain({ c }: { c: CircuitRow }) {
  const { cfg } = useNet()
  const { send, busy } = useTx()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const bytes = byteLength(name.trim())
  const tooLong = bytes > MAX_LABEL_NAME
  const { t } = useI18n()
  const ct = useCircuitText()
  const write = (label: Parameters<typeof fitLabel>[0]) =>
    send(t('gal.nameTx', { id: c.id }), setLabelTx(cfg!.scope!, cfg!.circuits, c.id, fitLabel(label, c.nIn, c.nOut)))

  if (c.catalog) {
    return (
      <div className="name-onchain">
        <button
          className="btn small"
          disabled={!!busy}
          title={t('gal.nameCatalogTitle', { name: c.catalog.name })}
          onClick={() => write(c.catalog!)}
        >
          {t('gal.nameCatalog', { name: ct.name(c.catalog.name) })}
        </button>
      </div>
    )
  }
  if (!editing) {
    return (
      <div className="name-onchain">
        <button className="btn small" disabled={!!busy} onClick={() => setEditing(true)} title={t('gal.nameTitle')}>
          {t('gal.name')}
        </button>
      </div>
    )
  }
  return (
    <form
      className="name-onchain"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim() || tooLong) return
        if (await write({ name, inputs: c.label.inputs, outputs: c.label.outputs })) setEditing(false)
      }}
    >
      <div className="name-onchain-row">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('gal.namePh', { id: c.id })} spellCheck={false} />
        <button className="btn small primary" type="submit" disabled={!!busy || !name.trim() || tooLong}>
          {t('gal.save')}
        </button>
        <button className="btn small ghost" type="button" disabled={!!busy} onClick={() => setEditing(false)}>
          {t('gal.cancel')}
        </button>
      </div>
      <span className={`tiny mono ${tooLong ? 'error' : 'muted'}`}>
        {tooLong ? t('gal.tooLong', { n: bytes, max: MAX_LABEL_NAME }) : t('gal.bytes', { n: bytes, max: MAX_LABEL_NAME })}
      </span>
    </form>
  )
}
