import { Logo } from '../components/Logo.tsx'
import { HeroChip } from './HeroChip.tsx'
import { EXPLORER, FEES, ISSUANCE, okb } from './issuance.ts'
import { useCpuStats } from './useCpuStats.ts'
import './landing.css'

const APP_HREF = '/app'
const TAPEOUT_HREF = 'https://tapeout.net'
const SET_AT_LAUNCH = 'Set at launch'

function LaunchButton({ big }: { big?: boolean }) {
  return (
    <a className={`btn primary lp-launch${big ? ' lp-launch-big' : ''}`} href={APP_HREF}>
      Launch App <span aria-hidden>→</span>
    </a>
  )
}

const int = (n: bigint | number) => Number(n).toLocaleString('en-US')

export function Landing() {
  return (
    <div className="lp">
      <div className="bg-grid" aria-hidden />
      <Nav />
      <Hero />
      <HowItWorks />
      <XorStory />
      <Catalog />
      <IssuanceSection />
      <BrainWallets />
      <UseCases />
      <Builders />
      <Security />
      <Faq />
      <FinalCta />
      <LandingFooter />
    </div>
  )
}

function Nav() {
  return (
    <header className="lp-nav">
      <a className="brand" href="/">
        <Logo />
        <div>
          <div className="brand-name">CEREBR</div>
          <div className="brand-sub">neural processor · TapeOut · X Layer</div>
        </div>
      </a>
      <nav className="lp-links">
        <a href="#how">How it works</a>
        <a href="#xor">XOR</a>
        <a href="#catalog">Circuits</a>
        <a href="#issuance">Issuance</a>
        <a href="#wallets">Brain wallets</a>
        <a href="#security">Security</a>
        <a href="#faq">FAQ</a>
      </nav>
      <LaunchButton />
    </header>
  )
}

function Hero() {
  return (
    <section className="lp-hero">
      <div className="lp-hero-copy">
        <span className="lp-eyebrow">
          <span className="dot live" /> Built on TapeOut · X Layer mainnet
        </span>
        <h1>
          A neural processor,
          <br />
          <span className="grad">taped out on X Layer.</span>
        </h1>
        <p className="lp-lede">
          Cerebr compiles neurons into real NAND netlists and tapes them out on its own TapeOut processor. Every
          transistor is a synapse, every circuit is a neuron you own, and anyone can run inference on-chain with{' '}
          <code>eval()</code>.
        </p>
        <div className="lp-cta-row">
          <LaunchButton big />
          <a className="btn lp-ghost" href="#xor">
            See a neuron solve XOR
          </a>
        </div>
        <ul className="lp-proof">
          <li>Real gates, not pictures of gates</li>
          <li>Inference you can verify on-chain</li>
          <li>Neurons any team can REF</li>
        </ul>
      </div>
      <div className="lp-hero-art">
        <HeroChip />
      </div>
      <LiveStrip />
    </section>
  )
}

/** Live CPU numbers from transistors/circuits via the SDK; hidden until a CPU is configured and readable. */
function LiveStrip() {
  const s = useCpuStats()
  if (!s) return null
  const pct = s.supplyCap > 0n ? Number((s.minted * 10_000n) / s.supplyCap) / 100 : 0
  const items: [string, string, string][] = [
    ['Processor', s.name, s.symbol],
    ['Transistors minted', int(s.minted), `of ${int(s.supplyCap)} (${pct}%)`],
    ['Remaining', int(s.remaining), 'NAND + LATCH share the cap'],
    ['Unit price', okb(s.mintPrice), 'OKB per transistor'],
    ['Circuits taped out', int(s.circuitCount), 'on this CPU'],
    ['Tape-out fee', okb(s.tapeoutFee), 'OKB, to TapeOut'],
  ]
  return (
    <div className="lp-live">
      <div className="lp-live-head tiny">
        <span className="dot live" /> Live from X Layer ·{' '}
        <a href={`${EXPLORER}/address/${s.transistors}`} target="_blank" rel="noreferrer">
          view on OKLink
        </a>
      </div>
      <div className="lp-live-grid">
        {items.map(([k, v, u], i) => (
          <div key={k} className={`lp-live-item${i === 1 || i === 4 ? ' accent' : ''}`}>
            <div className="stat-label">{k}</div>
            <div className="lp-live-value mono" title={v}>
              {v}
            </div>
            <div className="stat-unit">{u}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SectionHead({ id, kicker, title, children }: { id?: string; kicker: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="lp-head" id={id}>
      <span className="lp-kicker">{kicker}</span>
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
    </div>
  )
}

const STEPS = [
  {
    n: '01',
    title: 'Mint transistors',
    body: 'Transistors are the synapses. Mint NAND (and LATCH, for memory) from the Cerebr processor’s fixed supply at a fixed unit price.',
    fn: 'transistors.mint(NAND, amount)',
  },
  {
    n: '02',
    title: 'Compile a neuron',
    body: 'Give the compiler integer weights and a threshold. It tries four constructions and keeps the netlist with the fewest NAND gates.',
    fn: 'neuron({ weights, theta }) → netlist',
  },
  {
    n: '03',
    title: 'Tape it out',
    body: 'The netlist goes on-chain as a circuit NFT. Each NAND burns one transistor, so every neuron is paid for in real silicon.',
    fn: 'circuits.tapeout(nl, nIn, nOut)',
  },
  {
    n: '04',
    title: 'Compose and infer',
    body: 'Wire taped-out neurons into networks with REF, which reuses a circuit without burning more transistors. Run any of them for free with eval.',
    fn: 'circuits.eval(id, inputs)',
  },
]

function HowItWorks() {
  return (
    <section className="lp-section">
      <SectionHead id="how" kicker="How it works" title="From transistors to neurons to networks">
        TapeOut gives every processor two contracts: transistors you mint and circuits you tape out by burning them.
        Cerebr adds the missing piece, a compiler that turns neural networks into those circuits.
      </SectionHead>
      <ol className="lp-steps">
        {STEPS.map((s) => (
          <li key={s.n} className="card lp-step">
            <span className="lp-step-n mono">{s.n}</span>
            <h3>{s.title}</h3>
            <p className="muted">{s.body}</p>
            <code className="lp-fn">{s.fn}</code>
          </li>
        ))}
      </ol>
    </section>
  )
}

const XOR_ROWS: [number, number, number, number, number][] = [
  // x0, x1, OR, NAND, y = AND(OR, NAND)
  [0, 0, 0, 1, 0],
  [0, 1, 1, 1, 1],
  [1, 0, 1, 1, 1],
  [1, 1, 1, 0, 0],
]

function XorStory() {
  return (
    <section className="lp-section">
      <SectionHead id="xor" kicker="The XOR problem" title="One neuron can’t. Two layers of taped-out neurons can.">
        In 1969 Minsky and Papert showed that a single threshold neuron can never compute XOR, because no straight line
        separates its true cases from its false ones. Add a hidden layer and the problem disappears. Cerebr tapes out
        that exact network and runs it on-chain.
      </SectionHead>
      <div className="lp-split">
        <div className="card lp-xor-card">
          <XorNetwork />
        </div>
        <div className="lp-xor-side">
          <div className="card lp-xor-plane-card">
            <XorPlane />
            <p className="tiny muted">
              The two hidden neurons each draw one line. The output neuron fires only between them.
            </p>
          </div>
          <div className="card lp-truth">
            <table>
              <thead>
                <tr>
                  <th>x0</th>
                  <th>x1</th>
                  <th>OR</th>
                  <th>NAND</th>
                  <th>y = XOR</th>
                </tr>
              </thead>
              <tbody>
                {XOR_ROWS.map((r) => (
                  <tr key={r.join('')}>
                    {r.map((v, i) => (
                      <td key={i} className={i === 4 ? (v ? 'on' : 'off') : undefined}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <ul className="lp-xor-facts">
        <li>
          <b className="mono">6 NAND</b>
          <span className="muted">flattened into one circuit, so it burns 6 transistors</span>
        </li>
        <li>
          <b className="mono">0 NAND + 3 REF</b>
          <span className="muted">built from the taped-out OR, NAND and AND neurons, burning nothing new</span>
        </li>
        <li>
          <b className="mono">eval(id, 0b10) → 1</b>
          <span className="muted">a free view call, so anyone can check the answer</span>
        </li>
      </ul>
    </section>
  )
}

function XorNetwork() {
  const node = (x: number, y: number, label: string, sub: string, color: string) => (
    <g>
      <circle cx={x} cy={y} r="27" fill="#101622" stroke={color} strokeWidth="2" />
      <text x={x} y={y + 1} textAnchor="middle" fill={color} className="lp-svg-title">
        {label}
      </text>
      <text x={x} y={y + 15} textAnchor="middle" fill="#8b98a9" className="lp-svg-label">
        {sub}
      </text>
    </g>
  )
  // weight labels sit near the target node so the crossing edges stay readable
  const edge = (x1: number, y1: number, x2: number, y2: number, w: string, t = 0.7) => {
    const lx = x1 + (x2 - x1) * t
    const ly = y1 + (y2 - y1) * t
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#xorG)" strokeWidth="1.6" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#xorG)" strokeWidth="2" className="lp-trace" pathLength={100} />
        <rect x={lx - 13} y={ly - 9} width="26" height="16" rx="5" fill="#0b0f17" stroke="#26324a" />
        <text x={lx} y={ly + 3} textAnchor="middle" fill="#e6edf3" className="lp-svg-label">
          {w}
        </text>
      </g>
    )
  }
  return (
    <svg viewBox="0 0 420 260" className="lp-xor-svg" role="img" aria-label="Two-layer neural network computing XOR: OR and NAND hidden neurons feeding an AND output neuron">
      <defs>
        <linearGradient id="xorG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3ddc97" />
          <stop offset="1" stopColor="#2bb3ff" />
        </linearGradient>
      </defs>
      <text x="50" y="22" textAnchor="middle" fill="#8b98a9" className="lp-svg-label">inputs</text>
      <text x="200" y="22" textAnchor="middle" fill="#8b98a9" className="lp-svg-label">hidden layer</text>
      <text x="345" y="22" textAnchor="middle" fill="#8b98a9" className="lp-svg-label">output</text>
      {edge(77, 80, 173, 75, '+1')}
      {edge(77, 80, 173, 185, '−1', 0.78)}
      {edge(77, 190, 173, 75, '+1', 0.78)}
      {edge(77, 190, 173, 185, '−1')}
      {edge(227, 75, 318, 130, '+1', 0.5)}
      {edge(227, 185, 318, 130, '+1', 0.5)}
      {node(50, 80, 'x0', 'input', '#e6edf3')}
      {node(50, 190, 'x1', 'input', '#e6edf3')}
      {node(200, 75, 'OR', 'θ = 1', '#3ddc97')}
      {node(200, 185, 'NAND', 'θ = −1', '#b26bff')}
      {node(345, 130, 'AND', 'θ = 2', '#2bb3ff')}
      <text x="345" y="185" textAnchor="middle" fill="#e6edf3" className="lp-svg-label">y = x0 ⊕ x1</text>
      <text x="210" y="248" textAnchor="middle" fill="#8b98a9" className="lp-svg-label">
        each circle is a taped-out circuit · each line is a REF
      </text>
    </svg>
  )
}

function XorPlane() {
  // input plane: the four XOR cases and the two lines drawn by the hidden neurons
  // (OR fires above x0 + x1 = 0.5, NAND fires below x0 + x1 = 1.5; XOR is the band between)
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
    <svg viewBox="0 0 220 200" className="lp-plane" role="img" aria-label="The XOR cases in the input plane, separated by two lines">
      <defs>
        <clipPath id="xorPlaneClip">
          <rect x="16" y="8" width="196" height="186" />
        </clipPath>
      </defs>
      <g clipPath="url(#xorPlaneClip)">
        <path d={`M${band.map((p) => p.join(' ')).join(' L')} Z`} fill="rgba(61,220,151,0.10)" />
        <line {...line(0.5)} stroke="#3ddc97" strokeDasharray="5 4" />
        <line {...line(1.5)} stroke="#b26bff" strokeDasharray="5 4" />
      </g>
      <line x1="30" y1={py(0)} x2="205" y2={py(0)} stroke="#26324a" />
      <line x1={px(0)} y1="14" x2={px(0)} y2="185" stroke="#26324a" />
      {pts.map(([a, b, y]) => (
        <g key={`${a}${b}`}>
          <circle cx={px(a)} cy={py(b)} r="9" fill={y ? '#3ddc97' : '#101622'} stroke={y ? '#3ddc97' : '#ff5d73'} strokeWidth="2" />
          <text x={px(a) + 16} y={py(b) + (b ? -10 : 22)} fill="#8b98a9" className="lp-svg-label" textAnchor="middle">
            {a}
            {b}
          </text>
        </g>
      ))}
      <text x="208" y={py(0) + 14} textAnchor="end" fill="#8b98a9" className="lp-svg-label">x0</text>
      <text x={px(0) - 8} y="22" textAnchor="end" fill="#8b98a9" className="lp-svg-label">x1</text>
    </svg>
  )
}

type Kind = 'neuron' | 'network' | 'ref' | 'memory' | 'arith'
const KIND_LABEL: Record<Kind, string> = {
  neuron: 'Neuron',
  network: 'Network',
  ref: 'REF-composed',
  memory: 'Stateful',
  arith: 'Arithmetic',
}

// Gate counts from the Cerebr neural compiler (sdk/src/neuro, direct output mode), each circuit
// exhaustively verified against its reference model.
const CATALOG: { name: string; io: string; gates: string; kind: Kind; note: string }[] = [
  { name: 'AND neuron', io: '2 → 1', gates: '2 NAND', kind: 'neuron', note: 'Weights +1, +1, fires at 2.' },
  { name: 'OR neuron', io: '2 → 1', gates: '3 NAND', kind: 'neuron', note: 'Weights +1, +1, fires at 1.' },
  { name: 'Inhibitory neuron', io: '2 → 1', gates: '1 NAND', kind: 'neuron', note: 'Weights −1, −1, threshold −1. A single gate.' },
  { name: 'Majority-3', io: '3 → 1', gates: '6 NAND', kind: 'neuron', note: 'Votes yes when at least two of three inputs do.' },
  { name: 'Majority-5', io: '5 → 1', gates: '24 NAND', kind: 'neuron', note: 'Five-voter consensus neuron.' },
  { name: 'Go/No-Go neuron', io: '5 → 1', gates: '19 NAND', kind: 'neuron', note: 'Three excitatory and two inhibitory inputs, threshold 2.' },
  { name: 'XOR network', io: '2 → 1', gates: '6 NAND', kind: 'network', note: 'The two-layer network above, flattened.' },
  { name: 'XOR network (REF)', io: '2 → 1', gates: '0 NAND + 3 REF', kind: 'ref', note: 'Same truth table, built from three taped-out neurons.' },
  { name: 'Line detector', io: '9 → 3', gates: '37 NAND', kind: 'network', note: 'Finds horizontal, vertical and diagonal lines on a 3×3 grid.' },
  { name: 'Line detector (REF)', io: '9 → 3', gates: '0 NAND + 11 REF', kind: 'ref', note: 'Eight line cells and three pooling neurons, all reused.' },
  { name: '2-bit adder', io: '4 → 3', gates: '14 NAND', kind: 'arith', note: 'Ripple adder, the building block for counting neurons.' },
  { name: 'Integrate-and-fire', io: '2 → 1', gates: '17 NAND + 2 LATCH', kind: 'memory', note: 'A spiking neuron that fires on every third spike. Runs with step().' },
]

function Catalog() {
  return (
    <section className="lp-section">
      <SectionHead id="catalog" kicker="Circuit catalog" title="Neurons you can run, own and reuse">
        Every circuit below is compiled to a TapeOut netlist and checked against its reference model on every possible
        input. Gate counts are exact, so a circuit costs exactly that many transistors to tape out.
      </SectionHead>
      <div className="lp-catalog">
        {CATALOG.map((c) => (
          <div key={c.name} className={`card lp-cat k-${c.kind}`}>
            <div className="lp-cat-top">
              <span className="lp-cat-kind tiny">{KIND_LABEL[c.kind]}</span>
              <span className="tiny muted mono">{c.io}</span>
            </div>
            <h3>{c.name}</h3>
            <div className="lp-cat-gates mono">{c.gates}</div>
            <p className="muted small">{c.note}</p>
          </div>
        ))}
      </div>
      <p className="tiny muted lp-note">
        REF reuses a circuit that is already taped out, on Cerebr or on any other TapeOut processor, without burning
        more transistors. The tape-out fee still applies to each new circuit.
      </p>
    </section>
  )
}

function IssuanceSection() {
  const cap = ISSUANCE.supplyCap
  const price = ISSUANCE.mintPrice
  const cards: { k: string; v: string; u: string; todo?: boolean }[] = [
    { k: 'Transistor supply cap', v: cap !== undefined ? int(cap) : SET_AT_LAUNCH, u: 'NAND + LATCH share it', todo: cap === undefined },
    { k: 'Unit price', v: price !== undefined ? okb(price) : SET_AT_LAUNCH, u: 'OKB per transistor', todo: price === undefined },
    { k: 'Mint fee', v: FEES.mintCall, u: 'OKB per mint call, to TapeOut' },
    { k: 'Tape-out fee', v: FEES.tapeout, u: 'OKB per circuit, to TapeOut' },
  ]
  return (
    <section className="lp-section">
      <SectionHead id="issuance" kicker="Asset issuance" title="One asset: the transistor">
        Cerebr has no token of its own. The asset is the Cerebr processor’s transistor, issued through the TapeOut
        factory with a supply cap and unit price that are public from the moment it is deployed.
      </SectionHead>
      <div className="lp-nums">
        {cards.map((c) => (
          <div key={c.k} className={`lp-num${c.todo ? ' lp-todo' : ''}`}>
            <div className="stat-label">{c.k}</div>
            <div className="lp-num-v mono">{c.v}</div>
            <div className="small muted">{c.u}</div>
          </div>
        ))}
      </div>
      <div className="lp-split">
        <ul className="lp-facts">
          <li>
            <b>Fixed supply, fixed price.</b> Set once at <code>createCPU</code>; Cerebr cannot change them (TapeOut’s
            contracts that enforce them are upgradeable by TapeOut). No curve, no presale and no team allocation.
            Anyone mints at the same price until the cap is reached.
          </li>
          <li>
            <b>Burned by use.</b> Each NAND gate in a taped-out circuit burns one NAND transistor, and each LATCH burns
            one LATCH. Burns don’t free up room under the cap, so transistors only get scarcer.
          </li>
          <li>
            <b>Where the OKB goes.</b> The unit price goes to the processor’s creator, who withdraws it from the
            contract. The mint fee and tape-out fee go to TapeOut.
          </li>
          <li>
            <b>No fake activity.</b> We tape out our showcase circuits once each from the deployment wallet and say so.
            The creator also keeps 1,000 NAND and 100 LATCH, minted at the public price and disclosed. We never trade
            with ourselves to inflate numbers.
          </li>
        </ul>
        <div className="card">
          <h3 className="lp-h3">What a circuit costs</h3>
          <table className="lp-cost">
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Transistors</th>
                <th>Fees (OKB)</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Inhibitory neuron', 1],
                ['XOR network', 6],
                ['XOR network (REF)', 0],
                ['Line detector', 37],
                ['Line detector (REF)', 0],
              ].map(([n, t]) => (
                <tr key={n}>
                  <td>{n}</td>
                  <td className="mono">{t}</td>
                  <td className="mono">{FEES.tapeout}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted">
            Plus the transistors themselves at the unit price, a {FEES.mintCall} OKB fee per mint call and gas (about
            0.02 gwei on X Layer). Fees are TapeOut’s and can change; the dApp reads them live before every quote.
          </p>
        </div>
      </div>
    </section>
  )
}

function BrainWallets() {
  return (
    <section className="lp-section">
      <SectionHead id="wallets" kicker="Brain wallets" title="Every neuron can have a wallet">
        Each taped-out circuit can open TapeOut’s native ERC-6551 account. A neuron can then hold OKB, tokens and NFTs
        and call contracts. Whoever owns the circuit NFT controls its wallet.
      </SectionHead>
      <div className="lp-split">
        <div className="card lp-nest">
          <WalletDiagram />
        </div>
        <ul className="lp-facts">
          <li>
            <b>Address known up front.</b> <code>accountOf(circuit)</code> returns the wallet’s address before it
            exists, so a neuron can receive funds straight away.
          </li>
          <li>
            <b>Opened on demand.</b> <code>open()</code> deploys the account for {FEES.open} OKB, paid to TapeOut.
            Anyone can pay to open a wallet for any circuit.
          </li>
          <li>
            <b>Sold with the neuron.</b> Control follows the circuit NFT. Transfer the circuit and its wallet goes with
            it.
          </li>
          <li>
            <b>One rule.</b> Never send a circuit into its own wallet: the wallet would own itself and be locked for
            good. The dApp offers no circuit transfers, so it can’t happen there.
          </li>
        </ul>
      </div>
    </section>
  )
}

function WalletDiagram() {
  const box = (x: number, y: number, w: number, label: string, color: string, sub: string) => (
    <g>
      <rect x={x} y={y} width={w} height="46" rx="10" fill="#101622" stroke={color} strokeWidth="1.6" />
      <text x={x + 14} y={y + 20} fill={color} className="lp-svg-title">{label}</text>
      <text x={x + 14} y={y + 36} fill="#8b98a9" className="lp-svg-label">{sub}</text>
    </g>
  )
  return (
    <svg viewBox="0 0 400 250" className="lp-nest-svg" role="img" aria-label="A Cerebr circuit NFT controlling its TapeOut native account">
      {box(110, 10, 180, 'Circuit #7 · XOR', '#2bb3ff', 'NFT owned by you')}
      <path d="M200 56 V78" stroke="#2bb3ff" strokeDasharray="3 4" />
      <rect x="20" y="80" width="360" height="160" rx="14" fill="rgba(43,179,255,0.05)" stroke="#2bb3ff" strokeOpacity="0.5" strokeDasharray="5 5" />
      <text x="36" y="104" fill="#2bb3ff" className="lp-svg-title">Native account of #7 (ERC-6551)</text>
      {box(36, 120, 150, 'OKB · tokens', '#3ddc97', 'held by the neuron')}
      {box(214, 120, 150, 'execute()', '#b26bff', 'calls any contract')}
      <text x="36" y="200" fill="#e6edf3" className="lp-svg-label">owner() = ownerOf(#7), at all times</text>
      <text x="36" y="220" fill="#8b98a9" className="lp-svg-label">opener.open(circuits, 7) deploys it via the 6551 registry</text>
    </svg>
  )
}

const USES = [
  {
    t: 'On-chain game AI',
    b: 'Enemy logic, bot players and referees that run as real circuits. Every move can be replayed and checked by anyone with a view call.',
  },
  {
    t: 'Verifiable inference for agents',
    b: 'DeAI agents can call a small, fixed classifier on-chain and prove which model made the decision. No oracle, no trusted server.',
  },
  {
    t: 'Composable neurons',
    b: 'Our neurons are public building blocks. Any team on TapeOut can REF them into a bigger network without burning a single transistor.',
  },
  {
    t: 'Teaching how brains compute',
    b: 'From threshold units to spiking neurons, each idea is a circuit you can open, read gate by gate and run live.',
  },
]

function UseCases() {
  return (
    <section className="lp-section">
      <SectionHead kicker="Use cases" title="Small, honest intelligence that lives on-chain" />
      <div className="lp-cards-4">
        {USES.map((c) => (
          <div key={c.t} className="card lp-mini">
            <h3>{c.t}</h3>
            <p className="muted">{c.b}</p>
          </div>
        ))}
      </div>
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

// run it on-chain, for free: x0 = 1, x1 = 0
await tapeout.evalCircuit(client, {
  circuits: CEREBR, id: circuitId, inputs: [1, 0],
}) // → [1]`

function Builders() {
  return (
    <section className="lp-section">
      <SectionHead kicker="For builders" title="A compiler, an SDK and an on-chain renderer" />
      <div className="lp-split">
        <pre className="card lp-code mono">{SDK_SNIPPET}</pre>
        <ul className="lp-facts">
          <li>
            <b>Neural compiler.</b> Threshold neurons, majority votes, multi-layer networks and spiking neurons compile
            to TapeOut netlists. A built-in simulator matches TapeOut’s own byte for byte.
          </li>
          <li>
            <b>TapeOut SDK.</b> Typed viem helpers for every step: create a CPU, mint, tape out, eval, step and open
            accounts, with fee quotes read live from the chain.
          </li>
          <li>
            <b>CerebrScope.</b> An on-chain lens that draws each circuit as an SVG die shot from its actual gates,
            serves its metadata and runs truth tables in one call. TapeOut circuits return an empty{' '}
            <code>tokenURI</code> today; Scope fills that gap.
          </li>
          <li>
            <b>Verified on a mainnet fork.</b> Every TapeOut call we rely on was checked on a local copy of X Layer
            mainnet before any real transaction.
          </li>
        </ul>
      </div>
    </section>
  )
}

function Security() {
  return (
    <section className="lp-section">
      <SectionHead id="security" kicker="Security & honesty" title="What we control, and what we don’t">
        Cerebr adds no custody and no token of its own. Here’s exactly where your OKB and your trust go.
      </SectionHead>
      <div className="lp-split">
        <div className="card">
          <h3 className="lp-h3">By design</h3>
          <ul className="lp-checks">
            <li>Cerebr holds no user funds. Mints, tape-outs and wallets are direct calls to TapeOut’s contracts.</li>
            <li>CerebrScope holds no funds and has no admin. Its only state is an optional label registry, and only a circuit’s owner can label it.</li>
            <li>Supply cap and unit price are set once at deployment and published on this page. Cerebr has no way to change them.</li>
            <li>The dApp reads fees live and sends exact amounts, so no OKB is stranded by overpaying.</li>
            <li>Every catalog circuit is checked against its reference model on all inputs before it is taped out.</li>
          </ul>
        </div>
        <div className="card">
          <h3 className="lp-h3">Risks we disclose</h3>
          <ul className="lp-warns">
            <li>TapeOut’s X Layer contracts are in a test phase, upgradeable and unaudited. Their owner can change code and fees.</li>
            <li>Opening a brain wallet costs {FEES.open} OKB, paid to TapeOut, not to Cerebr.</li>
            <li>Circuits run as view calls with gas limits, so on-chain networks stay small: tens to hundreds of gates.</li>
            <li>Our compiler, CerebrScope, launch script and dApp had an internal review (AUDIT.md), not a professional third-party audit.</li>
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
    'They are binary neural networks: neurons with integer weights and a threshold, outputting 0 or 1. Small, but real, and every one runs gate by gate on-chain.',
  ],
  [
    'Does running a circuit cost anything?',
    'No. eval and step are view functions, so you can call them for free from any wallet, script or contract read.',
  ],
  [
    'Can I use Cerebr neurons in my own circuit?',
    'Yes. Add a REF to the circuit’s id in your netlist. It burns no transistors and pays no royalty; you only pay the normal tape-out fee for your own circuit.',
  ],
  [
    'What do I need to start?',
    'An injected wallet such as OKX Wallet and a little OKB on X Layer for transistors, fees and gas.',
  ],
] as const

function Faq() {
  return (
    <section className="lp-section">
      <SectionHead id="faq" kicker="FAQ" title="Questions, answered" />
      <div className="lp-faq">
        {FAQ.map(([q, a]) => (
          <details key={q} className="card lp-qa">
            <summary>{q}</summary>
            <p className="muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="lp-final card">
      <div>
        <h2>
          Build a neuron. <span className="grad">Tape it out. Watch it think.</span>
        </h2>
        <p className="muted">Mint transistors, compile a circuit, tape it out and test it live, all from the dApp.</p>
      </div>
      <LaunchButton big />
    </section>
  )
}

function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="brand">
        <Logo size={26} />
        <span className="brand-name">CEREBR</span>
      </div>
      <p className="tiny muted">
        A neural processor built on{' '}
        <a href={TAPEOUT_HREF} target="_blank" rel="noreferrer">
          TapeOut
        </a>{' '}
        for the IGNIX X Layer hackathon. Smart contracts carry risk; only use funds you can afford to lose. Not financial
        advice.
      </p>
      <a className="small" href={APP_HREF}>
        Launch App →
      </a>
    </footer>
  )
}
