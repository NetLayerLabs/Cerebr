// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentCircuits, IAgentOpener, ICerebrAgent} from "./ICerebrAgent.sol";

/// @title CerebrAgent
/// @notice An autonomous onchain agent whose brain is a taped-out Cerebr threshold neuron (by default
///         circuit #8, the "Go/No-Go Neuron": y = [e0 + e1 + e2 - i0 - i1 >= 2]). Each `act()` derives the
///         neuron's five inputs from onchain state only, runs ONE `eval()` of the policy circuit, and records
///         the verdict. The agent holds no funds and trades nothing: its output is a public, replayable
///         Go/No-Go signal ("is now a good moment for onchain activity on X Layer?").
/// @dev Input pins (bit i of the 1-byte eval input, LSB-first; see AGENT.md):
///        bit 0  e0 CALM        basefee <= calmMaxBasefee                                (+1)
///        bit 1  e1 ACTIVE      UTC hour of block.timestamp in [windowStartHour, windowEndHour)  (+1)
///        bit 2  e2 RESTED      no Go yet, or the last Go is >= restBlocks old           (+1)
///        bit 3  i0 SPIKE       basefee * 10_000 > ema * spikeBps                        (-1)
///        bit 4  i1 REFRACTORY  the last Go is < refractoryBlocks old                    (-1)
///      `ema` is an exponential moving average of block.basefee (alpha = 1/8) updated once per decision,
///      AFTER the inputs are derived; the inputs of a decision use the EMA as it was before it.
///      - The circuit is untrusted at runtime (TapeOut is upgradeable): eval is a gas-capped STATICCALL with
///        at most 96 bytes of return data copied and strict decoding (exactly one byte, value 0 or 1). Any
///        failure is recorded as an Abstain with its reason; the agent never bricks.
///      - The eval budget cannot be griefed: act() reverts unless the call can get the whole INFERENCE_GAS.
///      - Permissionless but rate-limited (minIntervalBlocks). A call from the policy circuit's own TapeOut
///        account (its "brain wallet", e.g. via account.execute) is flagged viaBrainWallet.
///      - No funds, no admin, nothing payable, no token transfers. The only external call made in act()
///        is a STATICCALL, so there is no reentrancy surface.
contract CerebrAgent is ICerebrAgent {
    /// @notice Gas budget of one eval staticcall (TapeOut eval costs ~50k + ~2.5k gas per gate).
    uint256 public constant INFERENCE_GAS = 1_000_000;
    /// @notice Largest flattened gateCount accepted at construction.
    uint32 public constant MAX_GATES = 256;
    uint32 public constant N_IN = 5;
    uint32 public constant N_OUT = 1;
    /// @notice Decisions kept in the ring buffer (older ones live on in events).
    uint256 public constant RING_SIZE = 64;
    /// @notice EMA smoothing: ema += (basefee - ema) / EMA_DIV (step rounded up, so it converges exactly).
    uint256 public constant EMA_DIV = 8;

    uint8 internal constant BIT_CALM = 1;
    uint8 internal constant BIT_ACTIVE = 2;
    uint8 internal constant BIT_RESTED = 4;
    uint8 internal constant BIT_SPIKE = 8;
    uint8 internal constant BIT_REFRACTORY = 16;

    /// @dev Gas that must be left before the eval call so that EIP-150's 63/64 rule still forwards the
    ///      full INFERENCE_GAS (plus a margin for the CALL itself).
    uint256 internal constant INFERENCE_GAS_REQUIRED = INFERENCE_GAS + INFERENCE_GAS / 63 + 10_000;

    IAgentCircuits public immutable circuits;
    uint256 public immutable policyCircuitId;
    /// @notice The policy circuit's TapeOut ERC-6551 account (opener.accountOf), or 0 without an opener.
    ///         Deterministic: it is the same address before and after the account is opened.
    address public immutable brainWallet;

    uint64 internal immutable _calmMaxBasefee;
    uint32 internal immutable _spikeBps;
    uint8 internal immutable _windowStartHour;
    uint8 internal immutable _windowEndHour;
    uint32 internal immutable _restBlocks;
    uint32 internal immutable _refractoryBlocks;
    uint32 internal immutable _minIntervalBlocks;

    Stats internal _stats; // one slot
    uint40 public lastGoBlock; // 0 = never
    uint128 public ema; // basefee EMA in wei
    mapping(uint256 slot => Record) internal _ring;

    /// @param circuits_ The TapeOut circuits contract (Cerebr: 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF).
    /// @param policyCircuitId_ Combinational, 5 in / 1 out, at most MAX_GATES gates, evaluable.
    /// @param opener_ The TapeOut opener (0x536a…0106), or address(0) to disable brain-wallet attribution.
    constructor(IAgentCircuits circuits_, uint256 policyCircuitId_, IAgentOpener opener_, Config memory cfg) {
        if (
            cfg.windowStartHour >= 24 || cfg.windowEndHour >= 24 || cfg.spikeBps < 10_000 || cfg.spikeBps > 1_000_000
                || cfg.minIntervalBlocks == 0 || cfg.refractoryBlocks > cfg.restBlocks || cfg.restBlocks == 0
        ) revert BadConfig();
        if (address(circuits_).code.length == 0) revert BadCircuit();
        circuits = circuits_;
        policyCircuitId = policyCircuitId_;
        try circuits_.circuitInfo(policyCircuitId_) returns (
            uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount
        ) {
            if (nIn != N_IN || nOut != N_OUT || nState != 0 || gateCount == 0 || gateCount > MAX_GATES) {
                revert BadCircuit();
            }
        } catch {
            revert BadCircuit();
        }

        address bw;
        if (address(opener_) != address(0)) {
            if (address(opener_).code.length == 0) revert BadConfig();
            try opener_.accountOf(address(circuits_), policyCircuitId_) returns (address a) {
                bw = a;
            } catch {
                revert BadConfig();
            }
        }
        brainWallet = bw;

        _calmMaxBasefee = cfg.calmMaxBasefee;
        _spikeBps = cfg.spikeBps;
        _windowStartHour = cfg.windowStartHour;
        _windowEndHour = cfg.windowEndHour;
        _restBlocks = cfg.restBlocks;
        _refractoryBlocks = cfg.refractoryBlocks;
        _minIntervalBlocks = cfg.minIntervalBlocks;

        ema = uint128(_clamp64(block.basefee));

        // Smoke inference: the circuit must answer every input with a well-formed single bit.
        for (uint256 x; x < 32; ++x) {
            // forge-lint: disable-next-line(unsafe-typecast)
            (,, Fallback reason,) = _eval(uint8(x)); // x < 32
            if (reason != Fallback.None) revert BadCircuit();
        }
    }

    // ------------------------------------------------------------------ act

    /// @inheritdoc ICerebrAgent
    function act() external returns (uint256 seq, Verdict verdict) {
        Stats memory s = _stats;
        if (s.lastActBlock != 0 && block.number < uint256(s.lastActBlock) + _minIntervalBlocks) {
            revert TooSoon(uint256(s.lastActBlock) + _minIntervalBlocks);
        }
        if (gasleft() < INFERENCE_GAS_REQUIRED) revert InsufficientGasForInference();

        // Narrowing casts are safe: block numbers and timestamps fit 40 bits for ~35k years, the decision
        // counter is a uint40, and basefee / ema are clamped to uint64.
        Record memory r;
        uint256 bf = _clamp64(block.basefee);
        uint256 e = ema;
        if (e == 0) e = bf; // first observation on a chain whose deployment block had basefee 0
        r.caller = msg.sender;
        // forge-lint: disable-next-line(unsafe-typecast)
        r.blockNumber = uint40(block.number);
        // forge-lint: disable-next-line(unsafe-typecast)
        r.timestamp = uint40(block.timestamp);
        // forge-lint: disable-next-line(unsafe-typecast)
        r.basefee = uint64(bf);
        // forge-lint: disable-next-line(unsafe-typecast)
        r.ema = uint64(e);
        r.prevGoBlock = lastGoBlock;
        r.inputs = deriveInputs(bf, e, block.timestamp, block.number, r.prevGoBlock);
        r.viaBrainWallet = brainWallet != address(0) && msg.sender == brainWallet;

        bytes memory rawOut;
        uint256 gasUsed;
        (r.outputs, rawOut, r.reason, gasUsed) = _eval(r.inputs);
        verdict = r.reason != Fallback.None ? Verdict.Abstain : (r.outputs == 1 ? Verdict.Go : Verdict.NoGo);
        r.verdict = verdict;

        unchecked {
            // uint40 counters growing by at most one per block
            seq = ++s.decisions;
            if (verdict == Verdict.Go) s.goCount++;
            else if (verdict == Verdict.NoGo) s.noGoCount++;
            else s.abstainCount++;
            if (r.viaBrainWallet) s.brainWalletCount++;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        r.seq = uint40(seq);
        s.lastActBlock = r.blockNumber;
        _stats = s;
        if (verdict == Verdict.Go) lastGoBlock = r.blockNumber;
        ema = uint128(_nextEma(e, bf));
        _ring[seq % RING_SIZE] = r;

        emit InferenceReceipt(seq, address(circuits), policyCircuitId, _inputBytes(r.inputs), rawOut, gasUsed, r.reason);
        _emitDecision(r);
    }

    function _emitDecision(Record memory r) internal {
        emit Decision(
            r.seq,
            r.caller,
            r.verdict,
            r.blockNumber,
            r.basefee,
            r.ema,
            _blocksSince(r.prevGoBlock, r.blockNumber),
            r.inputs,
            r.outputs,
            r.viaBrainWallet
        );
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc ICerebrAgent
    /// @dev eth_call without a gas price sees block.basefee == 0 on X Layer (geth NoBaseFee semantics):
    ///      pass a gasPrice / maxFeePerGas with the call, or use observeAt(latest baseFeePerGas).
    function observe() external view returns (Observation memory) {
        return _observe(block.basefee);
    }

    /// @inheritdoc ICerebrAgent
    function observeAt(uint256 basefee) external view returns (Observation memory) {
        return _observe(basefee);
    }

    /// @inheritdoc ICerebrAgent
    /// @dev An all-zero record (seq 0) before the first decision.
    function latestDecision() external view returns (Record memory r) {
        uint256 n = _stats.decisions;
        if (n != 0) r = _ring[n % RING_SIZE];
    }

    /// @inheritdoc ICerebrAgent
    /// @dev Oldest first. Only the last RING_SIZE decisions are stored: fromSeq is raised to the oldest
    ///      stored one, and at most min(count, RING_SIZE) records are returned (empty when out of range).
    function decisions(uint256 fromSeq, uint256 count) external view returns (Record[] memory out) {
        uint256 total = _stats.decisions;
        uint256 oldest = total > RING_SIZE ? total - RING_SIZE + 1 : 1;
        if (fromSeq < oldest) fromSeq = oldest;
        if (total == 0 || fromSeq > total || count == 0) return out;
        uint256 n = total - fromSeq + 1;
        if (n > count) n = count;
        out = new Record[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = _ring[(fromSeq + i) % RING_SIZE];
        }
    }

    /// @inheritdoc ICerebrAgent
    function stats() external view returns (Stats memory) {
        return _stats;
    }

    /// @inheritdoc ICerebrAgent
    function config() external view returns (Config memory) {
        return Config({
            calmMaxBasefee: _calmMaxBasefee,
            spikeBps: _spikeBps,
            windowStartHour: _windowStartHour,
            windowEndHour: _windowEndHour,
            restBlocks: _restBlocks,
            refractoryBlocks: _refractoryBlocks,
            minIntervalBlocks: _minIntervalBlocks
        });
    }

    /// @notice Re-runs the policy circuit on a stored decision's inputs (a convenience: the trustless check is
    ///         calling `circuits.eval(policyCircuitId, inputBytes(r.inputs))` yourself).
    /// @return outputs The circuit's answer now (0 on failure).
    /// @return matches True when the circuit still gives the recorded answer (an Abstain matches a failure).
    function replay(uint256 seq) external view returns (uint8 outputs, bool matches) {
        Record memory r = _ring[seq % RING_SIZE];
        if (r.seq != seq || seq == 0) return (0, false);
        Fallback reason;
        (outputs,, reason,) = _eval(r.inputs);
        matches = r.verdict == Verdict.Abstain ? reason != Fallback.None : (reason == Fallback.None && outputs == r.outputs);
    }

    /// @notice The five input pins for a given observation (pure function of its arguments and the Config).
    function deriveInputs(uint256 basefee, uint256 ema_, uint256 timestamp, uint256 blockNumber, uint256 prevGoBlock)
        public
        view
        returns (uint8 inputs)
    {
        if (basefee <= _calmMaxBasefee) inputs |= BIT_CALM;
        if (_inWindow(hourOf(timestamp))) inputs |= BIT_ACTIVE;
        uint256 since = _blocksSince(prevGoBlock, blockNumber);
        if (since >= _restBlocks) inputs |= BIT_RESTED;
        // basefee and ema are < 2**64 and spikeBps <= 1e6: no overflow
        if (basefee * 10_000 > ema_ * _spikeBps) inputs |= BIT_SPIKE;
        if (since < _refractoryBlocks) inputs |= BIT_REFRACTORY;
    }

    /// @notice The exact eval() input bytes for an input byte (one byte, pins LSB-first).
    function inputBytes(uint8 inputs) external pure returns (bytes memory) {
        return _inputBytes(inputs);
    }

    function hourOf(uint256 timestamp) public pure returns (uint256) {
        return (timestamp / 3600) % 24;
    }

    // ------------------------------------------------------------------ internals

    function _observe(uint256 basefee) internal view returns (Observation memory o) {
        Stats memory s = _stats;
        uint256 bf = _clamp64(basefee);
        uint256 e = ema;
        if (e == 0) e = bf;
        uint40 prevGo = lastGoBlock;
        o.blockNumber = block.number;
        o.timestamp = block.timestamp;
        o.basefee = bf;
        o.ema = e;
        o.hourUtc = hourOf(block.timestamp);
        o.blocksSinceGo = _blocksSince(prevGo, block.number);
        o.inputs = deriveInputs(bf, e, block.timestamp, block.number, prevGo);
        (o.outputs,, o.reason,) = _eval(o.inputs);
        o.verdict = o.reason != Fallback.None ? Verdict.Abstain : (o.outputs == 1 ? Verdict.Go : Verdict.NoGo);
        o.nextActBlock = s.lastActBlock == 0 ? 0 : uint256(s.lastActBlock) + _minIntervalBlocks;
        o.canAct = block.number >= o.nextActBlock;
    }

    function _inWindow(uint256 h) internal view returns (bool) {
        uint256 a = _windowStartHour;
        uint256 b = _windowEndHour;
        if (a == b) return true;
        if (a < b) return h >= a && h < b;
        return h >= a || h < b;
    }

    function _blocksSince(uint256 prevGoBlock, uint256 blockNumber) internal pure returns (uint256) {
        if (prevGoBlock == 0 || prevGoBlock > blockNumber) return type(uint256).max;
        return blockNumber - prevGoBlock;
    }

    /// @dev ema moves 1/8 of the way to bf, rounding the step up so it reaches bf exactly when bf is flat.
    function _nextEma(uint256 e, uint256 bf) internal pure returns (uint256) {
        if (bf >= e) return e + (bf - e + EMA_DIV - 1) / EMA_DIV;
        return e - (e - bf + EMA_DIV - 1) / EMA_DIV;
    }

    function _clamp64(uint256 x) internal pure returns (uint256) {
        return x > type(uint64).max ? type(uint64).max : x;
    }

    function _inputBytes(uint8 inputs) internal pure returns (bytes memory b) {
        b = new bytes(1);
        b[0] = bytes1(inputs);
    }

    /// @dev Gas-capped STATICCALL of eval(policyCircuitId, [inputs]) with strict decoding. Never reverts.
    /// @return outputs The single output bit (0 on failure).
    /// @return raw The raw eval output (empty on CallFailed / malformed ABI).
    function _eval(uint8 inputs)
        internal
        view
        returns (uint8 outputs, bytes memory raw, Fallback reason, uint256 gasUsed)
    {
        bytes memory callData = abi.encodeCall(IAgentCircuits.eval, (policyCircuitId, _inputBytes(inputs)));
        address target = address(circuits);
        uint256 budget = INFERENCE_GAS;
        bool ok;
        uint256 size;
        uint256 offset;
        uint256 len;
        uint256 word;
        uint256 g0 = gasleft();
        assembly ("memory-safe") {
            ok := staticcall(budget, target, add(callData, 0x20), mload(callData), 0, 0)
            size := returndatasize()
            // copy at most 96 bytes (offset, length, first data word) into scratch-free memory
            let p := mload(0x40)
            mstore(p, 0)
            mstore(add(p, 0x20), 0)
            mstore(add(p, 0x40), 0)
            let n := size
            if gt(n, 0x60) { n := 0x60 }
            returndatacopy(p, 0, n)
            offset := mload(p)
            len := mload(add(p, 0x20))
            word := mload(add(p, 0x40))
        }
        gasUsed = g0 - gasleft();
        if (!ok) return (0, raw, Fallback.CallFailed, gasUsed);
        // The canonical ABI encoding of a 1-byte `bytes`: offset 0x20, length 1, one padded word, nothing more.
        if (offset != 0x20 || len != 1 || size != 0x60 || word << 8 != 0) return (0, raw, Fallback.BadReturn, gasUsed);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 b = uint8(word >> 248); // the first (only) data byte
        raw = _inputBytes(b);
        if (b > 1) return (0, raw, Fallback.BadOutput, gasUsed);
        return (b, raw, Fallback.None, gasUsed);
    }
}
