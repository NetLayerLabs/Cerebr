import { useMemo, useState } from 'react'
import { useConnection, useGasPrice } from 'wagmi'
import { CATALOG } from '@cerebr/sdk'
import { GAS, LATCH_ID, NAND_ID, creatorOwed } from '@cerebr/sdk/tapeout'
import { useQuery } from '@tanstack/react-query'
import { useBalances, useCircuits, useCpu, useNet, type CpuState } from '../hooks/useCpu.ts'
import { useTx } from '../hooks/useTx.ts'
import { href } from '../hooks/useRoute.ts'
import { mintTx, withdrawTx } from '../lib/cerebr.ts'
import { compact, fmt } from '../lib/format.ts'
import { Addr, Row, Seg, Stat } from '../components/ui.tsx'
import { useI18n } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'

export function ProcessorView() {
  const { cpu } = useCpu()
  const { t, rich } = useI18n()
  if (!cpu) return <section className="stats skeleton-row" />
  const pct = cpu.supplyCap > 0n ? Number((cpu.minted * 10_000n) / cpu.supplyCap) / 100 : 0
  return (
    <>
      <section className="hero">
        <h1>{rich('proc.title', { name: cpu.name, em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{rich('proc.lede')}</p>
      </section>
      <section className="stats">
        <Stat label={t('proc.minted')} value={compact(cpu.minted, 0)} unit={t('proc.ofCap', { cap: compact(cpu.supplyCap, 0) })}>
          <div className="bar">
            <div style={{ width: `${Math.min(100, Math.max(pct, cpu.minted > 0n ? 0.6 : 0))}%` }} />
          </div>
        </Stat>
        <Stat label={t('proc.remaining')} value={compact(cpu.remaining, 0)} unit={t('proc.shareCap')} />
        <Stat label={t('proc.unitPrice')} value={fmt(cpu.mintPrice, 4)} unit={t('proc.perTransistor')} accent />
        <Stat label={t('proc.protocolFee')} value={fmt(cpu.protocolFee, 4)} unit={t('proc.perMintCall')} />
        <Stat label={t('proc.tapeFee')} value={fmt(cpu.tapeoutFee, 4)} unit={t('proc.perCircuit')} />
        <Stat label={t('proc.circuits')} value={cpu.circuitCount.toString()} unit={t('proc.onThisCpu')} accent />
      </section>
      <section className="grid-2">
        <Disclosure cpu={cpu} />
        <div className="stack">
          <MintPanel cpu={cpu} />
          <CreatorPanel cpu={cpu} />
        </div>
      </section>
      <OurCircuits />
    </>
  )
}

function Disclosure({ cpu }: { cpu: CpuState }) {
  const { explorerAddr } = useNet()
  const { t } = useI18n()
  const ct = useCircuitText()
  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('proc.terms')}</h2>
        <span className={`pill ${cpu.registered ? 'on' : ''}`}>{cpu.registered ? t('proc.registered') : t('proc.notRegistered')}</span>
      </div>
      {cpu.story && <blockquote className="story">{ct.story(cpu.story)}</blockquote>}
      <dl className="quote">
        <Row k={t('proc.processor')} v={`${cpu.name} (${cpu.symbol})`} />
        <Row k={t('proc.cap')} v={`${cpu.supplyCap.toLocaleString('en-US')} (NAND + LATCH)`} />
        <Row k={t('proc.unitPrice')} v={`${fmt(cpu.mintPrice, 6)} OKB`} />
        <Row k={t('proc.protocolFee')} v={t('proc.protocolFeeV', { fee: fmt(cpu.protocolFee, 6) })} />
        <Row k={t('proc.mintedSoFar')} v={cpu.minted.toLocaleString('en-US')} />
        <Row k={t('proc.tapeout')} v={t('proc.tapeoutV', { fee: fmt(cpu.tapeoutFee, 6) })} />
        <Row k={t('proc.brainWallet')} v={t('proc.brainWalletV', { fee: fmt(cpu.fees.openFee, 4) })} />
      </dl>
      <p className="small muted terms">{t('proc.termsBody')}</p>
      <div className="kv small">
        <span className="muted">{t('proc.creator')}</span>
        <Addr a={cpu.creator} href={explorerAddr(cpu.creator)} />
        <span className="muted">{t('proc.transistors')}</span>
        <Addr a={cpu.transistors} href={explorerAddr(cpu.transistors)} />
        <span className="muted">{t('proc.circuits')}</span>
        <Addr a={cpu.circuits} href={explorerAddr(cpu.circuits)} />
      </div>
    </div>
  )
}

const PRESETS = [10n, 50n, 100n, 500n]

function MintPanel({ cpu }: { cpu: CpuState }) {
  const [kind, setKind] = useState<'nand' | 'latch'>('nand')
  const [raw, setRaw] = useState('50')
  const { send, busy } = useTx()
  const { isConnected } = useConnection()
  const { balances } = useBalances()
  const { chainId } = useNet()
  const { data: gasPrice } = useGasPrice({ chainId })
  const { t } = useI18n()
  const amount = /^\d{1,9}$/.test(raw.trim()) ? BigInt(raw.trim()) : undefined
  const tx = useMemo(
    () => (amount && amount > 0n ? mintTx(cpu.transistors, kind === 'nand' ? NAND_ID : LATCH_ID, amount, cpu.mintPrice, cpu.protocolFee) : undefined),
    [amount, kind, cpu],
  )
  const over = amount !== undefined && amount > cpu.remaining
  const gas = (cpu.minted === 0n ? GAS.mintFirst : GAS.mint) * (gasPrice ?? 0n)
  const label = kind === 'nand' ? 'NAND' : 'LATCH'

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('proc.mintTitle')}</h2>
        <Seg value={kind} onChange={setKind} options={[['nand', 'NAND'], ['latch', 'LATCH']]} small />
      </div>
      <p className="small muted mint-help">
        {kind === 'nand' ? t('proc.nandHelp') : t('proc.latchHelp')}
      </p>
      <label className="field">
        <input inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ''))} aria-label={t('proc.amountAria', { label })} />
        <span className="unit">{label}</span>
      </label>
      <div className="chips">
        {PRESETS.map((p) => (
          <button key={p.toString()} className={`chip ${amount === p ? 'on' : ''}`} onClick={() => setRaw(p.toString())}>
            {p.toString()}
          </button>
        ))}
      </div>
      <dl className="quote">
        <Row k={t('proc.timesPrice', { n: amount?.toString() ?? '-' })} v={`${fmt(amount ? amount * cpu.mintPrice : undefined, 6)} OKB`} />
        <Row k={t('proc.feePerCall')} v={`${fmt(cpu.protocolFee, 6)} OKB`} />
        <Row k={t('proc.youPay')} v={`${fmt(tx?.value, 6)} OKB`} strong />
        <Row k={t('proc.gas')} v={gasPrice ? `~${fmt(gas, 3)} OKB` : '-'} />
        <Row k={t('proc.balance')} v={balances ? `${balances.nand} NAND · ${balances.latch} LATCH` : isConnected ? '…' : t('common.connectWallet')} />
      </dl>
      {over && <div className="error small">{t('proc.onlyRemain', { n: cpu.remaining.toString() })}</div>}
      <button
        className="btn primary big"
        disabled={!tx || over || !!busy}
        onClick={() => tx && amount && send(t('proc.mintTx', { n: amount, label }), tx)}
      >
        {busy ? t('proc.minting') : amount !== undefined ? t('proc.mintTx', { n: amount, label }) : t('proc.mintLabel', { label })}
      </button>
    </div>
  )
}

function CreatorPanel({ cpu }: { cpu: CpuState }) {
  const { address } = useConnection()
  const { pc, chainId } = useNet()
  const { send, busy } = useTx()
  const { t } = useI18n()
  const isCreator = !!address && address.toLowerCase() === cpu.creator.toLowerCase()
  const owed = useQuery({
    queryKey: ['cerebr', 'owed', chainId, cpu.transistors, address],
    enabled: isCreator && !!pc,
    queryFn: () => creatorOwed(pc!, cpu.transistors, cpu.creator),
  })
  if (!isCreator) return null
  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('proc.revenue')}</h2>
        <span className="pill on">{t('proc.youCreated')}</span>
      </div>
      <dl className="quote">
        <Row k={t('proc.owed')} v={`${fmt(owed.data, 6)} OKB`} strong />
      </dl>
      <button className="btn big" disabled={!owed.data || !!busy} onClick={() => send(t('proc.withdrawTx'), withdrawTx(cpu.transistors))}>
        {t('proc.withdraw')}
      </button>
    </div>
  )
}

function OurCircuits() {
  const { circuits, isLoading } = useCircuits()
  const { t } = useI18n()
  const ct = useCircuitText()
  const onChain = useMemo(() => {
    const m = new Map<string, bigint[]>()
    for (const c of circuits ?? []) if (c.label.catalogId) m.set(c.label.catalogId, [...(m.get(c.label.catalogId) ?? []), c.id])
    return m
  }, [circuits])
  const others = (circuits ?? []).filter((c) => !c.label.catalogId)
  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('proc.library')}</h2>
        <span className="small muted">
          {isLoading ? t('proc.readingCpu') : t('proc.libCount', { on: onChain.size, all: CATALOG.length, other: others.length })}
        </span>
      </div>
      <div className="lib">
        {CATALOG.map((c) => {
          const ids = onChain.get(c.id)
          const nl = c.build({ mode: 'direct' })
          return (
            <div key={c.id} className={`lib-row ${ids ? 'live' : ''}`}>
              <div className="lib-name">
                <b>{ct.name(c.name)}</b>
                <span className="small muted">{ct.description(c.description)}</span>
              </div>
              <span className="mono small lib-spec">
                {c.inputs.length}→{c.outputs.length} · {nl.counts.ref ? `${nl.counts.ref} REF` : `${nl.counts.nand} NAND`}
                {nl.counts.latch ? ` + ${nl.counts.latch} LATCH` : ''}
              </span>
              {ids ? (
                <a className="btn small" href={href('playground', ids[0])}>
                  {t('proc.run', { id: ids[0].toString() })}
                </a>
              ) : (
                <a className="btn small ghost" href={href('studio', c.id)}>
                  {t('proc.tapeOut')}
                </a>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
