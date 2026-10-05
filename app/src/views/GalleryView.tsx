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
import { DieShot } from '../components/DieShot.tsx'
import { Addr, Seg } from '../components/ui.tsx'

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
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const wallets = useBrainWallets(circuits)
  const shown = useMemo(() => {
    const list = [...(circuits ?? [])].reverse()
    return filter === 'mine' && address ? list.filter((c) => c.owner.toLowerCase() === address.toLowerCase()) : list
  }, [circuits, filter, address])

  return (
    <section className="gallery-wrap">
      <div className="section-head">
        <h1 className="h1-sm">Gallery</h1>
        <span className="small muted">
          {circuits ? `${circuits.length} circuits on the processor · die shots drawn from each circuit's real netlist` : ''}
        </span>
        <Seg value={filter} onChange={setFilter} options={[['all', 'All'], ['mine', 'Mine']]} small />
      </div>
      {isLoading && (
        <div className="gallery">
          <div className="circuit skeleton" />
          <div className="circuit skeleton" />
          <div className="circuit skeleton" />
        </div>
      )}
      {!isLoading && shown.length === 0 && (
        <div className="empty">
          {filter === 'mine' ? (address ? 'You own no circuits on this processor yet.' : 'Connect a wallet to see your circuits.') : 'No circuits yet.'}{' '}
          <a href={href('studio')}>Tape one out →</a>
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
  const { explorerAddr } = useNet()
  const { cpu } = useCpu()
  const { send, busy } = useTx()
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
      <DieShot netlist={c.netlist} nIn={c.nIn} nOut={c.nOut} title={c.label.name} subtitle={`CEREBR · #${c.id}`} circuitId={c.id} />
      <div className="circuit-body">
        <div className="circuit-title">
          <span className="mono">#{c.id.toString()}</span>
          <span>{c.label.name}</span>
          {c.nState > 0 && <span className="badge latch-badge">stateful</span>}
          {counts.ref > 0 && <span className="badge ref-badge">REF ×{counts.ref}</span>}
        </div>
        <div className="traits small">
          <span className="mono">
            {c.nIn}→{c.nOut}
          </span>
          <span className="mono">{c.gateCount} gates</span>
          {counts.ref > 0 && <span className="mono">{counts.nand} own NAND</span>}
          <span>
            owner {mine ? <b className="you">you</b> : <span className="mono">{shortAddr(c.owner)}</span>}
          </span>
        </div>
        <div className="tba">
          <div className="tba-head small">
            <span className="muted">Brain wallet</span>
            {wallet ? <Addr a={wallet.account} href={explorerAddr(wallet.account)} /> : <span className="muted">…</span>}
          </div>
          <div className="tba-row small">
            <span className="mono">
              {wallet ? `${fmt(wallet.balance, 4)} OKB` : ''}{' '}
              <span className={`pill ${wallet?.opened ? 'on' : ''}`}>{wallet ? (wallet.opened ? 'open' : 'not opened') : '…'}</span>
            </span>
            {wallet && !wallet.opened && cpu && mine && (
              <button
                className="btn small"
                disabled={!!busy}
                title="Deploys this circuit's native TapeOut account (ERC-6551). You control it while you own the circuit."
                onClick={() => send(`Open brain wallet #${c.id}`, openTx(cpu.circuits, c.id, cpu.fees.openFee))}
              >
                Open · {fmt(cpu.fees.openFee, 3)} OKB
              </button>
            )}
          </div>
        </div>
        <div className="card-actions">
          <a className="btn small" href={href('playground', c.id)}>
            Run on-chain →
          </a>
        </div>
      </div>
    </article>
  )
}
