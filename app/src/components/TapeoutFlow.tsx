import { useEffect } from 'react'
import { useConnection, useGasPrice } from 'wagmi'
import type { OutputMode } from '@cerebr/sdk'
import { useNet, type CpuState } from '../hooks/useCpu.ts'
import { href } from '../hooks/useRoute.ts'
import { useTapeout, type NameJob } from '../hooks/useTapeout.ts'
import type { CircuitLabel, Compiled, Design } from '../lib/cerebr.ts'
import { MAX_LABEL_NAME } from '../lib/scope.ts'
import { fmt } from '../lib/format.ts'
import { Row } from './ui.tsx'
import { useI18n } from '../i18n/index.tsx'

/**
 * Cost breakdown + "Tape out" for a compiled design (shared by the Studio and the Trainer): what is
 * burned, what the wallet holds, the mints, fees, total and gas, the onchain name field, the step
 * list, then "Run it" and the naming status. Keyed by the caller on the design, so state resets.
 */
export function TapeoutFlow({ c, cpu, design, mode, label, onRunning }: { c: Compiled; cpu: CpuState; design: Design; mode: OutputMode; label?: CircuitLabel; onRunning?: (running: boolean) => void }) {
  const { chainId } = useNet()
  const { isConnected } = useConnection()
  const { data: gasPrice } = useGasPrice({ chainId })
  const { t, rich } = useI18n()
  const f = useTapeout({ c, cpu, design, mode, label })
  const { plan, progress, jobs, scope } = f
  useEffect(() => onRunning?.(f.running), [f.running, onRunning])
  // Once the design is taped out, the quote, the "already taped out" note and the blockers describe a
  // re-plan against the new chain state (the circuit just made): hide them, the frozen steps stay.
  const done = progress?.done !== undefined
  // The naming shown under the result: the one in flight or rejected, else the design's own (last).
  const shownJob = jobs?.find((j) => j.state === 'pending' || j.state === 'failed') ?? jobs?.[jobs.length - 1]

  return (
    <>
      {!done && (
        <dl className="quote">
          <Row k={t('st.burned')} v={`${plan.burn.nand} NAND${plan.burn.latch ? ` + ${plan.burn.latch} LATCH` : ''}`} />
          <Row k={t('st.youHold')} v={isConnected ? `${f.have.nand} NAND · ${f.have.latch} LATCH` : t('common.connectWallet')} />
          {plan.mints.map((m) => (
            <Row key={m.label} k={t('st.stepMint', { n: m.amount, label: m.label })} v={`${fmt(m.value, 6)} OKB`} />
          ))}
          <Row k={t('st.feeTimes', { n: plan.tapeouts.length })} v={`${fmt(plan.tapeoutValue, 6)} OKB`} />
          <Row k={t('st.total')} v={`${fmt(plan.total, 6)} OKB`} strong />
          <Row
            k={t('st.gas')}
            v={gasPrice ? `~${fmt(plan.gas * gasPrice, 3)} OKB · ${t('st.gasK', { k: (Number(plan.gas) / 1000).toFixed(0) })}` : t('st.gasK', { k: (Number(plan.gas) / 1000).toFixed(0) })}
          />
        </dl>
      )}
      {!done && c.existing !== undefined && (
        <div className="banner info small">
          {rich('st.existing', { id: c.existing.toString(), a: (x) => <a href={href('playground', c.existing!)}>{x}</a> })}
        </div>
      )}
      {!done && plan.blocked && <div className="error small">{plan.blockedBy ? t('st.blocked', { need: plan.blockedBy.need, remaining: plan.blockedBy.remaining }) : plan.blocked}</div>}
      {scope && progress?.done === undefined && (
        <label className="name-field">
          <span className="small muted">{t('st.nameLabel')}</span>
          <input className="input" value={f.name} onChange={(e) => f.setName(e.target.value)} placeholder={label?.name ?? c.label.name} disabled={!!progress} spellCheck={false} />
          <span className={`tiny mono ${f.nameError ? 'error' : 'muted'}`}>{f.nameError ?? t('st.nameHint', { n: f.nameBytes, max: MAX_LABEL_NAME })}</span>
        </label>
      )}
      {progress && (
        <ol className="steps small">
          {f.steps.map((s, i) => {
            // Naming steps (the last ones) follow their CerebrScope.setLabel job; the others follow progress.step.
            const job = scope && i >= f.namesFrom ? (jobs?.[i - f.namesFrom] ?? null) : undefined
            const skipped = job?.state === 'skipped'
            const finished = job !== undefined ? job?.state === 'done' : i < progress.step
            const active = job !== undefined ? job?.state === 'pending' || job?.state === 'failed' : i === progress.step && !done
            return (
              <li key={i} className={finished ? 'done' : skipped ? 'skipped' : active ? 'active' : ''}>
                {s}
                {skipped ? t('st.skipped') : ''}
              </li>
            )
          })}
        </ol>
      )}
      {progress?.done !== undefined ? (
        <>
          <div className="done-row">
            <span className="ok">{t('st.done', { id: progress.done.toString() })}</span>
            <a className="btn primary small" href={href('playground', progress.done)}>
              {t('st.runIt')}
            </a>
          </div>
          {shownJob && <NamingStatus job={shownJob} busy={!!f.busy} onRetry={() => f.retryNaming()} onSkip={f.skipNaming} />}
        </>
      ) : (
        <button className="btn primary big" disabled={!f.ready} onClick={f.run}>
          {f.busy ? f.busy + '…' : f.steps.length > 1 ? t('st.tapeN', { n: f.steps.length }) : t('st.tape1')}
        </button>
      )}
    </>
  )
}

function NamingStatus({ job: naming, busy, onRetry, onSkip }: { job: NameJob; busy: boolean; onRetry: () => void; onSkip: () => void }) {
  const { t, rich } = useI18n()
  const id = naming.id
  if (naming.state === 'queued') return null
  if (naming.state === 'pending') return <div className="banner info small">{t('st.namingPending', { id: id.toString(), name: naming.label.name })}</div>
  if (naming.state === 'done') return <div className="banner info small ok">{t('st.namingDone', { name: naming.label.name })}</div>
  if (naming.state === 'skipped')
    return <div className="banner info small muted">{rich('st.namingSkipped', { a: (x) => <a href={href('gallery')}>{x}</a> })}</div>
  return (
    <div className="banner info small naming-retry">
      <span>{t('st.namingFailed', { id: id.toString() })}</span>
      <span className="naming-actions">
        <button className="btn small primary" disabled={busy} onClick={onRetry}>
          {t('st.nameIt')}
        </button>
        <button className="btn small ghost" disabled={busy} onClick={onSkip}>
          {t('st.skip')}
        </button>
      </span>
    </div>
  )
}
