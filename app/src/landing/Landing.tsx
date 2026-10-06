import { Logo } from '../components/Logo.tsx'
import { BuiltBy } from '../components/BuiltBy.tsx'
import { formatGwei } from 'viem'
import type { CpuInfo, TapeoutFees } from '@cerebr/sdk/tapeout'
import { Pinout, TimingDiagram } from './Pinout.tsx'
import { EXPLORER, ISSUANCE, okb, short } from './issuance.ts'
import {
  useCircuits,
  useCpuStats,
  useCreatorHoldings,
  useFees,
  useMisc,
  useTiming,
  useXor,
  type Counts,
  type LiveCircuit,
  type Misc,
  type Timing,
  type XorLive,
} from './useCpuStats.ts'
import './landing.css'

const APP_HREF = '/app'
const TAPEOUT_HREF = 'https://tapeout.net'
const REPO_HREF = 'https://github.com/NetLayerLabs/Cerebr'
const DOC = 'CRB-DS-001'

const int = (n: bigint | number) => Number(n).toLocaleString('en-US')
/** A live value, or a neutral '…' until its read lands. */
const L = <T,>(x: T | undefined, f: (x: T) => React.ReactNode = String): React.ReactNode => (x === undefined ? '…' : f(x))
const gates = (c: Counts) =>
  [`${c.nand} NAND`, c.latch ? `${c.latch} LATCH` : '', c.ref ? `${c.ref} REF` : ''].filter(Boolean).join(' + ')
const burns = (c: Counts) => c.nand + c.latch

// Copy keys: which catalog circuit each part of the page talks about (matched to chain by id).
const FLAT_XOR = 4
const XOR_REF = 5
const SPIKING = 14
const LINE_REF = 12
const WALLET_ID = 5n
const SPIKES = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0]
const playground = (id: number) => `${APP_HREF}#playground/${id}`

function Launch({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <a className={`ds-btn ds-btn-acc ds-btn-${size}`} href={APP_HREF}>
      Launch app <span aria-hidden>↗</span>
    </a>
  )
}

interface Live {
  cpu?: CpuInfo
  fees?: TapeoutFees
  circuits?: LiveCircuit[]
  byId: (id: number) => LiveCircuit | undefined
  misc?: Misc
  xor?: XorLive
  timing?: Timing
}

function useLive(): Live {
  const cpu = useCpuStats()
  const fees = useFees()
  const circuits = useCircuits(CATALOG_IDS)
  const byId = (id: number) => circuits?.find((c) => Number(c.id) === id)
  const misc = useMisc(WALLET_ID)
  const xor = useXor(byId(XOR_REF))
  const timing = useTiming(byId(SPIKING), circuits, SPIKES)
  return { cpu, fees, circuits, byId, misc, xor, timing }
}

export function Landing() {
  const live = useLive()
  return (
    <div className="ds">
      <Nav />
      <main>
        <Hero live={live} />
        <Characteristics />
        <HowItWorks />
        <XorStory live={live} />
        <Catalog live={live} />
        <Stateful live={live} />
        <IssuanceSection live={live} />
        <BrainWallets live={live} />
        <Applications />
        <Builders />
        <Security live={live} />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ */

function Nav() {
  return (
    <header className="ds-nav">
      <a className="ds-brand" href="/">
        <Logo size={26} />
        <span className="ds-brand-name">Cerebr</span>
        <span className="ds-brand-tag">CRB-1</span>
      </a>
      <nav className="ds-links">
        <a href="#how">Architecture</a>
        <a href="#xor">XOR</a>
        <a href="#catalog">Circuits</a>
        <a href="#issuance">Issuance</a>
        <a href="#wallets">Wallets</a>
        <a href="#security">Security</a>
        <a href="#faq">FAQ</a>
      </nav>
    </header>
  )
}

/** Datasheet section header: a ruled bar with the section number, title and page meta. */
function Sec({ id, n, label, meta, title, children }: { id?: string; n: string; label: string; meta?: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="ds-sec" id={id}>
      <div className="ds-sec-bar">
        <span className="ds-sec-n">§{n}</span>
        <span className="ds-sec-label">{label}</span>
        <span className="ds-sec-fill" />
        <span className="ds-sec-meta">{meta ?? `${DOC} · p.${n}`}</span>
      </div>
      <h2 className="ds-h2">{title}</h2>
      {children && <p className="ds-lede">{children}</p>}
    </div>
  )
}

function Hero({ live }: { live: Live }) {
  const { cpu, circuits, misc, xor, timing } = live
  const reads = new Set<string>()
  if (circuits) ['circuitInfo()', 'netlist()', 'ownerOf()'].forEach((r) => reads.add(r))
  if (xor) reads.add('eval()')
  if (timing?.verified) reads.add('step()')
  return (
    <section className="ds-hero">
      <div className="ds-hero-copy">
        <div className="ds-kicker">
          <span className="ds-live" /> Live on X Layer mainnet · built on TapeOut
        </div>
        <h1 className="ds-h1">
          A neural processor,
          <br />
          <em>taped out</em> onchain.
        </h1>
        <p className="ds-hero-lede">
          Cerebr compiles neurons into real NAND netlists and tapes them out on its own TapeOut processor. Every
          transistor is a synapse, every circuit is a neuron you own, and anyone can run inference onchain with{' '}
          <code>eval()</code>.
        </p>
        <div className="ds-cta">
          <Launch size="lg" />
          <a className="ds-btn ds-btn-line ds-btn-lg" href="#xor">
            See a neuron solve XOR
          </a>
        </div>
        <dl className="ds-hero-spec">
          <div>
            <dt>Gates</dt>
            <dd>NAND · LATCH · REF</dd>
          </div>
          <div>
            <dt>Inference</dt>
            <dd>eval() · step()</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>X Layer · {L(misc?.chainId)}</dd>
          </div>
        </dl>
      </div>
      <figure className="ds-hero-fig">
        <Pinout
          name={cpu?.name}
          symbol={cpu?.symbol}
          circuits={cpu ? Number(cpu.circuitCount) : undefined}
          cpu={ISSUANCE.cpu}
          chainId={misc?.chainId}
          reads={reads}
        />
        <figcaption>
          Fig. 1 - Schematic of the live processor, top view. Pins are its TapeOut functions (lit when this page has
          read them onchain); one die cell per taped-out circuit.
        </figcaption>
      </figure>
    </section>
  )
}

/** Live CPU state as a datasheet "electrical characteristics" table; config values until the read lands. */
function Characteristics() {
  const s = useCpuStats()
  const pct = s && s.supplyCap > 0n ? Number((s.minted * 10_000n) / s.supplyCap) / 100 : undefined
  const rows: [string, string, React.ReactNode, string][] = [
    ['Processor', '-', L(s?.name), s?.symbol ?? '…'],
    ['Transistor supply cap', 'N_cap', L(s?.supplyCap, int), 'NAND + LATCH'],
    ['Transistors minted', 'N_min', L(s?.minted, int), pct !== undefined ? `${pct}% of cap` : ''],
    ['Unit price', 'P_t', L(s?.mintPrice, okb), 'OKB / transistor'],
    ['Mint fee', 'F_m', L(s?.protocolFee, okb), 'OKB / call → TapeOut'],
    ['Tape-out fee', 'F_t', L(s?.tapeoutFee, okb), 'OKB / circuit → TapeOut'],
    ['Circuits taped out', 'C', L(s?.circuitCount, int), 'on this processor'],
  ]
  return (
    <section className="ds-section ds-char">
      <div className="ds-table-head">
        <span>Electrical characteristics</span>
        <span className="ds-table-meta">
          {s ? (
            <>
              <span className="ds-live" /> read live from chain ·{' '}
              <a href={`${EXPLORER}/address/${s.transistors}`} target="_blank" rel="noreferrer">
                OKLink ↗
              </a>
            </>
          ) : (
            'reading from X Layer…'
          )}
        </span>
      </div>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Symbol</th>
              <th className="r">Value</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([p, sym, v, u]) => (
              <tr key={p}>
                <td>{p}</td>
                <td className="ds-sym">{sym}</td>
                <td className="r ds-val">{v}</td>
                <td className="ds-unit">{u}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------------------------------------ */

const STEPS = [
  {
    n: 'A',
    title: 'Mint transistors',
    body: 'Transistors are the synapses. Mint NAND (and LATCH, for memory) from the Cerebr processor’s fixed supply at a fixed unit price.',
    fn: 'transistors.mint(NAND, n)',
  },
  {
    n: 'B',
    title: 'Compile a neuron',
    body: 'Give the compiler integer weights and a threshold. It tries four constructions and keeps the netlist with the fewest NAND gates.',
    fn: 'neuron({ weights, theta })',
  },
  {
    n: 'C',
    title: 'Tape it out',
    body: 'The netlist goes onchain as a circuit NFT. Each NAND burns one transistor, so every neuron is paid for in real silicon.',
    fn: 'circuits.tapeout(nl, nIn, nOut)',
  },
  {
    n: 'D',
    title: 'Compose & infer',
    body: 'Wire taped-out neurons into networks with REF, which reuses a circuit without burning transistors. Run any of them for free with eval.',
    fn: 'circuits.eval(id, inputs)',
  },
]

function HowItWorks() {
  return (
    <section className="ds-section">
      <Sec id="how" n="01" label="Functional description" title={<>From transistors to neurons <em>to networks.</em></>}>
        TapeOut gives every processor two contracts: transistors you mint and circuits you tape out by burning them.
        Cerebr adds the missing piece, a compiler that turns neural networks into those circuits.
      </Sec>
      <ol className="ds-blocks">
        {STEPS.map((s, i) => (
          <li key={s.n} className="ds-block">
            <div className="ds-block-top">
              <span className="ds-block-n">{s.n}</span>
              {i < STEPS.length - 1 && <span className="ds-block-arrow" aria-hidden>→</span>}
            </div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <code className="ds-fn">{s.fn}</code>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ------------------------------------------------------------------------------------------------ */

function XorStory({ live }: { live: Live }) {
  const { xor, byId } = live
  const flat = byId(FLAT_XOR)
  const net = byId(XOR_REF)
  const [h1, h2, out] = xor?.refs ?? []
  // eval(5, 0b10): x1 = 1, x0 = 0 is row 1
  const y10 = xor?.rows[1][4]
  return (
    <section className="ds-section">
      <Sec id="xor" n="02" label="Application note · XOR" title={<>One neuron can’t. <em>Two layers can.</em></>}>
        In 1969 Minsky and Papert showed that a single threshold neuron can never compute XOR: no straight line separates
        its true cases from its false ones. Add a hidden layer and the problem disappears. Cerebr tapes out that exact
        network and runs it onchain.
      </Sec>
      <div className="ds-grid-xor">
        <figure className="ds-fig ds-fig-wide">
          <XorNetwork refs={xor?.refs} />
          <figcaption>Fig. 2 - Two-layer network. Each node is a taped-out circuit; each edge is a REF.</figcaption>
        </figure>
        <figure className="ds-fig">
          <XorPlane />
          <figcaption>Fig. 3 - Input plane. Two hidden neurons, two lines; XOR is the band between.</figcaption>
        </figure>
        <figure className="ds-fig">
          <table className="ds-truth">
            <thead>
              <tr>
                <th>x0</th>
                <th>x1</th>
                <th>OR</th>
                <th>NAND</th>
                <th>y</th>
              </tr>
            </thead>
            <tbody>
              {xor
                ? xor.rows.map((r) => (
                    <tr key={r.slice(0, 2).join('')}>
                      {r.map((v, i) => (
                        <td key={i} className={i === 4 ? (v ? 'hi' : 'lo') : undefined}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))
                : [0, 1, 2, 3].map((r) => (
                    <tr key={r}>
                      <td>{r >> 1}</td>
                      <td>{r & 1}</td>
                      <td>…</td>
                      <td>…</td>
                      <td>…</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          <figcaption>
            Table 1 - Truth table, y = AND(OR, NAND).{' '}
            {xor ? (
              <>
                <span className="ds-live" /> eval(#{XOR_REF}) read live; OR and NAND are eval(#{h1}) and eval(#{h2}).
              </>
            ) : (
              'Running eval() on X Layer…'
            )}
          </figcaption>
        </figure>
      </div>
      <div className="ds-facts3">
        <div>
          <b>{L(flat && gates(flat.counts))}</b>
          <span>
            flattened into one circuit (#{FLAT_XOR}), burning {L(flat && burns(flat.counts))} transistors
          </span>
        </div>
        <div>
          <b>{L(net && gates(net.counts))}</b>
          <span>
            built from the taped-out OR, NAND and AND neurons ({xor ? `#${h1}, #${h2}, #${out}` : '…'}) as circuit #
            {XOR_REF}, burning {net ? (burns(net.counts) ? `${burns(net.counts)} transistors` : 'nothing new') : '…'}
          </span>
        </div>
        <div>
          <b>eval({XOR_REF}, 0b10) → {L(y10)}</b>
          <span>
            a free view call, so anyone can check the answer -{' '}
            <a href={playground(5)}>run it ↗</a>
          </span>
        </div>
      </div>
    </section>
  )
}

function XorNetwork({ refs }: { refs?: number[] }) {
  const id = (k: number) => (refs?.[k] !== undefined ? `#${refs[k]}` : '…')
  const node = (x: number, y: number, label: string, sub: string, acc = false) => (
    <g>
      <circle cx={x} cy={y} r="28" className={acc ? 'ds-node ds-node-acc' : 'ds-node'} />
      <text x={x} y={y + 2} textAnchor="middle" className="ds-node-t">{label}</text>
      <text x={x} y={y + 16} textAnchor="middle" className="ds-node-s">{sub}</text>
    </g>
  )
  const edge = (x1: number, y1: number, x2: number, y2: number, w: string, t = 0.7) => {
    const lx = x1 + (x2 - x1) * t
    const ly = y1 + (y2 - y1) * t
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="ds-edge" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="ds-edge-sig" pathLength={100} />
        <rect x={lx - 14} y={ly - 9} width="28" height="17" rx="2" className="ds-w" />
        <text x={lx} y={ly + 3.5} textAnchor="middle" className="ds-w-t">{w}</text>
      </g>
    )
  }
  return (
    <svg viewBox="0 0 440 260" className="ds-svg" role="img" aria-label="Two-layer neural network computing XOR: OR and NAND hidden neurons feeding an AND output neuron">
      <text x="52" y="22" textAnchor="middle" className="ds-ax">INPUT</text>
      <text x="215" y="22" textAnchor="middle" className="ds-ax">HIDDEN</text>
      <text x="372" y="22" textAnchor="middle" className="ds-ax">OUTPUT</text>
      {edge(80, 80, 187, 75, '+1')}
      {edge(80, 80, 187, 185, '−1', 0.78)}
      {edge(80, 190, 187, 75, '+1', 0.78)}
      {edge(80, 190, 187, 185, '−1')}
      {edge(243, 75, 344, 130, '+1', 0.5)}
      {edge(243, 185, 344, 130, '+1', 0.5)}
      {node(52, 80, 'x0', 'in')}
      {node(52, 190, 'x1', 'in')}
      {node(215, 75, 'OR', `θ=1 · ${id(0)}`)}
      {node(215, 185, 'NAND', `θ=−1 · ${id(1)}`)}
      {node(372, 130, 'AND', `θ=2 · ${id(2)}`, true)}
      <text x="372" y="186" textAnchor="middle" className="ds-node-s">y = x0 ⊕ x1</text>
    </svg>
  )
}

function XorPlane() {
  const pts: [number, number, number][] = [
    [0, 0, 0],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
  ]
  const px = (v: number) => 50 + v * 120
  const py = (v: number) => 160 - v * 120
  const line = (sum: number) => ({ x1: px(sum + 0.35), y1: py(-0.35), x2: px(-0.35), y2: py(sum + 0.35) })
  const band = [
    [px(0.85), py(-0.35)],
    [px(-0.35), py(0.85)],
    [px(-0.35), py(1.85)],
    [px(1.85), py(-0.35)],
  ]
  return (
    <svg viewBox="0 0 220 200" className="ds-svg" role="img" aria-label="The XOR cases in the input plane, separated by two lines">
      <defs>
        <clipPath id="dsPlaneClip">
          <rect x="16" y="8" width="196" height="186" />
        </clipPath>
      </defs>
      <g clipPath="url(#dsPlaneClip)">
        <path d={`M${band.map((p) => p.join(' ')).join(' L')} Z`} className="ds-band" />
        <line {...line(0.5)} className="ds-sep" />
        <line {...line(1.5)} className="ds-sep" />
      </g>
      <line x1="30" y1={py(0)} x2="205" y2={py(0)} className="ds-axis" />
      <line x1={px(0)} y1="14" x2={px(0)} y2="185" className="ds-axis" />
      {pts.map(([a, b, y]) => (
        <g key={`${a}${b}`}>
          <circle cx={px(a)} cy={py(b)} r="8" className={y ? 'ds-pt-hi' : 'ds-pt-lo'} />
          <text x={px(a) + 16} y={py(b) + (b ? -10 : 22)} textAnchor="middle" className="ds-ax">
            {a}
            {b}
          </text>
        </g>
      ))}
      <text x="208" y={py(0) + 14} textAnchor="end" className="ds-ax">x0</text>
      <text x={px(0) - 8} y="22" textAnchor="end" className="ds-ax">x1</text>
    </svg>
  )
}

/* ------------------------------------------------------------------------------------------------ */

type Kind = 'Neuron' | 'Network' | 'REF' | 'Stateful' | 'Arithmetic' | 'Circuit'

// Human copy for the circuits taped out by the launch script, keyed by onchain id. I/O, gate counts
// and the ids themselves are read from chain (each row is matched to the circuit with that id).
const CATALOG: { part: string; id: number; name: string; kind: Kind; note: string }[] = [
  { part: 'CRB-N2A', id: 1, name: 'AND neuron', kind: 'Neuron', note: 'Weights +1, +1, fires at 2.' },
  { part: 'CRB-N2O', id: 2, name: 'OR neuron', kind: 'Neuron', note: 'Weights +1, +1, fires at 1.' },
  { part: 'CRB-N2I', id: 3, name: 'Inhibitory neuron', kind: 'Neuron', note: 'Weights −1, −1, threshold −1. A single gate.' },
  { part: 'CRB-X2', id: 4, name: 'XOR network', kind: 'Network', note: 'The two-layer network, flattened.' },
  { part: 'CRB-X2R', id: 5, name: 'XOR network (REF)', kind: 'REF', note: 'Same truth table, built from three taped-out neurons.' },
  { part: 'CRB-M3', id: 6, name: 'Majority-3', kind: 'Neuron', note: 'Votes yes when at least two of three inputs do.' },
  { part: 'CRB-M5', id: 7, name: 'Majority-5', kind: 'Neuron', note: 'Five-voter consensus neuron.' },
  { part: 'CRB-T5', id: 8, name: 'Go/No-Go neuron', kind: 'Neuron', note: 'Three excitatory and two inhibitory inputs, threshold 2.' },
  { part: 'CRB-L9', id: 11, name: 'Line detector', kind: 'Network', note: 'Horizontal, vertical and diagonal lines on a 3×3 grid.' },
  { part: 'CRB-L9R', id: 12, name: 'Line detector (REF)', kind: 'REF', note: 'Eight line cells and three pooling neurons, all reused.' },
  { part: 'CRB-A2', id: 13, name: '2-bit adder', kind: 'Arithmetic', note: 'Ripple adder, the building block for counting neurons.' },
  { part: 'CRB-S2L', id: 14, name: 'Integrate-and-fire', kind: 'Stateful', note: 'Fires on every third spike. Runs with step().' },
]
/** Launch-script helpers (the line cell and any-of-3 pooling neuron CRB-L9R REFs), described in the note. */
const HELPER_IDS = [9, 10]
const CATALOG_IDS = [...CATALOG.map((c) => c.id), ...HELPER_IDS]
const nameOf = (id: number) => CATALOG.find((c) => c.id === id)?.name ?? `Circuit #${id}`

interface Row {
  key: string
  part: string
  name: string
  kind: Kind
  note: string
  id?: number
  c?: LiveCircuit
}

function catalogRows(circuits: LiveCircuit[] | undefined): Row[] {
  if (!circuits) return CATALOG.map((c) => ({ key: c.part, part: c.part, name: c.name, kind: c.kind, note: c.note }))
  return circuits
    .filter((c) => !HELPER_IDS.includes(Number(c.id)))
    .map((c): Row => {
      const id = Number(c.id)
      const copy = CATALOG.find((x) => x.id === id)
      if (copy) return { key: copy.part, part: copy.part, name: copy.name, kind: copy.kind, note: copy.note, id, c }
      return {
        key: `#${id}`,
        part: '-',
        name: c.label || `Circuit #${id}`,
        kind: c.nState ? 'Stateful' : c.counts.ref ? 'REF' : 'Circuit',
        note: c.labelDescription ?? `Taped out by ${short(c.owner)}.`,
        id,
        c,
      }
    })
}

function Catalog({ live }: { live: Live }) {
  const { circuits, byId } = live
  const rows = catalogRows(circuits)
  const lineRef = byId(LINE_REF)
  const helpers = lineRef ? [...new Set(lineRef.refs.map((r) => r.id))].filter((id) => HELPER_IDS.includes(id)) : HELPER_IDS
  return (
    <section className="ds-section">
      <Sec id="catalog" n="03" label="Ordering information" title={<>Neurons you can run, <em>own and reuse.</em></>}>
        Every circuit is compiled to a TapeOut netlist and checked against its reference model on every possible input.
        Gate counts are exact and read from each circuit’s onchain netlist: a circuit costs exactly that many
        transistors to tape out.
      </Sec>
      <div className="ds-table-wrap">
        <table className="ds-table ds-catalog">
          <thead>
            <tr>
              <th>Part</th>
              <th>Circuit</th>
              <th>Type</th>
              <th>I/O</th>
              <th className="r">Gates</th>
              <th className="ds-hide-sm">Description</th>
              <th className="r">Onchain</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="ds-part">{r.part}</td>
                <td className="ds-strong">{r.name}</td>
                <td>
                  <span className={`ds-tag ds-tag-${r.kind.toLowerCase()}`}>{r.kind}</span>
                </td>
                <td className="ds-mono">{r.c ? `${r.c.nIn} → ${r.c.nOut}` : '…'}</td>
                <td className="r ds-mono">{r.c ? gates(r.c.counts) : '…'}</td>
                <td className="ds-dim-t ds-hide-sm">{r.note}</td>
                <td className="r">
                  {r.id !== undefined ? (
                    <a className="ds-id" href={playground(r.id)} title={`Run circuit #${r.id} onchain`}>
                      #{r.id} ↗
                    </a>
                  ) : (
                    '…'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ds-note">
        {circuits ? (
          <>
            <span className="ds-live" /> I/O and gates read live from {circuits.length} circuits on X Layer (
            <code>circuitInfo</code> + decoded <code>netlist</code>).{' '}
          </>
        ) : (
          'Reading circuits from X Layer… '
        )}
        REF reuses a circuit already taped out - on Cerebr or on any other TapeOut processor - without burning more
        transistors. The tape-out fee still applies to each new circuit. Helper circuits{' '}
        {helpers.map((id, i) => (
          <span key={id}>
            {i ? ' and ' : ''}#{id}
          </span>
        ))}{' '}
        are the line cell and any-of-3 pooling neuron used by CRB-L9R.
      </p>
    </section>
  )
}

function Stateful({ live }: { live: Live }) {
  const { timing, byId } = live
  const c = byId(SPIKING)
  const n = SPIKES.length
  return (
    <section className="ds-section">
      <Sec n="04" label="Application note · memory" title={<>Neurons that <em>remember.</em></>}>
        LATCH transistors hold state between calls, so a circuit can integrate over time. CRB-S2L counts input spikes in
        {c ? ` ${c.counts.latch} latches` : ' latches'} and fires on every third one - a spiking neuron in{' '}
        {L(c && gates(c.counts).replace(' + ', ' and '))}, stepped onchain with <code>step()</code>.
      </Sec>
      <figure className="ds-fig ds-fig-timing">
        <TimingDiagram spikes={SPIKES} counts={timing?.counts} fires={timing?.fires} />
        <figcaption>
          Fig. 4 - CRB-S2L timing, computed from #{SPIKING}’s onchain netlist with the SDK simulator; every tick then
          checked with <code>step()</code> on X Layer. COUNT is held in {c ? c.counts.latch : '…'} LATCHes; FIRE goes high
          on every third spike.{' '}
          {timing?.verified !== undefined ? (
            timing.mismatch === undefined ? (
              <>
                <span className="ds-live" /> Verified onchain: {timing.verified}/{n} ticks.
              </>
            ) : (
              `step() disagrees at tick ${timing.mismatch + 1} (${timing.verified}/${n} ticks match).`
            )
          ) : timing ? (
            'Checking ticks with step()…'
          ) : (
            'Reading netlist…'
          )}
        </figcaption>
      </figure>
    </section>
  )
}

/* ------------------------------------------------------------------------------------------------ */

function IssuanceSection({ live }: { live: Live }) {
  const { cpu, fees, byId, misc } = live
  const holdings = useCreatorHoldings(cpu)
  const ratings: { k: string; v: React.ReactNode; u: string }[] = [
    { k: 'Transistor supply cap', v: L(cpu?.supplyCap, int), u: 'NAND + LATCH share it' },
    { k: 'Unit price', v: L(cpu?.mintPrice, okb), u: 'OKB per transistor' },
    { k: 'Mint fee', v: L(fees?.protocolFee, okb), u: 'OKB per mint call → TapeOut' },
    { k: 'Tape-out fee', v: L(fees?.tapeoutFee, okb), u: 'OKB per circuit → TapeOut' },
  ]
  const gas = misc && Number(formatGwei(misc.gasPrice)).toLocaleString('en-US', { maximumSignificantDigits: 2 })
  return (
    <section className="ds-section">
      <Sec id="issuance" n="05" label="Absolute ratings · issuance" title={<>One asset: <em>the transistor.</em></>}>
        Cerebr has no token of its own. The asset is the Cerebr processor’s transistor, issued through the TapeOut factory
        with a supply cap and unit price that are public from the moment it was deployed.
      </Sec>
      <div className="ds-ratings">
        {ratings.map((r) => (
          <div key={r.k} className="ds-rating">
            <div className="ds-rating-k">{r.k}</div>
            <div className="ds-rating-v">{r.v}</div>
            <div className="ds-rating-u">{r.u}</div>
          </div>
        ))}
      </div>
      <div className="ds-cols">
        <ul className="ds-list">
          <li>
            <b>Fixed supply, fixed price.</b> Set once at <code>createCPU</code>; Cerebr cannot change them (TapeOut’s
            contracts that enforce them are upgradeable by TapeOut). No curve, no presale, no team allocation.
          </li>
          <li>
            <b>Burned by use.</b> Each NAND gate in a taped-out circuit burns one NAND transistor, each LATCH one LATCH.
            Burns don’t free room under the cap, so transistors only get scarcer.
          </li>
          <li>
            <b>Where the OKB goes.</b> The unit price goes to the processor’s creator; the mint and tape-out fees go to
            TapeOut.
          </li>
          <li>
            <b>No fake activity.</b> Showcase circuits were taped out once each from the deployment wallet
            {cpu ? (
              <>
                {' '}
                (
                <a href={`${EXPLORER}/address/${cpu.creator}`} target="_blank" rel="noreferrer">
                  {short(cpu.creator)}
                </a>
                )
              </>
            ) : null}
            , which also holds {L(holdings?.nand, int)} NAND and {L(holdings?.latch, int)} LATCH minted at the public
            price (read live) - all disclosed. We never trade with ourselves.
          </li>
        </ul>
        <div className="ds-table-wrap">
          <table className="ds-table">
            <thead>
              <tr>
                <th>Circuit</th>
                <th className="r">Transistors</th>
                <th className="r">Fee (OKB)</th>
              </tr>
            </thead>
            <tbody>
              {COST_IDS.map((id) => {
                const c = byId(id)
                return (
                  <tr key={id}>
                    <td>{nameOf(id)}</td>
                    <td className="r ds-mono">{L(c && burns(c.counts))}</td>
                    <td className="r ds-mono">{L(fees?.tapeoutFee, okb)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="ds-note">
            Plus the transistors at the unit price, {L(fees?.protocolFee, okb)} OKB per mint call and gas (~{L(gas)} gwei
            on X Layer now). Transistor counts come from each circuit’s onchain netlist; fees are TapeOut’s, can change
            and are read live here and by the dApp before every quote.
          </p>
        </div>
      </div>
    </section>
  )
}

function BrainWallets({ live }: { live: Live }) {
  const { fees, misc } = live
  return (
    <section className="ds-section">
      <Sec id="wallets" n="06" label="Peripherals · brain wallets" title={<>Every neuron can <em>hold a wallet.</em></>}>
        Each taped-out circuit can open TapeOut’s native ERC-6551 account. A neuron can then hold OKB, tokens and NFTs
        and call contracts. Whoever owns the circuit NFT controls its wallet.
      </Sec>
      <div className="ds-cols">
        <figure className="ds-fig">
          <WalletDiagram misc={misc} />
          <figcaption>
            Fig. 5 - Circuit NFT and its native account. Live example: circuit #{String(WALLET_ID)}
            {misc ? `, wallet ${misc.wallet.opened ? 'opened' : 'not opened yet'} (read live).` : '.'}
          </figcaption>
        </figure>
        <ul className="ds-list">
          <li>
            <b>Address known up front.</b> <code>accountOf(circuit)</code> returns the wallet address before it exists,
            so a neuron can receive funds straight away.
          </li>
          <li>
            <b>Opened on demand.</b> <code>open()</code> deploys the account for {L(fees?.openFee, okb)} OKB, paid to TapeOut.
          </li>
          <li>
            <b>Sold with the neuron.</b> Control follows the circuit NFT. Transfer the circuit and its wallet goes with it.
          </li>
          <li>
            <b>One rule.</b> Never send a circuit into its own wallet: it would own itself and be locked for good. The dApp
            offers no circuit transfers, so it can’t happen there.
          </li>
        </ul>
      </div>
    </section>
  )
}

function WalletDiagram({ misc }: { misc?: Misc }) {
  const id = String(WALLET_ID)
  return (
    <svg viewBox="0 0 400 240" className="ds-svg" role="img" aria-label="A Cerebr circuit NFT controlling its TapeOut native account">
      <rect x="120" y="10" width="160" height="44" className="ds-box ds-box-acc" />
      <text x="134" y="30" className="ds-box-t">CIRCUIT #{id} · XOR</text>
      <text x="134" y="45" className="ds-box-s">NFT · owned by you</text>
      <line x1="200" y1="54" x2="200" y2="82" className="ds-edge" strokeDasharray="3 4" />
      <text x="208" y="72" className="ds-box-s">owner()</text>
      <rect x="20" y="82" width="360" height="148" className="ds-box ds-box-dash" />
      <text x="36" y="104" className="ds-box-t">NATIVE ACCOUNT · ERC-6551</text>
      <rect x="36" y="118" width="150" height="44" className="ds-box" />
      <text x="50" y="137" className="ds-box-t">OKB · TOKENS</text>
      <text x="50" y="152" className="ds-box-s">held by the neuron</text>
      <rect x="214" y="118" width="150" height="44" className="ds-box" />
      <text x="228" y="137" className="ds-box-t">execute()</text>
      <text x="228" y="152" className="ds-box-s">calls any contract</text>
      <text x="36" y="190" className="ds-box-s">owner() = ownerOf(#{id}), at all times</text>
      <text x="36" y="208" className="ds-box-s">
        opener.accountOf(circuits, {id}) → {misc ? short(misc.wallet.account) : '…'}
      </text>
    </svg>
  )
}

/** Circuits in the issuance cost table (copy keys, matched onchain by id). */
const COST_IDS = [3, 4, 5, 11, 12]

const USES = [
  {
    t: 'Onchain game AI',
    b: 'Enemy logic, bot players and referees that run as real circuits. Every move can be replayed and checked by anyone with a view call.',
  },
  {
    t: 'Verifiable inference for agents',
    b: 'DeAI agents call a small, fixed classifier onchain and can check exactly which circuit made the decision. No oracle, no server.',
  },
  {
    t: 'Composable neurons',
    b: 'Our neurons are public building blocks. Any team on TapeOut can REF them into a bigger network without burning a transistor.',
  },
  {
    t: 'Teaching how brains compute',
    b: 'From threshold units to spiking neurons, each idea is a circuit you can open, read gate by gate and run live.',
  },
]

function Applications() {
  return (
    <section className="ds-section">
      <Sec n="07" label="Typical applications" title={<>Small, honest intelligence <em>that lives onchain.</em></>} />
      <ol className="ds-apps">
        {USES.map((u, i) => (
          <li key={u.t}>
            <span className="ds-apps-n">0{i + 1}</span>
            <h3>{u.t}</h3>
            <p>{u.b}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

const SDK_SNIPPET = `import { getCircuit, encodeHex, tapeout } from '@cerebr/sdk'

// compile the two-layer XOR network to a NAND netlist
const nl = getCircuit('xor-net').build({ mode: 'direct' })

// tape it out on the Cerebr processor (burns 6 NAND)
const { circuitId } = await tapeout.tapeout(wallet, client, {
  circuits: CEREBR, netlist: encodeHex(nl), nIn: 2, nOut: 1,
})

// run it onchain, for free: x0 = 1, x1 = 0
await tapeout.evalCircuit(client, {
  circuits: CEREBR, id: circuitId, inputs: [1, 0],
}) // → [1]`

function Builders() {
  const lines = SDK_SNIPPET.split('\n')
  return (
    <section className="ds-section">
      <Sec n="08" label="Development tools" title={<>A compiler, an SDK <em>and an onchain renderer.</em></>} />
      <div className="ds-cols">
        <div className="ds-code">
          <div className="ds-code-bar">
            <span>xor.ts</span>
            <span>@cerebr/sdk</span>
          </div>
          <pre>
            {lines.map((l, i) => (
              <div key={i} className="ds-code-line">
                <span className="ds-code-ln">{String(i + 1).padStart(2, ' ')}</span>
                <span className={l.trim().startsWith('//') ? 'ds-code-c' : undefined}>{l || ' '}</span>
              </div>
            ))}
          </pre>
        </div>
        <ul className="ds-list">
          <li>
            <b>Neural compiler.</b> Threshold neurons, majority votes, multi-layer networks and spiking neurons compile to
            TapeOut netlists. A built-in simulator matches TapeOut’s own, byte for byte.
          </li>
          <li>
            <b>TapeOut SDK.</b> Typed viem helpers for every step - create a CPU, mint, tape out, eval, step and open
            accounts - with fee quotes read live from the chain.
          </li>
          <li>
            <b>CerebrScope.</b> An onchain lens that draws each circuit as an SVG die shot from its actual gates and
            serves its metadata. TapeOut circuits return an empty <code>tokenURI</code> today; Scope fills that gap.
          </li>
          <li>
            <b>Verified twice.</b> Every TapeOut call was checked on a mainnet fork, then on mainnet itself, where every
            catalog circuit matched the simulator on every input. This page re-checks XOR and the spiking neuron live.
          </li>
        </ul>
      </div>
    </section>
  )
}

function Security({ live }: { live: Live }) {
  const { fees } = live
  return (
    <section className="ds-section">
      <Sec id="security" n="09" label="Reliability" title={<>What we control, <em>and what we don’t.</em></>}>
        Cerebr adds no custody and no token of its own. Here is exactly where your OKB and your trust go.
      </Sec>
      <div className="ds-cols ds-cols-even">
        <div className="ds-panel">
          <div className="ds-panel-h">Guaranteed by design</div>
          <ul className="ds-checks">
            <li>Cerebr holds no user funds. Mints, tape-outs and wallets are direct calls to TapeOut’s contracts.</li>
            <li>CerebrScope holds no funds and has no admin; only a circuit’s owner can label it. Source verified on Sourcify.</li>
            <li>Supply cap and unit price were set once at deployment and are read live from chain here. Cerebr cannot change them.</li>
            <li>The dApp reads fees live and sends exact amounts, so no OKB is stranded by overpaying.</li>
            <li>Every catalog circuit is checked against its reference model on all inputs before and after tape-out.</li>
          </ul>
        </div>
        <div className="ds-panel ds-panel-warn">
          <div className="ds-panel-h">Disclosed risks</div>
          <ul className="ds-warns">
            <li>TapeOut’s X Layer contracts are in a test phase, upgradeable and unaudited. Their owner can change code and fees.</li>
            <li>Opening a brain wallet costs {L(fees?.openFee, okb)} OKB (read live), paid to TapeOut, not to Cerebr.</li>
            <li>Circuits run as view calls with gas limits, so onchain networks stay small: tens to hundreds of gates.</li>
            <li>Our compiler, CerebrScope, launch script and dApp had an internal review (AUDIT.md), not a third-party audit.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

const FAQ = [
  [
    'What is TapeOut?',
    'A protocol on X Layer where anyone can create a processor. Each processor has transistors you mint and circuits you tape out by burning them. Cerebr is one of those processors, specialised in neural circuits.',
  ],
  [
    'Is there a Cerebr token?',
    'No. The asset is the Cerebr processor’s transistor, issued through the TapeOut factory. Circuits are NFTs on the same processor.',
  ],
  [
    'Are these real neural networks?',
    'They are binary neural networks: neurons with integer weights and a threshold, outputting 0 or 1. Small, but real, and every one runs gate by gate onchain.',
  ],
  [
    'Does running a circuit cost anything?',
    'No. eval and step are view functions, so you can call them for free from any wallet, script or contract read.',
  ],
  [
    'Can I use Cerebr neurons in my own circuit?',
    'Yes. Add a REF to the circuit’s id in your netlist. It burns no transistors and pays no royalty; you only pay the normal tape-out fee for your own circuit.',
  ],
  ['What do I need to start?', 'An injected wallet such as OKX Wallet and a little OKB on X Layer for transistors, fees and gas.'],
] as const

function Faq() {
  return (
    <section className="ds-section">
      <Sec id="faq" n="10" label="Frequently asked" title={<>Questions, <em>answered.</em></>} />
      <div className="ds-faq">
        {FAQ.map(([q, a], i) => (
          <details key={q} className="ds-qa">
            <summary>
              <span className="ds-qa-n">Q{i + 1}</span>
              <span className="ds-qa-q">{q}</span>
              <span className="ds-qa-x" aria-hidden />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="ds-final">
      <div className="ds-final-copy">
        <span className="ds-sec-n">§11</span>
        <h2 className="ds-final-h">
          Build a neuron. Tape it out.
          <br />
          <em>Watch it think.</em>
        </h2>
        <p className="ds-lede">Mint transistors, compile a circuit, tape it out and test it live - all from the dApp.</p>
      </div>
      <div className="ds-final-cta">
        <Launch size="lg" />
        <a className="ds-btn ds-btn-line ds-btn-lg" href={REPO_HREF} target="_blank" rel="noreferrer">
          Read the source
        </a>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="ds-footer">
      <div className="ds-footer-top">
        <div className="ds-footer-brand">
          <a className="ds-brand" href="/">
            <Logo size={22} />
            <span className="ds-brand-name">Cerebr</span>
          </a>
          <BuiltBy />
        </div>
        <nav className="ds-footer-links">
          <a href={APP_HREF}>App</a>
          <a href={REPO_HREF} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={TAPEOUT_HREF} target="_blank" rel="noreferrer">
            TapeOut
          </a>
          {ISSUANCE.cpu && (
            <a href={`${EXPLORER}/address/${ISSUANCE.cpu}`} target="_blank" rel="noreferrer">
              Processor on OKLink
            </a>
          )}
        </nav>
      </div>
    </footer>
  )
}
