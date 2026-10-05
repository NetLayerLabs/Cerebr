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
        <h1>
          Inference, <span className="grad">on-chain.</span>
        </h1>
        <p className="muted">
          Pick any circuit on the processor, set its inputs and run it with TapeOut's <code>eval()</code> as an{' '}
          <code>eth_call</code>. The answer comes from the chain; the local simulator runs the same netlist next to it, and
          the two must agree.
        </p>
      </section>
      {isLoading ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : !selected ? (
        <div className="card notice">
          <h2>No circuits on this processor yet</h2>
          <p className="muted">
            Tape one out in the <a href={href('studio')}>Circuit Studio</a>.
          </p>
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
  const toggle = (i: number) => setBits((b) => b.map((v, j) => (j === i ? (v ? 0 : 1) : v)))

  return (
    <>
      <section className="grid-2 bench">
        <div className="card">
          <div className="card-head">
            <h2>Circuit</h2>
            <select className="select" value={c.id.toString()} onChange={(e) => (window.location.hash = href('playground', e.target.value))}>
              {all.map((x) => (
                <option key={x.id.toString()} value={x.id.toString()}>
                  #{x.id.toString()} · {x.label.name}
                </option>
              ))}
            </select>
          </div>
          <div className="bench-top">
            <div className="bench-art">
              <DieShot netlist={c.netlist} nIn={c.nIn} nOut={c.nOut} title={c.label.name} subtitle={`CEREBR · #${c.id}`} circuitId={c.id} />
            </div>
            <div className="bench-info small">
              <b>{c.label.name}</b>
              {c.label.description && <p className="muted">{c.label.description}</p>}
              <p className="mono muted">
                {c.nIn} in → {c.nOut} out · {c.gateCount} gates{c.nState ? ` · ${c.nState} state bits` : ''}
              </p>
            </div>
          </div>
          <div className="tiny muted pins-head">Inputs {sequential ? '(applied on the next clock step)' : '(click to toggle)'}</div>
          {isPixelGrid(c.label.inputs) ? <PixelGrid bits={bits} onChange={setBits} /> : <Pins labels={c.label.inputs} bits={bits} onToggle={toggle} />}
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

const GRID_PRESETS: [string, number[]][] = [
  ['Row', [0, 0, 0, 1, 1, 1, 0, 0, 0]],
  ['Column', [0, 1, 0, 0, 1, 0, 0, 1, 0]],
  ['Diagonal', [1, 0, 0, 0, 1, 0, 0, 0, 1]],
  ['Cross', [0, 1, 0, 1, 1, 1, 0, 1, 0]],
  ['L', [1, 0, 0, 1, 0, 0, 1, 1, 0]],
  ['Clear', [0, 0, 0, 0, 0, 0, 0, 0, 0]],
]

function PixelGrid({ bits, onChange }: { bits: number[]; onChange: (b: number[]) => void }) {
  return (
    <div className="pixels-wrap">
      <div className="pixels" role="grid" aria-label="3 by 3 image">
        {bits.map((b, i) => (
          <button
            key={i}
            className={`px ${b ? 'on' : ''}`}
            aria-pressed={!!b}
            aria-label={`row ${Math.floor(i / 3)} column ${i % 3}`}
            onClick={() => onChange(bits.map((v, j) => (j === i ? (v ? 0 : 1) : v)))}
          />
        ))}
      </div>
      <div className="chips">
        {GRID_PRESETS.map(([l, p]) => (
          <button key={l} className="chip" onClick={() => onChange(p)}>
            {l}
          </button>
        ))}
        <button className="chip" onClick={() => onChange(Array.from({ length: 9 }, () => (Math.random() < 0.45 ? 1 : 0)))}>
          Random
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
  return (
    <div className="card result">
      <div className="card-head">
        <h2>Result</h2>
        {match !== undefined && <span className={`pill ${match ? 'on' : 'bad'}`}>{match ? '✓ chain = simulator' : '✕ mismatch'}</span>}
      </div>
      <Outputs c={c} bits={q.data?.outputs} />
      <div className="compare">
        <div>
          <div className="tiny muted">On-chain eval() · eth_call</div>
          {q.error ? (
            <div className="error small">{errorMessage(q.error)}</div>
          ) : (
            <Pins labels={c.label.outputs} bits={q.data?.outputs ?? []} kind="out" compare={local} />
          )}
        </div>
        <div>
          <div className="tiny muted">Local simulator</div>
          <Pins labels={c.label.outputs} bits={local ?? []} kind="out" />
        </div>
      </div>
      <dl className="quote">
        <div className="row">
          <dt>Gas used by eval</dt>
          <dd className="mono">{q.data?.gas !== undefined ? q.data.gas.toLocaleString('en-US') : q.isFetching ? '…' : '—'}</dd>
        </div>
        <div className="row">
          <dt>Round trip</dt>
          <dd className="mono">{q.data ? `${q.data.ms.toFixed(0)} ms` : '…'}</dd>
        </div>
        <div className="row">
          <dt>Calldata → return</dt>
          <dd className="mono">
            eval({c.id.toString()}, {packBits(inputs)}) → {q.data?.ret ?? '…'}
          </dd>
        </div>
      </dl>
      <p className="tiny muted">A view call: free for the caller, and anyone can run it, including other contracts.</p>
    </div>
  )
}

/** Named outputs, big: lit when 1 (e.g. horizontal / vertical / diagonal for the line detector). */
function Outputs({ c, bits }: { c: CircuitRow; bits?: number[] }) {
  return (
    <div className="outputs">
      {c.label.outputs.map((l, i) => (
        <span key={i} className={`out-chip ${bits?.[i] ? 'on' : ''}`}>
          {l}
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
      setTicks((t) => [{ t: t.length, inputs, state, outputs: unpackBits(out, c.nOut), local: Array.from(local.outputs), next }, ...t].slice(0, 12))
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
        <h2>Clocked run</h2>
        {ticks.length > 0 && <span className={`pill ${allMatch ? 'on' : 'bad'}`}>{allMatch ? '✓ chain = simulator' : '✕ mismatch'}</span>}
      </div>
      <Outputs c={c} bits={last?.outputs} />
      <div className="tiny muted pins-head">State carried between calls (latches)</div>
      <Pins labels={stateLabels} bits={state} kind="out" />
      <div className="btn-row">
        <button className="btn primary" disabled={busy || !prog} onClick={clock}>
          {busy ? 'Stepping…' : 'Clock step() on-chain'}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setState(Array(c.nState).fill(0))
            setTicks([])
          }}
        >
          Reset state
        </button>
      </div>
      {err && <div className="error small">{err}</div>}
      {ticks.length > 0 && (
        <table className="tt mono small trace">
          <thead>
            <tr>
              <th>t</th>
              <th>inputs</th>
              <th>state</th>
              <th>chain</th>
              <th>local</th>
            </tr>
          </thead>
          <tbody>
            {ticks.map((t) => (
              <tr key={t.t}>
                <td className="muted">{t.t}</td>
                <td>{t.inputs.join('')}</td>
                <td>{t.state.join('')}</td>
                <td className={`out ${t.outputs.some(Boolean) ? 'one' : ''}`}>{t.outputs.join('')}</td>
                <td>{t.local.join('')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="tiny muted">
        step(id, state, inputs) is a view call: outputs come from the current state, then each latch stores its input.
        {gas !== undefined ? ` Last step: ${gas.toLocaleString('en-US')} gas.` : ''}
      </p>
    </div>
  )
}

function Exhaustive({ c, prog }: { c: CircuitRow; prog?: Program }) {
  const { cfg, pc } = useNet()
  const [res, setRes] = useState<{ rows: number; ok: number; ms: number } | { error: string }>()
  const [busy, setBusy] = useState(false)
  const rows = 1 << c.nIn

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
        <h2>Verify every input on-chain</h2>
        <button className="btn small" disabled={busy || !prog} onClick={verify}>
          {busy ? 'Evaluating…' : `Run all ${rows} inputs`}
        </button>
      </div>
      <p className="small muted">
        Evaluates all {rows} input patterns with eval() (batched through multicall3) and compares each answer with the local
        simulator.
      </p>
      {res && 'error' in res && <div className="error small">{res.error}</div>}
      {res && 'ok' in res && (
        <div className={res.ok === res.rows ? 'ok' : 'error'}>
          {res.ok === res.rows ? '✓' : '✕'} {res.ok}/{res.rows} on-chain answers match the simulator ({(res.ms / 1000).toFixed(1)} s)
        </div>
      )}
    </section>
  )
}
