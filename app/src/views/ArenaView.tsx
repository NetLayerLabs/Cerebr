import { useEffect, useState } from 'react'
import { useConnection, useGasPrice } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useNet } from '../hooks/useCpu.ts'
import { href } from '../hooks/useRoute.ts'
import { Stat, Row } from '../components/ui.tsx'
import { Board } from '../components/arena/Board.tsx'
import { InferenceReceipt } from '../components/arena/InferenceReceipt.tsx'
import { arenaError, useArenaTx } from '../components/arena/useArenaTx.ts'
import {
  BOT,
  EMPTY,
  FALLBACKS,
  HUMAN,
  PLAY_GAS_TYPICAL,
  STATUS,
  arenaAbi,
  boardOf,
  findGames,
  rememberGame,
  rememberTurn,
  rememberedGame,
  rememberedTurns,
  startedGame,
  turnOf,
  winLine,
  type GameState,
  type Stats,
  type Turn,
} from '../lib/arena.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { useI18n, type Key } from '../i18n/index.tsx'
import './arena.css'

const RESULT_KEY: Record<number, Key> = {
  [STATUS.Active]: 'arena.status.active',
  [STATUS.HumanWon]: 'arena.status.won',
  [STATUS.BotWon]: 'arena.status.lost',
  [STATUS.Draw]: 'arena.status.draw',
}

/**
 * §05 Arena (#arena[/<gameId>]): tic-tac-toe against the NeuralArena bot circuit (human moves first).
 * Every bot move is an eval() of circuit #arenaBot inside the player's play() transaction, logged as an
 * InferenceReceipt that the page decodes and can replay with eval() as an eth_call.
 */
export function ArenaView({ arg }: { arg?: string }) {
  const { contracts, pc, chainId } = useNet()
  const { address } = useConnection()
  const { t, rich } = useI18n()
  const arena = contracts?.arena
  const argId = arg && /^\d+$/.test(arg) && arg !== '0' ? BigInt(arg) : undefined
  /** An explicit game (from the route or a new game); otherwise the connected wallet's active game. */
  const [picked, setPicked] = useState<bigint | undefined>(argId)

  const stats = useQuery({
    queryKey: ['cerebr', 'arena', 'stats', chainId, arena, address],
    enabled: !!pc && !!arena,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [global, mine, fallbacks] = await Promise.all([
        pc!.readContract({ address: arena!, abi: arenaAbi, functionName: 'stats' }) as Promise<Stats>,
        address ? (pc!.readContract({ address: arena!, abi: arenaAbi, functionName: 'playerStats', args: [address] }) as Promise<Stats>) : undefined,
        pc!.readContract({ address: arena!, abi: arenaAbi, functionName: 'fallbackCount' }) as Promise<bigint>,
      ])
      return { global, mine, fallbacks }
    },
  })

  const games = useQuery({
    queryKey: ['cerebr', 'arena', 'mine', chainId, arena, address],
    enabled: !!pc && !!arena && !!address,
    refetchInterval: 30_000,
    queryFn: () => findGames(pc!, arena!, address!, rememberedGame(arena!, address!)),
  })
  const active = games.data?.find((g) => g.status === STATUS.Active)?.id
  // Pin a resumed game, so it stays on screen once it ends (it is no longer "active" then).
  useEffect(() => {
    if (picked === undefined && active !== undefined) setPicked(active)
  }, [picked, active])
  const gameId = picked ?? active

  const game = useQuery({
    queryKey: ['cerebr', 'arena', 'game', chainId, arena, gameId?.toString()],
    enabled: !!pc && !!arena && gameId !== undefined,
    refetchInterval: 15_000,
    queryFn: async () => {
      const g = (await pc!.readContract({ address: arena!, abi: arenaAbi, functionName: 'gameState', args: [gameId!] })) as GameState
      if (g.status === STATUS.None) return { g, cells: undefined }
      const cells = (await pc!.readContract({ address: arena!, abi: arenaAbi, functionName: 'board', args: [gameId!] })) as readonly number[]
      return { g, cells: [...cells] }
    },
  })

  // Receipts of this game's moves sent from this browser (best effort: X Layer's RPC caps log ranges).
  const turns = useQuery({
    queryKey: ['cerebr', 'arena', 'turns', chainId, arena, gameId?.toString()],
    enabled: !!pc && !!arena && gameId !== undefined,
    staleTime: Infinity,
    queryFn: async () => {
      const hashes = rememberedTurns(arena!, gameId!)
      const rs = await Promise.all(hashes.map((h) => pc!.getTransactionReceipt({ hash: h }).catch(() => undefined)))
      return rs.map((r) => (r ? turnOf(r, arena!) : undefined)).filter((x): x is Turn => !!x && x.gameId === gameId)
    },
  })

  const g = game.data?.g
  const mine = !!g && !!address && g.player.toLowerCase() === address.toLowerCase()
  useEffect(() => {
    if (mine && arena && address && gameId !== undefined) rememberGame(arena, address, gameId)
  }, [mine, arena, address, gameId])

  const { send, busy } = useArenaTx(arena)
  const [pending, setPending] = useState<number | undefined>()
  const [preview, setPreview] = useState(false)
  const [sel, setSel] = useState<number | undefined>()
  const [lastLimit, setLastLimit] = useState<bigint | undefined>()
  useEffect(() => setSel(undefined), [gameId, g?.moves])

  const startGame = async () => {
    const r = await send(t('arena.tx.new'), { functionName: 'newGame' })
    const id = r && arena ? startedGame(r.receipt, arena) : undefined
    if (id === undefined || !arena || !address) return
    rememberGame(arena, address, id)
    setPicked(id)
    window.history.replaceState(window.history.state, '', href('arena', id))
  }

  const play = async (cell: number) => {
    if (gameId === undefined || !arena) return
    setPending(cell)
    const r = await send(t('arena.tx.play', { c: cell, id: gameId }), { functionName: 'play', args: [gameId, cell] })
    setPending(undefined)
    if (!r) {
      void game.refetch()
      return
    }
    setLastLimit(r.gasLimit)
    rememberTurn(arena, gameId, r.receipt.transactionHash)
    await Promise.all([turns.refetch(), game.refetch()])
  }

  const cells = game.data?.cells
  const canPlay = mine && g?.status === STATUS.Active && pending === undefined && !busy
  const onCell = canPlay ? (i: number) => (preview ? setSel(i) : void play(i)) : undefined
  const line = cells ? winLine(cells)?.line : undefined

  const pv = usePreview(arena, g, preview ? sel : undefined)
  const ghosts = [
    ...(pending !== undefined ? [{ cell: pending, who: HUMAN }] : []),
    ...(sel !== undefined && pending === undefined ? [{ cell: sel, who: HUMAN }] : []),
    ...(sel !== undefined && pending === undefined && pv.data?.kind === 'bot' ? [{ cell: pv.data.cell, who: BOT }] : []),
  ]

  const shown = turns.data ?? []
  const s = stats.data

  return (
    <>
      <section className="hero">
        <h1>{rich('arena.title', { em: (c) => <span className="grad">{c}</span> })}</h1>
        <p className="muted">{t('arena.lede', { bot: contracts?.arenaBot ?? 0n })}</p>
      </section>

      <section className="stats arena-stats">
        <Stat label={t('arena.st.games')} value={s ? s.global.games.toString() : '…'} />
        <Stat label={t('arena.st.botWins')} value={s ? s.global.botWins.toString() : '…'} />
        <Stat label={t('arena.st.draws')} value={s ? s.global.draws.toString() : '…'} accent />
        <Stat label={t('arena.st.humanWins')} value={s ? s.global.humanWins.toString() : '…'} unit={t('arena.st.humanWinsUnit')} />
        <Stat label={t('arena.st.fallbacks')} value={s ? s.fallbacks.toString() : '…'} unit={t('arena.st.fallbacksUnit')} />
        <Stat
          label={t('arena.st.you')}
          value={!address ? '-' : s?.mine ? s.mine.games.toString() : '…'}
          unit={!address ? t('arena.st.youConnect') : s?.mine ? t('arena.st.record', { w: s.mine.humanWins, d: s.mine.draws, l: s.mine.botWins }) : undefined}
        />
      </section>

      <section className="grid-2 arena-grid">
        <div className="card arena-play">
          <div className="card-head">
            <h2>{gameId !== undefined ? t('arena.gameN', { id: gameId }) : t('arena.board')}</h2>
            {g && g.status !== STATUS.None && (
              <span className={`pill arena-status s${g.status}`}>{t(RESULT_KEY[g.status] ?? 'arena.status.active')}</span>
            )}
          </div>

          {g && g.status > STATUS.Active && <Over status={g.status} mine={mine} />}
          {g && !mine && g.status !== STATUS.None && <p className="banner info small arena-spectate">{t('arena.spectating', { p: shortAddr(g.player) })}</p>}
          {gameId !== undefined && game.data && g?.status === STATUS.None && <p className="banner warn small">{t('arena.unknown', { id: gameId })}</p>}
          {game.error && <p className="error small">{arenaError(game.error)}</p>}

          <div className="arena-stage">
            <Board
              cells={cells ?? Array(9).fill(EMPTY)}
              onCell={onCell}
              ghosts={ghosts}
              win={line}
              selected={preview && pending === undefined ? sel : undefined}
              label={t('arena.boardAria')}
            />
            <div className="arena-side">
              <div className="arena-legend small">
                <span>
                  <i className="arena-key human" /> {t('arena.legend.you')}
                </span>
                <span>
                  <i className="arena-key bot" /> {t('arena.legend.bot', { bot: contracts?.arenaBot ?? 0n })}
                </span>
              </div>
              <p className="small arena-say" aria-live="polite">
                {pending !== undefined
                  ? t('arena.say.mining', { c: pending })
                  : gameId === undefined
                    ? address
                      ? games.isLoading
                        ? t('arena.say.finding')
                        : t('arena.say.start')
                      : t('arena.say.connect')
                    : !g
                      ? '…'
                      : g.status === STATUS.Active
                        ? mine
                          ? preview
                            ? t('arena.say.previewPick')
                            : t('arena.say.yourMove')
                          : t('arena.say.watching')
                        : t('arena.say.over')}
              </p>
              <div className="btn-row">
                <button className={`btn ${g?.status === STATUS.Active && mine ? '' : 'primary'}`} onClick={startGame} disabled={!!busy || !arena}>
                  {busy === 'newGame' ? t('arena.btn.starting') : t('arena.btn.new')}
                </button>
                <button
                  className={`chip arena-preview-toggle ${preview ? 'on' : ''}`}
                  aria-pressed={preview}
                  onClick={() => {
                    setPreview((p) => !p)
                    setSel(undefined)
                  }}
                >
                  {t('arena.btn.preview')}
                </button>
              </div>
              {preview && sel !== undefined && canPlay && (
                <div className="arena-pv">
                  <p className="small">
                    {pv.isFetching
                      ? t('arena.pv.loading')
                      : pv.error
                        ? arenaError(pv.error)
                        : pv.data?.kind === 'win'
                          ? t('arena.pv.win', { c: sel })
                          : pv.data?.kind === 'draw'
                            ? t('arena.pv.draw', { c: sel })
                            : pv.data
                              ? t('arena.pv.bot', { c: sel, r: pv.data.cell })
                              : ''}
                    {pv.data?.kind === 'bot' && pv.data.reason ? ` ${t(`arena.fb.${FALLBACKS[pv.data.reason]}` as Key)}` : ''}
                  </p>
                  <p className="tiny muted">{t('arena.pv.note')}</p>
                  <button className="btn primary small" onClick={() => play(sel)} disabled={!!busy}>
                    {t('arena.btn.playCell', { c: sel })}
                  </button>
                </div>
              )}
              <GasNote lastLimit={lastLimit} />
            </div>
          </div>
        </div>

        <div className="card arena-receipts">
          <div className="card-head">
            <h2>{t('arena.rc.title')}</h2>
            {shown.length > 0 && <span className="pill">{t('arena.rc.count', { n: shown.length })}</span>}
          </div>
          <p className="small muted arena-rc-lede">{t('arena.rc.lede')}</p>
          {turns.isLoading && gameId !== undefined ? (
            <div className="skeleton" style={{ height: 160 }} />
          ) : shown.length === 0 ? (
            <div className="empty small">{gameId !== undefined && g && g.moves > 0 ? t('arena.rc.elsewhere') : t('arena.rc.none0')}</div>
          ) : (
            <div className="arena-rc-list">
              {[...shown].reverse().map((tn) => (
                <InferenceReceipt key={tn.hash} turn={tn} n={shown.indexOf(tn) + 1} />
              ))}
            </div>
          )}
        </div>
      </section>

      {address && !!games.data?.length && <MyGames rows={games.data} current={gameId} onOpen={(id) => setPicked(id)} />}

      <section className="card arena-how">
        <div className="card-head">
          <h2>{t('arena.how.title')}</h2>
        </div>
        <ol className="arena-how-list small">
          <li>{rich('arena.how.1')}</li>
          <li>{rich('arena.how.2')}</li>
          <li>{rich('arena.how.3')}</li>
          <li>{rich('arena.how.4')}</li>
        </ol>
      </section>
    </>
  )
}

/** The bot's answer to a hypothetical human move, from previewBotMove (an eth_call: no transaction). */
function usePreview(arena: Address | undefined, g: GameState | undefined, sel: number | undefined) {
  const { pc, chainId } = useNet()
  return useQuery({
    queryKey: ['cerebr', 'arena', 'preview', chainId, arena, g?.bot, g?.human, sel],
    enabled: !!pc && !!arena && !!g && sel !== undefined,
    staleTime: Infinity,
    queryFn: async (): Promise<{ kind: 'win' } | { kind: 'draw' } | { kind: 'bot'; cell: number; reason: number }> => {
      const human = g!.human | (1 << sel!)
      if (winLine(boardOf(g!.bot, human))?.who === HUMAN) return { kind: 'win' }
      if ((human | g!.bot) === 0x1ff) return { kind: 'draw' }
      const [cell, reason] = (await pc!.readContract({ address: arena!, abi: arenaAbi, functionName: 'previewBotMove', args: [g!.bot, human] })) as readonly [number, number]
      return { kind: 'bot', cell, reason }
    },
  })
}

function Over({ status, mine }: { status: number; mine: boolean }) {
  const { t } = useI18n()
  const kind = status === STATUS.HumanWon ? 'won' : status === STATUS.Draw ? 'draw' : 'lost'
  return (
    <div className={`arena-over ${kind}`} role="status">
      <div className="arena-over-h">{t(`arena.over.${kind}` as Key)}</div>
      <p className="small">{t(`arena.over.${kind}Body` as Key)}</p>
      {!mine && <p className="tiny muted">{t('arena.over.notYours')}</p>}
    </div>
  )
}

/** What one move costs: the limit sent (estimate + margin) vs. the gas actually charged, at the live gas price. */
function GasNote({ lastLimit }: { lastLimit?: bigint }) {
  const { t } = useI18n()
  const { chainId } = useNet()
  const { data: price } = useGasPrice({ chainId, query: { refetchInterval: 15_000 } })
  return (
    <dl className="quote arena-gas">
      <Row k={t('arena.gas.limit')} v={lastLimit ? lastLimit.toLocaleString('en-US') : t('arena.gas.limitAuto')} />
      <Row k={t('arena.gas.used')} v={`~${PLAY_GAS_TYPICAL.toLocaleString('en-US')}`} />
      <Row k={t('arena.gas.price')} v={price !== undefined ? `${fmt(price, 4, 9)} gwei` : '…'} />
      <Row k={t('arena.gas.cost')} v={price !== undefined ? `≈ ${fmt(PLAY_GAS_TYPICAL * price, 3)} OKB` : '…'} strong />
      <p className="tiny muted arena-gas-note">{t('arena.gas.note')}</p>
    </dl>
  )
}

function MyGames({ rows, current, onOpen }: { rows: { id: bigint; status: number; moves: number }[]; current?: bigint; onOpen: (id: bigint) => void }) {
  const { t } = useI18n()
  return (
    <section className="card arena-mine">
      <div className="card-head">
        <h2>{t('arena.mine.title')}</h2>
        <span className="pill">{t('arena.rc.count', { n: rows.length })}</span>
      </div>
      <div className="arena-table-wrap">
        <table className="arena-table">
          <thead>
            <tr>
              <th>{t('arena.mine.game')}</th>
              <th>{t('arena.mine.moves')}</th>
              <th>{t('arena.mine.result')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.id.toString()} className={r.id === current ? 'on' : ''}>
                <td className="mono">#{r.id.toString()}</td>
                <td className="mono">{r.moves}</td>
                <td>
                  <span className={`arena-res s${r.status}`}>{t(RESULT_KEY[r.status] ?? 'arena.status.active')}</span>
                </td>
                <td className="arena-open">
                  {r.id === current ? (
                    <span className="tiny muted">{t('arena.mine.showing')}</span>
                  ) : (
                    <a
                      href={href('arena', r.id)}
                      onClick={(e) => {
                        e.preventDefault()
                        onOpen(r.id)
                        window.history.replaceState(window.history.state, '', href('arena', r.id))
                      }}
                    >
                      {t('arena.mine.open')}
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

