import { BOT, EMPTY, HUMAN } from '../../lib/arena.ts'
import { useT } from '../../i18n/index.tsx'

/** Human = cross (amber, like circuit inputs), bot = ring (accent, like circuit outputs). */
export function Mark({ who, ghost }: { who: number; ghost?: boolean }) {
  if (who === EMPTY) return null
  return (
    <svg className={`arena-mark ${who === HUMAN ? 'human' : 'bot'} ${ghost ? 'ghost' : ''}`} viewBox="0 0 40 40" aria-hidden>
      {who === HUMAN ? (
        <path d="M10 10 L30 30 M30 10 L10 30" />
      ) : (
        <circle cx="20" cy="20" r="11" />
      )}
    </svg>
  )
}

/**
 * A 3×3 board. `onCell` makes empty cells clickable. `ghosts` draws translucent marks (a pending move,
 * a preview), `win` highlights a winning line, `hot` outlines one cell (the bot's chosen output).
 */
export function Board(props: {
  cells: readonly number[]
  onCell?: (i: number) => void
  ghosts?: readonly { cell: number; who: number }[]
  win?: readonly number[]
  hot?: number
  selected?: number
  mini?: boolean
  label: string
}) {
  const t = useT()
  const { cells, onCell, ghosts = [], win, mini } = props
  return (
    <div className={`arena-board ${mini ? 'mini' : ''}`} role="grid" aria-label={props.label}>
      {cells.map((c, i) => {
        const ghost = ghosts.find((g) => g.cell === i && c === EMPTY)
        const cls = `arena-cell ${win?.includes(i) ? 'win' : ''} ${props.hot === i ? 'hot' : ''} ${props.selected === i ? 'sel' : ''} ${c === BOT ? 'is-bot' : c === HUMAN ? 'is-human' : ''}`
        const aria = t('arena.cellAria', { i, what: c === BOT ? t('arena.who.bot') : c === HUMAN ? t('arena.who.you') : t('arena.who.empty') })
        const inner = (
          <>
            {!mini && <span className="arena-idx mono">{i}</span>}
            {c !== EMPTY ? <Mark who={c} /> : ghost ? <Mark who={ghost.who} ghost /> : null}
          </>
        )
        return onCell && c === EMPTY ? (
          <button key={i} className={`${cls} open`} onClick={() => onCell(i)} aria-label={aria} role="gridcell">
            {inner}
          </button>
        ) : (
          <div key={i} className={cls} aria-label={aria} role="gridcell">
            {inner}
          </div>
        )
      })}
    </div>
  )
}
