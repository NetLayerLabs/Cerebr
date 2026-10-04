// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {ERC6551Fixture} from "./helpers/ERC6551TestHelpers.sol";

/// @title On-chain auto-reveal queue (round-2 finding 2-6).
/// @dev Every tape-out / fusion settles up to AUTO_REVEAL_PER_MINT sealed Circuits from the head of a
///      FIFO queue (buys settle up to AUTO_REVEAL_PER_BUY, sells none). Ready ones are revealed,
///      expired ones re-commit, and the walk stops at the first sealed Circuit that is not ready.
contract CerebrAutoRevealTest is Test, ERC6551Fixture {
    CerebrProcessor internal p;
    CerebrCircuit internal c;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant BASIC = 5_000e18;
    uint256 internal K; // AUTO_REVEAL_PER_MINT
    uint256 internal SKIPS; // AUTO_REVEAL_MAX_SKIPS

    bytes32 internal constant REVEALED_SIG = keccak256("CircuitRevealed(uint256,uint8,uint256)");
    bytes32 internal constant RECOMMITTED_SIG = keccak256("Recommitted(uint256,uint256)");

    function setUp() public {
        p = new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, address(registry6551), address(accountImpl6551));
        c = p.CIRCUIT();
        K = c.AUTO_REVEAL_PER_MINT();
        SKIPS = c.AUTO_REVEAL_MAX_SKIPS();
        _buy(alice, 2_000_000e18);
    }

    // ================================================================ helpers

    function _buy(address who, uint256 amount) internal {
        uint256 q = p.quoteBuy(amount);
        vm.deal(who, who.balance + q);
        vm.prank(who);
        p.buyTransistors{value: q}(amount, q);
    }

    function _tape() internal returns (uint256 id) {
        vm.prank(alice);
        id = p.tapeOutCircuit();
    }

    function _tapeN(uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            _tape();
        }
    }

    function _revealed(uint256 id) internal view returns (bool r) {
        (, r,) = c.circuitInfo(id);
    }

    function _commit(uint256 id) internal view returns (uint256) {
        (,, uint64 cb) = c.circuitInfo(id);
        return cb;
    }

    function _expectedSeed(uint256 id) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(blockhash(_commit(id) + 1), id, block.chainid, address(c))));
    }

    function _countLogs(Vm.Log[] memory logs, bytes32 sig) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(c) && logs[i].topics[0] == sig) n++;
        }
    }

    // ================================================================ basics

    function test_ConstantsAndInitialHead() public view {
        assertEq(K, 2);
        assertEq(SKIPS, 4);
        assertEq(p.AUTO_REVEAL_PER_BUY(), 1);
        assertEq(c.revealQueueHead(), 1);
        assertEq(c.totalMinted(), 0);
    }

    function test_TapeOutRevealsPreviousReadyCircuit() public {
        uint256 a = _tape();
        assertFalse(_revealed(a));
        vm.roll(block.number + 2);
        uint256 seed = _expectedSeed(a);
        vm.expectEmit(address(c));
        emit CerebrCircuit.CircuitRevealed(a, Tier.Basic, seed);
        uint256 b = _tape();
        assertTrue(_revealed(a));
        assertEq(c.seedOf(a), seed);
        assertFalse(_revealed(b), "new Circuit can never be revealed in its own mint");
        assertEq(c.revealQueueHead(), b);
    }

    function test_NotReadyStopsQueue() public {
        uint256 a = _tape();
        vm.roll(block.number + 1); // hash of commitBlock + 1 is not available yet
        _tape();
        assertFalse(_revealed(a));
        assertEq(c.revealQueueHead(), a);
        vm.roll(block.number + 1);
        _tape();
        assertTrue(_revealed(a));
    }

    function test_FifoAtMostKPerMint() public {
        _tapeN(5); // ids 1..5, same block
        vm.roll(block.number + 2);
        vm.recordLogs();
        uint256 id6 = _tape();
        assertEq(_countLogs(vm.getRecordedLogs(), REVEALED_SIG), K);
        for (uint256 id = 1; id <= 5; ++id) {
            assertEq(_revealed(id), id <= K, "FIFO order");
        }
        assertEq(c.revealQueueHead(), K + 1);
        // Next mint takes the next K, still oldest first; id6 (this block's) stays sealed.
        _tape();
        for (uint256 id = 1; id <= 5; ++id) {
            assertEq(_revealed(id), id <= 2 * K);
        }
        assertFalse(_revealed(id6));
    }

    function test_StopsAtFirstNotReadyEvenIfLaterReady() public {
        // id1 old and ready; id2 minted in the previous block (not ready); nothing after id2 can be
        // older than id2 unless it re-committed, so stopping there skips no ready Circuit.
        uint256 a = _tape();
        vm.roll(block.number + 5);
        uint256 b = _tape(); // reveals a
        assertTrue(_revealed(a));
        vm.roll(block.number + 1);
        _tape();
        assertFalse(_revealed(b));
        assertEq(c.revealQueueHead(), b);
    }

    function test_FusionAutoRevealsReadyParents() public {
        uint256 a = _tape();
        uint256 b = _tape();
        vm.roll(block.number + 2);
        // Both parents are sealed but ready: the fusion's own queue step reveals them first.
        vm.prank(alice);
        uint256 child = p.fuseCircuits(a, b);
        assertTrue(_revealed(a) && _revealed(b));
        assertEq(c.fusedInto(a), child);
        assertFalse(_revealed(child));
        assertEq(c.revealQueueHead(), child);
    }

    function test_TapeOutTierAutoReveals() public {
        uint256 a = _tape();
        vm.roll(block.number + 2);
        vm.prank(alice);
        uint256 pro = p.tapeOutCircuitTier(Tier.Pro);
        assertTrue(_revealed(a));
        assertFalse(_revealed(pro));
    }

    function test_BuySettlesOneSellNone() public {
        _tapeN(3);
        vm.roll(block.number + 2);
        vm.prank(alice);
        p.sellTransistors(1e18, 0);
        assertFalse(_revealed(1), "sell must not touch the queue");
        _buy(bob, 1e18);
        assertTrue(_revealed(1));
        assertFalse(_revealed(2));
        assertEq(c.revealQueueHead(), 2);
    }

    function test_PausedMintsDoNothingManualRevealStillWorks() public {
        uint256 a = _tape();
        vm.roll(block.number + 2);
        vm.prank(owner);
        p.pause();
        vm.prank(alice);
        vm.expectRevert();
        p.tapeOutCircuit();
        assertFalse(_revealed(a));
        assertTrue(c.reveal(a)); // keeper backup
        assertEq(c.processRevealQueue(5), 0); // queue just steps over it
        assertEq(c.revealQueueHead(), 2);
    }

    // ================================================================ manual reveal interplay

    function test_ManualRevealIdempotentWithQueue() public {
        _tapeN(3);
        vm.roll(block.number + 2);
        uint256 seed2 = _expectedSeed(2);
        assertTrue(c.reveal(2)); // out of order, by a keeper
        _tape(); // settles 1 and 3, steps over 2
        assertTrue(_revealed(1) && _revealed(3));
        assertEq(c.seedOf(2), seed2, "queue never re-reveals");
        assertEq(c.revealQueueHead(), 4);
        // Manual reveal of a queue-revealed Circuit keeps reverting as before.
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyRevealed.selector, 1));
        c.reveal(1);
    }

    function test_SkipBudgetIsBounded() public {
        uint256 n = SKIPS + 2; // more manually revealed ids than one call may step over
        _tapeN(n + 1);
        vm.roll(block.number + 2);
        for (uint256 id = 1; id <= n; ++id) {
            c.reveal(id);
        }
        // steps = K + SKIPS = n: the call only steps over ids 1..n, so id n+1 waits one more call.
        _tape();
        assertFalse(_revealed(n + 1));
        assertEq(c.revealQueueHead(), n + 1);
        _tape();
        assertTrue(_revealed(n + 1));
    }

    // ================================================================ expiry

    function test_ExpiredRecommitsWithoutRevertingOuterAction() public {
        _tapeN(3);
        vm.roll(block.number + 300); // all three hashes expired
        vm.recordLogs();
        uint256 id4 = _tape();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countLogs(logs, RECOMMITTED_SIG), K);
        assertEq(_countLogs(logs, REVEALED_SIG), 0);
        assertEq(_commit(1), block.number);
        assertEq(_commit(2), block.number);
        assertEq(_commit(3) + 300, block.number);
        assertEq(c.revealQueueHead(), 1, "re-committed head stays at the head");
        assertEq(c.ownerOf(id4), alice);

        // Next block: head not ready yet -> queue stops (id3 expired but behind it).
        vm.roll(block.number + 1);
        _tape();
        assertFalse(_revealed(1));
        // Two blocks after the re-commit everything settles: 1 and 2 reveal; 3 re-commits next.
        vm.roll(block.number + 1);
        _tape();
        assertTrue(_revealed(1) && _revealed(2));
        assertEq(c.revealQueueHead(), 3);
        _tape();
        assertEq(_commit(3), block.number);
        vm.roll(block.number + 2);
        _tape();
        assertTrue(_revealed(3));
    }

    function test_RevealAfterRecommitBehindHead() public {
        // id1 expired; id2 minted later and still in its window: one call re-commits 1 and reveals 2.
        uint256 a = _tape();
        vm.roll(block.number + 1);
        uint256 b = _tape(); // a not ready yet: untouched
        vm.roll(_commit(a) + 258); // blockhash(a's target) just expired, b's is the oldest available
        _tape();
        assertFalse(_revealed(a));
        assertEq(_commit(a), block.number);
        assertTrue(_revealed(b), "ready Circuit behind a re-committed head is not skipped");
        assertEq(c.revealQueueHead(), a);
        vm.roll(block.number + 2);
        _tape();
        assertTrue(_revealed(a));
        assertEq(c.revealQueueHead(), b + 2); // a, b revealed; head at the mint before this one
    }

    function test_ZeroHashQuirkRecommitsInQueue() public {
        uint256 a = _tape();
        vm.roll(block.number + 2);
        vm.setBlockhash(_commit(a) + 1, bytes32(0));
        _tape();
        assertFalse(_revealed(a));
        assertEq(_commit(a), block.number);
        assertEq(c.seedOf(a), 0);
    }

    // ================================================================ permissionless entry point

    function test_ProcessRevealQueuePermissionless() public {
        assertEq(c.processRevealQueue(10), 0, "empty queue");
        _tapeN(4);
        assertEq(c.processRevealQueue(10), 0, "nothing ready");
        vm.roll(block.number + 2);
        vm.prank(bob);
        assertEq(c.processRevealQueue(3), 3);
        assertEq(c.revealQueueHead(), 4);
        assertEq(c.processRevealQueue(0), 0);
        assertEq(c.processRevealQueue(type(uint256).max), 1, "huge budget clamps, never overflows");
        assertEq(c.revealQueueHead(), 5);
        assertEq(c.processRevealQueue(type(uint256).max), 0);
    }

    function test_MintAndFuseStillOnlyProcessor() public {
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.mint(alice, Tier.Basic);
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.fuse(alice, 1, 2);
    }

    // ================================================================ gas

    /// Steady state: one ready Circuit per mint costs ~31k extra gas; the worst case is bounded.
    function test_GasOverheadBounded() public {
        _tapeN(2);
        vm.roll(block.number + 2);
        c.processRevealQueue(10); // empty queue
        uint256 g0 = gasleft();
        _tape();
        uint256 base = g0 - gasleft();

        // Worst case: SKIPS manually revealed ids, then K ready sealed ones.
        _tapeN(SKIPS + K);
        vm.roll(block.number + 2);
        for (uint256 i; i < SKIPS; ++i) {
            c.reveal(c.revealQueueHead() + i);
        }
        g0 = gasleft();
        _tape();
        uint256 worst = g0 - gasleft();
        assertEq(c.revealQueueHead(), c.totalMinted() - 1, "SKIPS skips + K settles, then the budget ends");
        // K reveals (~30k each, dominated by the fresh seedOf slot) + SKIPS cold reads.
        assertLt(worst - base, K * 33_000 + SKIPS * 3_000, "auto-reveal overhead unbounded");
    }

    // ================================================================ fuzz: reference model

    /// Random mints, block gaps, keeper reveals and queue pokes against an independent model of
    /// the FIFO queue. Checks the exact set of settled ids, re-commits and the head after each step.
    function testFuzz_QueueMatchesModel(uint8[24] memory ops, uint16[24] memory args) public {
        for (uint256 i; i < ops.length; ++i) {
            uint256 op = ops[i] % 6;
            uint256 arg = args[i];
            if (op == 0) {
                vm.roll(block.number + arg % 4);
            } else if (op == 1) {
                vm.roll(block.number + 1 + arg % 400); // sometimes past the 256-block window
            } else if (op == 2 && c.totalMinted() != 0) {
                uint256 id = 1 + arg % c.totalMinted();
                if (!_revealed(id) && block.number > _commit(id) + 1) c.reveal(id);
            } else if (op == 3) {
                _modelStep(arg % 4, 3); // permissionless poke
            } else if (op == 4) {
                _modelStep(p.AUTO_REVEAL_PER_BUY(), 1); // buy
            } else {
                _modelStep(K, 0); // tape-out
            }
        }
    }

    /// kind: 0 tape-out, 1 buy, 3 poke(k)
    function _modelStep(uint256 k, uint256 kind) internal {
        uint256 head = c.revealQueueHead();
        uint256 minted = c.totalMinted();
        // Snapshot.
        uint256 len = minted + 1 - head;
        bool[] memory rev = new bool[](len);
        uint256[] memory cb = new uint256[](len);
        for (uint256 j; j < len; ++j) {
            rev[j] = _revealed(head + j);
            cb[j] = _commit(head + j);
        }
        // Reference model: expected action per id (0 none, 1 reveal, 2 re-commit) and new head.
        uint8[] memory act = new uint8[](len);
        uint256 newHead = head;
        {
            uint256 budget = k < len ? k : len;
            uint256 steps = budget + SKIPS;
            uint256 settled;
            bool headMoves = true;
            for (uint256 j; j < len && settled < budget && steps > 0; ++j) {
                steps--;
                if (!rev[j]) {
                    if (block.number <= cb[j] + 1) break;
                    act[j] = blockhash(cb[j] + 1) == bytes32(0) ? 2 : 1;
                    settled++;
                    if (act[j] == 2) headMoves = false;
                }
                if (headMoves) newHead = head + j + 1;
            }
        }
        uint256[] memory seeds = new uint256[](len);
        for (uint256 j; j < len; ++j) {
            if (act[j] == 1) {
                seeds[j] = uint256(keccak256(abi.encode(blockhash(cb[j] + 1), head + j, block.chainid, c)));
            }
        }

        if (kind == 0) _tape();
        else if (kind == 1) _buy(bob, 1e18);
        else c.processRevealQueue(k);

        for (uint256 j; j < len; ++j) {
            uint256 id = head + j;
            if (act[j] == 1) {
                assertTrue(_revealed(id), "model: should reveal");
                assertEq(c.seedOf(id), seeds[j]);
            } else if (act[j] == 2) {
                assertFalse(_revealed(id));
                assertEq(_commit(id), block.number, "model: should re-commit");
            } else {
                assertEq(_revealed(id), rev[j], "model: untouched");
                assertEq(_commit(id), cb[j], "model: untouched commit");
            }
        }
        assertEq(c.revealQueueHead(), newHead, "model: head");
        for (uint256 id = 1; id < newHead; ++id) {
            assertTrue(_revealed(id), "below head must be revealed");
        }
    }

    // ================================================================ fuzz: liveness

    /// With ongoing activity (some buy, tape-out or fusion at least every 64 blocks, at most one mint
    /// per block) no Circuit ever expires: the queue reveals each within its 256-block window, so the
    /// owner can never force a re-roll and no keeper is needed.
    function testFuzz_NoExpiryUnderActivity(uint8[40] memory gaps, uint8[40] memory kinds) public {
        vm.recordLogs();
        for (uint256 i; i < gaps.length; ++i) {
            vm.roll(block.number + 1 + gaps[i] % 64);
            if (kinds[i] % 3 == 0) _buy(bob, 1e18);
            else _tape();
            _assertNoStaleSealed(2 * 64 + 2);
        }
        assertEq(_countLogs(vm.getRecordedLogs(), RECOMMITTED_SIG), 0, "a Circuit re-committed under activity");
    }

    function _assertNoStaleSealed(uint256 maxAge) internal view {
        uint256 n = c.totalMinted();
        for (uint256 id = c.revealQueueHead(); id <= n; ++id) {
            if (_revealed(id)) continue;
            assertLe(block.number, _commit(id) + maxAge, "sealed Circuit stayed ready too long");
        }
    }
}
