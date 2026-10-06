import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNet } from '../hooks/useCpu.ts'
import { href } from '../hooks/useRoute.ts'
import { Stat, Row, Addr } from '../components/ui.tsx'
import { EXPLORER } from '../landing/issuance.ts'
import {
  AGENT_PINS,
  AGENT_THETA,
  FALLBACK_NAMES,
  KEEPER_INTERVAL_SEC,
  NEVER,
  RING,
  Verdict,
  agentInputHex,
  explainInputs,
  readAgentConfig,
  readAgentLive,
  readDecisions,
  replayDecision,
  utcTime,
  type AgentConfig,
  type AgentRecord,
  type Observation,
  type ReplayResult,
} from '../lib/agent.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { useI18n, type Key } from '../i18n/index.tsx'
import './agent.css'

const REPO = 'https://github.com/NetLayerLabs/Cerebr'
const DEPLOY_TX = '0xa9aaacef0f3af99dc0046a67d5e3132879c65301415fca4b10202d617e15a31f'
const FIRST_ACT_TX = '0xb738dac247760db5bad17709b019a953384132cf5e9c558698a69e7925e2c4ed'
const DAY = 86_400

const VERDICT_KEY: Record<number, Key> = { [Verdict.NoGo]: 'agent.v.nogo', [Verdict.Go]: 'agent.v.go', [Verdict.Abstain]: 'agent.v.abstain' }
const VERDICT_CLS: Record<number, string> = { [Verdict.NoGo]: 'nogo', [Verdict.Go]: 'go', [Verdict.Abstain]: 'abstain' }

const gwei = (wei: bigint) => fmt(wei, 4, 9)

/** Seconds since a unix timestamp, refreshed every second. */
function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/**
 * §07 Agent (#agent): CerebrAgent, live on X Layer. A keeper calls act() every 10 minutes; the contract
 * derives five pins from chain state and asks the taped-out Go/No-Go Neuron (circuit #8) via eval().
 * Read-only: stats(), observeAt(latest basefee), the 64-entry ring buffer, and an eval() replay per row.
 */
export function AgentView() {
  const { contracts, cfg, pc, chainId } = useNet()
  const { t, rich } = useI18n()
  const agent = contracts?.agent
  const policy = contracts?.agentPolicy ?? 8n
  const now = useNow()

  const config = useQuery({
    queryKey: ['cerebr', 'agent', 'config', chainId, agent],
    enabled: !!pc && !!agent,
    staleTime: Infinity,
    queryFn: () => readAgentConfig(pc!, agent!),
  })
  const live = useQuery({
    queryKey: ['cerebr', 'agent', 'live', chainId, agent],
    enabled: !!pc && !!agent,
    refetchInterval: 15_000,
    queryFn: () => readAgentLive(pc!, agent!),
  })
  const n = live.data?.stats.decisions
  const feed = useQuery({
    queryKey: ['cerebr', 'agent', 'decisions', chainId, agent, n],
    enabled: !!pc && !!agent && n !== undefined,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
    queryFn: () => readDecisions(pc!, agent!, n!),
  })
  const brain = useQuery({
    queryKey: ['cerebr', 'agent', 'brain', chainId, contracts?.agentBrain],
    enabled: !!pc && !!contracts?.agentBrain,
    staleTime: 60_000,
    queryFn: async () => ((await pc!.getCode({ address: contracts!.agentBrain })) ?? '0x').length > 2,
  })

  const s = live.data?.stats
  const obs = live.data?.obs
  const rows = feed.data ?? []
  const last = rows[0]
  const blocksLeft = obs ? (obs.canAct ? 0n : obs.nextActBlock - obs.blockNumber) : undefined

  return (
    <>
      <section className="hero">
        <h1>{rich('agent.title', { em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{rich('agent.lede', { id: policy.toString() })}</p>
      </section>

      <section className="stats agent-stats">
        <Stat label={t('agent.st.decisions')} value={s ? s.decisions.toLocaleString('en-US') : '…'} unit={s ? t('agent.st.decisionsUnit', { n: s.brainWalletCount }) : undefined} />
        <Stat label={t('agent.st.go')} value={s ? s.goCount.toLocaleString('en-US') : '…'} accent />
        <Stat label={t('agent.st.nogo')} value={s ? s.noGoCount.toLocaleString('en-US') : '…'} />
        <Stat label={t('agent.st.abstain')} value={s ? s.abstainCount.toLocaleString('en-US') : '…'} unit={t('agent.st.abstainUnit')} />
        <Stat
          label={t('agent.st.last')}
          value={last ? <Age secs={now - last.timestamp} /> : s?.decisions === 0 ? '-' : '…'}
          unit={last ? t('agent.st.lastUnit', { seq: last.seq, v: t(VERDICT_KEY[last.verdict] ?? 'agent.v.abstain') }) : undefined}
        />
        <Stat
          label={t('agent.st.next')}
          value={blocksLeft === undefined ? '…' : blocksLeft <= 0n ? t('agent.st.nextNow') : t('agent.st.blocks', { n: blocksLeft.toLocaleString('en-US') })}
          unit={obs ? t('agent.st.nextUnit', { b: obs.nextActBlock.toLocaleString('en-US') }) : undefined}
        />
      </section>

      {live.error && <p className="banner warn small agent-err">{t('agent.readFail')}</p>}

      <section className="grid-2 agent-grid">
        <ObservationCard obs={obs} cfg={config.data} />
        <div className="card agent-addrs">
          <div className="card-head">
            <h2>{t('agent.ad.title')}</h2>
            <span className="pill on">{t('agent.ad.noAdmin')}</span>
          </div>
          <dl className="quote">
            <Row k={t('agent.ad.agent')} v={agent ? <Addr a={agent} href={`${EXPLORER}/address/${agent}`} /> : '…'} />
            <Row
              k={t('agent.ad.policy')}
              v={
                <span className="agent-policy">
                  <a href={href('playground', policy)}>{t('agent.ad.policyLink', { id: policy })}</a>
                  {cfg && <Addr a={cfg.circuits} href={`${EXPLORER}/address/${cfg.circuits}`} />}
                </span>
              }
            />
            {contracts && (
              <Row
                k={t('agent.ad.brain')}
                v={
                  <span className="agent-policy">
                    <Addr a={contracts.agentBrain} href={`${EXPLORER}/address/${contracts.agentBrain}`} />
                    <span className="tiny muted">{brain.data === undefined ? '…' : brain.data ? t('agent.ad.opened') : t('agent.ad.notOpened')}</span>
                  </span>
                }
              />
            )}
            {contracts && (
              <Row
                k={t('agent.ad.keeper')}
                v={
                  <span className="agent-policy">
                    <Addr a={contracts.agentKeeper} href={`${EXPLORER}/address/${contracts.agentKeeper}`} />
                    <span className="tiny muted">{t('agent.ad.keeperNote', { m: KEEPER_INTERVAL_SEC / 60 })}</span>
                  </span>
                }
              />
            )}
            <Row k={t('agent.ad.deploy')} v={<TxLink hash={DEPLOY_TX} />} />
            <Row k={t('agent.ad.firstAct')} v={<TxLink hash={FIRST_ACT_TX} />} />
          </dl>
          <p className="small muted agent-ad-note">{t('agent.ad.note')}</p>
          <a className="btn small" href={`${REPO}/blob/main/AGENT.md`} target="_blank" rel="noopener noreferrer">
            {t('agent.ad.doc')}
          </a>
        </div>
      </section>

      <DayStrip rows={rows} now={obs ? Number(obs.timestamp) : now} cfg={config.data} />

      <Feed rows={rows} loading={feed.isLoading || (n === undefined && !live.error)} cfg={config.data} policy={policy} total={n} now={now} />
    </>
  )
}

function Age({ secs }: { secs: number }) {
  const { t } = useI18n()
  const v = Math.max(0, secs)
  return <>{v < 60 ? t('agent.ago.s', { n: v }) : v < 3600 ? t('agent.ago.m', { n: Math.floor(v / 60) }) : t('agent.ago.h', { h: Math.floor(v / 3600), m: Math.floor((v % 3600) / 60) })}</>
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a className="mono" href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </a>
  )
}

/** The five pins as lamps: weight, live reading, the weighted sum against theta, the preview verdict. */
function ObservationCard({ obs, cfg }: { obs?: Observation; cfg?: AgentConfig }) {
  const { t } = useI18n()
  const pins = obs ? explainInputs(obs.inputs) : undefined
  const since = obs?.blocksSinceGo
  const never = since === NEVER
  const sinceTxt = since === undefined ? '…' : never ? t('agent.pin.never') : since.toLocaleString('en-US')
  const reading: Record<(typeof AGENT_PINS)[number]['key'], string> = {
    calm: obs && cfg ? t('agent.pin.calmR', { bf: gwei(obs.basefee), max: gwei(cfg.calmMaxBasefee) }) : '…',
    active: obs && cfg ? t('agent.pin.activeR', { h: obs.hourUtc.toString(), a: cfg.windowStartHour, b: cfg.windowEndHour }) : '…',
    rested: obs && cfg ? t('agent.pin.restedR', { n: sinceTxt, r: cfg.restBlocks.toLocaleString('en-US') }) : '…',
    spike: obs && cfg ? t('agent.pin.spikeR', { bf: gwei(obs.basefee), x: cfg.spikeBps / 10_000, ema: gwei(obs.ema) }) : '…',
    refractory: obs && cfg ? t('agent.pin.refractoryR', { n: sinceTxt, r: cfg.refractoryBlocks.toLocaleString('en-US') }) : '…',
  }
  const sum = pins?.sum
  return (
    <div className="card agent-obs">
      <div className="card-head">
        <h2>{t('agent.obs.title')}</h2>
        {obs && <span className="pill">{t('agent.obs.block', { b: obs.blockNumber.toLocaleString('en-US') })}</span>}
      </div>
      <p className="small muted agent-obs-lede">{t('agent.obs.lede')}</p>
      <ul className="agent-pins">
        {AGENT_PINS.map((p) => {
          const on = pins ? pins[p.key] : false
          return (
            <li key={p.key} className={`agent-pin ${on ? 'on' : ''} ${p.weight < 0 ? 'inh' : 'exc'}`}>
              <span className="agent-lamp" aria-hidden />
              <span className="agent-pin-name mono">
                {p.label}
                <span className="agent-pin-id">
                  {p.pin} · {t('agent.pin.bit', { i: p.bit })}
                </span>
              </span>
              <span className={`agent-w mono ${p.weight < 0 ? 'neg' : 'pos'}`}>{p.weight > 0 ? '+1' : '-1'}</span>
              <span className="agent-pin-rule small">
                <span>{t(`agent.pin.${p.key}` as Key)}</span>
                <span className="mono agent-pin-read">{reading[p.key]}</span>
              </span>
              <span className="agent-pin-bit mono" aria-label={on ? t('agent.pin.onAria') : t('agent.pin.offAria')}>
                {on ? 1 : 0}
              </span>
            </li>
          )
        })}
      </ul>
      <div className="agent-sum">
        <div className="agent-sum-eq mono">
          {pins
            ? AGENT_PINS.map((p, i) => (
                <span key={p.key} className={pins[p.key] ? 'on' : ''}>
                  {i > 0 || p.weight < 0 ? (p.weight > 0 ? ' + ' : ' - ') : ''}
                  {pins[p.key] ? 1 : 0}
                </span>
              ))
            : '…'}
          <span className="agent-sum-total">
            {' '}
            = {sum ?? '…'} {sum !== undefined ? (sum >= AGENT_THETA ? '≥' : '<') : ''} θ {AGENT_THETA}
          </span>
        </div>
        {obs && <span className={`agent-verdict big ${VERDICT_CLS[obs.verdict]}`}>{t(VERDICT_KEY[obs.verdict] ?? 'agent.v.abstain')}</span>}
      </div>
      <dl className="quote agent-obs-rows">
        <Row k={t('agent.obs.inputs')} v={obs ? `${agentInputHex(obs.inputs)} → eval → ${agentInputHex(obs.outputs)}` : '…'} />
        <Row k={t('agent.obs.canAct')} v={obs ? (obs.canAct ? t('agent.obs.yes') : t('agent.obs.no')) : '…'} strong={obs?.canAct} />
        <Row
          k={t('agent.obs.nextAct')}
          v={obs ? (obs.canAct ? t('agent.st.nextNow') : t('agent.obs.nextIn', { b: obs.nextActBlock.toLocaleString('en-US'), n: (obs.nextActBlock - obs.blockNumber).toLocaleString('en-US') })) : '…'}
        />
      </dl>
      <p className="tiny muted agent-obs-note">{t('agent.obs.note')}</p>
    </div>
  )
}

/** One dot per decision of the last 24 h, placed on a UTC time axis; the ACTIVE window is shaded. */
function DayStrip({ rows, now, cfg }: { rows: AgentRecord[]; now: number; cfg?: AgentConfig }) {
  const { t } = useI18n()
  const start = now - DAY
  const inDay = rows.filter((r) => r.timestamp >= start)
  const pos = (ts: number) => `${(((ts - start) / DAY) * 100).toFixed(3)}%`
  // The ACTIVE window(s) inside [start, now]: each UTC day touching the range contributes [day+a, day+b).
  const bands: [number, number][] = []
  if (cfg && cfg.windowStartHour !== cfg.windowEndHour) {
    const a = cfg.windowStartHour * 3600
    const b = cfg.windowEndHour * 3600
    for (let d = Math.floor(start / DAY) * DAY - DAY; d <= now; d += DAY) {
      const segs: [number, number][] = a < b ? [[d + a, d + b]] : [[d + a, d + DAY + b]]
      for (const [x, y] of segs) if (y > start && x < now) bands.push([Math.max(x, start), Math.min(y, now)])
    }
  }
  const ticks = [0, 6, 12, 18, 24].map((h) => start + h * 3600)
  const go = inDay.filter((r) => r.verdict === Verdict.Go).length
  const oldest = rows[rows.length - 1]
  return (
    <section className="card agent-day">
      <div className="card-head">
        <h2>{t('agent.day.title')}</h2>
        <span className="pill">{t('agent.day.count', { n: inDay.length, go })}</span>
      </div>
      <div className="agent-strip" role="img" aria-label={t('agent.day.aria', { n: inDay.length, go })}>
        {bands.map(([x, y]) => (
          <span key={x} className="agent-band" style={{ left: pos(x), width: `${(((y - x) / DAY) * 100).toFixed(3)}%` }} />
        ))}
        {inDay.map((r) => (
          <span
            key={r.seq}
            className={`agent-dot ${VERDICT_CLS[r.verdict]}`}
            style={{ left: pos(r.timestamp) }}
            title={`#${r.seq} · ${utcTime(r.timestamp)} UTC · ${t(VERDICT_KEY[r.verdict] ?? 'agent.v.abstain')}`}
          />
        ))}
      </div>
      <div className="agent-axis mono">
        {ticks.map((x, i) => (
          <span key={i} style={{ left: pos(x) }}>
            {i === 4 ? t('agent.day.now') : utcTime(x)}
          </span>
        ))}
      </div>
      <div className="agent-legend small">
        <span>
          <i className="agent-dot go" /> {t('agent.v.go')}
        </span>
        <span>
          <i className="agent-dot nogo" /> {t('agent.v.nogo')}
        </span>
        <span>
          <i className="agent-dot abstain" /> {t('agent.v.abstain')}
        </span>
        <span>
          <i className="agent-band-key" /> {t('agent.day.window', { a: cfg?.windowStartHour ?? 13, b: cfg?.windowEndHour ?? 21 })}
        </span>
      </div>
      <p className="tiny muted agent-day-note">
        {t('agent.day.note', { n: RING })}
        {oldest && oldest.timestamp > start ? ` ${t('agent.day.since', { time: utcTime(oldest.timestamp) })}` : ''}
      </p>
    </section>
  )
}

type ReplayState = { state: 'busy' } | { state: 'done'; r: ReplayResult } | { state: 'error' }

/** The ring buffer, newest first, each row replayable through eval() and checkRecord. */
function Feed({ rows, loading, cfg, policy, total, now }: { rows: AgentRecord[]; loading: boolean; cfg?: AgentConfig; policy: bigint; total?: number; now: number }) {
  const { t } = useI18n()
  const { pc, cfg: cpu } = useNet()
  const [replays, setReplays] = useState<Record<number, ReplayState>>({})
  const run = async (r: AgentRecord) => {
    if (!pc || !cpu || !cfg) return
    setReplays((m) => ({ ...m, [r.seq]: { state: 'busy' } }))
    try {
      const res = await replayDecision(pc, cpu.circuits, policy, r, cfg)
      setReplays((m) => ({ ...m, [r.seq]: { state: 'done', r: res } }))
    } catch {
      setReplays((m) => ({ ...m, [r.seq]: { state: 'error' } }))
    }
  }
  const ready = !!pc && !!cpu && !!cfg
  const done = Object.values(replays).filter((x) => x.state === 'done')
  const passed = done.filter((x) => x.state === 'done' && x.r.pass).length

  return (
    <section className="card agent-feed">
      <div className="card-head">
        <h2>{t('agent.feed.title')}</h2>
        {total !== undefined && <span className="pill">{t('agent.feed.count', { n: rows.length, total })}</span>}
      </div>
      <p className="small muted agent-feed-lede">{t('agent.feed.lede', { id: policy })}</p>
      <div className="btn-row agent-feed-actions">
        <button className="btn small" disabled={!ready || !rows.length} onClick={() => rows.forEach((r) => void run(r))}>
          {t('agent.feed.replayAll')}
        </button>
        {done.length > 0 && <span className={`pill ${passed === done.length ? 'on' : 'bad'}`}>{t('agent.feed.passed', { p: passed, n: done.length })}</span>}
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : rows.length === 0 ? (
        <div className="empty small">{t('agent.feed.none')}</div>
      ) : (
        <div className="agent-list" role="table" aria-label={t('agent.feed.title')}>
          <div className="agent-row agent-row-head" role="row">
            <span role="columnheader">{t('agent.feed.seq')}</span>
            <span role="columnheader">{t('agent.feed.time')}</span>
            <span role="columnheader">{t('agent.feed.verdict')}</span>
            <span role="columnheader">{t('agent.feed.inputs')}</span>
            <span role="columnheader">{t('agent.feed.out')}</span>
            <span role="columnheader">{t('agent.feed.basefee')}</span>
            <span role="columnheader">{t('agent.feed.caller')}</span>
            <span role="columnheader">{t('agent.feed.replay')}</span>
          </div>
          {rows.map((r) => (
            <FeedRow key={r.seq} r={r} now={now} replay={replays[r.seq]} onReplay={() => run(r)} ready={ready} />
          ))}
        </div>
      )}
    </section>
  )
}

function FeedRow({ r, now, replay, onReplay, ready }: { r: AgentRecord; now: number; replay?: ReplayState; onReplay: () => void; ready: boolean }) {
  const { t } = useI18n()
  return (
    <div className="agent-row" role="row">
      <span role="cell" className="mono agent-seq">
        <a href={`${EXPLORER}/block/${r.blockNumber}`} target="_blank" rel="noopener noreferrer" title={t('agent.feed.blockTitle', { b: r.blockNumber })}>
          #{r.seq}
        </a>
      </span>
      <span role="cell" className="agent-time">
        <span className="mono">{utcTime(r.timestamp)} UTC</span>
        <span className="tiny muted">
          <Age secs={now - r.timestamp} />
        </span>
      </span>
      <span role="cell" className="agent-vcell">
        <span className={`agent-verdict ${VERDICT_CLS[r.verdict]}`}>{t(VERDICT_KEY[r.verdict] ?? 'agent.v.abstain')}</span>
        {r.viaBrainWallet && <span className="pill on agent-bw">{t('agent.feed.brain')}</span>}
        {r.reason > 0 && <span className="tiny agent-reason">{t(`agent.fb.${FALLBACK_NAMES[r.reason]}` as Key)}</span>}
      </span>
      <span role="cell" className="agent-bits mono" title={agentInputHex(r.inputs)}>
        {AGENT_PINS.map((p) => {
          const on = (r.inputs >> p.bit) & 1
          return (
            <b key={p.key} className={on ? `one ${p.weight < 0 ? 'inh' : 'exc'}` : ''} title={`${p.label} = ${on}`}>
              {p.pin}
            </b>
          )
        })}
      </span>
      <span role="cell" className="mono agent-out">{r.verdict === Verdict.Abstain ? '-' : r.outputs}</span>
      <span role="cell" className="mono agent-bf">{gwei(r.basefee)} gwei</span>
      <span role="cell" className="mono agent-caller">
        <a href={`${EXPLORER}/address/${r.caller}`} target="_blank" rel="noopener noreferrer">
          {shortAddr(r.caller)}
        </a>
      </span>
      <span role="cell" className="agent-rp">
        <button className="btn small" onClick={onReplay} disabled={!ready || replay?.state === 'busy'}>
          {replay?.state === 'busy' ? t('agent.feed.replaying') : t('agent.feed.replayBtn')}
        </button>
        {replay?.state === 'done' && <ReplayTick res={replay.r} />}
        {replay?.state === 'error' && <span className="tiny agent-fail">{t('agent.feed.replayErr')}</span>}
      </span>
    </div>
  )
}

function ReplayTick({ res }: { res: ReplayResult }) {
  const { t } = useI18n()
  const title = [
    `eval → ${res.ret}${res.evalOk === undefined ? '' : res.evalOk ? ' ✓' : ' ✗'}`,
    `${t('agent.rp.inputs')} ${res.local.inputsOk ? '✓' : '✗'} (${agentInputHex(res.local.expectedInputs)})`,
    `${t('agent.rp.netlist')} ${res.local.outputOk ? '✓' : '✗'}`,
  ].join(' · ')
  return (
    <span className={`agent-tick ${res.pass ? 'ok' : 'bad'}`} title={title}>
      <span aria-hidden>{res.pass ? '✓' : '✗'}</span>
      <span className="tiny">{res.pass ? t('agent.rp.pass', { ret: res.ret }) : t('agent.rp.fail', { ret: res.ret })}</span>
    </span>
  )
}
