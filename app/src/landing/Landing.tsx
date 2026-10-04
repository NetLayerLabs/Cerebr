import { useCerebr } from '../hooks/useCerebr.ts'
import { compact, fmt } from '../lib/format.ts'
import { TIERS } from '../lib/tiers.ts'
import { Logo } from '../components/Logo.tsx'
import { HeroChip } from './HeroChip.tsx'
import './landing.css'

const APP_HREF = '/app'
const RARITY = ['Common', 'Rare', 'Epic', 'Legendary'] as const
const TIER_COST = ['5,000 CBR', '20,000 CBR', '100,000 CBR', 'Fusion only']
const FUSE_FROM = ['Tape out directly', '2 × Basic + 5k CBR', '2 × Pro + 20k CBR', '2 × Quantum + 100k CBR']

function LaunchButton({ big }: { big?: boolean }) {
  return (
    <a className={`btn primary lp-launch${big ? ' lp-launch-big' : ''}`} href={APP_HREF}>
      Launch App <span aria-hidden>→</span>
    </a>
  )
}

export function Landing() {
  return (
    <div className="lp">
      <div className="bg-grid" aria-hidden />
      <Nav />
      <Hero />
      <Loop />
      <Economics />
      <Circuits />
      <BrainWallets />
      <Fairness />
      <Security />
      <Builders />
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
          <div className="brand-sub">neural processor · X Layer</div>
        </div>
      </a>
      <nav className="lp-links">
        <a href="#how">How it works</a>
        <a href="#economics">Economics</a>
        <a href="#circuits">Circuits</a>
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
          <span className="dot live" /> Built for X Layer · IGNIX TapeOut Hackathon
        </span>
        <h1>
          Mint compute.
          <br />
          <span className="grad">Burn it into brains.</span>
        </h1>
        <p className="lp-lede">
          Cerebr is an on-chain neural processor. Buy Transistors ($CBR) on a fully backed bonding curve, burn them to
          tape out Neural Circuit NFTs, and fuse Circuits into rarer brains, each with its own on-chain wallet.
        </p>
        <div className="lp-cta-row">
          <LaunchButton big />
          <a className="btn lp-ghost" href="#how">
            See how it works
          </a>
        </div>
        <ul className="lp-proof">
          <li>100% on-chain art &amp; metadata</li>
          <li>Owner can never touch the reserve</li>
          <li>Sells can never be paused</li>
        </ul>
      </div>
      <div className="lp-hero-art">
        <HeroChip />
      </div>
      <LiveStrip />
    </section>
  )
}

/** Live protocol numbers from CerebrLens.protocolState(); hidden when no deployment is reachable. */
function LiveStrip() {
  const { state, chain } = useCerebr()
  if (!state) return null
  const items: [string, string, string][] = [
    ['Spot price', fmt(state.currentPrice, 4), 'OKB / CBR'],
    ['Circulating', compact(state.totalSupply), `of ${compact(state.maxSupply)} CBR`],
    ['OKB reserve', fmt(state.balance, 4), 'OKB'],
    ['Surplus locked', fmt(state.surplusReserve, 4), 'OKB, forever'],
    ['CBR burned', compact(state.totalCbrBurned), 'CBR'],
    ['Circuits', state.totalCircuits.toString(), 'taped out + fused'],
  ]
  return (
    <div className="lp-live">
      <div className="lp-live-head tiny">
        <span className="dot live" /> Live from {chain?.name ?? 'chain'}
      </div>
      <div className="lp-live-grid">
        {items.map(([k, v, u], i) => (
          <div key={k} className={`lp-live-item${i === 3 || i === 4 ? ' accent' : ''}`}>
            <div className="stat-label">{k}</div>
            <div className="lp-live-value mono">{v}</div>
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
    title: 'Mint Transistors',
    body: 'Send OKB and receive $CBR at the price on a linear bonding curve. Early buyers pay less, and every OKB paid stays in the contract as reserve.',
    fn: 'buyTransistors(amount, maxCost)',
  },
  {
    n: '02',
    title: 'Tape out a Circuit',
    body: 'Burn 5k, 20k or 100k $CBR to mint a Basic, Pro or Quantum Neural Circuit. Its traits stay sealed until a later block reveals them.',
    fn: 'tapeOutCircuit()',
  },
  {
    n: '03',
    title: 'Fuse upward',
    body: 'Two Circuits of the same tier plus $CBR make one Circuit of the next tier. The parents move into the child’s brain wallet; nothing is destroyed.',
    fn: 'fuseCircuits(idA, idB)',
  },
  {
    n: '04',
    title: 'Lock the surplus',
    body: 'Burned $CBR never comes back, but the OKB that backed it stays in the reserve. That surplus can’t be withdrawn by anyone, so it only grows.',
    fn: 'surplusReserve()',
  },
]

function Loop() {
  return (
    <section className="lp-section">
      <SectionHead id="how" kicker="How it works" title="A closed loop from OKB to on-chain brains">
        Four steps and one economic idea: every burn makes the curve more than fully backed.
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

function Economics() {
  return (
    <section className="lp-section">
      <SectionHead id="economics" kicker="Economics" title="A bonding curve that only gets more backed">
        No order book, no liquidity pool and no team allocation. The contract itself is the market maker.
      </SectionHead>
      <div className="lp-split">
        <div className="card lp-curve-card">
          <CurveIllustration />
          <div className="lp-formula mono">
            price(s) = <span className="c-mint">base</span> + <span className="c-cyan">slope</span> × s
          </div>
        </div>
        <ul className="lp-facts">
          <li>
            <b>10M $CBR max circulating supply.</b> The cap and the curve parameters are fixed when the contract is
            deployed. The owner can never change them.
          </li>
          <li>
            <b>Exact integral pricing.</b> A buy pays the area under the curve. Buys round up and sells round down, so the
            reserve can never fall short, even by a single wei.
          </li>
          <li>
            <b>Sell back at any time.</b> Selling burns your $CBR and pays you from the reserve, minus a 1% fee. Sells
            have no pause switch.
          </li>
          <li>
            <b>Burns over-collateralise the curve.</b> A burn lowers the spot price, but the OKB behind the burned $CBR
            stays in the reserve forever. The surplus is readable on-chain at any time.
          </li>
          <li>
            <b>Slippage protection built in.</b> Every buy takes a <code>maxCost</code> and every sell a{' '}
            <code>minRefund</code>, so a front-runner can’t push you past the limit you set.
          </li>
        </ul>
      </div>
    </section>
  )
}

function CurveIllustration() {
  // price rises linearly; shaded = reserve backing current supply; hatched = locked surplus from burns
  return (
    <svg viewBox="0 0 400 220" className="lp-curve" role="img" aria-label="Linear bonding curve with reserve and locked surplus">
      <defs>
        <linearGradient id="lpArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3ddc97" stopOpacity="0.35" />
          <stop offset="1" stopColor="#3ddc97" stopOpacity="0.03" />
        </linearGradient>
        <pattern id="lpHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="rgba(255,176,0,0.08)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="#ffb000" strokeOpacity="0.55" strokeWidth="2" />
        </pattern>
      </defs>
      <g stroke="#1c2536">
        {[40, 80, 120, 160].map((y) => (
          <line key={y} x1="30" x2="390" y1={y} y2={y} />
        ))}
      </g>
      <path d="M30 190 L30 165 L215 110 L215 190 Z" fill="url(#lpArea)" />
      <path d="M215 190 L215 110 L265 95 L265 190 Z" fill="url(#lpHatch)" />
      <path d="M30 165 L390 58" stroke="#3ddc97" strokeWidth="3" fill="none" />
      <line x1="30" y1="190" x2="390" y2="190" stroke="#26324a" />
      <line x1="30" y1="20" x2="30" y2="190" stroke="#26324a" />
      <circle cx="215" cy="110" r="6" fill="#3ddc97" />
      <circle cx="215" cy="110" r="12" fill="none" stroke="#3ddc97" strokeOpacity="0.4" className="lp-pulse" />
      <text x="222" y="104" className="lp-svg-label" fill="#e6edf3">supply now</text>
      <text x="120" y="182" className="lp-svg-label" fill="#3ddc97">reserve backing</text>
      <text x="270" y="150" className="lp-svg-label" fill="#ffb000">locked by burns</text>
      <text x="36" y="34" className="lp-svg-label" fill="#8b98a9">price (OKB)</text>
      <text x="330" y="208" className="lp-svg-label" fill="#8b98a9">supply →</text>
    </svg>
  )
}

function Circuits() {
  return (
    <section className="lp-section">
      <SectionHead id="circuits" kicker="Neural Circuits" title="Four tiers. Better odds the higher you go.">
        Each Circuit is an ERC-721 whose SVG art and traits are generated entirely on-chain: architecture, cores,
        clock speed, process node and rarity. There’s no IPFS link to go missing.
      </SectionHead>
      <div className="lp-tiers">
        {TIERS.map((t) => (
          <div key={t.id} className="tier lp-tier" style={{ '--tc': t.color } as React.CSSProperties}>
            <div className="tier-top">
              <span className="tier-name">{t.name}</span>
              <span className="tiny muted mono">T{t.id}</span>
            </div>
            <div className="tier-cost mono">{TIER_COST[t.id]}</div>
            <div className="tiny muted">{FUSE_FROM[t.id]}</div>
            <div className="odds" aria-label="Rarity odds">
              {t.odds.map((o, i) => (
                <span key={i} style={{ flexGrow: o || 0.001 }} className={`odd r${i}`}>
                  {o >= 10 ? `${o}%` : ''}
                </span>
              ))}
            </div>
            <dl className="lp-spec tiny">
              <dt>Cores</dt>
              <dd className="mono">{t.cores}</dd>
              <dt>Clock</dt>
              <dd className="mono">{t.clock} GHz</dd>
              <dt>Node</dt>
              <dd className="mono">{t.node} nm</dd>
              <dt>Legendary</dt>
              <dd className="mono">{t.odds[3]}%</dd>
            </dl>
          </div>
        ))}
      </div>
      <div className="lp-legend tiny muted">
        {RARITY.map((r, i) => (
          <span key={r}>
            <i className={`odd r${i}`} /> {r}
          </span>
        ))}
      </div>
    </section>
  )
}

function BrainWallets() {
  return (
    <section className="lp-section">
      <SectionHead id="wallets" kicker="ERC-6551 brain wallets" title="Every Circuit is also a wallet">
        Each Neural Circuit controls its own token-bound account. A brain can hold OKB, tokens and other NFTs, sign
        messages (ERC-1271) and make calls. Whoever owns the Circuit controls the wallet.
      </SectionHead>
      <div className="lp-split">
        <div className="card lp-nest">
          <NestDiagram />
        </div>
        <ul className="lp-facts">
          <li>
            <b>Created on demand.</b> Every Circuit’s wallet address is known from the moment it is minted, so it can
            receive assets straight away. The wallet contract is only deployed when the owner clicks “Activate brain
            wallet”, which keeps minting cheap.
          </li>
          <li>
            <b>Fusion keeps its history.</b> Fused parents aren’t burned. They move into the child’s wallet, so anything
            they held can still be reached through the child.
          </li>
          <li>
            <b>Sold with the brain.</b> When a Circuit changes hands, its wallet goes with it. A parent locked inside a
            child can only be moved by the child’s wallet itself, never by an approved operator.
          </li>
          <li>
            <b>Ready for agents.</b> A brain that can own assets and act on-chain gives AI agents and games a clear
            identity to plug into.
          </li>
        </ul>
      </div>
    </section>
  )
}

function NestDiagram() {
  const box = (x: number, y: number, w: number, label: string, color: string, sub: string) => (
    <g>
      <rect x={x} y={y} width={w} height="46" rx="10" fill="#101622" stroke={color} strokeWidth="1.6" />
      <text x={x + 14} y={y + 20} fill={color} className="lp-svg-title">{label}</text>
      <text x={x + 14} y={y + 36} fill="#8b98a9" className="lp-svg-label">{sub}</text>
    </g>
  )
  return (
    <svg viewBox="0 0 400 250" className="lp-nest-svg" role="img" aria-label="A Pro Circuit's brain wallet holding its two Basic parents">
      {box(110, 10, 180, 'Pro Circuit #7', '#2bb3ff', 'owned by you')}
      <path d="M200 56 V78" stroke="#2bb3ff" strokeDasharray="3 4" />
      <rect x="20" y="80" width="360" height="160" rx="14" fill="rgba(43,179,255,0.05)" stroke="#2bb3ff" strokeOpacity="0.5" strokeDasharray="5 5" />
      <text x="36" y="104" fill="#2bb3ff" className="lp-svg-title">Brain wallet of #7 (ERC-6551)</text>
      {box(36, 120, 150, 'Basic #3', '#3ddc97', 'fused parent')}
      {box(214, 120, 150, 'Basic #5', '#3ddc97', 'fused parent')}
      <text x="36" y="200" fill="#e6edf3" className="lp-svg-label">+ OKB · ERC-20s · NFTs · signatures</text>
      <text x="36" y="220" fill="#8b98a9" className="lp-svg-label">parents’ own wallets stay reachable through #7</text>
    </svg>
  )
}

function Fairness() {
  const cards = [
    {
      t: 'Commit-reveal traits',
      b: 'A tape-out locks in a block, and traits come from the hash of a block after the mint. Nobody can preview the outcome, and reverting a bad mint to try again doesn’t work. Every buy, tape-out and fusion reveals ready Circuits automatically, in mint order.',
    },
    {
      t: 'Fair-launch guard',
      b: 'For the first ~3,600 blocks (about an hour), buys are capped at 1,000 $CBR per wallet per block and 2,500 $CBR per block overall. The overall cap is the real limit, so bots can’t sweep the cheapest supply.',
    },
    {
      t: 'Each Circuit fuses once',
      b: 'A Circuit used as a fusion parent is permanently marked. Taking it back out of the wallet doesn’t let you fuse it again.',
    },
    {
      t: 'Limited admin powers',
      b: 'The owner can pause buys, tape-outs and fusion, and withdraw the 1% sell fees. That is all. They can’t mint $CBR, touch the reserve, pause sells or give up ownership.',
    },
  ]
  return (
    <section className="lp-section">
      <SectionHead kicker="Fair by construction" title="Safeguards built into the contracts" />
      <div className="lp-cards-4">
        {cards.map((c) => (
          <div key={c.t} className="card lp-mini">
            <h3>{c.t}</h3>
            <p className="muted">{c.b}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Security() {
  const nums: [string, string][] = [
    ['219', 'Foundry tests'],
    ['98%', 'line coverage'],
    ['3', 'internal review rounds'],
    ['1,000×', 'fuzz runs per property'],
  ]
  return (
    <section className="lp-section">
      <SectionHead id="security" kicker="Security" title="Tested against the claims we make">
        Every economic claim on this page is checked by tests: unit tests, fuzzing, and stateful invariant tests that
        run random sequences of buys, sells, tape-outs, fusions and reveals across many users.
      </SectionHead>
      <div className="lp-nums">
        {nums.map(([n, l]) => (
          <div key={l} className="lp-num">
            <div className="lp-num-v grad">{n}</div>
            <div className="small muted">{l}</div>
          </div>
        ))}
      </div>
      <div className="lp-split">
        <div className="card">
          <h3 className="lp-h3">Invariants that always hold</h3>
          <ul className="lp-checks">
            <li>
              The reserve covers the full curve backing plus fees: <code>balance ≥ reserveRequired + protocolFees</code>
            </li>
            <li>Buying and immediately selling never returns more than you paid</li>
            <li>The price never falls as supply rises</li>
            <li>Total supply never exceeds 10M $CBR</li>
            <li>Total burned equals the sum of every tape-out and fusion burn</li>
            <li>No Circuit is ever used as a fusion parent twice</li>
          </ul>
        </div>
        <div className="card">
          <h3 className="lp-h3">Trade-offs we disclose</h3>
          <ul className="lp-warns">
            <li>
              The randomness comes from a block hash, which X Layer’s sequencer can influence. That’s acceptable because
              traits are purely cosmetic.
            </li>
            <li>If nothing happens on the protocol for about 4 minutes, a ready Circuit’s reveal window can lapse and it gets new traits. A permissionless keeper closes that gap.</li>
            <li>The per-wallet launch cap can be dodged with many wallets; the per-block cap is the real guard.</li>
            <li>
              ERC-20 approvals made by a brain wallet stay in place after the Circuit is sold. Don’t approve
              signature-based spenders such as Permit2 from a brain wallet.
            </li>
          </ul>
          <p className="tiny muted">
            Full findings and how each was resolved: <code>AUDIT.md</code>. This is an internal multi-agent review, not a professional third-party audit.
          </p>
        </div>
      </div>
    </section>
  )
}

const LENS_SNIPPET = `// one call, the whole protocol
const s = await lens.read.protocolState()
s.currentPrice   s.surplusReserve   s.mintedByTier

// how much CBR does 1 OKB buy right now?
const cbr = await lens.read.quoteBuyExactOKB([parseEther('1')])

// a user's CBR + every Circuit, traits and brain wallet
const u = await lens.read.userState([address])`

function Builders() {
  return (
    <section className="lp-section">
      <SectionHead kicker="For builders" title="Integrate in minutes, not days" />
      <div className="lp-split">
        <pre className="card lp-code mono">{LENS_SNIPPET}</pre>
        <ul className="lp-facts">
          <li>
            <b>CerebrLens.</b> A read-only helper contract. It quotes how much $CBR an exact OKB amount buys, returns
            protocol snapshots and user portfolios, and gives the curve points for charts.
          </li>
          <li>
            <b>Subgraph included.</b> Trades, Circuits, fusions, daily snapshots and protocol totals are indexed and
            ready to deploy to Goldsky on X Layer.
          </li>
          <li>
            <b>Detailed events.</b> Every buy, sell, tape-out and fusion event includes the new supply, so an indexer
            can rebuild the full history from events alone.
          </li>
          <li>
            <b>Standards everywhere.</b> ERC-20, ERC-721 with on-chain <code>tokenURI</code> and <code>contractURI</code>,
            ERC-6551 and ERC-1271.
          </li>
        </ul>
      </div>
    </section>
  )
}

const FAQ = [
  ['What do I need to start?', 'An injected wallet such as OKX Wallet, and some OKB on X Layer for $CBR and gas.'],
  [
    'Where does the money go?',
    'All OKB from buys stays in the Processor contract as reserve. The only thing the owner can ever withdraw is the 1% fee on sells.',
  ],
  [
    'Why does the price drop when Circuits are taped out?',
    'Price follows circulating supply, and burns reduce it. The OKB behind the burned $CBR stays locked, though, so the reserve backing each remaining token goes up. That surplus is shown live on-chain.',
  ],
  [
    'Can a whale or bot buy all the cheap supply at launch?',
    'Not in the first hour. The fair-launch guard caps buys per block, both per wallet and across everyone.',
  ],
  [
    'What can a brain wallet actually do?',
    'Anything an account can do: hold and send assets, call contracts and sign messages. Control always follows ownership of the Circuit.',
  ],
  [
    'Is fusion cheaper than taping out directly?',
    'Yes, on purpose. Two Basics plus 5k $CBR (15k in all) make a Pro, against 20k direct. Fusion rewards working up through the tiers, and it’s the only way to reach Singularity.',
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
          The Processor is running. <span className="grad">Tape out your first Circuit.</span>
        </h2>
        <p className="muted">Buy $CBR, mint a sealed wafer, reveal it and work up to Singularity.</p>
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
        Built for the IGNIX X Layer TapeOut Hackathon. Smart contracts carry risk; only use funds you can afford to
        lose. Not financial advice.
      </p>
      <a className="small" href={APP_HREF}>
        Launch App →
      </a>
    </footer>
  )
}
