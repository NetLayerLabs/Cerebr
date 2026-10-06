// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The two TapeOut circuits functions the agent needs (see TAPEOUT.md section 4).
interface IAgentCircuits {
    /// @dev Bit-packed LSB-first. Reverts "has latch: use step" for sequential circuits.
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    /// @dev gateCount and nState are flattened through REFs. Reverts "no circuit" for unknown ids.
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
}

/// @notice TapeOut opener: the deterministic ERC-6551 "brain wallet" address of a circuit.
interface IAgentOpener {
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
}

/// @notice Cerebr Agent: an autonomous onchain agent whose brain is a taped-out Cerebr threshold neuron.
///         See AGENT.md. Every decision is one `eval()` of the policy circuit on inputs derived only from
///         onchain-observable state, recorded in a ring buffer and in events anyone can replay.
interface ICerebrAgent {
    /// @notice What the agent decided. Abstain = the circuit could not be evaluated (see Fallback).
    enum Verdict {
        NoGo,
        Go,
        Abstain
    }

    /// @notice Why the agent abstained (None = the circuit's own answer was used).
    enum Fallback {
        None,
        CallFailed, // eval reverted or ran out of its gas budget
        BadReturn, // return data is not a well-formed `bytes` of length 1
        BadOutput // the output byte has bits set above the single output pin
    }

    /// @notice Immutable policy configuration (fixed at deployment; there is no admin).
    struct Config {
        /// @dev e0 CALM fires when basefee <= calmMaxBasefee (wei).
        uint64 calmMaxBasefee;
        /// @dev i0 SPIKE fires when basefee * 10_000 > ema * spikeBps (e.g. 15_000 = 1.5x the EMA).
        uint32 spikeBps;
        /// @dev e1 ACTIVE fires when the UTC hour is in [windowStartHour, windowEndHour) (wraps past
        ///      midnight when start > end; start == end means all day).
        uint8 windowStartHour;
        uint8 windowEndHour;
        /// @dev e2 RESTED fires when the last Go is at least restBlocks old (or there was none).
        uint32 restBlocks;
        /// @dev i1 REFRACTORY fires when the last Go is fewer than refractoryBlocks old.
        uint32 refractoryBlocks;
        /// @dev act() reverts TooSoon until minIntervalBlocks have passed since the previous act().
        uint32 minIntervalBlocks;
    }

    /// @notice One decision, as stored in the ring buffer (two storage slots).
    struct Record {
        address caller;
        uint40 blockNumber;
        uint40 timestamp;
        uint8 inputs; // the exact eval() input byte (5 pins, LSB-first)
        uint8 outputs; // the eval() output byte (0 on abstain)
        uint40 seq; // 1-based; 0 = empty record
        uint40 prevGoBlock; // last Go before this decision (0 = never): blocksSinceGo = blockNumber - prevGoBlock
        uint64 basefee; // block.basefee (clamped to uint64)
        uint64 ema; // the basefee EMA the inputs were derived from (before this decision's update)
        Verdict verdict;
        Fallback reason;
        bool viaBrainWallet; // msg.sender was the policy circuit's own TapeOut account
    }

    /// @notice The inputs the agent would use now, and what it would decide (no transaction).
    struct Observation {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 basefee;
        uint256 ema;
        uint256 hourUtc;
        uint256 blocksSinceGo; // type(uint256).max when the agent never said Go
        uint8 inputs;
        uint8 outputs;
        Verdict verdict;
        Fallback reason;
        bool canAct; // act() would not revert TooSoon in this block
        uint256 nextActBlock; // first block in which act() is allowed
    }

    struct Stats {
        uint40 decisions;
        uint40 goCount;
        uint40 noGoCount;
        uint40 abstainCount;
        uint40 brainWalletCount;
        uint40 lastActBlock;
    }

    /// @notice One decision. `inputs` can be recomputed from (basefee, ema, block timestamp, blocksSinceGo)
    ///         and the immutable Config; `outputs == circuits.eval(policyCircuitId, [inputs])` (see InferenceReceipt).
    event Decision(
        uint256 indexed seq,
        address indexed caller,
        Verdict indexed verdict,
        uint256 blockNumber,
        uint256 basefee,
        uint256 ema,
        uint256 blocksSinceGo,
        uint8 inputs,
        uint8 outputs,
        bool viaBrainWallet
    );
    /// @notice One onchain inference: `outputs = circuits.eval(circuitId, inputs)`, replayable by anyone
    ///         (same shape as NeuralArena's receipt, keyed by decision seq).
    /// @param outputs The raw eval output (empty when the call failed or returned malformed data).
    /// @param gasUsed Gas consumed by the eval staticcall, as measured by the agent.
    event InferenceReceipt(
        uint256 indexed seq,
        address indexed circuits,
        uint256 indexed circuitId,
        bytes inputs,
        bytes outputs,
        uint256 gasUsed,
        Fallback fallbackReason
    );

    error BadCircuit();
    error BadConfig();
    error TooSoon(uint256 nextActBlock);
    error InsufficientGasForInference();

    function act() external returns (uint256 seq, Verdict verdict);

    function observe() external view returns (Observation memory);
    function observeAt(uint256 basefee) external view returns (Observation memory);
    function latestDecision() external view returns (Record memory);
    function decisions(uint256 fromSeq, uint256 count) external view returns (Record[] memory);
    function stats() external view returns (Stats memory);
    function config() external view returns (Config memory);
}
