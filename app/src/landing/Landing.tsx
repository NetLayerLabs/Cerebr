import { BrandLockup } from '../components/BrandLockup.tsx'
import { SiteFooter } from '../components/SiteFooter.tsx'
import { TapeOutMark, XLayerMark } from '../components/PartnerMarks.tsx'
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
import { Preferences } from '../components/Preferences.tsx'
import { useI18n, type Key, type T } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'
import { CountUp, useLandingMotion } from './motion.tsx'
import { useRef } from 'react'
import './landing.css'
// GENESIS DROP (drop engineer): live call-to-action under the hero buttons, styles in views/drop.css.
import { useGenesisDrop } from '../lib/drop.ts'
import '../views/drop.css'

const APP_HREF = '/app'
const REPO_HREF = 'https://github.com/NetLayerLabs/Cerebr'
const DOC = 'CRB-DS-001'

const int = (n: bigint | number) => Number(n).toLocaleString('en-US')
/** A live value, or a neutral '…' (language-neutral) until its read lands. */
const L = <T,>(x: T | undefined, f: (x: T) => React.ReactNode = String): React.ReactNode => (x === undefined ? '…' : f(x))
/** Gate counts as 'n NAND + n LATCH + n REF' (identifiers, not translated). */
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
  const { t } = useI18n()
  return (
    <a className={`ds-btn ds-btn-acc ds-btn-${size}`} href={APP_HREF}>
      {t('l.launch')}
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
  const root = useRef<HTMLDivElement>(null)
  useLandingMotion(root)
  return (
    <div className="ds" ref={root}>
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
      <SiteFooter />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------ */

function Nav() {
  const { t } = useI18n()
  return (
    <header className="ds-nav">
      <span className="ds-progress" aria-hidden />
      <a className="ds-brand" href="/">
        <BrandLockup height={28} />
      </a>
      <nav className="ds-links" aria-label={t('l.nav.aria')}>
        <a href="#how">{t('l.nav.arch')}</a>
        <a href="#xor">{t('l.nav.xor')}</a>
        <a href="#catalog">{t('l.nav.circuits')}</a>
        <a href="#issuance">{t('l.nav.issuance')}</a>
        <a href="#wallets">{t('l.nav.wallets')}</a>
        <a href="#security">{t('l.nav.security')}</a>
        <a href="#faq">{t('l.nav.faq')}</a>
      </nav>
      <Preferences className="ds-prefs" />
    </header>
  )
}

/** Datasheet section header: a ruled bar with the section number, title and page meta. */
function Sec({ id, n, label, meta, title, children }: { id?: string; n: string; label: string; meta?: string; title: React.ReactNode; children?: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="ds-sec" id={id} data-rv="sec">
      <div className="ds-sec-bar">
        <span className="ds-sec-n">§{n}</span>
        <span className="ds-sec-label">{label}</span>
        <span className="ds-sec-fill" />
        <span className="ds-sec-meta">{meta ?? t('l.sec.page', { doc: DOC, n })}</span>
      </div>
      <h2 className="ds-h2">{title}</h2>
      {children && <p className="ds-lede">{children}</p>}
    </div>
  )
}

function Hero({ live }: { live: Live }) {
  const { cpu, circuits, misc, xor, timing } = live
  const { t, rich } = useI18n()
  const reads = new Set<string>()
  if (circuits) ['circuitInfo()', 'netlist()', 'ownerOf()'].forEach((r) => reads.add(r))
  if (xor) reads.add('eval()')
  if (timing?.verified) reads.add('step()')
  return (
    <section className="ds-hero">
      <div className="ds-hero-copy">
        <div className="ds-partner">
          <span className="ds-partner-tile" aria-hidden>
            <XLayerMark size={13} />
          </span>
          <span className="ds-partner-main">
            <span className="ds-live" aria-hidden />
            {t('l.hero.live')}
          </span>
          <span className="ds-partner-div" aria-hidden />
          <span className="ds-partner-sub">
            <span className="ds-partner-mark" aria-hidden>
              <TapeOutMark size={13} />
            </span>
            {t('l.hero.builtOn')}
          </span>
        </div>
        <h1 className="ds-h1">{rich('l.hero.title')}</h1>
        <p className="ds-hero-lede">{rich('l.hero.lede')}</p>
        <div className="ds-cta">
          <Launch size="lg" />
          <a className="ds-btn ds-btn-line ds-btn-lg" href="#xor">
            {t('l.hero.cta2')}
          </a>
        </div>
        <GenesisDropCta />
        <dl className="ds-hero-spec">
          <div>
            <dt>{t('l.hero.gates')}</dt>
            <dd>NAND · LATCH · REF</dd>
          </div>
          <div>
            <dt>{t('l.hero.inference')}</dt>
            <dd>eval() · step()</dd>
          </div>
          <div>
            <dt>{t('l.hero.network')}</dt>
            <dd className="ds-hero-net">
              <span aria-hidden>
                <XLayerMark size={11} />
              </span>
              X Layer
            </dd>
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
        <figcaption>{t('l.hero.fig')}</figcaption>
      </figure>
    </section>
  )
}

/**
 * GENESIS DROP: compact link to the Genesis Drop card (/app#processor). Shown while the drop reads
 * and while it is live; hidden once it is drained, cancelled or missing. Keys drop.l.* (drop namespace).
 */
function GenesisDropCta() {
  const { t } = useI18n()
  const { data } = useGenesisDrop()
  if (data === null || (data && !data.drop.live)) return null
  const n = data ? data.drop.perClaim : 16n
  return (
    <a className="ds-drop" href={`${APP_HREF}#processor`}>
      <span className="ds-drop-tag">{t('drop.l.tag')}</span>
      <span className="ds-drop-text">
        {t('drop.l.text', { n })}
        {data && <span className="ds-drop-left">{t('drop.l.left', { n: data.drop.sharesLeft })}</span>}
      </span>
      <span className="ds-drop-go" aria-hidden>
        {t('drop.l.cta')} →
      </span>
    </a>
  )
}
/* /GENESIS DROP */

/** Live CPU state as a datasheet "electrical characteristics" table; config values until the read lands. */
function Characteristics() {
  const s = useCpuStats()
  const { t } = useI18n()
  const pct = s && s.supplyCap > 0n ? Number((s.minted * 10_000n) / s.supplyCap) / 100 : undefined
  const rows: [string, string, React.ReactNode, string][] = [
    [t('l.char.processor'), '-', L(s?.name), s?.symbol ?? '…'],
    [t('l.char.cap'), 'N_cap', <CountUp value={s?.supplyCap} />, 'NAND + LATCH'],
    [t('l.char.minted'), 'N_min', <CountUp value={s?.minted} />, pct !== undefined ? t('l.char.pct', { pct }) : ''],
    [t('l.char.price'), 'P_t', L(s?.mintPrice, okb), t('l.char.priceU')],
    [t('l.char.mintFee'), 'F_m', L(s?.protocolFee, okb), t('l.char.mintFeeU')],
    [t('l.char.tapeFee'), 'F_t', L(s?.tapeoutFee, okb), t('l.char.tapeFeeU')],
    [t('l.char.circuits'), 'C', <CountUp value={s?.circuitCount} />, t('l.char.circuitsU')],
  ]
  return (
    <section className="ds-section ds-char">
      <div className="ds-table-head">
        <span>{t('l.char.title')}</span>
        <span className="ds-table-meta">
          {s ? (
            <>
              <span className="ds-live" /> {t('l.char.live')} ·{' '}
              <a href={`${EXPLORER}/address/${s.transistors}`} target="_blank" rel="noreferrer">
                {t('common.explorer')} ↗
              </a>
            </>
          ) : (
            t('l.char.reading')
          )}
        </span>
      </div>
      <div className="ds-table-wrap" data-rv="rows">
        <table className="ds-table">
          <thead>
            <tr>
              <th>{t('l.th.param')}</th>
              <th>{t('l.th.symbol')}</th>
              <th className="r">{t('l.th.value')}</th>
              <th>{t('l.th.unit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([p, sym, v, u], i) => (
              <tr key={i} style={{ '--i': i } as React.CSSProperties}>
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

const STEPS: { n: string; title: Key; body: Key; fn: string }[] = [
  { n: 'A', title: 'l.step.a.t', body: 'l.step.a.b', fn: 'transistors.mint(NAND, n)' },
  { n: 'B', title: 'l.step.b.t', body: 'l.step.b.b', fn: 'neuron({ weights, theta })' },
  { n: 'C', title: 'l.step.c.t', body: 'l.step.c.b', fn: 'circuits.tapeout(nl, nIn, nOut)' },
  { n: 'D', title: 'l.step.d.t', body: 'l.step.d.b', fn: 'circuits.eval(id, inputs)' },
]

function HowItWorks() {
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec id="how" n="01" label={t('l.how.label')} title={rich('l.how.title')}>
        {t('l.how.lede')}
      </Sec>
      <ol className="ds-blocks" data-rv="stagger">
        {STEPS.map((s, i) => (
          <li key={s.n} className="ds-block" style={{ '--i': i } as React.CSSProperties}>
            <div className="ds-block-top">
              <span className="ds-block-n">{s.n}</span>
              {i < STEPS.length - 1 && <span className="ds-block-arrow" aria-hidden>→</span>}
            </div>
            <h3>{t(s.title)}</h3>
            <p>{t(s.body)}</p>
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
  // eval(5, 0b01): x0 = 1, x1 = 0 is row 2, the inputs the "run it" link opens the playground with
  const y01 = xor?.rows[2][4]
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec id="xor" n="02" label={t('l.xor.label')} title={rich('l.xor.title')}>
        {t('l.xor.lede')}
      </Sec>
      <div className="ds-grid-xor">
        <figure className="ds-fig ds-fig-wide" data-rv="xor">
          <XorNetwork refs={xor?.refs} />
          <figcaption>{t('l.xor.fig2')}</figcaption>
        </figure>
        <figure className="ds-fig" data-rv="plane">
          <XorPlane />
          <figcaption>{t('l.xor.fig3')}</figcaption>
        </figure>
        <figure className="ds-fig" data-rv="truth">
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
                ? xor.rows.map((r, i) => (
                    <tr key={r.slice(0, 2).join('')} style={{ '--i': i } as React.CSSProperties}>
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
            {t('l.xor.table')}{' '}
            {xor ? (
              <>
                <span className="ds-live" /> {t('l.xor.tableLive', { ref: XOR_REF, h1, h2 })}
              </>
            ) : (
              t('l.xor.tableLoading')
            )}
          </figcaption>
        </figure>
      </div>
      <div className="ds-facts3">
        <div>
          <b>{L(flat && gates(flat.counts))}</b>
          <span>{rich('l.xor.flat', { id: FLAT_XOR, n: L(flat && burns(flat.counts)) })}</span>
        </div>
        <div>
          <b>{L(net && gates(net.counts))}</b>
          <span>
            {t('l.xor.ref', {
              ids: xor ? `#${h1}, #${h2}, #${out}` : '…',
              id: XOR_REF,
              burn: net ? (burns(net.counts) ? t('l.xor.burnN', { n: burns(net.counts) }) : t('l.xor.burnNone')) : '…',
            })}
          </span>
        </div>
        <div>
          <b>eval({XOR_REF}, 0b01) → {L(y01)}</b>
          <span>{rich('l.xor.free', { a: (c) => <a href={playground(5)}>{c}</a> })}</span>
        </div>
      </div>
    </section>
  )
}

function XorNetwork({ refs }: { refs?: number[] }) {
  const { t } = useI18n()
  const id = (k: number) => (refs?.[k] !== undefined ? `#${refs[k]}` : '…')
  /** d = reveal delay (ms): inputs, then layer-1 edges, hidden nodes, layer-2 edges, output. */
  const D = (d: number) => ({ '--d': `${d}ms` }) as React.CSSProperties
  const node = (x: number, y: number, label: string, sub: string, acc = false, d = 0) => (
    <g className="ds-node-g" style={D(d)}>
      <circle cx={x} cy={y} r="28" className={acc ? 'ds-node ds-node-acc' : 'ds-node'} />
      <text x={x} y={y + 2} textAnchor="middle" className="ds-node-t">{label}</text>
      <text x={x} y={y + 16} textAnchor="middle" className="ds-node-s">{sub}</text>
    </g>
  )
  const edge = (x1: number, y1: number, x2: number, y2: number, w: string, t = 0.7, d = 150) => {
    const lx = x1 + (x2 - x1) * t
    const ly = y1 + (y2 - y1) * t
    return (
      <g style={D(d)}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="ds-edge ds-edge-draw" pathLength={100} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} className="ds-edge-sig" pathLength={100} />
        <g className="ds-wg">
          <rect x={lx - 14} y={ly - 9} width="28" height="17" rx="2" className="ds-w" />
          <text x={lx} y={ly + 3.5} textAnchor="middle" className="ds-w-t">{w}</text>
        </g>
      </g>
    )
  }
  return (
    <svg viewBox="0 0 440 260" className="ds-svg" role="img" aria-label={t('l.xor.netAria')}>
      <text x="52" y="22" textAnchor="middle" className="ds-ax">{t('l.xor.input')}</text>
      <text x="215" y="22" textAnchor="middle" className="ds-ax">{t('l.xor.hidden')}</text>
      <text x="372" y="22" textAnchor="middle" className="ds-ax">{t('l.xor.output')}</text>
      {edge(80, 80, 187, 75, '+1')}
      {edge(80, 80, 187, 185, '−1', 0.78)}
      {edge(80, 190, 187, 75, '+1', 0.78)}
      {edge(80, 190, 187, 185, '−1')}
      {edge(243, 75, 344, 130, '+1', 0.5, 900)}
      {edge(243, 185, 344, 130, '+1', 0.5, 900)}
      {node(52, 80, 'x0', t('l.xor.in'))}
      {node(52, 190, 'x1', t('l.xor.in'))}
      {node(215, 75, 'OR', `θ=1 · ${id(0)}`, false, 700)}
      {node(215, 185, 'NAND', `θ=−1 · ${id(1)}`, false, 700)}
      {node(372, 130, 'AND', `θ=2 · ${id(2)}`, true, 1450)}
      <text x="372" y="186" textAnchor="middle" className="ds-node-s">y = x0 ⊕ x1</text>
    </svg>
  )
}

function XorPlane() {
  const { t } = useI18n()
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
    <svg viewBox="0 0 220 200" className="ds-svg" role="img" aria-label={t('l.xor.planeAria')}>
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
          <circle cx={px(a)} cy={py(b)} r="8" className={y ? 'ds-pt-hi' : 'ds-pt-lo'} style={{ '--i': a * 2 + b } as React.CSSProperties} />
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
// name / note are i18n keys (l.c<id>.name / l.c<id>.note).
const CATALOG: { part: string; id: number; name: Key; kind: Kind; note: Key }[] = [
  { part: 'CRB-N2A', id: 1, name: 'l.c1.name', kind: 'Neuron', note: 'l.c1.note' },
  { part: 'CRB-N2O', id: 2, name: 'l.c2.name', kind: 'Neuron', note: 'l.c2.note' },
  { part: 'CRB-N2I', id: 3, name: 'l.c3.name', kind: 'Neuron', note: 'l.c3.note' },
  { part: 'CRB-X2', id: 4, name: 'l.c4.name', kind: 'Network', note: 'l.c4.note' },
  { part: 'CRB-X2R', id: 5, name: 'l.c5.name', kind: 'REF', note: 'l.c5.note' },
  { part: 'CRB-M3', id: 6, name: 'l.c6.name', kind: 'Neuron', note: 'l.c6.note' },
  { part: 'CRB-M5', id: 7, name: 'l.c7.name', kind: 'Neuron', note: 'l.c7.note' },
  { part: 'CRB-T5', id: 8, name: 'l.c8.name', kind: 'Neuron', note: 'l.c8.note' },
  { part: 'CRB-L9', id: 11, name: 'l.c11.name', kind: 'Network', note: 'l.c11.note' },
  { part: 'CRB-L9R', id: 12, name: 'l.c12.name', kind: 'REF', note: 'l.c12.note' },
  { part: 'CRB-A2', id: 13, name: 'l.c13.name', kind: 'Arithmetic', note: 'l.c13.note' },
  { part: 'CRB-S2L', id: 14, name: 'l.c14.name', kind: 'Stateful', note: 'l.c14.note' },
]
/** Launch-script helpers (the line cell and any-of-3 pooling neuron CRB-L9R REFs), described in the note. */
const HELPER_IDS = [9, 10]
const CATALOG_IDS = [...CATALOG.map((c) => c.id), ...HELPER_IDS]
const nameOf = (t: T, id: number) => {
  const k = CATALOG.find((c) => c.id === id)?.name
  return k ? t(k) : t('l.cat.circuitN', { id })
}

interface Row {
  key: string
  part: string
  name: string
  kind: Kind
  note: string
  id?: number
  c?: LiveCircuit
}

function catalogRows(circuits: LiveCircuit[] | undefined, t: T, ct: ReturnType<typeof useCircuitText>): Row[] {
  if (!circuits) return CATALOG.map((c) => ({ key: c.part, part: c.part, name: t(c.name), kind: c.kind, note: t(c.note) }))
  return circuits
    .filter((c) => !HELPER_IDS.includes(Number(c.id)))
    .map((c): Row => {
      const id = Number(c.id)
      const copy = CATALOG.find((x) => x.id === id)
      if (copy) return { key: copy.part, part: copy.part, name: t(copy.name), kind: copy.kind, note: t(copy.note), id, c }
      return {
        key: `#${id}`,
        part: '-',
        name: c.label ? ct.name(c.label) : t('l.cat.circuitN', { id }),
        kind: c.nState ? 'Stateful' : c.counts.ref ? 'REF' : 'Circuit',
        note: c.labelDescription ? ct.description(c.labelDescription) : t('l.cat.tapedBy', { addr: short(c.owner) }),
        id,
        c,
      }
    })
}

function Catalog({ live }: { live: Live }) {
  const { circuits, byId } = live
  const { t, rich } = useI18n()
  const ct = useCircuitText()
  const rows = catalogRows(circuits, t, ct)
  const lineRef = byId(LINE_REF)
  const helpers = lineRef ? [...new Set(lineRef.refs.map((r) => r.id))].filter((id) => HELPER_IDS.includes(id)) : HELPER_IDS
  return (
    <section className="ds-section">
      <Sec id="catalog" n="03" label={t('l.cat.label')} title={rich('l.cat.title')}>
        {t('l.cat.lede')}
      </Sec>
      <div className="ds-table-wrap" data-rv="rows">
        <table className="ds-table ds-catalog">
          <thead>
            <tr>
              <th>{t('l.cat.th.part')}</th>
              <th>{t('l.cat.th.circuit')}</th>
              <th>{t('l.cat.th.type')}</th>
              <th>{t('l.cat.th.io')}</th>
              <th className="r">{t('l.cat.th.gates')}</th>
              <th className="ds-hide-sm">{t('l.cat.th.desc')}</th>
              <th className="r">{t('l.cat.th.onchain')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} style={{ '--i': i } as React.CSSProperties}>
                <td className="ds-part">{r.part}</td>
                <td className="ds-strong">{r.name}</td>
                <td>
                  <span className={`ds-tag ds-tag-${r.kind.toLowerCase()}`}>{t(`l.kind.${r.kind}`)}</span>
                </td>
                <td className="ds-mono">{r.c ? `${r.c.nIn} → ${r.c.nOut}` : '…'}</td>
                <td className="r ds-mono">{r.c ? gates(r.c.counts) : '…'}</td>
                <td className="ds-dim-t ds-hide-sm">{r.note}</td>
                <td className="r">
                  {r.id !== undefined ? (
                    <a className="ds-id" href={playground(r.id)} title={t('l.cat.run', { id: r.id })}>
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
            <span className="ds-live" /> {rich('l.cat.live', { n: circuits.length })}{' '}
          </>
        ) : (
          t('l.cat.reading') + ' '
        )}
        {t('l.cat.note', { ids: helpers.map((id) => `#${id}`).join(t('common.and')) })}
      </p>
    </section>
  )
}

function Stateful({ live }: { live: Live }) {
  const { timing, byId } = live
  const c = byId(SPIKING)
  const n = SPIKES.length
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec n="04" label={t('l.mem.label')} title={rich('l.mem.title')}>
        {rich('l.mem.lede', {
          latches: c ? t('l.mem.latchesN', { n: c.counts.latch }) : t('l.mem.latches'),
          gates: L(c && gates(c.counts).replace(' + ', t('common.and'))),
        })}
      </Sec>
      <figure className="ds-fig ds-fig-timing" data-rv="scope">
        <TimingDiagram spikes={SPIKES} counts={timing?.counts} fires={timing?.fires} />
        <figcaption>
          {rich('l.mem.fig4', { id: SPIKING, n: c ? c.counts.latch : '…' })}{' '}
          {timing?.verified !== undefined ? (
            timing.mismatch === undefined ? (
              <>
                <span className="ds-verified">
                  <span className="ds-live" /> {t('l.mem.verified', { v: timing.verified, n })}
                </span>
              </>
            ) : (
              t('l.mem.mismatch', { t: timing.mismatch + 1, v: timing.verified, n })
            )
          ) : timing ? (
            t('l.mem.checking')
          ) : (
            t('l.mem.reading')
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
  const { t, rich } = useI18n()
  const ratings: { k: string; v: React.ReactNode; u: string }[] = [
    { k: t('l.iss.cap'), v: <CountUp value={cpu?.supplyCap} />, u: t('l.iss.capU') },
    { k: t('l.iss.price'), v: L(cpu?.mintPrice, okb), u: t('l.iss.priceU') },
    { k: t('l.iss.mintFee'), v: L(fees?.protocolFee, okb), u: t('l.iss.mintFeeU') },
    { k: t('l.iss.tapeFee'), v: L(fees?.tapeoutFee, okb), u: t('l.iss.tapeFeeU') },
  ]
  const gas = misc && Number(formatGwei(misc.gasPrice)).toLocaleString('en-US', { maximumSignificantDigits: 2 })
  return (
    <section className="ds-section">
      <Sec id="issuance" n="05" label={t('l.iss.label')} title={rich('l.iss.title')}>
        {t('l.iss.lede')}
      </Sec>
      <div className="ds-ratings" data-rv="stagger">
        {ratings.map((r, i) => (
          <div key={i} className="ds-rating" style={{ '--i': i } as React.CSSProperties}>
            <div className="ds-rating-k">{r.k}</div>
            <div className="ds-rating-v">{r.v}</div>
            <div className="ds-rating-u">{r.u}</div>
          </div>
        ))}
      </div>
      <div className="ds-cols">
        <ul className="ds-list" data-rv="stagger">
          <li>{rich('l.iss.li1')}</li>
          <li>{rich('l.iss.li2')}</li>
          <li>{rich('l.iss.li3')}</li>
          <li>
            {rich('l.iss.li4', {
              creator: cpu ? (
                <>
                  {' '}
                  (
                  <a href={`${EXPLORER}/address/${cpu.creator}`} target="_blank" rel="noreferrer">
                    {short(cpu.creator)}
                  </a>
                  )
                </>
              ) : null,
              nand: L(holdings?.nand, int),
              latch: L(holdings?.latch, int),
            })}
          </li>
        </ul>
        <div className="ds-table-wrap" data-rv="rows">
          <table className="ds-table">
            <thead>
              <tr>
                <th>{t('l.iss.th.circuit')}</th>
                <th className="r">{t('l.iss.th.transistors')}</th>
                <th className="r">{t('l.iss.th.fee')}</th>
              </tr>
            </thead>
            <tbody>
              {COST_IDS.map((id, i) => {
                const c = byId(id)
                return (
                  <tr key={id} style={{ '--i': i } as React.CSSProperties}>
                    <td>{nameOf(t, id)}</td>
                    <td className="r ds-mono">{L(c && burns(c.counts))}</td>
                    <td className="r ds-mono">{L(fees?.tapeoutFee, okb)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="ds-note">{rich('l.iss.note', { fee: L(fees?.protocolFee, okb), gas: L(gas) })}</p>
        </div>
      </div>
    </section>
  )
}

function BrainWallets({ live }: { live: Live }) {
  const { fees, misc } = live
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec id="wallets" n="06" label={t('l.wal.label')} title={rich('l.wal.title')}>
        {t('l.wal.lede')}
      </Sec>
      <div className="ds-cols">
        <figure className="ds-fig" data-rv="wallet">
          <WalletDiagram misc={misc} />
          <figcaption>
            {t('l.wal.fig5', {
              id: String(WALLET_ID),
              status: misc ? (misc.wallet.opened ? t('l.wal.opened') : t('l.wal.notOpened')) : t('l.wal.end'),
            })}
          </figcaption>
        </figure>
        <ul className="ds-list" data-rv="stagger">
          <li>{rich('l.wal.li1')}</li>
          <li>{rich('l.wal.li2', { fee: L(fees?.openFee, okb) })}</li>
          <li>{rich('l.wal.li3')}</li>
          <li>{rich('l.wal.li4')}</li>
        </ul>
      </div>
    </section>
  )
}

function WalletDiagram({ misc }: { misc?: Misc }) {
  const id = String(WALLET_ID)
  const { t } = useI18n()
  return (
    <svg viewBox="0 0 400 240" className="ds-svg" role="img" aria-label={t('l.wal.aria')}>
      <rect x="120" y="10" width="160" height="44" className="ds-box ds-box-acc" />
      <text x="134" y="30" className="ds-box-t">{t('l.wal.d.circuit', { id })}</text>
      <text x="134" y="45" className="ds-box-s">{t('l.wal.d.owned')}</text>
      <line x1="200" y1="54" x2="200" y2="82" className="ds-edge ds-owner-link" strokeDasharray="3 4" />
      <text x="208" y="72" className="ds-box-s ds-owner-label">owner()</text>
      <rect x="20" y="82" width="360" height="148" className="ds-box ds-box-dash" />
      <text x="36" y="104" className="ds-box-t">{t('l.wal.d.account')}</text>
      <rect x="36" y="118" width="150" height="44" className="ds-box" />
      <text x="50" y="137" className="ds-box-t">{t('l.wal.d.tokens')}</text>
      <text x="50" y="152" className="ds-box-s">{t('l.wal.d.held')}</text>
      <rect x="214" y="118" width="150" height="44" className="ds-box" />
      <text x="228" y="137" className="ds-box-t">execute()</text>
      <text x="228" y="152" className="ds-box-s">{t('l.wal.d.calls')}</text>
      <text x="36" y="190" className="ds-box-s">{t('l.wal.d.always', { id })}</text>
      <text x="36" y="208" className="ds-box-s">
        opener.accountOf(circuits, {id}) → {misc ? short(misc.wallet.account) : '…'}
      </text>
    </svg>
  )
}

/** Circuits in the issuance cost table (copy keys, matched onchain by id). */
const COST_IDS = [3, 4, 5, 11, 12]

const USES: { t: Key; b: Key }[] = [
  { t: 'l.app.1.t', b: 'l.app.1.b' },
  { t: 'l.app.2.t', b: 'l.app.2.b' },
  { t: 'l.app.3.t', b: 'l.app.3.b' },
  { t: 'l.app.4.t', b: 'l.app.4.b' },
]

function Applications() {
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec n="07" label={t('l.app.label')} title={rich('l.app.title')} />
      <ol className="ds-apps" data-rv="alt">
        {USES.map((u, i) => (
          <li key={u.t} style={{ '--i': i } as React.CSSProperties}>
            <span className="ds-apps-n">0{i + 1}</span>
            <h3>{t(u.t)}</h3>
            <p>{t(u.b)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

const SDK_SNIPPET = (t: T) => `import { getCircuit, encodeHex, tapeout } from '@cerebr/sdk'

${t('l.dev.c1')}
const nl = getCircuit('xor-net').build({ mode: 'direct' })

${t('l.dev.c2')}
const { circuitId } = await tapeout.tapeout(wallet, client, {
  circuits: CEREBR, netlist: encodeHex(nl), nIn: 2, nOut: 1,
})

${t('l.dev.c3')}
await tapeout.evalCircuit(client, {
  circuits: CEREBR, id: circuitId, inputs: [1, 0],
}) // → [1]`

function Builders() {
  const { t, rich } = useI18n()
  const lines = SDK_SNIPPET(t).split('\n')
  return (
    <section className="ds-section">
      <Sec n="08" label={t('l.dev.label')} title={rich('l.dev.title')} />
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
        <ul className="ds-list" data-rv="stagger">
          <li>{rich('l.dev.li1')}</li>
          <li>{rich('l.dev.li2')}</li>
          <li>{rich('l.dev.li3')}</li>
          <li>{rich('l.dev.li4')}</li>
        </ul>
      </div>
    </section>
  )
}

function Security({ live }: { live: Live }) {
  const { fees } = live
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec id="security" n="09" label={t('l.sec.label')} title={rich('l.sec.title')}>
        {t('l.sec.lede')}
      </Sec>
      <div className="ds-cols ds-cols-even" data-rv="alt">
        <div className="ds-panel">
          <div className="ds-panel-h">{t('l.sec.good')}</div>
          <ul className="ds-checks">
            <li>{t('l.sec.g1')}</li>
            <li>{t('l.sec.g2')}</li>
            <li>{t('l.sec.g3')}</li>
            <li>{t('l.sec.g4')}</li>
            <li>{t('l.sec.g5')}</li>
          </ul>
        </div>
        <div className="ds-panel ds-panel-warn">
          <div className="ds-panel-h">{t('l.sec.risks')}</div>
          <ul className="ds-warns">
            <li>{t('l.sec.r1')}</li>
            <li>{rich('l.sec.r2', { fee: L(fees?.openFee, okb) })}</li>
            <li>{t('l.sec.r3')}</li>
            <li>{t('l.sec.r4')}</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

const FAQ: [Key, Key][] = [
  ['l.faq.1.q', 'l.faq.1.a'],
  ['l.faq.2.q', 'l.faq.2.a'],
  ['l.faq.3.q', 'l.faq.3.a'],
  ['l.faq.4.q', 'l.faq.4.a'],
  ['l.faq.5.q', 'l.faq.5.a'],
  ['l.faq.6.q', 'l.faq.6.a'],
]

function Faq() {
  const { t, rich } = useI18n()
  return (
    <section className="ds-section">
      <Sec id="faq" n="10" label={t('l.faq.label')} title={rich('l.faq.title')} />
      <div className="ds-faq" data-rv="stagger">
        {FAQ.map(([q, a], i) => (
          <details key={q} className="ds-qa" style={{ '--i': i } as React.CSSProperties}>
            <summary>
              <span className="ds-qa-n">Q{i + 1}</span>
              <span className="ds-qa-q">{t(q)}</span>
              <span className="ds-qa-x" aria-hidden />
            </summary>
            <p>{t(a)}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function FinalCta() {
  const { t, rich } = useI18n()
  return (
    <section className="ds-final">
      <div className="ds-final-copy">
        <span className="ds-sec-n">§11</span>
        <h2 className="ds-final-h">{rich('l.final.title')}</h2>
        <p className="ds-lede">{t('l.final.lede')}</p>
      </div>
      <div className="ds-final-cta">
        <Launch size="lg" />
        <a className="ds-btn ds-btn-line ds-btn-lg" href={REPO_HREF} target="_blank" rel="noreferrer">
          {t('l.final.source')}
        </a>
      </div>
    </section>
  )
}
