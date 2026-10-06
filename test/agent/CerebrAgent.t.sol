// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CerebrAgent} from "../../src/agent/CerebrAgent.sol";
import {IAgentCircuits, IAgentOpener, ICerebrAgent} from "../../src/agent/ICerebrAgent.sol";
import {GoNoGo, MockAgentCircuits, MockBrainAccount, MockOpener} from "./AgentMocks.sol";

contract CerebrAgentTest is Test {
    uint256 constant ID = 8;
    uint256 constant DAY0 = 1_790_035_200; // a UTC midnight (1_790_035_200 % 86400 == 0)
    uint64 constant CALM = 50_000_000; // 0.05 gwei
    uint256 constant FLAT = 20_000_000; // X Layer's usual 0.02 gwei

    MockAgentCircuits circuits;
    MockBrainAccount brain;
    MockOpener opener;
    CerebrAgent agent;
    address owner = makeAddr("circuitOwner");
    address keeper = makeAddr("keeper");

    event Decision(
        uint256 indexed seq,
        address indexed caller,
        ICerebrAgent.Verdict indexed verdict,
        uint256 blockNumber,
        uint256 basefee,
        uint256 ema,
        uint256 blocksSinceGo,
        uint8 inputs,
        uint8 outputs,
        bool viaBrainWallet
    );
    event InferenceReceipt(
        uint256 indexed seq,
        address indexed circuits,
        uint256 indexed circuitId,
        bytes inputs,
        bytes outputs,
        uint256 gasUsed,
        ICerebrAgent.Fallback fallbackReason
    );

    function cfg() internal pure returns (ICerebrAgent.Config memory) {
        return ICerebrAgent.Config({
            calmMaxBasefee: CALM,
            spikeBps: 15_000,
            windowStartHour: 13,
            windowEndHour: 21,
            restBlocks: 43_200,
            refractoryBlocks: 3_600,
            minIntervalBlocks: 300
        });
    }

    function setUp() public {
        vm.roll(1_000_000);
        vm.warp(DAY0 + 14 hours); // inside the 13-21 UTC window
        vm.fee(FLAT);
        circuits = new MockAgentCircuits();
        brain = new MockBrainAccount(owner);
        opener = new MockOpener(address(brain));
        agent = new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(opener)), cfg());
    }

    function _next(uint256 blocks) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks); // ~1s blocks
    }

    // ------------------------------------------------------------ construction

    function test_constructor_state() public view {
        assertEq(address(agent.circuits()), address(circuits));
        assertEq(agent.policyCircuitId(), ID);
        assertEq(agent.brainWallet(), address(brain));
        assertEq(agent.ema(), FLAT);
        ICerebrAgent.Config memory c = agent.config();
        assertEq(c.calmMaxBasefee, CALM);
        assertEq(c.spikeBps, 15_000);
        assertEq(c.minIntervalBlocks, 300);
        assertEq(agent.latestDecision().seq, 0);
        assertEq(agent.decisions(1, 10).length, 0);
    }

    function test_constructor_noOpener_noBrainWallet() public {
        CerebrAgent a = new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), cfg());
        assertEq(a.brainWallet(), address(0));
        a.act();
        assertFalse(a.latestDecision().viaBrainWallet);
    }

    function test_constructor_rejectsBadCircuits() public {
        ICerebrAgent.Config memory c = cfg();
        vm.expectRevert(ICerebrAgent.BadCircuit.selector);
        new CerebrAgent(IAgentCircuits(makeAddr("eoa")), ID, IAgentOpener(address(0)), c);
        vm.expectRevert(ICerebrAgent.BadCircuit.selector);
        new CerebrAgent(IAgentCircuits(address(circuits)), 9, IAgentOpener(address(0)), c); // unknown id

        uint32[4][6] memory bad = [
            [uint32(4), 1, 0, 19],
            [uint32(5), 2, 0, 19],
            [uint32(5), 1, 1, 19],
            [uint32(5), 1, 0, 0],
            [uint32(5), 1, 0, 257],
            [uint32(18), 9, 0, 590]
        ];
        for (uint256 i; i < bad.length; ++i) {
            circuits.setInfo(bad[i][0], bad[i][1], bad[i][2], bad[i][3]);
            vm.expectRevert(ICerebrAgent.BadCircuit.selector);
            new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), c);
        }
        circuits.setInfo(5, 1, 0, 256);
        new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), c); // the limit is fine

        circuits.setInfoReverts(true);
        vm.expectRevert(ICerebrAgent.BadCircuit.selector);
        new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), c);
        circuits.setInfoReverts(false);

        // the smoke inference must succeed on all 32 inputs
        MockAgentCircuits.Mode[6] memory modes = [
            MockAgentCircuits.Mode.Revert,
            MockAgentCircuits.Mode.BurnGas,
            MockAgentCircuits.Mode.WrongLength,
            MockAgentCircuits.Mode.BadOutput,
            MockAgentCircuits.Mode.BadOffset,
            MockAgentCircuits.Mode.ReturnBomb
        ];
        for (uint256 i; i < modes.length; ++i) {
            circuits.setMode(modes[i]);
            vm.expectRevert(ICerebrAgent.BadCircuit.selector);
            new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), c);
        }
    }

    function test_constructor_rejectsBadConfig() public {
        ICerebrAgent.Config[7] memory bad;
        for (uint256 i; i < bad.length; ++i) {
            bad[i] = cfg();
        }
        bad[0].windowStartHour = 24;
        bad[1].windowEndHour = 24;
        bad[2].spikeBps = 9_999;
        bad[3].spikeBps = 1_000_001;
        bad[4].minIntervalBlocks = 0;
        bad[5].refractoryBlocks = 50_000; // > restBlocks
        bad[6].restBlocks = 0;
        bad[6].refractoryBlocks = 0;
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(ICerebrAgent.BadConfig.selector);
            new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), bad[i]);
        }
        vm.expectRevert(ICerebrAgent.BadConfig.selector); // opener without code
        new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(makeAddr("eoa")), cfg());
    }

    // ------------------------------------------------------------ input derivation

    function test_deriveInputs_eachPin() public view {
        uint256 bn = 2_000_000;
        uint256 ts = DAY0 + 14 hours;
        // calm, active, rested (never went), no spike, not refractory
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, 0), 0x07);
        assertEq(agent.deriveInputs(CALM, CALM, ts, bn, 0) & 1, 1); // <= is calm
        assertEq(agent.deriveInputs(CALM + 1, CALM + 1, ts, bn, 0) & 1, 0);
        assertEq(agent.deriveInputs(FLAT, FLAT, DAY0 + 12 hours, bn, 0) & 2, 0); // before window
        assertEq(agent.deriveInputs(FLAT, FLAT, DAY0 + 13 hours, bn, 0) & 2, 2); // start inclusive
        assertEq(agent.deriveInputs(FLAT, FLAT, DAY0 + 21 hours, bn, 0) & 2, 0); // end exclusive
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, bn - 43_200) & 4, 4); // rest boundary inclusive
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, bn - 43_199) & 4, 0);
        assertEq(agent.deriveInputs(30_000_000, FLAT, ts, bn, 0) & 8, 0); // exactly 1.5x: not a spike
        assertEq(agent.deriveInputs(30_000_001, FLAT, ts, bn, 0) & 8, 8);
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, bn - 3_599) & 16, 16); // refractory
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, bn - 3_600) & 16, 0);
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, bn) & 16, 16); // Go in this very block
        assertEq(agent.deriveInputs(FLAT, FLAT, ts, bn, bn + 1) & 20, 4); // future "last Go" = never
    }

    function test_window_wrapsMidnight() public {
        ICerebrAgent.Config memory c = cfg();
        c.windowStartHour = 22;
        c.windowEndHour = 3;
        CerebrAgent a = new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), c);
        assertEq(a.deriveInputs(FLAT, FLAT, DAY0 + 23 hours, 1, 0) & 2, 2);
        assertEq(a.deriveInputs(FLAT, FLAT, DAY0 + 2 hours, 1, 0) & 2, 2);
        assertEq(a.deriveInputs(FLAT, FLAT, DAY0 + 3 hours, 1, 0) & 2, 0);
        assertEq(a.deriveInputs(FLAT, FLAT, DAY0 + 21 hours, 1, 0) & 2, 0);
        c.windowStartHour = 5;
        c.windowEndHour = 5;
        a = new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), c);
        for (uint256 h; h < 24; ++h) {
            assertEq(a.deriveInputs(FLAT, FLAT, DAY0 + h * 1 hours, 1, 0) & 2, 2); // all day
        }
    }

    // ------------------------------------------------------------ act

    function test_act_firstDecision_recordsAndEmits() public {
        vm.expectEmit(true, true, true, false, address(agent)); // gasUsed varies
        emit InferenceReceipt(1, address(circuits), ID, hex"07", hex"01", 0, ICerebrAgent.Fallback.None);
        vm.expectEmit(true, true, true, true, address(agent));
        emit Decision(1, keeper, ICerebrAgent.Verdict.Go, block.number, FLAT, FLAT, type(uint256).max, 7, 1, false);
        vm.prank(keeper);
        (uint256 seq, ICerebrAgent.Verdict v) = agent.act();
        assertEq(seq, 1);
        assertEq(uint8(v), uint8(ICerebrAgent.Verdict.Go));

        ICerebrAgent.Record memory r = agent.latestDecision();
        assertEq(r.seq, 1);
        assertEq(r.caller, keeper);
        assertEq(r.blockNumber, block.number);
        assertEq(r.timestamp, block.timestamp);
        assertEq(r.inputs, 7);
        assertEq(r.outputs, 1);
        assertEq(r.basefee, FLAT);
        assertEq(r.ema, FLAT);
        assertEq(r.prevGoBlock, 0);
        assertFalse(r.viaBrainWallet);
        assertEq(agent.lastGoBlock(), block.number);

        ICerebrAgent.Stats memory s = agent.stats();
        assertEq(s.decisions, 1);
        assertEq(s.goCount, 1);
        assertEq(s.lastActBlock, block.number);
    }

    function test_act_rateLimited() public {
        agent.act();
        uint256 next = block.number + 300;
        vm.expectRevert(abi.encodeWithSelector(ICerebrAgent.TooSoon.selector, next));
        agent.act();
        _next(299);
        vm.expectRevert(abi.encodeWithSelector(ICerebrAgent.TooSoon.selector, next));
        agent.act();
        ICerebrAgent.Observation memory o = agent.observe();
        assertFalse(o.canAct);
        assertEq(o.nextActBlock, next);
        _next(1);
        assertTrue(agent.observe().canAct);
        agent.act();
        assertEq(agent.stats().decisions, 2);
    }

    function test_act_cannotBeStarvedOfInferenceGas() public {
        vm.expectRevert(ICerebrAgent.InsufficientGasForInference.selector);
        agent.act{gas: 900_000}();
        agent.act{gas: 1_200_000}();
        assertEq(uint8(agent.latestDecision().verdict), uint8(ICerebrAgent.Verdict.Go));
    }

    /// @dev Flat 0.02 gwei, keeper every 600 blocks (10 min), inside the window: Go, refractory No-Go for
    ///      an hour, then Go again (calm + active = 2) - a pulse every ~70 minutes.
    function test_dynamics_pulseInsideWindow() public {
        uint8[9] memory expectGo = [1, 0, 0, 0, 0, 0, 1, 0, 0];
        for (uint256 i; i < expectGo.length; ++i) {
            (, ICerebrAgent.Verdict v) = agent.act();
            assertEq(v == ICerebrAgent.Verdict.Go ? 1 : 0, expectGo[i], vm.toString(i));
            _next(600);
        }
        ICerebrAgent.Record memory r = agent.latestDecision();
        assertEq(r.inputs, 0x10 | 0x03); // refractory, calm, active
    }

    /// @dev Outside the window a recent Go means No-Go until restBlocks (12h) have passed.
    function test_dynamics_outsideWindowNeedsRest() public {
        agent.act(); // Go at 14:00
        vm.warp(DAY0 + 22 hours);
        vm.roll(block.number + 8 * 3600);
        (, ICerebrAgent.Verdict v) = agent.act();
        assertEq(uint8(v), uint8(ICerebrAgent.Verdict.NoGo)); // calm only: 1 < 2
        assertEq(agent.latestDecision().inputs, 0x01);
        vm.roll(agent.lastGoBlock() + 43_200);
        (, v) = agent.act();
        assertEq(uint8(v), uint8(ICerebrAgent.Verdict.Go)); // calm + rested
    }

    /// @dev A spike inhibits: rested + active + calm - spike = 2 still fires; without the window it does not.
    function test_dynamics_spikeInhibits() public {
        vm.warp(DAY0 + 2 hours); // outside the window
        vm.fee(40_000_000); // 2x the EMA, still calm (<= 0.05 gwei)
        (, ICerebrAgent.Verdict v) = agent.act();
        assertEq(agent.latestDecision().inputs, 0x01 | 0x04 | 0x08);
        assertEq(uint8(v), uint8(ICerebrAgent.Verdict.NoGo));
        _next(300);
        vm.warp(DAY0 + 14 hours);
        vm.fee(80_000_000); // spike and not calm: active + rested - spike = 1
        (, v) = agent.act();
        assertEq(agent.latestDecision().inputs, 0x02 | 0x04 | 0x08);
        assertEq(uint8(v), uint8(ICerebrAgent.Verdict.NoGo));
    }

    // ------------------------------------------------------------ EMA

    function test_ema_convergesExactly() public {
        vm.fee(100_000_000);
        for (uint256 i; i < 250; ++i) {
            agent.act();
            _next(300);
        }
        assertEq(agent.ema(), 100_000_000);
        vm.fee(1);
        for (uint256 i; i < 200; ++i) {
            agent.act();
            _next(300);
        }
        assertEq(agent.ema(), 1);
    }

    function test_ema_firstStep() public {
        vm.fee(28_000_000);
        agent.act();
        assertEq(agent.ema(), FLAT + 1_000_000); // 20M + ceil(8M / 8)
        assertEq(agent.latestDecision().ema, FLAT); // the decision used the EMA from before
        _next(300);
        vm.fee(1_000_000);
        agent.act();
        assertEq(agent.ema(), 21_000_000 - 2_500_000); // 21M - ceil(20M / 8)
    }

    function testFuzz_ema_staysBetween(uint64 e0, uint64 bf) public {
        vm.fee(e0);
        CerebrAgent a = new CerebrAgent(IAgentCircuits(address(circuits)), ID, IAgentOpener(address(0)), cfg());
        vm.fee(bf);
        a.act();
        uint256 lo = e0 < bf ? e0 : bf;
        uint256 hi = e0 < bf ? bf : e0;
        if (e0 == 0) lo = hi = bf; // seeded from the first basefee
        uint256 e = a.ema();
        assertGe(e, lo);
        assertLe(e, hi);
        if (e0 != bf && e0 != 0) assertTrue(e != e0); // always moves toward bf
    }

    // ------------------------------------------------------------ ring buffer and paging

    function test_ring_wrapsAndPages() public {
        for (uint256 i; i < 70; ++i) {
            vm.prank(address(uint160(1000 + i)));
            agent.act();
            _next(300);
        }
        assertEq(agent.stats().decisions, 70);
        ICerebrAgent.Record[] memory all = agent.decisions(0, 1000);
        assertEq(all.length, 64);
        assertEq(all[0].seq, 7); // 1..6 were overwritten
        assertEq(all[63].seq, 70);
        for (uint256 i; i < 64; ++i) {
            assertEq(all[i].seq, 7 + i);
            assertEq(all[i].caller, address(uint160(1000 + 6 + i)));
        }
        ICerebrAgent.Record[] memory page = agent.decisions(60, 5);
        assertEq(page.length, 5);
        assertEq(page[0].seq, 60);
        assertEq(page[4].seq, 64);
        page = agent.decisions(68, 10);
        assertEq(page.length, 3);
        assertEq(page[2].seq, 70);
        assertEq(agent.decisions(71, 10).length, 0);
        assertEq(agent.decisions(10, 0).length, 0);
        assertEq(agent.decisions(3, 2)[0].seq, 7); // raised to the oldest stored
        assertEq(agent.latestDecision().seq, 70);
    }

    function testFuzz_decisionsPaging(uint8 n, uint16 from, uint16 count) public {
        n = uint8(bound(n, 0, 100));
        for (uint256 i; i < n; ++i) {
            agent.act();
            _next(300);
        }
        ICerebrAgent.Record[] memory page = agent.decisions(from, count);
        uint256 oldest = n > 64 ? n - 63 : 1;
        uint256 start = from < oldest ? oldest : from;
        uint256 expected = (n == 0 || start > n || count == 0) ? 0 : n - start + 1;
        if (expected > count) expected = count;
        assertEq(page.length, expected);
        for (uint256 i; i < page.length; ++i) {
            assertEq(page[i].seq, start + i);
        }
    }

    // ------------------------------------------------------------ brain wallet

    function test_brainWallet_attribution() public {
        vm.prank(owner);
        brain.execute(address(agent), 0, abi.encodeCall(CerebrAgent.act, ()), 0);
        ICerebrAgent.Record memory r = agent.latestDecision();
        assertTrue(r.viaBrainWallet);
        assertEq(r.caller, address(brain));
        assertEq(agent.stats().brainWalletCount, 1);

        _next(300);
        vm.prank(owner); // the owner acting directly is not the neuron's own wallet
        agent.act();
        assertFalse(agent.latestDecision().viaBrainWallet);

        _next(300);
        MockBrainAccount other = new MockBrainAccount(owner); // another circuit's account
        vm.prank(owner);
        other.execute(address(agent), 0, abi.encodeCall(CerebrAgent.act, ()), 0);
        assertFalse(agent.latestDecision().viaBrainWallet);
        assertEq(agent.stats().brainWalletCount, 1);
    }

    function test_brainWallet_isRateLimitedToo() public {
        agent.act();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ICerebrAgent.TooSoon.selector, block.number + 300));
        brain.execute(address(agent), 0, abi.encodeCall(CerebrAgent.act, ()), 0);
    }

    // ------------------------------------------------------------ misbehaving circuit

    function test_misbehavingCircuit_abstainsNeverBricks() public {
        MockAgentCircuits.Mode[8] memory modes = [
            MockAgentCircuits.Mode.DirtyPadding,
            MockAgentCircuits.Mode.Revert,
            MockAgentCircuits.Mode.BurnGas,
            MockAgentCircuits.Mode.WrongLength,
            MockAgentCircuits.Mode.BadOutput,
            MockAgentCircuits.Mode.BadOffset,
            MockAgentCircuits.Mode.ShortReturn,
            MockAgentCircuits.Mode.ReturnBomb
        ];
        ICerebrAgent.Fallback[8] memory reasons = [
            ICerebrAgent.Fallback.BadReturn,
            ICerebrAgent.Fallback.CallFailed,
            ICerebrAgent.Fallback.CallFailed,
            ICerebrAgent.Fallback.BadReturn,
            ICerebrAgent.Fallback.BadOutput,
            ICerebrAgent.Fallback.BadReturn,
            ICerebrAgent.Fallback.BadReturn,
            ICerebrAgent.Fallback.BadReturn
        ];
        for (uint256 i; i < modes.length; ++i) {
            circuits.setMode(modes[i]);
            ICerebrAgent.Observation memory o = agent.observe();
            assertEq(uint8(o.verdict), uint8(ICerebrAgent.Verdict.Abstain));
            assertEq(uint8(o.reason), uint8(reasons[i]));
            uint256 g0 = gasleft();
            (, ICerebrAgent.Verdict v) = agent.act();
            assertLt(g0 - gasleft(), 1_300_000, "gas bounded");
            assertEq(uint8(v), uint8(ICerebrAgent.Verdict.Abstain));
            ICerebrAgent.Record memory r = agent.latestDecision();
            assertEq(uint8(r.reason), uint8(reasons[i]), vm.toString(i));
            assertEq(r.outputs, 0);
            assertEq(agent.lastGoBlock(), 0); // an abstain never counts as Go
            (uint8 out, bool matches) = agent.replay(r.seq);
            assertEq(out, 0);
            assertTrue(matches);
            _next(300);
        }
        assertEq(agent.stats().abstainCount, 8);
        circuits.setMode(MockAgentCircuits.Mode.Neuron); // recovers
        (, ICerebrAgent.Verdict v2) = agent.act();
        assertEq(uint8(v2), uint8(ICerebrAgent.Verdict.Go));
    }

    function test_replay_detectsChangedCircuit() public {
        circuits.setMode(MockAgentCircuits.Mode.Constant1);
        _next(1);
        // inputs with the neuron's answer 0: outside window, recently went (refractory)
        vm.warp(DAY0 + 2 hours);
        agent.act();
        _next(300);
        agent.act(); // refractory: 1 + 0 + 0 - 0 - 1 = 0 for the neuron, but Constant1 says Go
        uint256 seq = agent.latestDecision().seq;
        (uint8 out, bool matches) = agent.replay(seq);
        assertTrue(matches);
        assertEq(out, 1);
        circuits.setMode(MockAgentCircuits.Mode.Neuron);
        (out, matches) = agent.replay(seq);
        assertEq(out, 0);
        assertFalse(matches);
        (, matches) = agent.replay(0);
        assertFalse(matches);
        (, matches) = agent.replay(99);
        assertFalse(matches);
    }

    // ------------------------------------------------------------ fuzz: observe == act == reference neuron

    function testFuzz_actMatchesObserveAndReference(uint64 bf, uint32 hourSec, uint16 sinceGo, bool wentBefore)
        public
    {
        vm.warp(DAY0 + 1 days + uint256(hourSec) % 1 days);
        if (wentBefore) {
            agent.act(); // a Go at the start (calm, active-or-rested)
            vm.roll(block.number + 300 + uint256(sinceGo));
        }
        vm.fee(bf);
        ICerebrAgent.Observation memory o = agent.observe();
        ICerebrAgent.Observation memory o2 = agent.observeAt(bf);
        assertEq(o.inputs, o2.inputs);
        uint8 expected = agent.deriveInputs(
            bf > type(uint64).max ? type(uint64).max : bf, o.ema, block.timestamp, block.number, agent.lastGoBlock()
        );
        assertEq(o.inputs, expected);
        (uint256 seq, ICerebrAgent.Verdict v) = agent.act();
        ICerebrAgent.Record memory r = agent.latestDecision();
        assertEq(r.seq, seq);
        assertEq(r.inputs, o.inputs);
        assertEq(uint8(v), uint8(o.verdict));
        assertEq(r.outputs, GoNoGo.fire(r.inputs));
        assertEq(uint8(v), r.outputs); // Go == 1, NoGo == 0
        (, bool matches) = agent.replay(seq);
        assertTrue(matches);
    }

    function test_referenceNeuron_truthTable() public view {
        // the mock and the reference agree with the onchain #8 samples (0->0, 3->1, 7->1, 15->1, 23->1, 31->0)
        uint8[6] memory x = [0, 3, 7, 15, 23, 31];
        uint8[6] memory y = [0, 1, 1, 1, 1, 0];
        for (uint256 i; i < 6; ++i) {
            assertEq(GoNoGo.fire(x[i]), y[i]);
            bytes memory input = new bytes(1);
            input[0] = bytes1(x[i]);
            assertEq(circuits.eval(ID, input)[0], bytes1(y[i]));
        }
    }

    function test_noValueAccepted() public {
        (bool ok,) = address(agent).call{value: 1}(abi.encodeCall(CerebrAgent.act, ()));
        assertFalse(ok);
        (ok,) = address(agent).call{value: 1}("");
        assertFalse(ok);
    }

    function test_gas_act() public {
        uint256 g0 = gasleft();
        agent.act();
        uint256 first = g0 - gasleft();
        for (uint256 i; i < 64; ++i) {
            _next(300);
            agent.act();
        }
        _next(300);
        g0 = gasleft();
        agent.act();
        uint256 wrapped = g0 - gasleft();
        emit log_named_uint("act gas (first, mock circuit)", first);
        emit log_named_uint("act gas (ring wrapped, mock circuit)", wrapped);
        assertLt(wrapped, first);
    }
}
