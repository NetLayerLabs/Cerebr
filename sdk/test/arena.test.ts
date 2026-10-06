import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ARENA_N_IN, ARENA_N_OUT, ARENA_ORDER, BOT, EMPTY, HUMAN, LINES,
  arenaMove, arenaNetwork, buildArenaNetlist, decodeMove, encodeBoard, encodeBoardBits, evalArenaNetwork,
  getArenaCircuit, referencePolicy, winner, type Board,
} from '../src/neuro/arena.ts';
import { decodeNetlist, encodeHex, evalPacked, packBits, prepare, fromHex } from '../src/neuro/index.ts';

const boardOf = (k: number): number[] => {
  const b: number[] = [];
  for (let i = 0; i < 9; i++) { b.push(k % 3); k = Math.floor(k / 3); }
  return b;
};

test('arena: circuit shape and gate budget', () => {
  const a = getArenaCircuit();
  assert.equal(a.nIn, ARENA_N_IN);
  assert.equal(a.nOut, ARENA_N_OUT);
  assert.equal(a.netlist.counts.latch, 0);
  assert.equal(a.netlist.counts.ref, 0);
  assert.equal(a.nand, 590, 'NAND count changed: update ARENA.md, the Foundry netlist and the mainnet plan');
  assert.ok(a.nand < 600);
  // the hex round-trips through the contract-faithful decoder
  const back = decodeNetlist(a.hex, a.nIn, a.nOut);
  assert.equal(back.counts.nand, a.nand);
  assert.equal(encodeHex(back), a.hex);
  // deterministic build
  assert.equal(encodeHex(buildArenaNetlist()), a.hex);
});

test('arena: circuit == neuron network == reference policy on all 3^9 boards', () => {
  const a = getArenaCircuit();
  const net = arenaNetwork();
  const prog = prepare(fromHex(a.hex), a.nIn, a.nOut); // the exact bytes that get taped out
  for (let k = 0; k < 3 ** 9; k++) {
    const b = boardOf(k);
    const ref = referencePolicy(b);
    const bits = evalPacked(prog, encodeBoard(b));
    const out = [...Array(9).keys()].map((i) => (bits[i >> 3] >> (i & 7)) & 1);
    // exactly one-hot when a cell is empty, all zero when the board is full
    assert.equal(out.reduce((s, x) => s + x, 0), ref === -1 ? 0 : 1, `board ${b.join('')}`);
    assert.equal(decodeMove(out), ref, `circuit vs reference on ${b.join('')}`);
    assert.equal(decodeMove(evalArenaNetwork(b, net)), ref, `network vs reference on ${b.join('')}`);
    if (ref !== -1) assert.equal(b[ref], EMPTY, 'never an occupied cell');
    assert.equal(bits.length, 2);
    assert.equal(bits[1] >> 1, 0, 'padding bits are zero');
  }
});

test('arena: priorities (win > block > centre/corner/edge) on all boards', () => {
  const completes = (b: Board, i: number, p: number) =>
    LINES.some((l) => l.includes(i) && l.every((j) => j === i || b[j] === p));
  for (let k = 0; k < 3 ** 9; k++) {
    const b = boardOf(k);
    const m = arenaMove(b);
    const empties = ARENA_ORDER.filter((i) => b[i] === EMPTY);
    if (!empties.length) { assert.equal(m, -1); continue; }
    const wins = empties.filter((i) => completes(b, i, BOT));
    const blocks = empties.filter((i) => completes(b, i, HUMAN));
    if (wins.length) assert.equal(m, wins[0], 'takes the first win');
    else if (blocks.length) assert.equal(m, blocks[0], 'blocks');
    else if (b[4] === EMPTY && !b.some((x) => x === BOT)) assert.equal(m, 4, 'centre when it has no piece yet');
  }
});

/** Every reachable position with the bot to move, walking all human replies. */
function walk(botFirst: boolean, visit: (b: number[], botMove: number) => void): { positions: number; humanWins: number; botWins: number; draws: number } {
  const seen = new Set<string>();
  const r = { positions: 0, humanWins: 0, botWins: 0, draws: 0 };
  const botTurn = (b: number[]) => {
    const key = b.join('');
    if (seen.has(key)) return;
    seen.add(key);
    r.positions++;
    const m = arenaMove(b);
    visit(b, m);
    const c = b.slice();
    c[m] = BOT;
    if (winner(c) === BOT) { r.botWins++; return; }
    if (c.every((x) => x !== EMPTY)) { r.draws++; return; }
    humanTurn(c);
  };
  const humanTurn = (b: number[]) => {
    for (let i = 0; i < 9; i++) {
      if (b[i] !== EMPTY) continue;
      const c = b.slice();
      c[i] = HUMAN;
      if (winner(c) === HUMAN) { r.humanWins++; continue; }
      if (c.every((x) => x !== EMPTY)) { r.draws++; continue; }
      botTurn(c);
    }
  };
  const start = Array(9).fill(EMPTY);
  if (botFirst) botTurn(start);
  else humanTurn(start);
  return r;
}

for (const botFirst of [false, true]) {
  test(`arena: exhaustive game tree (${botFirst ? 'bot' : 'human'} first) - legal moves, bot never loses`, () => {
    const r = walk(botFirst, (b, m) => {
      assert.ok(m >= 0 && b[m] === EMPTY, `illegal move ${m} on ${b.join('')}`);
      assert.equal(m, referencePolicy(b));
    });
    assert.equal(r.humanWins, 0, 'the human can never win');
    assert.ok(r.positions > 50 && r.botWins > 0 && r.draws > 0);
  });
}

test('arena: encoding matches eval() packing', () => {
  for (const k of [0, 1, 2, 3 ** 9 - 1, 12345]) {
    const b = boardOf(k);
    assert.deepEqual(encodeBoard(b), packBits(encodeBoardBits(b)));
  }
  // cell 0 bot -> bit 0, cell 0 human -> bit 1, cell 8 human -> bit 17
  assert.deepEqual([...encodeBoard([BOT, 0, 0, 0, 0, 0, 0, 0, 0])], [1, 0, 0]);
  assert.deepEqual([...encodeBoard([HUMAN, 0, 0, 0, 0, 0, 0, 0, 0])], [2, 0, 0]);
  assert.deepEqual([...encodeBoard([0, 0, 0, 0, 0, 0, 0, 0, HUMAN])], [0, 0, 2]);
  assert.equal(decodeMove([0, 0, 0, 0, 0, 0, 0, 0, 0]), -1);
  assert.equal(decodeMove([0, 1, 0, 0, 1, 0, 0, 0, 0]), -1);
  assert.equal(decodeMove([0, 0, 0, 0, 0, 0, 0, 0, 1]), 8);
});

test('arena: the Foundry netlist constant matches the SDK build', () => {
  const path = fileURLToPath(new URL('../../test/arena/ArenaBotNetlist.sol', import.meta.url));
  const src = readFileSync(path, 'utf8');
  const m = src.match(/hex"([0-9a-f]+)"/);
  assert.ok(m, 'no hex literal in ArenaBotNetlist.sol (regenerate: node scripts/arena-netlist.ts --sol)');
  assert.equal(`0x${m[1]}`, getArenaCircuit().hex, 'ArenaBotNetlist.sol is stale: node scripts/arena-netlist.ts --sol');
});
