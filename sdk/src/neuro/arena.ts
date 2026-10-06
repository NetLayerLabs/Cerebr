// Neural Arena: a tic-tac-toe policy built as a layered threshold-neuron network and compiled to a
// TapeOut NAND netlist. NeuralArena.sol (src/arena) calls eval() on the taped-out circuit for every
// bot move, so each decision is an onchain inference.
//
// Board encoding (18 inputs, LSB-first as eval() packs them):
//   input 2i   = cell i holds a BOT piece
//   input 2i+1 = cell i holds a HUMAN piece          (cells 0..8, row-major)
// Output (9 bits): one-hot move, output i = "play cell i". All zero when no cell is empty.
//
// The policy is a strict priority, ties broken by ARENA_ORDER = centre, corners, edges:
//   1. win       : complete a line holding two bot pieces
//   2. block     : complete a line holding two human pieces
//   3. safe threat: make a two-in-a-row whose forced reply is NOT a human fork cell
//                   (a fork cell is an empty cell that would give the human two open threats)
//   4. centre, then corners, then edges
// Exhaustive game-tree search (sdk/test/arena.test.ts) shows this policy never loses, whether the
// human or the bot moves first.
//
// Network (every unit is y = [Σ w·x ≥ θ]):
//   L1  empty      e_i    = [-b_i - h_i ≥ 0]
//   L2  pair units for each line L and target cell i (j,k = the other two cells of L):
//         bb  = [b_j + b_k ≥ 2]          two bot pieces
//         hh  = [h_j + h_k ≥ 2]          two human pieces
//         hjek = [h_j + e_k ≥ 2], hkej = [h_k + e_j ≥ 2]
//         hs  = [hjek + hkej ≥ 1]         one human piece, one empty
//   L3  Wx_i = [Σ_L bb ≥ 1], W_i = [Wx_i + e_i ≥ 2]     win cell
//       Bx_i = [Σ_L hh ≥ 1], B_i = [Bx_i + e_i ≥ 2]     block cell
//       Fx_i = [Σ_L hs ≥ 2], F_i = [Fx_i + e_i ≥ 2]     human fork cell (two open human lines)
//   L4  q_i = [e_i - F_i ≥ 1]                           quiet empty cell (a safe forced reply)
//       bq_jk = [b_j + q_k ≥ 2], t = [bq_jk + bq_kj ≥ 1] one bot piece + one quiet empty cell
//   L5  Tx_i = [Σ_L t ≥ 1], T_i = [Tx_i + e_i ≥ 2]     safe-threat cell
//   L6  winner-take-all by lateral inhibition over 36 candidates, tiers W, B, T, e (each tier in
//       ARENA_ORDER): s_k = [c_k - inh_k ≥ 1], inh_{k+1} = [c_k + inh_k ≥ 1], inh_0 = 0
//   L7  out_i = [Σ s_k over the four candidates of cell i ≥ 1]
//
// Units whose weights are ±1 and that act as AND / OR of literals compile through Logic's AND/OR
// trees (double negations cancel across layers); the rest go through the threshold compiler.

import { Logic } from './logic.ts';
import { encodeHex, type BuildOptions, type Netlist, type Signal } from './netlist.ts';
import { threshold } from './neuron.ts';
import { evalBits, programOf, type Program } from './sim.ts';

/** The 8 winning lines. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Tie-break order: centre, corners, edges. */
export const ARENA_ORDER: readonly number[] = [4, 0, 2, 6, 8, 1, 3, 5, 7];

export const ARENA_N_IN = 18;
export const ARENA_N_OUT = 9;

/** Cell contents. */
export const EMPTY = 0, BOT = 1, HUMAN = 2;
export type Cell = typeof EMPTY | typeof BOT | typeof HUMAN;
export type Board = readonly number[];

// ----------------------------------------------------------------- reference policy (imperative)

const linesThrough = (i: number) => LINES.filter((l) => l.includes(i));
const others = (l: readonly number[], i: number) => l.filter((j) => j !== i) as [number, number];

/** Lines through empty cell i whose other two cells are one `p` piece and one empty cell. */
function openLines(board: Board, i: number, p: number): number {
  return linesThrough(i).filter((l) => {
    const [j, k] = others(l, i);
    return (board[j] === p && board[k] === EMPTY) || (board[k] === p && board[j] === EMPTY);
  }).length;
}

/**
 * Reference policy, written independently of the network. Returns the cell to play, or -1 when the
 * board has no empty cell. Defined for every board (also unreachable ones).
 */
export function referencePolicy(board: Board): number {
  const empty = (i: number) => board[i] === EMPTY;
  const completes = (i: number, p: number) => linesThrough(i).some((l) => others(l, i).every((j) => board[j] === p));
  for (const p of [BOT, HUMAN]) for (const i of ARENA_ORDER) if (empty(i) && completes(i, p)) return i;
  const fork = (i: number) => empty(i) && openLines(board, i, HUMAN) >= 2;
  for (const i of ARENA_ORDER) {
    if (!empty(i)) continue;
    const safe = linesThrough(i).some((l) => {
      const [j, k] = others(l, i);
      return (board[j] === BOT && empty(k) && !fork(k)) || (board[k] === BOT && empty(j) && !fork(j));
    });
    if (safe) return i;
  }
  for (const i of ARENA_ORDER) if (empty(i)) return i;
  return -1;
}

/** Board winner: BOT, HUMAN or EMPTY (none). */
export function winner(board: Board): number {
  for (const [a, b, c] of LINES) if (board[a] !== EMPTY && board[a] === board[b] && board[a] === board[c]) return board[a];
  return EMPTY;
}

// ----------------------------------------------------------------- encoding

/** Circuit input bits for a board (18 bits, see header). */
export function encodeBoardBits(board: Board): number[] {
  const x: number[] = [];
  for (let i = 0; i < 9; i++) x.push(board[i] === BOT ? 1 : 0, board[i] === HUMAN ? 1 : 0);
  return x;
}

/** Packed eval() input: 3 bytes, LSB-first, exactly what NeuralArena.sol sends. */
export function encodeBoard(board: Board): Uint8Array {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    if (board[i] === BOT) v |= 1 << (2 * i);
    else if (board[i] === HUMAN) v |= 1 << (2 * i + 1);
  }
  return Uint8Array.from([v & 255, (v >> 8) & 255, (v >> 16) & 255]);
}

/** One-hot output bits -> cell (or -1 when no bit / several bits are set). */
export function decodeMove(bits: ArrayLike<number>): number {
  let cell = -1;
  for (let i = 0; i < 9; i++) {
    if (!bits[i]) continue;
    if (cell !== -1) return -1;
    cell = i;
  }
  return cell;
}

// ----------------------------------------------------------------- the network

export interface ArenaNeuron {
  name: string;
  layer: number;
  inputs: string[];
  weights: number[];
  theta: number;
}

const N = (layer: number, name: string, inputs: string[], weights: number[], theta: number): ArenaNeuron => ({ name, layer, inputs, weights, theta });

/** The policy as a list of threshold neurons in topological order. Inputs are named b0..b8, h0..h8. */
export function arenaNetwork(): ArenaNeuron[] {
  const ns: ArenaNeuron[] = [];
  const cells = [...Array(9).keys()];
  for (const i of cells) ns.push(N(1, `e${i}`, [`b${i}`, `h${i}`], [-1, -1], 0));
  const pairs = (i: number) => linesThrough(i).map((l) => others(l, i));
  const P = (j: number, k: number) => `${j}${k}`;
  // L2 pair units (one set per unordered pair; every pair lies on exactly one line)
  const seen = new Set<string>();
  for (const i of cells) for (const [j, k] of pairs(i)) {
    const p = P(j, k);
    if (seen.has(p)) continue;
    seen.add(p);
    ns.push(N(2, `bb${p}`, [`b${j}`, `b${k}`], [1, 1], 2));
    ns.push(N(2, `hh${p}`, [`h${j}`, `h${k}`], [1, 1], 2));
    ns.push(N(2, `he${j}${k}`, [`h${j}`, `e${k}`], [1, 1], 2));
    ns.push(N(2, `he${k}${j}`, [`h${k}`, `e${j}`], [1, 1], 2));
    ns.push(N(2, `hs${p}`, [`he${j}${k}`, `he${k}${j}`], [1, 1], 1));
  }
  const pool = (layer: number, name: string, feat: string, i: number, k: number) => {
    const ps = pairs(i).map(([j, kk]) => `${feat}${P(j, kk)}`);
    // [Σ feat ≥ k] : at least k line features through cell i, then gated by "cell i is empty"
    ns.push(N(layer, `${name}x${i}`, ps, ps.map(() => 1), k));
    ns.push(N(layer, `${name}${i}`, [`${name}x${i}`, `e${i}`], [1, 1], 2));
  };
  for (const i of cells) pool(3, 'W', 'bb', i, 1);
  for (const i of cells) pool(3, 'B', 'hh', i, 1);
  for (const i of cells) pool(3, 'F', 'hs', i, 2);
  for (const i of cells) ns.push(N(4, `q${i}`, [`e${i}`, `F${i}`], [1, -1], 1));
  for (const p of seen) {
    const [j, k] = [Number(p[0]), Number(p[1])];
    ns.push(N(4, `bq${j}${k}`, [`b${j}`, `q${k}`], [1, 1], 2));
    ns.push(N(4, `bq${k}${j}`, [`b${k}`, `q${j}`], [1, 1], 2));
    ns.push(N(4, `t${p}`, [`bq${j}${k}`, `bq${k}${j}`], [1, 1], 1));
  }
  for (const i of cells) pool(5, 'T', 't', i, 1);
  // winner-take-all chain over 36 candidates: every tier in ARENA_ORDER, tiers in priority order
  const cands = ['W', 'B', 'T', 'e'].flatMap((x) => ARENA_ORDER.map((c) => ({ x: `${x}${c}`, c })));
  let inh: string | undefined;
  const sels: string[][] = cells.map(() => []);
  cands.forEach(({ x, c }, idx) => {
    const sel = `s${x}`;
    ns.push(inh ? N(6, sel, [x, inh], [1, -1], 1) : N(6, sel, [x], [1], 1));
    sels[c].push(sel);
    if (idx < cands.length - 1) {
      const next = `inh${idx + 1}`;
      ns.push(inh ? N(6, next, [x, inh], [1, 1], 1) : N(6, next, [x], [1], 1));
      inh = next;
    }
  });
  for (const i of cells) ns.push(N(7, `out${i}`, sels[i], sels[i].map(() => 1), 1));
  return ns;
}

/** Evaluate the neuron network directly (no gates). Returns the 9 one-hot outputs. */
export function evalArenaNetwork(board: Board, net: ArenaNeuron[] = arenaNetwork()): number[] {
  const v = new Map<string, number>();
  for (let i = 0; i < 9; i++) {
    v.set(`b${i}`, board[i] === BOT ? 1 : 0);
    v.set(`h${i}`, board[i] === HUMAN ? 1 : 0);
  }
  for (const n of net) {
    let s = 0;
    n.inputs.forEach((x, k) => { s += n.weights[k] * v.get(x)!; });
    v.set(n.name, s >= n.theta ? 1 : 0);
  }
  return [...Array(9).keys()].map((i) => v.get(`out${i}`)!);
}

/**
 * Compile one unit. Units whose weights are all ±1 and whose threshold makes them an AND or an OR
 * of literals go through the Logic AND/OR trees (so double negations cancel across layers);
 * everything else goes through the general threshold compiler.
 */
function unit(c: Logic, xs: Signal[], ws: number[], theta: number): Signal {
  if (ws.every((w) => w === 1 || w === -1)) {
    const lits = xs.map((x, k) => (ws[k] > 0 ? x : c.not(x)));
    const need = theta + ws.filter((w) => w < 0).length; // Σ literals ≥ need
    if (need <= 0) return c.ONE;
    if (need > lits.length) return c.ZERO;
    if (need === lits.length) return c.andN(lits);
    if (need === 1) return c.orN(lits);
  }
  return threshold(c, xs, ws, theta);
}

export interface ArenaCircuit {
  netlist: Netlist;
  hex: `0x${string}`;
  nIn: number;
  nOut: number;
  nand: number;
  neurons: number;
  program: Program;
}

/** Compile the arena policy network to a TapeOut netlist ('direct' output mode by default). */
export function buildArenaNetlist(opts: BuildOptions = {}): Netlist {
  const c = new Logic(ARENA_N_IN);
  const sig = new Map<string, Signal>();
  for (let i = 0; i < 9; i++) {
    sig.set(`b${i}`, c.input(2 * i));
    sig.set(`h${i}`, c.input(2 * i + 1));
  }
  for (const n of arenaNetwork()) sig.set(n.name, unit(c, n.inputs.map((x) => sig.get(x)!), n.weights, n.theta));
  const outs = [...Array(9).keys()].map((i) => sig.get(`out${i}`)!);
  return c.b.build(outs, { mode: 'direct', ...opts });
}

let cached: ArenaCircuit | undefined;

/** The arena bot circuit: netlist, hex for tapeout(), pin counts and a simulator program. */
export function getArenaCircuit(): ArenaCircuit {
  if (cached) return cached;
  const netlist = buildArenaNetlist();
  cached = {
    netlist,
    hex: encodeHex(netlist),
    nIn: netlist.nIn,
    nOut: netlist.nOut,
    nand: netlist.counts.nand,
    neurons: arenaNetwork().length,
    program: programOf(netlist),
  };
  return cached;
}

/** Run the compiled circuit (gate simulator) on a board; returns the chosen cell or -1. */
export function arenaMove(board: Board, prog: Program = getArenaCircuit().program): number {
  return decodeMove(evalBits(prog, encodeBoardBits(board)));
}
