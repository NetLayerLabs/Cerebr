// NeuralArena (src/arena/NeuralArena.sol, ARENA.md): ABI, board helpers, receipt decoding and the
// per-viewer game memory. Pure (no React, no import.meta.env).
import { parseEventLogs, type Address, type Hex, type PublicClient, type TransactionReceipt } from 'viem'
import { unpackBits } from '@cerebr/sdk/tapeout'

export const arenaAbi = [
  { type: 'function', name: 'newGame', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: 'gameId', type: 'uint256' }] },
  {
    type: 'function',
    name: 'play',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'cell', type: 'uint8' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'board', stateMutability: 'view', inputs: [{ name: 'gameId', type: 'uint256' }], outputs: [{ name: 'cells', type: 'uint8[9]' }] },
  {
    type: 'function',
    name: 'gameState',
    stateMutability: 'view',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'player', type: 'address' },
          { name: 'human', type: 'uint16' },
          { name: 'bot', type: 'uint16' },
          { name: 'moves', type: 'uint8' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
  { type: 'function', name: 'stats', stateMutability: 'view', inputs: [], outputs: [{ type: 'tuple', components: statsComponents() }] },
  { type: 'function', name: 'playerStats', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ type: 'tuple', components: statsComponents() }] },
  { type: 'function', name: 'gameCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'fallbackCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'botCircuitId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'circuits', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'previewBotMove',
    stateMutability: 'view',
    inputs: [
      { name: 'bot', type: 'uint16' },
      { name: 'human', type: 'uint16' },
    ],
    outputs: [
      { name: 'cell', type: 'uint8' },
      { name: 'reason', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'GameStarted',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'Moved',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'cell', type: 'uint8', indexed: false },
      { name: 'isBot', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'InferenceReceipt',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'circuits', type: 'address', indexed: true },
      { name: 'circuitId', type: 'uint256', indexed: true },
      { name: 'inputs', type: 'bytes', indexed: false },
      { name: 'outputs', type: 'bytes', indexed: false },
      { name: 'gasUsed', type: 'uint256', indexed: false },
      { name: 'fallbackReason', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BotFallback',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'cell', type: 'uint8', indexed: false },
      { name: 'reason', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'GameOver',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'result', type: 'uint8', indexed: false },
    ],
  },
  { type: 'error', name: 'BadCircuit', inputs: [] },
  { type: 'error', name: 'UnknownGame', inputs: [] },
  { type: 'error', name: 'NotPlayer', inputs: [] },
  { type: 'error', name: 'GameNotActive', inputs: [] },
  { type: 'error', name: 'InvalidCell', inputs: [] },
  { type: 'error', name: 'CellOccupied', inputs: [] },
  { type: 'error', name: 'InsufficientGasForInference', inputs: [] },
] as const

function statsComponents() {
  return [
    { name: 'games', type: 'uint64' },
    { name: 'humanWins', type: 'uint64' },
    { name: 'botWins', type: 'uint64' },
    { name: 'draws', type: 'uint64' },
  ] as const
}

/** NeuralArena's custom errors (each has a friendly message under arena.err.<Name>). */
export const ARENA_ERRORS = ['UnknownGame', 'NotPlayer', 'GameNotActive', 'InvalidCell', 'CellOccupied', 'InsufficientGasForInference', 'BadCircuit'] as const
export type ArenaError = (typeof ARENA_ERRORS)[number]

/** INeuralArena.Status */
export const STATUS = { None: 0, Active: 1, HumanWon: 2, BotWon: 3, Draw: 4 } as const
export type Status = (typeof STATUS)[keyof typeof STATUS]
/** INeuralArena.Fallback (index = enum value). */
export const FALLBACKS = ['None', 'CallFailed', 'BadReturn', 'NotOneHot', 'Occupied'] as const

export type Stats = { games: bigint; humanWins: bigint; botWins: bigint; draws: bigint }
export type GameState = { player: Address; human: number; bot: number; moves: number; status: number }

// ------------------------------------------------------------------ board

/** Cell contents, as board() returns them. */
export const EMPTY = 0
export const BOT = 1
export const HUMAN = 2

export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const

/** The board from the two bitmasks of gameState (bit i = cell i). */
export const boardOf = (bot: number, human: number): number[] =>
  Array.from({ length: 9 }, (_, i) => ((bot >> i) & 1 ? BOT : (human >> i) & 1 ? HUMAN : EMPTY))

/** The winning line on a board, if any. */
export function winLine(board: readonly number[]): { who: number; line: readonly number[] } | undefined {
  for (const l of LINES) if (board[l[0]] !== EMPTY && board[l[0]] === board[l[1]] && board[l[0]] === board[l[2]]) return { who: board[l[0]], line: l }
  return undefined
}

/** The 18 circuit inputs (bit 2i = bot on cell i, bit 2i+1 = human on cell i) from the 3-byte eval input. */
export const inputBits = (inputs: Hex): number[] => unpackBits(inputs, 18)

/** The 9 one-hot outputs from the 2-byte eval output. */
export const outputBits = (outputs: Hex): number[] => unpackBits(outputs, 9)

/** The board an eval input describes. */
export const boardOfInputs = (inputs: Hex): number[] => {
  const x = inputBits(inputs)
  return Array.from({ length: 9 }, (_, i) => (x[2 * i] ? BOT : x[2 * i + 1] ? HUMAN : EMPTY))
}

// ------------------------------------------------------------------ receipts

/** One play() transaction, as its receipt tells it. */
export type Turn = {
  hash: Hex
  block: bigint
  gameId: bigint
  human?: number
  bot?: number
  inference?: { circuits: Address; circuitId: bigint; inputs: Hex; outputs: Hex; gasUsed: bigint; fallback: number }
  /** Final status when this move ended the game. */
  over?: number
  /** Whole transaction gas and fee. */
  txGas: bigint
  fee: bigint
}

export function turnOf(receipt: TransactionReceipt, arena: Address): Turn | undefined {
  const logs = parseEventLogs({ abi: arenaAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === arena.toLowerCase()) })
  let turn: Turn | undefined
  for (const l of logs) {
    const gameId = (l.args as { gameId: bigint }).gameId
    turn ??= { hash: receipt.transactionHash, block: receipt.blockNumber, gameId, txGas: receipt.gasUsed, fee: receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n) }
    if (l.eventName === 'Moved') {
      if (l.args.isBot) turn.bot = l.args.cell
      else turn.human = l.args.cell
    } else if (l.eventName === 'InferenceReceipt') {
      turn.inference = { circuits: l.args.circuits, circuitId: l.args.circuitId, inputs: l.args.inputs, outputs: l.args.outputs, gasUsed: l.args.gasUsed, fallback: l.args.fallbackReason }
    } else if (l.eventName === 'GameOver') {
      turn.over = l.args.result
    }
  }
  return turn?.human !== undefined ? turn : undefined
}

/** The game id from a newGame() receipt. */
export function startedGame(receipt: TransactionReceipt, arena: Address): bigint | undefined {
  const logs = parseEventLogs({ abi: arenaAbi, eventName: 'GameStarted', logs: receipt.logs.filter((l) => l.address.toLowerCase() === arena.toLowerCase()) })
  return logs[0]?.args.gameId
}

// ------------------------------------------------------------------ gas

/** play() must be able to forward the whole 3M eval budget (EIP-150), so it needs a ~3.09M limit; ~1.42M is charged. */
export const PLAY_GAS_CAP = 3_300_000n
/** Typical gas charged by one play() (measured on a mainnet fork, ARENA.md). */
export const PLAY_GAS_TYPICAL = 1_420_000n

/** The limit sent with play(): the node's estimate + 5%, at least +60k, capped at 3.3M unless the estimate itself is higher. */
export function playGasLimit(estimate: bigint): bigint {
  const padded = estimate + (estimate / 20n > 60_000n ? estimate / 20n : 60_000n)
  if (estimate >= PLAY_GAS_CAP) return padded
  return padded > PLAY_GAS_CAP ? PLAY_GAS_CAP : padded
}

// ------------------------------------------------------------------ per-viewer memory (localStorage, best effort)

const KEY = 'cerebr.arena.v1'
type Memory = { last?: Record<string, string>; turns?: Record<string, Hex[]> }

function load(): Memory {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Memory
  } catch {
    return {}
  }
}
function save(m: Memory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* storage blocked: this session only */
  }
}
const who = (arena: Address, player: Address) => `${arena.toLowerCase()}:${player.toLowerCase()}`
const gameKey = (arena: Address, id: bigint) => `${arena.toLowerCase()}:${id}`

export const rememberedGame = (arena: Address, player: Address): bigint | undefined => {
  const v = load().last?.[who(arena, player)]
  return v && /^\d+$/.test(v) ? BigInt(v) : undefined
}
export function rememberGame(arena: Address, player: Address, id: bigint) {
  const m = load()
  m.last = { ...m.last, [who(arena, player)]: id.toString() }
  save(m)
}
export const rememberedTurns = (arena: Address, id: bigint): Hex[] => load().turns?.[gameKey(arena, id)] ?? []
export function rememberTurn(arena: Address, id: bigint, hash: Hex) {
  const m = load()
  const k = gameKey(arena, id)
  const list = m.turns?.[k] ?? []
  if (!list.includes(hash)) m.turns = { ...m.turns, [k]: [...list, hash].slice(-5) }
  // keep the memory small: the 40 most recent games
  const keys = Object.keys(m.turns ?? {})
  if (keys.length > 40) for (const old of keys.slice(0, keys.length - 40)) delete m.turns![old]
  save(m)
}

// ------------------------------------------------------------------ finding a player's games

export type GameRow = { id: bigint; status: number; moves: number }

/**
 * A player's recent games, newest first, from one multicall of gameState over the last `window` game
 * ids (plus the remembered one). NeuralArena keeps no player -> game index and X Layer's public RPC
 * caps eth_getLogs at 100 blocks, so this is the cheap way to resume an active game.
 */
export async function findGames(pc: PublicClient, arena: Address, player: Address, remembered?: bigint, window = 200): Promise<GameRow[]> {
  const count = (await pc.readContract({ address: arena, abi: arenaAbi, functionName: 'gameCount' })) as bigint
  const ids = new Set<bigint>()
  for (let i = count; i > 0n && i > count - BigInt(window); i--) ids.add(i)
  if (remembered !== undefined && remembered > 0n && remembered <= count) ids.add(remembered)
  const list = [...ids].sort((a, b) => (a > b ? -1 : 1))
  if (!list.length) return []
  const res = await pc.multicall({
    allowFailure: true,
    contracts: list.map((id) => ({ address: arena, abi: arenaAbi, functionName: 'gameState', args: [id] }) as const),
  })
  const me = player.toLowerCase()
  const rows: GameRow[] = []
  res.forEach((r, i) => {
    if (r.status !== 'success') return
    const g = r.result as GameState
    if (g.player.toLowerCase() === me) rows.push({ id: list[i], status: g.status, moves: g.moves })
  })
  return rows
}
