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

export function ProcessorView() {
  const { cpu } = useCpu()
  if (!cpu) return <section className="stats skeleton-row" />
  const pct = cpu.supplyCap > 0n ? Number((cpu.minted * 10_000n) / cpu.supplyCap) / 100 : 0
  return (
    <>
      <section className="hero">
        <h1>
          {cpu.name} <span className="grad">neural processor</span>
        </h1>
        <p className="muted">
          A processor created through the TapeOut factory on X Layer. Its transistors (NAND and LATCH) are the asset: mint
          them, then burn them into neural circuits (threshold neurons, majority votes, the XOR network, a 3×3 line
          detector) that anyone can run on-chain with <code>eval()</code>.
        </p>
      </section>
      <section className="stats">
        <Stat label="Transistors minted" value={compact(cpu.minted, 0)} unit={`of ${compact(cpu.supplyCap, 0)} supply cap`}>
          <div className="bar">
            <div style={{ width: `${Math.min(100, Math.max(pct, cpu.minted > 0n ? 0.6 : 0))}%` }} />
          </div>
        </Stat>
        <Stat label="Remaining" value={compact(cpu.remaining, 0)} unit="NAND + LATCH share the cap" />
        <Stat label="Unit price" value={fmt(cpu.mintPrice, 4)} unit="OKB per transistor" accent />
        <Stat label="Protocol fee" value={fmt(cpu.protocolFee, 4)} unit="OKB per mint call" />
        <Stat label="Tape-out fee" value={fmt(cpu.tapeoutFee, 4)} unit="OKB per circuit" />
        <Stat label="Circuits" value={cpu.circuitCount.toString()} unit="taped out on this CPU" accent />
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
  return (
    <div className="card">
      <div className="card-head">
        <h2>Issuance terms</h2>
        <span className={`pill ${cpu.registered ? 'on' : ''}`}>{cpu.registered ? 'registered in TapeOut factory' : 'not registered'}</span>
      </div>
      {cpu.story && <blockquote className="story">{cpu.story}</blockquote>}
      <dl className="quote">
        <Row k="Processor" v={`${cpu.name} (${cpu.symbol})`} />
        <Row k="Transistor supply cap" v={`${cpu.supplyCap.toLocaleString('en-US')} (NAND + LATCH)`} />
        <Row k="Unit price" v={`${fmt(cpu.mintPrice, 6)} OKB`} />
        <Row k="Protocol fee" v={`${fmt(cpu.protocolFee, 6)} OKB per mint call`} />
        <Row k="Minted so far" v={cpu.minted.toLocaleString('en-US')} />
        <Row k="Tape-out" v={`1 transistor per gate, REF free · ${fmt(cpu.tapeoutFee, 6)} OKB`} />
        <Row k="Brain wallet" v={`${fmt(cpu.fees.openFee, 4)} OKB to open`} />
      </dl>
      <p className="small muted terms">
        Mint revenue (amount × unit price) is owed to the creator and withdrawn by pull payment; the protocol fee goes to
        TapeOut. Burning transistors does not free supply: the cap counts every transistor ever minted. The supply cap and
        unit price are fixed at creation by the factory; TapeOut's own fees can change (its contracts are upgradeable), so the
        app reads them live.
      </p>
      <div className="kv small">
        <span className="muted">Creator</span>
        <Addr a={cpu.creator} href={explorerAddr(cpu.creator)} />
        <span className="muted">Transistors</span>
        <Addr a={cpu.transistors} href={explorerAddr(cpu.transistors)} />
        <span className="muted">Circuits</span>
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
        <h2>Mint transistors</h2>
        <Seg value={kind} onChange={setKind} options={[['nand', 'NAND'], ['latch', 'LATCH']]} small />
      </div>
      <p className="small muted mint-help">
        {kind === 'nand'
          ? 'NAND is the universal gate: every neuron in the catalog is built from NANDs.'
          : 'LATCH holds one bit of state between steps (used by the integrate-and-fire neuron).'}
      </p>
      <label className="field">
        <input inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value.replace(/[^\d]/g, ''))} aria-label={`${label} amount`} />
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
        <Row k={`${amount?.toString() ?? '—'} × unit price`} v={`${fmt(amount ? amount * cpu.mintPrice : undefined, 6)} OKB`} />
        <Row k="Protocol fee (per call)" v={`${fmt(cpu.protocolFee, 6)} OKB`} />
        <Row k="You pay (msg.value)" v={`${fmt(tx?.value, 6)} OKB`} strong />
        <Row k="Network gas (est.)" v={gasPrice ? `~${fmt(gas, 3)} OKB` : '—'} />
        <Row k="Your balance" v={balances ? `${balances.nand} NAND · ${balances.latch} LATCH` : isConnected ? '…' : 'connect a wallet'} />
      </dl>
      {over && <div className="error small">Only {cpu.remaining.toString()} transistors remain under the cap.</div>}
      <button
        className="btn primary big"
        disabled={!tx || over || !!busy}
        onClick={() => tx && send(`Mint ${amount} ${label}`, tx)}
      >
        {busy?.startsWith('Mint') ? 'Minting…' : `Mint ${amount ?? ''} ${label}`}
      </button>
    </div>
  )
}

function CreatorPanel({ cpu }: { cpu: CpuState }) {
  const { address } = useConnection()
  const { pc, chainId } = useNet()
  const { send, busy } = useTx()
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
        <h2>Creator revenue</h2>
        <span className="pill on">you created this CPU</span>
      </div>
      <dl className="quote">
        <Row k="Owed to you" v={`${fmt(owed.data, 6)} OKB`} strong />
      </dl>
      <button className="btn big" disabled={!owed.data || !!busy} onClick={() => send('Withdraw mint revenue', withdrawTx(cpu.transistors))}>
        Withdraw
      </button>
    </div>
  )
}

function OurCircuits() {
  const { circuits, isLoading } = useCircuits()
  const onChain = useMemo(() => {
    const m = new Map<string, bigint[]>()
    for (const c of circuits ?? []) if (c.label.catalogId) m.set(c.label.catalogId, [...(m.get(c.label.catalogId) ?? []), c.id])
    return m
  }, [circuits])
  const others = (circuits ?? []).filter((c) => !c.label.catalogId)
  return (
    <section className="card">
      <div className="card-head">
        <h2>Neural circuit library</h2>
        <span className="small muted">
          {isLoading ? 'reading the CPU…' : `${onChain.size} of ${CATALOG.length} catalog circuits on chain · ${others.length} other`}
        </span>
      </div>
      <div className="lib">
        {CATALOG.map((c) => {
          const ids = onChain.get(c.id)
          const nl = c.build({ mode: 'direct' })
          return (
            <div key={c.id} className={`lib-row ${ids ? 'live' : ''}`}>
              <div className="lib-name">
                <b>{c.name}</b>
                <span className="small muted">{c.description}</span>
              </div>
              <span className="mono small lib-spec">
                {c.inputs.length}→{c.outputs.length} · {nl.counts.ref ? `${nl.counts.ref} REF` : `${nl.counts.nand} NAND`}
                {nl.counts.latch ? ` + ${nl.counts.latch} LATCH` : ''}
              </span>
              {ids ? (
                <a className="btn small" href={href('playground', ids[0])}>
                  Run #{ids[0].toString()}
                </a>
              ) : (
                <a className="btn small ghost" href={href('studio', c.id)}>
                  Tape out
                </a>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
