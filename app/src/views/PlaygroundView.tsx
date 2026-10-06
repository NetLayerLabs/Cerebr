import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem'
import { bitsOf, run, truthTable as localTable, type Program } from '@cerebr/sdk'
import { circuitsAbi, packBits, unpackBits, type Bit } from '@cerebr/sdk/tapeout'
import { useCircuits, useNet, type CircuitRow } from '../hooks/useCpu.ts'
import { useDebounced } from '../hooks/useDebounced.ts'
import { href } from '../hooks/useRoute.ts'
import { loadProgram, TAPEOUT } from '../lib/cerebr.ts'
import { errorMessage } from '../lib/errors.ts'
import { DieShot } from '../components/DieShot.tsx'
import { Pins } from '../components/ui.tsx'
import { useI18n, type Key } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'

const programCaches = new Map<string, Map<string, Promise<Program>>>()
const cacheFor = (chainId: number) => {
  const k = String(chainId)
  if (!programCaches.has(k)) programCaches.set(k, new Map())
  return programCaches.get(k)!
}

/** A 3×3 image input (catalog line detector: bit = 3·row + col). */
const isPixelGrid = (labels: string[]) => labels.length === 9 && labels.every((l, i) => l === `r${Math.floor(i / 3)}c${i % 3}`)

export function PlaygroundView({ circuitId }: { circuitId?: string }) {
  const { circuits, isLoading } = useCircuits()
  const { t, rich } = useI18n()
  const selected = useMemo(() => {
    if (!circuits?.length) return undefined
    return (
      circuits.find((c) => c.id.toString() === circuitId) ??
      circuits.find((c) => c.label.catalogId === 'line-detector') ??
      circuits.find((c) => c.label.catalogId === 'xor-net') ??
      circuits[circuits.length - 1]
    )
  }, [circuits, circuitId])

  return (
    <>
      <section className="hero">
        <h1>{rich('pg.title', { em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{rich('pg.lede')}</p>
      </section>
      {isLoading ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : !selected ? (
        <div className="card notice">
          <h2>{t('pg.none')}</h2>
          <p className="muted">{rich('pg.noneBody', { a: (x) => <a href={href('studio')}>{x}</a> })}</p>
        </div>
      ) : (
        <Bench key={selected.id.toString()} c={selected} all={circuits!} />
      )}
    </>
  )
}

function Bench({ c, all }: { c: CircuitRow; all: CircuitRow[] }) {
  const { chainId, cfg, pc } = useNet()
  const prog = useQuery({
    queryKey: ['cerebr', 'program', chainId, cfg?.circuits, c.id.toString()],
    enabled: !!pc && !!cfg,
    staleTime: Infinity,
    queryFn: () => loadProgram(pc!, cfg!.circuits, c.id, cacheFor(chainId), c),
  })
  const [bits, setBits] = useState<number[]>(() => defaultInputs(c))
  const sequential = c.nState > 0
  const { t } = useI18n()
  const ct = useCircuitText()
  const toggle = (i: number) => setBits((b) => b.map((v, j) => (j === i ? (v ? 0 : 1) : v)))

  return (
    <>
      <section className="grid-2 bench">
        <div className="card">
          <div className="card-head">
            <h2>{t('pg.circuit')}</h2>
            <select className="select" value={c.id.toString()} onChange={(e) => (window.location.hash = href('playground', e.target.value))}>
              {all.map((x) => (
                <option key={x.id.toString()} value={x.id.toString()}>
                  #{x.id.toString()} · {ct.name(x.label.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="bench-top">
            <div className="bench-art">
              <DieShot netlist={c.netlist} nIn={c.nIn} nOut={c.nOut} title={ct.name(c.label.name)} subtitle={`CEREBR · #${c.id}`} circuitId={c.id} />
            </div>
            <div className="bench-info small">
              <b>{ct.name(c.label.name)}</b>
              {c.label.description && <p className="muted">{ct.description(c.label.description)}</p>}
              <p className="mono muted">
                {t('pg.specs', { i: c.nIn, o: c.nOut, g: c.gateCount })}
                {c.nState ? t('pg.stateBits', { n: c.nState }) : ''}
              </p>
            </div>
          </div>
          <div className="tiny muted pins-head">{sequential ? t('pg.inputsSeq') : t('pg.inputsComb')}</div>
          {isPixelGrid(c.label.inputs) ? <PixelGrid bits={bits} onChange={setBits} /> : <Pins labels={ct.pins(c.label.inputs)} bits={bits} onToggle={toggle} />}
        </div>
        {sequential ? <Clocked c={c} prog={prog.data} inputs={bits} /> : <Evaluated c={c} prog={prog.data} inputs={bits} />}
      </section>
      {!sequential && c.nIn <= 10 && <Exhaustive c={c} prog={prog.data} />}
    </>
  )
}

function defaultInputs(c: CircuitRow): number[] {
  if (isPixelGrid(c.label.inputs)) return [0, 0, 0, 1, 1, 1, 0, 0, 0]
  return Array(c.nIn).fill(0).map((_, i) => (i === 0 ? 1 : 0))
}

const GRID_PRESETS: [Key, number[]][] = [
  ['pg.grid.row', [0, 0, 0, 1, 1, 1, 0, 0, 0]],
  ['pg.grid.column', [0, 1, 0, 0, 1, 0, 0, 1, 0]],
  ['pg.grid.diagonal', [1, 0, 0, 0, 1, 0, 0, 0, 1]],
  ['pg.grid.cross', [0, 1, 0, 1, 1, 1, 0, 1, 0]],
  ['pg.grid.l', [1, 0, 0, 1, 0, 0, 1, 1, 0]],
  ['pg.grid.clear', [0, 0, 0, 0, 0, 0, 0, 0, 0]],
]

function PixelGrid({ bits, onChange }: { bits: number[]; onChange: (b: number[]) => void }) {
  const { t } = useI18n()
  return (
    <div className="pixels-wrap">
      <div className="pixels" role="grid" aria-label={t('pg.gridAria')}>
        {bits.map((b, i) => (
          <button
            key={i}
            className={`px ${b ? 'on' : ''}`}
            aria-pressed={!!b}
            aria-label={t('pg.pxAria', { r: Math.floor(i / 3), c: i % 3 })}
            onClick={() => onChange(bits.map((v, j) => (j === i ? (v ? 0 : 1) : v)))}
          />
        ))}
      </div>
      <div className="chips">
        {GRID_PRESETS.map(([l, p]) => (
          <button key={l} className="chip" onClick={() => onChange(p)}>
            {t(l)}
          </button>
        ))}
        <button className="chip" onClick={() => onChange(Array.from({ length: 9 }, () => (Math.random() < 0.45 ? 1 : 0)))}>
          {t('pg.grid.random')}
        </button>
      </div>
    </div>
  )
}

/** Gas a view call would use if sent as a transaction (eth_estimateGas, includes the 21k base). */
const viewGas = (pc: PublicClient, to: Address, data: Hex) => pc.estimateGas({ to, data } as Parameters<PublicClient["estimateGas"]>[0]).catch(() => undefined)

type OnchainResult = { outputs: Bit[]; ret: Hex; gas?: bigint; ms: number }

async function evalOnchain(pc: PublicClient, circuits: Address, id: bigint, inputs: number[], nOut: number): Promise<OnchainResult> {
  const args = [id, packBits(inputs)] as const
  const t0 = performance.now()
  const ret = await pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'eval', args })
  const ms = performance.now() - t0
  const gas = await viewGas(pc, circuits, encodeFunctionData({ abi: circuitsAbi, functionName: 'eval', args }))
  return { outputs: unpackBits(ret, nOut), ret, gas, ms }
}

function Evaluated({ c, prog, inputs }: { c: CircuitRow; prog?: Program; inputs: number[] }) {
  const { chainId, cfg, pc } = useNet()
  const key = useDebounced(inputs.join(''), 180)
  const q = useQuery({
    queryKey: ['cerebr', 'eval', chainId, cfg?.circuits, c.id.toString(), key],
    enabled: !!pc && !!cfg,
    staleTime: Infinity,
    queryFn: () => evalOnchain(pc!, cfg!.circuits, c.id, key.split('').map(Number), c.nOut),
  })
  const local = useMemo(() => (prog ? Array.from(run(prog, [], inputs).outputs) : undefined), [prog, inputs])
  const stale = key !== inputs.join('')
  const match = q.data && local && !stale ? q.data.outputs.every((v, i) => v === local[i]) : undefined
  const { t } = useI18n()
  const ct = useCircuitText()
  return (
    <div className="card result">
      <div className="card-head">
        <h2>{t('pg.result')}</h2>
        {match !== undefined && <span className={`pill ${match ? 'on' : 'bad'}`}>{match ? t('pg.match') : t('pg.mismatch')}</span>}
      </div>
      <Outputs c={c} bits={q.data?.outputs} />
      <div className="compare">
        <div>
          <div className="tiny muted">{t('pg.onchainEval')}</div>
          {q.error ? (
            <div className="error small">{errorMessage(q.error)}</div>
          ) : (
            <Pins labels={ct.pins(c.label.outputs)} bits={q.data?.outputs ?? []} kind="out" compare={local} />
          )}
        </div>
        <div>
          <div className="tiny muted">{t('pg.localSim')}</div>
          <Pins labels={ct.pins(c.label.outputs)} bits={local ?? []} kind="out" />
        </div>
      </div>
      <dl className="quote">
        <div className="row">
          <dt>{t('pg.gasUsed')}</dt>
          <dd className="mono">{q.data?.gas !== undefined ? q.data.gas.toLocaleString('en-US') : q.isFetching ? '…' : '-'}</dd>
        </div>
        <div className="row">
          <dt>{t('pg.roundTrip')}</dt>
          <dd className="mono">{q.data ? `${q.data.ms.toFixed(0)} ms` : '…'}</dd>
        </div>
        <div className="row">
          <dt>{t('pg.calldata')}</dt>
          <dd className="mono">
            eval({c.id.toString()}, {packBits(inputs)}) → {q.data?.ret ?? '…'}
          </dd>
        </div>
      </dl>
      <p className="tiny muted">{t('pg.viewNote')}</p>
    </div>
  )
}

/** Named outputs, big: lit when 1 (e.g. horizontal / vertical / diagonal for the line detector). */
function Outputs({ c, bits }: { c: CircuitRow; bits?: number[] }) {
  const ct = useCircuitText()
  return (
    <div className="outputs">
      {c.label.outputs.map((l, i) => (
        <span key={i} className={`out-chip ${bits?.[i] ? 'on' : ''}`}>
          {ct.pin(l)}
        </span>
      ))}
    </div>
  )
}

type Tick = { t: number; inputs: number[]; state: number[]; outputs: number[]; local: number[]; next: number[] }

function Clocked({ c, prog, inputs }: { c: CircuitRow; prog?: Program; inputs: number[] }) {
  const { cfg, pc } = useNet()
  const [state, setState] = useState<number[]>(() => Array(c.nState).fill(0))
  const [ticks, setTicks] = useState<Tick[]>([])
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [gas, setGas] = useState<bigint>()
  const { t } = useI18n()
  const last = ticks[0]

  async function clock() {
    if (!pc || !cfg || !prog) return
    setBusy(true)
    setErr(undefined)
    try {
      const args = [c.id, packBits(state), packBits(inputs)] as const
      const [ns, out] = await pc.readContract({ address: cfg.circuits, abi: circuitsAbi, functionName: 'step', args })
      viewGas(pc, cfg.circuits, encodeFunctionData({ abi: circuitsAbi, functionName: 'step', args })).then(setGas)
      const local = run(prog, state, inputs)
      const next = unpackBits(ns, c.nState)
      setTicks((ts) => [{ t: ts.length, inputs, state, outputs: unpackBits(out, c.nOut), local: Array.from(local.outputs), next }, ...ts].slice(0, 12))
      setState(next)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setTicks([])
  }, [c.id])

  const stateLabels = c.label.catalogId === 'spiking-neuron' ? ['p0', 'p1'] : Array.from({ length: c.nState }, (_, i) => `s${i}`)
  const allMatch = ticks.every((t) => t.outputs.every((v, i) => v === t.local[i]))
  return (
    <div className="card result">
      <div className="card-head">
        <h2>{t('pg.clocked')}</h2>
        {ticks.length > 0 && <span className={`pill ${allMatch ? 'on' : 'bad'}`}>{allMatch ? t('pg.match') : t('pg.mismatch')}</span>}
      </div>
      <Outputs c={c} bits={last?.outputs} />
      <div className="tiny muted pins-head">{t('pg.stateCarried')}</div>
      <Pins labels={stateLabels} bits={state} kind="out" />
      <div className="btn-row">
        <button className="btn primary" disabled={busy || !prog} onClick={clock}>
          {busy ? t('pg.stepping') : t('pg.clock')}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setState(Array(c.nState).fill(0))
            setTicks([])
          }}
        >
          {t('pg.reset')}
        </button>
      </div>
      {err && <div className="error small">{err}</div>}
      {ticks.length > 0 && (
        <table className="tt mono small trace">
          <thead>
            <tr>
              <th>t</th>
              <th>{t('pg.th.inputs')}</th>
              <th>{t('pg.th.state')}</th>
              <th>{t('pg.th.chain')}</th>
              <th>{t('pg.th.local')}</th>
            </tr>
          </thead>
          <tbody>
            {ticks.map((k) => (
              <tr key={k.t}>
                <td className="muted">{k.t}</td>
                <td>{k.inputs.join('')}</td>
                <td>{k.state.join('')}</td>
                <td className={`out ${k.outputs.some(Boolean) ? 'one' : ''}`}>{k.outputs.join('')}</td>
                <td>{k.local.join('')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="tiny muted">
        {t('pg.stepNote')}
        {gas !== undefined ? t('pg.lastStep', { gas: gas.toLocaleString('en-US') }) : ''}
      </p>
    </div>
  )
}

function Exhaustive({ c, prog }: { c: CircuitRow; prog?: Program }) {
  const { cfg, pc } = useNet()
  const [res, setRes] = useState<{ rows: number; ok: number; ms: number } | { error: string }>()
  const [busy, setBusy] = useState(false)
  const rows = 1 << c.nIn
  const { t } = useI18n()

  async function verify() {
    if (!pc || !cfg || !prog) return
    setBusy(true)
    setRes(undefined)
    const t0 = performance.now()
    try {
      const want = localTable(prog)
      let ok = 0
      // Chunked so each eth_call stays well under public RPC gas caps.
      for (let from = 0; from < rows; from += 64) {
        const ks = Array.from({ length: Math.min(64, rows - from) }, (_, i) => from + i)
        const out = await pc.multicall({
          allowFailure: false,
          multicallAddress: TAPEOUT.multicall3,
          contracts: ks.map((k) => ({ address: cfg.circuits, abi: circuitsAbi, functionName: 'eval', args: [c.id, packBits(bitsOf(k, c.nIn))] }) as const),
        })
        out.forEach((r, i) => {
          const got = unpackBits(r as Hex, c.nOut)
          if (got.every((v, j) => v === want[ks[i]][j])) ok++
        })
      }
      setRes({ rows, ok, ms: performance.now() - t0 })
    } catch (e) {
      setRes({ error: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card exhaustive">
      <div className="card-head">
        <h2>{t('pg.verify')}</h2>
        <button className="btn small" disabled={busy || !prog} onClick={verify}>
          {busy ? t('pg.evaluating') : t('pg.runAll', { n: rows })}
        </button>
      </div>
      <p className="small muted">{t('pg.verifyBody', { n: rows })}</p>
      {res && 'error' in res && <div className="error small">{res.error}</div>}
      {res && 'ok' in res && (
        <div className={res.ok === res.rows ? 'ok' : 'error'}>
          {res.ok === res.rows ? '✓' : '✕'} {t('pg.verifyRes', { ok: res.ok, rows: res.rows, s: (res.ms / 1000).toFixed(1) })}
        </div>
      )}
    </section>
  )
}
