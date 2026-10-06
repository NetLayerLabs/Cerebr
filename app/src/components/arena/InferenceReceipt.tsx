import { useState } from 'react'
import { circuitsAbi } from '@cerebr/sdk/tapeout'
import type { Hex } from 'viem'
import { useNet } from '../../hooks/useCpu.ts'
import { FALLBACKS, boardOfInputs, inputBits, outputBits, type Turn } from '../../lib/arena.ts'
import { fmt } from '../../lib/format.ts'
import { useI18n, type Key } from '../../i18n/index.tsx'
import { arenaError } from './useArenaTx.ts'
import { Board } from './Board.tsx'

type Replay = { state: 'idle' } | { state: 'busy' } | { state: 'done'; ret: Hex; match: boolean } | { state: 'error'; msg: string }

/** One play() transaction: the human move, the bot's onchain inference (inputs, one-hot outputs, gas, fallback) and an eval() replay. */
export function InferenceReceipt({ turn, n }: { turn: Turn; n: number }) {
  const { t } = useI18n()
  const { pc, explorerTx } = useNet()
  const [replay, setReplay] = useState<Replay>({ state: 'idle' })
  const inf = turn.inference
  const ins = inf ? inputBits(inf.inputs) : []
  const outs = inf ? outputBits(inf.outputs) : []
  const fb = inf?.fallback ?? 0

  const run = async () => {
    if (!pc || !inf) return
    setReplay({ state: 'busy' })
    try {
      const ret = (await pc.readContract({ address: inf.circuits, abi: circuitsAbi, functionName: 'eval', args: [inf.circuitId, inf.inputs] })) as Hex
      setReplay({ state: 'done', ret, match: ret.toLowerCase() === inf.outputs.toLowerCase() })
    } catch (e) {
      setReplay({ state: 'error', msg: arenaError(e) })
    }
  }

  return (
    <article className="arena-rcpt">
      <header className="arena-rcpt-head">
        <span className="mono arena-rcpt-n">{t('arena.rc.move', { n })}</span>
        <span className="small">
          {t('arena.rc.you', { c: turn.human ?? '-' })}
          {turn.bot !== undefined && <> · {t('arena.rc.bot', { c: turn.bot })}</>}
        </span>
        {inf ? (
          <span className={`pill ${fb ? 'bad' : 'on'}`}>{fb ? t(`arena.fb.${FALLBACKS[fb]}` as Key) : t('arena.rc.circuitMove')}</span>
        ) : (
          <span className="pill">{t('arena.rc.noInference')}</span>
        )}
      </header>
      {inf ? (
        <div className="arena-rcpt-body">
          <div className="arena-rcpt-board">
            <Board cells={boardOfInputs(inf.inputs)} hot={turn.bot} ghosts={turn.bot !== undefined ? [{ cell: turn.bot, who: 1 }] : []} mini label={t('arena.rc.boardAria')} />
            <div className="tiny muted">{t('arena.rc.saw')}</div>
          </div>
          <dl className="quote arena-rcpt-rows">
            <div className="row">
              <dt>{t('arena.rc.inputs')}</dt>
              <dd>
                <span className="arena-hex">{inf.inputs}</span>
                <span className="arena-bits" aria-label={t('arena.rc.inputsAria')}>
                  {Array.from({ length: 9 }, (_, i) => (
                    <span key={i} className="arena-pair" title={t('arena.rc.pairTitle', { i })}>
                      <b className={ins[2 * i] ? 'one bot' : ''}>{ins[2 * i]}</b>
                      <b className={ins[2 * i + 1] ? 'one human' : ''}>{ins[2 * i + 1]}</b>
                    </span>
                  ))}
                </span>
              </dd>
            </div>
            <div className="row">
              <dt>{t('arena.rc.outputs')}</dt>
              <dd>
                <span className="arena-hex">{inf.outputs === '0x' ? t('arena.rc.empty') : inf.outputs}</span>
                <span className="arena-bits" aria-label={t('arena.rc.outputsAria')}>
                  {outs.map((b, i) => (
                    <b key={i} className={b ? 'one out' : ''} title={t('arena.rc.outTitle', { i })}>
                      {b}
                    </b>
                  ))}
                </span>
              </dd>
            </div>
            <div className="row">
              <dt>{t('arena.rc.evalGas')}</dt>
              <dd>{inf.gasUsed.toLocaleString('en-US')}</dd>
            </div>
            <div className="row">
              <dt>{t('arena.rc.txGas')}</dt>
              <dd>
                {turn.txGas.toLocaleString('en-US')} · {fmt(turn.fee, 3)} OKB
              </dd>
            </div>
            <div className="row">
              <dt>{t('arena.rc.fallback')}</dt>
              <dd className={fb ? 'arena-bad' : ''}>{fb ? t(`arena.fbLong.${FALLBACKS[fb]}` as Key) : t('arena.rc.none')}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="small muted arena-rcpt-note">{t('arena.rc.endedByYou')}</p>
      )}
      <footer className="arena-rcpt-foot">
        {inf && (
          <button className="btn small" onClick={run} disabled={replay.state === 'busy' || !pc}>
            {replay.state === 'busy' ? t('arena.rc.replaying') : t('arena.rc.replay')}
          </button>
        )}
        {replay.state === 'done' && (
          <span className={`arena-replay ${replay.match ? 'ok' : 'bad'}`}>
            <span className="mono">
              eval({inf!.circuitId.toString()}, {inf!.inputs}) → {replay.ret}
            </span>
            <span className={`pill ${replay.match ? 'on' : 'bad'}`}>{replay.match ? t('arena.rc.match') : t('arena.rc.mismatch')}</span>
          </span>
        )}
        {replay.state === 'error' && <span className="error small">{replay.msg}</span>}
        {explorerTx(turn.hash) && (
          <a className="small mono arena-tx" href={explorerTx(turn.hash)} target="_blank" rel="noreferrer">
            {turn.hash.slice(0, 10)}…{turn.hash.slice(-6)}
          </a>
        )}
      </footer>
    </article>
  )
}
