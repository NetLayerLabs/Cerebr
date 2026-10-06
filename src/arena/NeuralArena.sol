// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IArenaCircuits} from "./IArenaCircuits.sol";
import {INeuralArena} from "./INeuralArena.sol";

/// @title NeuralArena
/// @notice Tic-tac-toe against a bot whose every move is decided ONCHAIN by a taped-out Cerebr circuit:
///         a layered threshold-neuron policy compiled to NAND gates (sdk/src/neuro/arena.ts). Each bot
///         move is an `eval()` of that circuit, recorded as an `InferenceReceipt` anyone can replay.
/// @dev The human always moves first (X); the bot replies in the same transaction.
///      - Circuit I/O: 18 inputs, bit 2i = bot piece on cell i, bit 2i+1 = human piece on cell i
///        (3 bytes, LSB-first); 9 outputs, one-hot move (2 bytes).
///      - The circuit is untrusted at runtime: TapeOut's contracts are upgradeable, so the eval call is a
///        gas-capped staticcall whose return data is length-checked. Any failure (revert, out of gas,
///        malformed data, not one-hot, occupied cell) makes the arena play the first empty cell in
///        centre-corner-edge order instead and emit `BotFallback`. A game can never be bricked.
///      - The eval budget cannot be griefed: `play` reverts unless the call can be given the whole
///        INFERENCE_GAS budget, so a low gas limit cannot force a fallback move.
///      - No funds, no admin, no payable functions. The only external call is a STATICCALL, which cannot
///        modify state, so there is no reentrancy surface.
contract NeuralArena is INeuralArena {
    /// @notice Gas budget of one eval staticcall. The bot circuit is 590 NAND (~1.5M gas measured on a
    ///         mainnet fork; see ARENA.md); circuits above MAX_GATES are rejected at construction.
    uint256 public constant INFERENCE_GAS = 3_000_000;
    /// @notice Largest flattened gateCount accepted (TapeOut eval costs ~50k + ~2.5k gas per gate).
    uint32 public constant MAX_GATES = 1000;
    uint32 public constant N_IN = 18;
    uint32 public constant N_OUT = 9;

    /// @dev Gas that must be left before the eval call so that EIP-150's 63/64 rule still forwards the full
    ///      INFERENCE_GAS (plus a margin for the CALL itself).
    uint256 internal constant INFERENCE_GAS_REQUIRED = INFERENCE_GAS + INFERENCE_GAS / 63 + 10_000;
    /// @dev Fallback order, one cell per nibble from the lowest: 4, 0, 2, 6, 8, 1, 3, 5, 7.
    uint256 internal constant ORDER = 0x753186204;
    /// @dev The 8 winning lines as 9-bit cell masks, 16 bits each.
    uint256 internal constant LINES = 0x0054_0111_0124_0092_0049_01c0_0038_0007;
    uint16 internal constant FULL = 0x1ff;

    IArenaCircuits public immutable circuits;
    uint256 public immutable botCircuitId;

    uint256 public gameCount;
    uint256 public fallbackCount;
    Stats internal _stats;
    mapping(address player => Stats) internal _playerStats;
    mapping(uint256 gameId => Game) internal _games;

    /// @param circuits_ The TapeOut circuits contract (Cerebr: 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF).
    /// @param botCircuitId_ The taped-out bot circuit. Must be combinational, 18 in / 9 out, at most
    ///        MAX_GATES gates, and must answer the empty board with a legal move.
    constructor(IArenaCircuits circuits_, uint256 botCircuitId_) {
        if (address(circuits_).code.length == 0) revert BadCircuit();
        circuits = circuits_;
        botCircuitId = botCircuitId_;
        try circuits_.circuitInfo(botCircuitId_) returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount) {
            if (nIn != N_IN || nOut != N_OUT || nState != 0 || gateCount == 0 || gateCount > MAX_GATES) {
                revert BadCircuit();
            }
        } catch {
            revert BadCircuit();
        }
        // Smoke inference on the empty board: the circuit must answer with a legal move.
        (, Fallback reason,,) = _evalMove(0, 0);
        if (reason != Fallback.None) revert BadCircuit();
    }

    // ------------------------------------------------------------------ game

    /// @inheritdoc INeuralArena
    function newGame() external returns (uint256 gameId) {
        gameId = ++gameCount;
        _games[gameId] = Game({player: msg.sender, human: 0, bot: 0, moves: 0, status: Status.Active});
        _stats.games++;
        _playerStats[msg.sender].games++;
        emit GameStarted(gameId, msg.sender);
    }

    /// @inheritdoc INeuralArena
    /// @dev Applies the human move, then (if the game goes on) runs the bot circuit and applies its move.
    function play(uint256 gameId, uint8 cell) external {
        Game memory g = _games[gameId];
        if (g.status == Status.None) revert UnknownGame();
        if (g.player != msg.sender) revert NotPlayer();
        if (g.status != Status.Active) revert GameNotActive();
        if (cell >= 9) revert InvalidCell();
        uint16 bit = uint16(1) << cell;
        if ((g.human | g.bot) & bit != 0) revert CellOccupied();

        g.human |= bit;
        g.moves++;
        emit Moved(gameId, msg.sender, cell, false);

        if (_won(g.human)) {
            g.status = Status.HumanWon;
        } else if (g.moves == 9) {
            g.status = Status.Draw;
        } else {
            uint8 botCell = _botMove(gameId, g.bot, g.human);
            g.bot |= uint16(1) << botCell;
            g.moves++;
            emit Moved(gameId, msg.sender, botCell, true);
            if (_won(g.bot)) g.status = Status.BotWon;
            else if (g.moves == 9) g.status = Status.Draw;
        }

        _games[gameId] = g;
        if (g.status != Status.Active) _finish(gameId, g.player, g.status);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc INeuralArena
    /// @dev 0 = empty, 1 = bot, 2 = human (the SDK's encoding).
    function board(uint256 gameId) external view returns (uint8[9] memory cells) {
        Game memory g = _games[gameId];
        if (g.status == Status.None) revert UnknownGame();
        for (uint256 i; i < 9; ++i) {
            if ((g.bot >> i) & 1 != 0) cells[i] = 1;
            else if ((g.human >> i) & 1 != 0) cells[i] = 2;
        }
    }

    /// @inheritdoc INeuralArena
    function gameState(uint256 gameId) external view returns (Game memory) {
        return _games[gameId];
    }

    /// @inheritdoc INeuralArena
    function stats() external view returns (Stats memory) {
        return _stats;
    }

    /// @inheritdoc INeuralArena
    function playerStats(address player) external view returns (Stats memory) {
        return _playerStats[player];
    }

    /// @notice The exact eval() input the arena sends for a position (3 bytes, LSB-first).
    function encodeBoard(uint16 bot, uint16 human) public pure returns (bytes memory input) {
        uint256 v;
        for (uint256 i; i < 9; ++i) {
            v |= ((uint256(bot) >> i) & 1) << (2 * i);
            v |= ((uint256(human) >> i) & 1) << (2 * i + 1);
        }
        input = new bytes(3);
        // forge-lint: disable-next-line(unsafe-typecast)
        input[0] = bytes1(uint8(v)); // byte extraction: truncation intended
        // forge-lint: disable-next-line(unsafe-typecast)
        input[1] = bytes1(uint8(v >> 8));
        // forge-lint: disable-next-line(unsafe-typecast)
        input[2] = bytes1(uint8(v >> 16));
    }

    /// @notice What the bot would play in a position, without a transaction (same path as `play`).
    /// @return cell The move actually played (after fallback).
    /// @return reason Fallback.None when the circuit's own answer is played.
    function previewBotMove(uint16 bot, uint16 human) external view returns (uint8 cell, Fallback reason) {
        if (bot & human != 0 || (bot | human) & FULL == FULL || (bot | human) > FULL) revert InvalidCell();
        (cell, reason,,) = _evalMove(bot, human);
    }

    // ------------------------------------------------------------------ internals

    function _botMove(uint256 gameId, uint16 bot, uint16 human) internal returns (uint8 cell) {
        if (gasleft() < INFERENCE_GAS_REQUIRED) revert InsufficientGasForInference();
        Fallback reason;
        bytes memory outputs;
        uint256 gasUsed;
        (cell, reason, outputs, gasUsed) = _evalMove(bot, human);
        emit InferenceReceipt(
            gameId, address(circuits), botCircuitId, encodeBoard(bot, human), outputs, gasUsed, reason
        );
        if (reason != Fallback.None) {
            fallbackCount++;
            emit BotFallback(gameId, cell, reason);
        }
    }

    /// @dev The first 96 bytes of an eval return (ABI `bytes`: offset, length, first data word).
    struct RawReturn {
        bool ok;
        uint256 size;
        uint256 offset;
        uint256 len;
        uint256 word;
    }

    /// @dev Runs the circuit and validates its answer. Never reverts: on any failure it returns the
    ///      deterministic fallback cell and the reason. Requires at least one empty cell.
    function _evalMove(uint16 bot, uint16 human)
        internal
        view
        returns (uint8 cell, Fallback reason, bytes memory outputs, uint256 gasUsed)
    {
        RawReturn memory r;
        (r, gasUsed) = _rawEval(encodeBoard(bot, human));
        uint16 occupied = bot | human;
        if (!r.ok) return (_fallbackCell(occupied), Fallback.CallFailed, outputs, gasUsed);
        // A well-formed `bytes` return: offset 0x20, then the length, then the data padded to 32 bytes.
        // forge-lint: disable-next-line(divide-before-multiply)
        if (r.offset != 0x20 || r.len > 32 || r.size < 0x40 + ((r.len + 31) / 32) * 32) {
            return (_fallbackCell(occupied), Fallback.BadReturn, outputs, gasUsed);
        }
        uint256 word = r.word;
        if (r.len < 32) word &= ~(type(uint256).max >> (8 * r.len)); // keep only the first len bytes
        outputs = new bytes(r.len);
        if (r.len != 0) {
            assembly ("memory-safe") {
                mstore(add(outputs, 0x20), word) // 0 < len <= 32: one word holds all of it
            }
        }
        if (r.len != 2) return (_fallbackCell(occupied), Fallback.BadReturn, outputs, gasUsed);

        uint256 v = (word >> 248) | (((word >> 240) & 0xff) << 8);
        if (v == 0 || v & (v - 1) != 0 || v > FULL) {
            return (_fallbackCell(occupied), Fallback.NotOneHot, outputs, gasUsed);
        }
        while (v > 1) {
            v >>= 1;
            cell++;
        }
        if ((occupied >> cell) & 1 != 0) return (_fallbackCell(occupied), Fallback.Occupied, outputs, gasUsed);
        return (cell, Fallback.None, outputs, gasUsed);
    }

    /// @dev Gas-capped STATICCALL of eval(botCircuitId, input). Copies at most 96 bytes of return data,
    ///      so a return-data bomb costs the arena nothing.
    function _rawEval(bytes memory input) internal view returns (RawReturn memory r, uint256 gasUsed) {
        bytes memory callData = abi.encodeCall(IArenaCircuits.eval, (botCircuitId, input));
        address target = address(circuits);
        uint256 budget = INFERENCE_GAS;
        bool ok;
        uint256 size;
        uint256 g0 = gasleft();
        assembly ("memory-safe") {
            ok := staticcall(budget, target, add(callData, 0x20), mload(callData), 0, 0)
            size := returndatasize()
        }
        gasUsed = g0 - gasleft();
        r.ok = ok;
        r.size = size;
        uint256 n = size > 0x60 ? 0x60 : size;
        assembly ("memory-safe") {
            // r.offset, r.len and r.word are three consecutive zeroed words starting at r + 0x40
            returndatacopy(add(r, 0x40), 0, n)
        }
    }

    /// @dev First empty cell in centre-corner-edge order. Callers guarantee an empty cell exists.
    function _fallbackCell(uint16 occupied) internal pure returns (uint8) {
        for (uint256 i; i < 9; ++i) {
            uint8 c = uint8((ORDER >> (4 * i)) & 0xf);
            if ((occupied >> c) & 1 == 0) return c;
        }
        revert InvalidCell(); // unreachable while a cell is empty
    }

    function _won(uint16 m) internal pure returns (bool) {
        for (uint256 i; i < 8; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint16 line = uint16(LINES >> (16 * i)); // 16-bit field extraction
            if (m & line == line) return true;
        }
        return false;
    }

    function _finish(uint256 gameId, address player, Status result) internal {
        Stats storage p = _playerStats[player];
        if (result == Status.HumanWon) {
            _stats.humanWins++;
            p.humanWins++;
        } else if (result == Status.BotWon) {
            _stats.botWins++;
            p.botWins++;
        } else {
            _stats.draws++;
            p.draws++;
        }
        emit GameOver(gameId, player, result);
    }
}
