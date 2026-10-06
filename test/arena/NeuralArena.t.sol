// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {NeuralArena} from "../../src/arena/NeuralArena.sol";
import {INeuralArena} from "../../src/arena/INeuralArena.sol";
import {IArenaCircuits} from "../../src/arena/IArenaCircuits.sol";
import {ArenaPolicy, MockNandCircuits, MockPolicyCircuits} from "./ArenaMocks.sol";
import {ArenaBotNetlist} from "./ArenaBotNetlist.sol";

/// @notice Unit tests (no fork). The arena runs against (a) a mock whose eval is the reference policy,
///         (b) a mock that executes the real taped-out NAND netlist, and (c) misbehaving circuits.
contract NeuralArenaTest is Test {
    event Moved(uint256 indexed gameId, address indexed player, uint8 cell, bool isBot);
    event BotFallback(uint256 indexed gameId, uint8 cell, INeuralArena.Fallback reason);
    event GameOver(uint256 indexed gameId, address indexed player, INeuralArena.Status result);
    event GameStarted(uint256 indexed gameId, address indexed player);

    MockPolicyCircuits policy;
    MockNandCircuits nand;
    NeuralArena arena; // on the policy mock
    NeuralArena nandArena; // on the real netlist
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        policy = new MockPolicyCircuits();
        nand = new MockNandCircuits(ArenaBotNetlist.NETLIST, ArenaBotNetlist.N_IN, ArenaBotNetlist.N_OUT);
        arena = new NeuralArena(policy, 1);
        nandArena = new NeuralArena(nand, 1);
    }

    // ------------------------------------------------------------ construction

    function test_constructorValidatesCircuit() public {
        MockPolicyCircuits m = new MockPolicyCircuits();
        m.setInfo(18, 8, 0, 590);
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(m, 1);
        m.setInfo(17, 9, 0, 590);
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(m, 1);
        m.setInfo(18, 9, 1, 590); // sequential
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(m, 1);
        m.setInfo(18, 9, 0, 1001); // over the gas bound
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(m, 1);
        m.setInfo(18, 9, 0, 590);
        vm.expectRevert(INeuralArena.BadCircuit.selector); // unknown id: circuitInfo reverts
        new NeuralArena(m, 2);
        vm.expectRevert(INeuralArena.BadCircuit.selector); // no code
        new NeuralArena(IArenaCircuits(address(0xdead)), 1);
        m.setMode(MockPolicyCircuits.Mode.MultiHot); // right pins, wrong behaviour
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(m, 1);
        m.setMode(MockPolicyCircuits.Mode.Policy);
        NeuralArena ok = new NeuralArena(m, 1);
        assertEq(address(ok.circuits()), address(m));
        assertEq(ok.botCircuitId(), 1);
    }

    // ------------------------------------------------------------ game flow

    function test_newGameAndBotReply() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit GameStarted(1, alice);
        uint256 id = arena.newGame();
        assertEq(id, 1);
        INeuralArena.Game memory g = arena.gameState(id);
        assertEq(g.player, alice);
        assertEq(uint8(g.status), uint8(INeuralArena.Status.Active));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit Moved(id, alice, 0, false);
        vm.expectEmit(true, true, false, true);
        emit Moved(id, alice, 4, true); // the bot takes the centre
        arena.play(id, 0);
        uint8[9] memory b = arena.board(id);
        assertEq(b[0], 2);
        assertEq(b[4], 1);
        assertEq(arena.gameState(id).moves, 2);
        assertEq(arena.stats().games, 1);
        assertEq(arena.playerStats(alice).games, 1);
    }

    function test_inferenceReceiptIsReplayable() public {
        vm.prank(alice);
        uint256 id = arena.newGame();
        vm.recordLogs();
        vm.prank(alice);
        arena.play(id, 0);
        bytes32 topic = keccak256("InferenceReceipt(uint256,address,uint256,bytes,bytes,uint256,uint8)");
        VmSafe.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != topic) continue;
            found = true;
            assertEq(uint256(logs[i].topics[1]), id);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(policy));
            assertEq(uint256(logs[i].topics[3]), 1);
            (bytes memory input, bytes memory output, uint256 gasUsed, INeuralArena.Fallback reason) =
                abi.decode(logs[i].data, (bytes, bytes, uint256, INeuralArena.Fallback));
            assertEq(input, hex"020000"); // human on cell 0 -> bit 1
            assertEq(output, policy.eval(1, input)); // anyone can replay the inference
            assertEq(output, hex"1000"); // cell 4
            assertGt(gasUsed, 0);
            assertEq(uint8(reason), 0);
        }
        assertTrue(found);
    }

    function test_botWinsAndStats() public {
        // H0 B4 H1 B2 (blocks 0-1-2, threatens 2-4-6) H3 B6 wins on the anti-diagonal
        uint8[3] memory human = [0, 1, 3];
        uint8[3] memory bot = [4, 2, 6];
        _playScript(nandArena, alice, human, bot);
        uint256 id = nandArena.gameCount();
        assertEq(uint8(nandArena.gameState(id).status), uint8(INeuralArena.Status.BotWon));
        INeuralArena.Stats memory s = nandArena.stats();
        assertEq(s.games, 1);
        assertEq(s.botWins, 1);
        assertEq(s.humanWins + s.draws, 0);
        assertEq(nandArena.playerStats(alice).botWins, 1);
        assertEq(nandArena.playerStats(bob).games, 0);
    }

    function test_drawLine() public {
        // Opposite corners: H0 B4 H8 B1 (an edge threat, never a corner) H7 B6 H2 B5 H3 -> draw
        vm.startPrank(alice);
        uint256 id = nandArena.newGame();
        uint8[5] memory human = [0, 8, 7, 2, 3];
        uint8[4] memory bot = [4, 1, 6, 5];
        for (uint256 i; i < 5; ++i) {
            nandArena.play(id, human[i]);
            if (i < 4) assertEq(nandArena.board(id)[bot[i]], 1);
        }
        vm.stopPrank();
        assertEq(uint8(nandArena.gameState(id).status), uint8(INeuralArena.Status.Draw));
        assertEq(nandArena.gameState(id).moves, 9);
        assertEq(nandArena.stats().draws, 1);
    }

    function _playScript(NeuralArena a, address who, uint8[3] memory human, uint8[3] memory bot) internal {
        vm.startPrank(who);
        uint256 id = a.newGame();
        for (uint256 i; i < 3; ++i) {
            vm.expectEmit(true, true, false, true);
            emit Moved(id, who, bot[i], true);
            a.play(id, human[i]);
        }
        vm.stopPrank();
    }

    function test_reverts() public {
        vm.prank(alice);
        uint256 id = arena.newGame();
        vm.expectRevert(INeuralArena.UnknownGame.selector);
        arena.play(99, 0);
        vm.expectRevert(INeuralArena.UnknownGame.selector);
        arena.board(99);
        vm.prank(bob);
        vm.expectRevert(INeuralArena.NotPlayer.selector);
        arena.play(id, 0);
        vm.startPrank(alice);
        vm.expectRevert(INeuralArena.InvalidCell.selector);
        arena.play(id, 9);
        arena.play(id, 0); // bot 4
        vm.expectRevert(INeuralArena.CellOccupied.selector);
        arena.play(id, 0);
        vm.expectRevert(INeuralArena.CellOccupied.selector);
        arena.play(id, 4);
        vm.stopPrank();
        _playOut(arena, alice, id);
        vm.prank(alice);
        vm.expectRevert(INeuralArena.GameNotActive.selector);
        arena.play(id, 0);
    }

    function test_lowGasCannotForceFallback() public {
        vm.prank(alice);
        uint256 id = arena.newGame();
        vm.prank(alice);
        vm.expectRevert(INeuralArena.InsufficientGasForInference.selector);
        arena.play{gas: 2_000_000}(id, 0);
        assertEq(arena.gameState(id).moves, 0);
        assertEq(arena.fallbackCount(), 0);
    }

    // ------------------------------------------------------------ misbehaving circuits never brick a game

    function test_fallbacks() public {
        _checkFallback(MockPolicyCircuits.Mode.Revert, INeuralArena.Fallback.CallFailed);
        _checkFallback(MockPolicyCircuits.Mode.Burn, INeuralArena.Fallback.CallFailed);
        _checkFallback(MockPolicyCircuits.Mode.Empty, INeuralArena.Fallback.BadReturn);
        _checkFallback(MockPolicyCircuits.Mode.Long, INeuralArena.Fallback.BadReturn);
        _checkFallback(MockPolicyCircuits.Mode.RawGarbage, INeuralArena.Fallback.BadReturn);
        _checkFallback(MockPolicyCircuits.Mode.ReturnBomb, INeuralArena.Fallback.BadReturn);
        _checkFallback(MockPolicyCircuits.Mode.BadOffset, INeuralArena.Fallback.BadReturn);
        _checkFallback(MockPolicyCircuits.Mode.MultiHot, INeuralArena.Fallback.NotOneHot);
        _checkFallback(MockPolicyCircuits.Mode.Zero, INeuralArena.Fallback.NotOneHot);
        _checkFallback(MockPolicyCircuits.Mode.Padding, INeuralArena.Fallback.NotOneHot);
        _checkFallback(MockPolicyCircuits.Mode.Occupied, INeuralArena.Fallback.Occupied);
    }

    function _checkFallback(MockPolicyCircuits.Mode mode, INeuralArena.Fallback reason) internal {
        MockPolicyCircuits m = new MockPolicyCircuits();
        NeuralArena a = new NeuralArena(m, 1);
        m.setMode(mode);
        vm.startPrank(alice);
        uint256 id = a.newGame();
        vm.expectEmit(true, false, false, true);
        emit BotFallback(id, 4, reason); // first empty cell in centre-corner-edge order
        a.play(id, 0);
        // a whole game is still playable: the bot keeps falling back, the game ends normally
        for (uint8 c = 1; c < 9 && a.gameState(id).status == INeuralArena.Status.Active; ++c) {
            if (a.board(id)[c] == 0) a.play(id, c);
        }
        vm.stopPrank();
        assertTrue(a.gameState(id).status != INeuralArena.Status.Active, "game finished");
        assertGt(a.fallbackCount(), 0);
    }

    function test_previewBotMove() public view {
        (uint8 cell, INeuralArena.Fallback r) = arena.previewBotMove(0, 0);
        assertEq(cell, 4);
        assertEq(uint8(r), 0);
        (cell,) = nandArena.previewBotMove(uint16(1 << 4) | uint16(1 << 0), uint16(1 << 1) | uint16(1 << 8));
        assertEq(cell, 2); // no win or block: safe threat 2-4-6 (the forced reply 6 is not a human fork cell)
    }

    // ------------------------------------------------------------ the real netlist vs the reference policy

    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_netlistMatchesPolicy(uint256 seed) public view {
        // random legal-looking position: each cell empty / bot / human, not full
        uint16 bot;
        uint16 human;
        for (uint256 i; i < 9; ++i) {
            uint256 v = (seed >> (2 * i)) % 3;
            if (v == 1) bot |= uint16(1 << i);
            else if (v == 2) human |= uint16(1 << i);
        }
        bytes memory input = arena.encodeBoard(bot, human);
        assertEq(nand.eval(1, input), ArenaPolicy.oneHot(ArenaPolicy.move(bot, human)));
    }

    /// @notice Every human strategy, through the contract and the real netlist: the human never wins,
    ///         the bot never plays an occupied cell and every position gets a non-fallback inference.
    function test_exhaustiveGameTree_realNetlist() public {
        vm.pauseGasMetering();
        vm.prank(alice);
        uint256 id = nandArena.newGame();
        (uint256 games, uint256 botWins, uint256 draws) = _explore(nandArena, id);
        assertEq(nandArena.stats().humanWins, 0);
        assertEq(nandArena.fallbackCount(), 0);
        emit log_named_uint("games", games);
        emit log_named_uint("bot wins", botWins);
        emit log_named_uint("draws", draws);
        assertEq(games, 457); // matches sdk/test/arena.test.ts (346 bot wins + 111 draws)
        assertEq(botWins, 346);
        assertEq(draws, 111);
    }

    function _explore(NeuralArena a, uint256 id) internal returns (uint256 games, uint256 botWins, uint256 draws) {
        for (uint8 c; c < 9; ++c) {
            if (a.board(id)[c] != 0) continue;
            uint256 snap = vm.snapshotState();
            uint16 occBefore = _occ(a, id);
            vm.prank(alice);
            a.play(id, c);
            INeuralArena.Game memory g = a.gameState(id);
            // the bot never plays over an existing piece and always adds exactly one
            assertEq(g.human & g.bot, 0);
            assertEq((occBefore & ~(g.human | g.bot)), 0);
            if (g.status == INeuralArena.Status.Active) {
                (uint256 x, uint256 y, uint256 z) = _explore(a, id);
                (games, botWins, draws) = (games + x, botWins + y, draws + z);
            } else {
                assertTrue(g.status != INeuralArena.Status.HumanWon, "human won");
                games++;
                if (g.status == INeuralArena.Status.BotWon) botWins++;
                else draws++;
            }
            vm.revertToState(snap);
        }
    }

    // ------------------------------------------------------------ fuzz: random play never bricks

    /// forge-config: default.fuzz.runs = 500
    function testFuzz_randomGamesNeverBrick(uint256 seed) public {
        vm.startPrank(alice);
        uint256 id = nandArena.newGame();
        for (uint256 turn; turn < 5; ++turn) {
            INeuralArena.Game memory g = nandArena.gameState(id);
            if (g.status != INeuralArena.Status.Active) break;
            uint8 c = uint8(uint256(keccak256(abi.encode(seed, turn))) % 9);
            while ((g.human | g.bot) & (uint16(1) << c) != 0) c = (c + 1) % 9;
            uint256 botBefore = g.bot;
            nandArena.play(id, c);
            g = nandArena.gameState(id);
            assertEq(g.human & g.bot, 0);
            if (g.status == INeuralArena.Status.Active) {
                assertEq(ArenaPolicy.popcount(g.bot), ArenaPolicy.popcount(uint16(botBefore)) + 1);
            }
        }
        vm.stopPrank();
        INeuralArena.Game memory end = nandArena.gameState(id);
        assertTrue(end.status != INeuralArena.Status.HumanWon);
        assertTrue(end.status != INeuralArena.Status.Active, "5 human moves always end the game");
        assertEq(nandArena.fallbackCount(), 0);
    }

    // ------------------------------------------------------------ helpers

    function _occ(NeuralArena a, uint256 id) internal view returns (uint16) {
        INeuralArena.Game memory g = a.gameState(id);
        return g.human | g.bot;
    }

    /// @dev Human plays the first empty cell until the game ends.
    function _playOut(NeuralArena a, address who, uint256 id) internal {
        vm.startPrank(who);
        while (a.gameState(id).status == INeuralArena.Status.Active) {
            uint8[9] memory b = a.board(id);
            uint8 c;
            while (b[c] != 0) ++c;
            a.play(id, c);
        }
        vm.stopPrank();
    }
}
