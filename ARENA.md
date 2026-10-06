# Neural Arena

Tic-tac-toe against a bot whose every move is decided **onchain** by a taped-out Cerebr circuit. The bot is a small threshold-neuron network compiled to 590 NAND gates. `NeuralArena.sol` calls `circuits.eval()` on it inside every `play()` transaction and logs each decision as an `InferenceReceipt` that anyone can replay.

| Piece | Where |
|---|---|
| Bot network and compiler | [`sdk/src/neuro/arena.ts`](sdk/src/neuro/arena.ts) (`getArenaCircuit()`) |
| Netlist printer | [`sdk/scripts/arena-netlist.ts`](sdk/scripts/arena-netlist.ts) (`--hex`, `--sol`) |
| Contract | [`src/arena/NeuralArena.sol`](src/arena/NeuralArena.sol), [`INeuralArena.sol`](src/arena/INeuralArena.sol), [`IArenaCircuits.sol`](src/arena/IArenaCircuits.sol) |
| Tests | [`sdk/test/arena.test.ts`](sdk/test/arena.test.ts), [`test/arena/`](test/arena) |
| Deploy script | [`script/DeployArena.s.sol`](script/DeployArena.s.sol) |

## The bot circuit

**I/O.** There are 18 inputs, two per cell (cells 0-8, row-major): input `2i` means cell i holds a bot piece, and input `2i+1` means it holds a human piece. They are packed LSB-first into 3 bytes, which is what `eval()` expects. The 9 outputs are a one-hot move, where output i means "play cell i", returned as 2 bytes. On a full board all outputs are 0.

**Policy.** It is a strict priority. Ties go to the first cell in the order centre, corners, edges (4, 0, 2, 6, 8, 1, 3, 5, 7).

1. **Win**: complete a line that holds two bot pieces.
2. **Block**: complete a line that holds two human pieces.
3. **Safe threat**: make a two-in-a-row whose forced reply is *not* a human fork cell. A fork cell is an empty cell that would give the human two open lines.
4. **Position**: the centre, then a corner, then an edge.

The plain win/block/centre/corner heuristic loses to the opposite-corner and edge forks. A brute-force search over all 9! static preference orders, combined with win/block and with several fork-defence variants, found that a static order alone never avoids losing as second player. The "safe threat" layer is the cheapest addition we found that makes the bot **unbeatable**, whether the human or the bot moves first.

**Network.** 362 threshold units `y = [Σ w·x ≥ θ]` in 7 layers:

| Layer | Units | Role |
|---|---|---|
| L1 | `e_i = [-b_i - h_i ≥ 0]` | empty cell |
| L2 | per line pair `(j,k)`: `bb = [b_j+b_k ≥ 2]`, `hh = [h_j+h_k ≥ 2]`, `hs = [[h_j+e_k ≥ 2] + [h_k+e_j ≥ 2] ≥ 1]` | two bot pieces, two human pieces, one human piece plus one empty cell |
| L3 | `W_i = [[Σbb ≥ 1] + e_i ≥ 2]`, `B_i` likewise, `F_i = [[Σhs ≥ 2] + e_i ≥ 2]` | win cell, block cell, human fork cell |
| L4 | `q_i = [e_i - F_i ≥ 1]`, `t = [[b_j+q_k ≥ 2] + [b_k+q_j ≥ 2] ≥ 1]` | quiet empty cell; one bot piece plus a quiet reply |
| L5 | `T_i = [[Σt ≥ 1] + e_i ≥ 2]` | safe-threat cell |
| L6 | `s_k = [c_k - inh_k ≥ 1]`, `inh_{k+1} = [c_k + inh_k ≥ 1]` over 36 candidates (W, B, T, e, each in tie-break order) | winner-take-all by lateral inhibition |
| L7 | `out_i = [Σ s over cell i's four candidates ≥ 1]` | one-hot move |

The compiler is the SDK's (`Logic` + `threshold`). Structural hashing shares gates across units, and AND/OR-shaped units cancel double negations across layers.

| Size | |
|---|---|
| NAND gates (= transistors burned at tape-out) | **590** |
| LATCH / REF | 0 / 0 |
| Netlist bytes | 4,130 |
| `eval` gas (measured on a mainnet fork) | **~1.36M** in-EVM, 1.40M as an `eth_estimateGas` of the view call |

**Verification** (`cd sdk && npm test`, `sdk/test/arena.test.ts`):
* The exact taped-out bytes, the neuron network and an independently written reference policy agree on **all 3^9 = 19,683 boards**, excluding encodings with both pieces on one cell. The output is exactly one-hot whenever a cell is empty, the chosen cell is never occupied, and the padding bits are 0.
* The priority checks (first win, else first block, else centre) hold on every board.
* The exhaustive game tree was walked over every human strategy. With the human first there are 457 games: **0 human wins**, 346 bot wins and 111 draws. With the bot first there are 77 games and **0 human wins**.
* `test/arena/ArenaBotNetlist.sol`, the Foundry copy of the netlist, is checked byte-for-byte against the SDK build.

## The contract

```
constructor(IArenaCircuits circuits, uint256 botCircuitId)   // immutable; validates the circuit
newGame() returns (uint256 gameId)                          // the human always moves first
play(uint256 gameId, uint8 cell)                            // human move, then the bot's inference move
board(gameId) -> uint8[9]  (0 empty, 1 bot, 2 human)
gameState(gameId) -> Game{player, human, bot, moves, status}
stats() / playerStats(addr) -> {games, humanWins, botWins, draws}
encodeBoard(bot, human) -> bytes        previewBotMove(bot, human) -> (cell, fallbackReason)
```

* **Construction.** `circuitInfo` must report 18 inputs, 9 outputs, no state and 1 to 1,000 gates. The circuit must also answer the empty board with a legal move (a smoke inference). Anything else reverts `BadCircuit`, so a wrong id cannot be wired in.
* **`play`.** It validates the move (`UnknownGame`, `NotPlayer`, `GameNotActive`, `InvalidCell`, `CellOccupied`), applies it and checks for a win or draw. If the game goes on, it STATICCALLs `eval(botCircuitId, encodeBoard(...))` with a 3,000,000-gas budget, decodes the one-hot answer, validates it, applies it and checks for a win or draw again. Game state is written once at the end.
* **Defensive inference.** TapeOut's contracts are upgradeable, so `eval` is treated as untrusted:
  * The call is a gas-capped STATICCALL. At most 96 bytes of return data are copied, so a return bomb costs nothing.
  * The ABI `bytes` offset and length are checked, and the output must be exactly 2 bytes, one-hot within 9 bits, on an empty cell.
  * Any failure (`CallFailed`, `BadReturn`, `NotOneHot`, `Occupied`) plays the first empty cell in centre-corner-edge order and emits `BotFallback`. **A game can never be bricked.**
  * `play` reverts `InsufficientGasForInference` unless the call can be given its full budget, so a player cannot set a low gas limit to force the weaker fallback move.
* **Events.** `GameStarted`, `Moved(gameId, player, cell, isBot)`, `InferenceReceipt(gameId, circuits, circuitId, inputs, outputs, gasUsed, fallbackReason)`, `BotFallback`, `GameOver(gameId, player, result)`.
* **Scope.** No funds, no admin, no payable functions, no upgradeability. The only external call is a STATICCALL, which cannot change state, so there is no reentrancy surface. Every function does a constant amount of work.

### Gas (mainnet fork, real transactions)

| Action | Gas used | Cost at 0.02 gwei |
|---|---|---|
| `tapeout` of the bot (590 NAND) | 1,883,874 | 0.0000377 OKB + the 0.0013 OKB fee |
| Deploy `NeuralArena` (includes the smoke inference) | 2,760,178 | 0.0000552 OKB |
| `newGame` | 112,724 | 0.0000023 OKB |
| **`play` (human move + onchain inference + bot move)** | **1,413,862 - 1,427,518** | **~0.0000284 OKB** |
| CerebrScope `setLabel` | 962,082 | 0.0000192 OKB |

`play` needs a gas *limit* of about 3.09M, because the call must be able to forward the full eval budget. Only about 1.42M is used and charged. Wallets get this right from `eth_estimateGas`.

## Play and verify (judges)

```bash
RPC=https://rpc.xlayer.tech
ARENA=0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD
cast send $ARENA "newGame()" --rpc-url $RPC --account <you>                 # gameId = GameStarted event
cast send $ARENA "play(uint256,uint8)" <gameId> 4 --rpc-url $RPC --account <you>
cast call $ARENA "board(uint256)(uint8[9])" <gameId> --rpc-url $RPC        # 0 empty, 1 bot, 2 human
cast call $ARENA "stats()((uint64,uint64,uint64,uint64))" --rpc-url $RPC
```

To audit any bot move, take an `InferenceReceipt` from the play transaction (`cast receipt <tx>`) and replay it:

```bash
cast call 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF "eval(uint256,bytes)(bytes)" 16 <inputs> --rpc-url $RPC
# == outputs in the receipt; bit i set = the bot played cell i
```

To check that the circuit is the network in this repo:

```bash
cd sdk && node scripts/arena-netlist.ts --hex     # equals:
cast call 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF "netlist(uint256)(bytes)" 16 --rpc-url $RPC
npm test                                           # exhaustive proofs above
```

## Tests

```bash
forge test --match-path 'test/arena/*'           # unit: 12 tests (policy mock, real-netlist NAND mock, broken circuits)
anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8603 --silent
ARENA_FORK_RPC=http://127.0.0.1:8603 forge test --match-path 'test/arena/*' -vv   # + 9 fork tests
```

* **Unit tests** cover constructor validation, game flow, events and replayable receipts, every revert, and the low-gas grief guard. Eleven misbehaving circuits (revert, gas burn, empty, long, raw garbage, 1 MB return bomb, bad offset, multi-hot, zero, padding bit, occupied cell) each fall back and still finish the game. A Solidity NAND interpreter runs the real netlist: 2,000 fuzz boards match the Solidity reference policy, the full game tree through the contract has 0 human wins, and 500 random games never brick.
* **Fork tests** run against the real Cerebr processor. The creator wallet tapes out the bot (`circuitInfo` reports 590 gates, the netlist is stored byte-exact, 404 NAND are left). Then: 1,000 fuzz boards from `eval` match the reference, the full game tree through the real circuit has **457 games, 0 human wins**, scripted bot-win and draw games play out, invalid moves revert, 64 random games never brick, a fresh CPU goes from factory to mint to tapeout to play, and wrong circuits are rejected.

## Mainnet rollout plan (not executed)

Everything below was rehearsed on an anvil fork with the creator wallet impersonated. Only the user signs. The keys come from the CLI (`--account` / `--ledger`), never from a file.

```bash
RPC=https://rpc.xlayer.tech
C=0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF      # Cerebr circuits
T=0x84b5a5c6fE305319458113b87c09a2A241427D2D      # Cerebr transistors
S=0x2640F8E89b2B107919568FFd42dFb46A1866e528      # CerebrScope
CREATOR=0xc742AdA2872a042dD36D2E706907b4036968960C

# 0. preflight: creator NAND >= 590 (994 today), fee 0.0013 OKB, the next id (15 today, so the bot becomes #16)
cast call $T "balanceOf(address,uint256)(uint256)" $CREATOR 0 --rpc-url $RPC
cast call $C "TAPEOUT_FEE()(uint256)" --rpc-url $RPC
cast call $C "nextId()(uint256)" --rpc-url $RPC

# 1. tape out the bot: burns 590 NAND, pays 0.0013 OKB, ~1.88M gas
NL=$(cd sdk && node scripts/arena-netlist.ts --hex)
cast send $C "tapeout(bytes,uint32,uint32)" $NL 18 9 --value 0.0013ether --rpc-url $RPC --account <creator>
ID=$(cast call $C "nextId()(uint256)" --rpc-url $RPC)
cast call $C "circuitInfo(uint256)(uint32,uint32,uint32,uint32)" $ID --rpc-url $RPC   # 18 9 0 590
cast call $C "eval(uint256,bytes)(bytes)" $ID 0x000000 --rpc-url $RPC                  # 0x1000 (centre)

# 2. deploy the arena: ~2.76M gas (rehearse first without --broadcast)
BOT_CIRCUIT_ID=$ID forge script script/DeployArena.s.sol --rpc-url xlayer --sender $CREATOR --account <creator> --broadcast

# 3. name the circuit onchain via CerebrScope: ~0.96M gas
cast send $S "setLabel(address,uint256,(string,string,string[],string[]))" $C $ID \
  '("Neural Arena Bot","Tic-tac-toe policy as a 7-layer threshold-neuron network (590 NAND). Inputs: per cell i, b_i = bot piece, h_i = human piece. Output: one-hot move. Win > block > safe threat > centre > corner > edge; never loses. Played by NeuralArena.",["b0","h0","b1","h1","b2","h2","b3","h3","b4","h4","b5","h5","b6","h6","b7","h7","b8","h8"],["play0","play1","play2","play3","play4","play5","play6","play7","play8"])' \
  --rpc-url $RPC --account <creator>
```

| Step | Transistors | OKB (gas at 0.02 gwei) |
|---|---|---|
| Tape out | 590 NAND burned from the creator's 994 (404 left); already minted, so no new mint | 0.0013 fee + ~0.00004 gas |
| Deploy NeuralArena | none | ~0.000055 |
| setLabel | none | ~0.00002 |
| **Total** | **590 NAND** | **~0.00142 OKB**; the creator holds ~0.0587 OKB |

After the rollout, record the circuit id, arena address and transaction hashes in `launch/out/196.json` and the README, and verify the arena source on Sourcify as was done for CerebrScope.

## Live on X Layer mainnet (2026-10-06)

| Item | Value |
|---|---|
| Bot circuit | Cerebr circuit **#16** "Neural Arena Bot" (18 in, 9 out, 590 NAND), tape-out tx [0x0867…6f78](https://www.okx.com/web3/explorer/xlayer/tx/0x0867ed331fa75965a70facd01b0a0f0f456c9c0be33b4e0f5787f5eec70b6f78) |
| NeuralArena | [`0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD`](https://www.okx.com/web3/explorer/xlayer/address/0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD), deploy tx [0xd794…4748](https://www.okx.com/web3/explorer/xlayer/tx/0xd794960051024427817ca50db7025090e2dddf6ab664050caf184fd027d34748) |
| Bot label | CerebrScope `setLabel` tx [0x8ba8…f65c](https://www.okx.com/web3/explorer/xlayer/tx/0x8ba86cbbad574129c4060c19d7f9be7a7148810ef01c7a4b4d2913e6c2b7f65c) |
| Checks after deploy | `circuitInfo(16)` = 18/9/0/590; `eval(16, 0x000000)` = `0x1000` (centre); `previewBotMove(0, 0)` = cell 4, no fallback |
