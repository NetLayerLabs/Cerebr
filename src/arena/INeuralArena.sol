// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Neural Arena: tic-tac-toe against a bot whose every move is an onchain inference of a
///         taped-out Cerebr circuit. See ARENA.md.
interface INeuralArena {
    enum Status {
        None,
        Active,
        HumanWon,
        BotWon,
        Draw
    }

    /// @notice Why the contract overrode the circuit's answer (None = the circuit's move was played).
    enum Fallback {
        None,
        CallFailed, // eval reverted or ran out of its gas budget
        BadReturn, // return data is not a well-formed `bytes` of the expected length
        NotOneHot, // zero or several move bits set (or padding bits set)
        Occupied // the chosen cell is not empty
    }

    struct Game {
        address player;
        uint16 human; // bit i = cell i holds a human piece
        uint16 bot; // bit i = cell i holds a bot piece
        uint8 moves; // pieces on the board
        Status status;
    }

    struct Stats {
        uint64 games;
        uint64 humanWins;
        uint64 botWins;
        uint64 draws;
    }

    event GameStarted(uint256 indexed gameId, address indexed player);
    /// @param player The game's human player (also for bot moves; see `isBot`).
    event Moved(uint256 indexed gameId, address indexed player, uint8 cell, bool isBot);
    /// @notice One onchain inference: `outputs = circuits.eval(circuitId, inputs)`, replayable by anyone.
    /// @param outputs The raw eval output (empty when the call failed or returned malformed data).
    /// @param gasUsed Gas consumed by the eval staticcall, as measured by the arena.
    /// @param fallbackReason None when the circuit's move was played as returned.
    event InferenceReceipt(
        uint256 indexed gameId,
        address indexed circuits,
        uint256 indexed circuitId,
        bytes inputs,
        bytes outputs,
        uint256 gasUsed,
        Fallback fallbackReason
    );
    /// @notice The circuit's answer could not be played; the arena played `cell` deterministically instead.
    event BotFallback(uint256 indexed gameId, uint8 cell, Fallback reason);
    event GameOver(uint256 indexed gameId, address indexed player, Status result);

    error BadCircuit();
    error UnknownGame();
    error NotPlayer();
    error GameNotActive();
    error InvalidCell();
    error CellOccupied();
    error InsufficientGasForInference();

    function newGame() external returns (uint256 gameId);
    function play(uint256 gameId, uint8 cell) external;

    function board(uint256 gameId) external view returns (uint8[9] memory cells);
    function gameState(uint256 gameId) external view returns (Game memory);
    function stats() external view returns (Stats memory);
    function playerStats(address player) external view returns (Stats memory);
}
