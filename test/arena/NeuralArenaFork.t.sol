// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {NeuralArena} from "../../src/arena/NeuralArena.sol";
import {INeuralArena} from "../../src/arena/INeuralArena.sol";
import {IArenaCircuits} from "../../src/arena/IArenaCircuits.sol";
import {ITapeOutCircuits, ITapeOutFactory, ITapeOutTransistors} from "../../src/scope/ITapeOut.sol";
import {ArenaPolicy} from "./ArenaMocks.sol";
import {ArenaBotNetlist} from "./ArenaBotNetlist.sol";

/// @notice Fork tests against the real TapeOut contracts and the real Cerebr processor on X Layer.
///         Start a fork first:
///           anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8603 --silent
///         Then:  ARENA_FORK_RPC=http://127.0.0.1:8603 forge test --match-path 'test/arena/*' -vv
///         Without ARENA_FORK_RPC the suite is skipped. Nothing is broadcast: every tapeout and game
///         happens inside the forked EVM only.
contract NeuralArenaForkTest is Test {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    ITapeOutCircuits constant CEREBR = ITapeOutCircuits(0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF);
    ITapeOutTransistors constant CEREBR_T = ITapeOutTransistors(0x84b5a5c6fE305319458113b87c09a2A241427D2D);
    address constant CREATOR = 0xc742AdA2872a042dD36D2E706907b4036968960C;

    NeuralArena arena;
    uint256 botId;
    address author; // who taped the bot out on this fork (the creator wallet when it has the NAND)
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        string memory rpc = vm.envOr("ARENA_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        // Rehearse the mainnet plan exactly: the creator wallet tapes the bot out on the Cerebr processor.
        botId = _creatorTapeout();
        arena = new NeuralArena(IArenaCircuits(address(CEREBR)), botId);
    }

    /// @dev The creator path is the mainnet rehearsal. If this fork already holds the creator's tapeout
    ///      (or the plan was executed on mainnet), a fresh wallet mints the NAND instead.
    function _creatorTapeout() internal returns (uint256 id) {
        author = CREATOR;
        if (CEREBR_T.balanceOf(CREATOR, 0) < ArenaBotNetlist.NAND_COUNT) {
            author = makeAddr("author");
            vm.deal(author, 1 ether);
            uint256 value = ArenaBotNetlist.NAND_COUNT * CEREBR_T.mintPrice() + CEREBR_T.protocolFee();
            vm.prank(author); // (fees are read first: a prank applies to the next call only)
            CEREBR_T.mint{value: value}(0, ArenaBotNetlist.NAND_COUNT);
        }
        uint256 nandBefore = CEREBR_T.balanceOf(author, 0);
        uint256 fee = CEREBR.TAPEOUT_FEE();
        vm.prank(author);
        id = CEREBR.tapeout{value: fee}(ArenaBotNetlist.NETLIST, ArenaBotNetlist.N_IN, ArenaBotNetlist.N_OUT);
        assertEq(CEREBR_T.balanceOf(author, 0), nandBefore - ArenaBotNetlist.NAND_COUNT);
    }

    // ------------------------------------------------------------ the taped-out circuit

    function test_fork_tapeoutAndCircuitInfo() public view {
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = CEREBR.circuitInfo(botId);
        assertEq(nIn, 18);
        assertEq(nOut, 9);
        assertEq(nState, 0);
        assertEq(gates, ArenaBotNetlist.NAND_COUNT);
        assertEq(CEREBR.netlist(botId), ArenaBotNetlist.NETLIST);
        assertEq(CEREBR.ownerOf(botId), author);
        console2.log("bot circuit id on fork", botId);
        console2.log("taped out by          ", author);
        console2.log("author NAND left      ", CEREBR_T.balanceOf(author, 0));
    }

    function test_fork_gasReport() public {
        // tapeout gas (a second copy, from the creator's remaining NAND would not fit; use a fresh minter)
        address m = makeAddr("minter");
        vm.deal(m, 1 ether);
        vm.startPrank(m);
        CEREBR_T.mint{value: ArenaBotNetlist.NAND_COUNT * CEREBR_T.mintPrice() + CEREBR_T.protocolFee()}(
            0, ArenaBotNetlist.NAND_COUNT
        );
        uint256 fee = CEREBR.TAPEOUT_FEE();
        uint256 g = gasleft();
        CEREBR.tapeout{value: fee}(ArenaBotNetlist.NETLIST, 18, 9);
        console2.log("tapeout gas (590 NAND)", g - gasleft());
        vm.stopPrank();

        g = gasleft();
        CEREBR.eval(botId, hex"020000");
        console2.log("eval gas (external view call)", g - gasleft());

        g = gasleft();
        new NeuralArena(IArenaCircuits(address(CEREBR)), botId);
        console2.log("arena deploy gas", g - gasleft());

        vm.startPrank(alice);
        g = gasleft();
        uint256 id = arena.newGame();
        console2.log("newGame gas (first)", g - gasleft());
        g = gasleft();
        arena.play(id, 0);
        console2.log("play gas (move 1 + inference)", g - gasleft());
        g = gasleft();
        arena.play(id, 8);
        console2.log("play gas (move 2 + inference)", g - gasleft());
        vm.stopPrank();
    }

    function testFuzz_fork_evalMatchesPolicy(uint256 seed) public view {
        uint16 bot;
        uint16 human;
        for (uint256 i; i < 9; ++i) {
            uint256 v = (seed >> (2 * i)) % 3;
            if (v == 1) bot |= uint16(1 << i);
            else if (v == 2) human |= uint16(1 << i);
        }
        assertEq(CEREBR.eval(botId, arena.encodeBoard(bot, human)), ArenaPolicy.oneHot(ArenaPolicy.move(bot, human)));
    }

    // ------------------------------------------------------------ games

    function test_fork_fullGames() public {
        // H0 B4 H1 B2 H3 B6: bot wins
        vm.startPrank(alice);
        uint256 a = arena.newGame();
        arena.play(a, 0);
        arena.play(a, 1);
        arena.play(a, 3);
        assertEq(uint8(arena.gameState(a).status), uint8(INeuralArena.Status.BotWon));
        uint8[9] memory b = arena.board(a);
        assertEq(b[4] + b[2] + b[6], 3); // bot on the anti-diagonal
        // opposite corners: H0 B4 H8 B1 H7 B6 H2 B5 H3: draw
        uint256 d = arena.newGame();
        uint8[5] memory h = [0, 8, 7, 2, 3];
        for (uint256 i; i < 5; ++i) {
            arena.play(d, h[i]);
        }
        assertEq(uint8(arena.gameState(d).status), uint8(INeuralArena.Status.Draw));
        vm.expectRevert(INeuralArena.GameNotActive.selector);
        arena.play(d, 0);
        vm.stopPrank();

        INeuralArena.Stats memory s = arena.stats();
        assertEq(s.games, 2);
        assertEq(s.botWins, 1);
        assertEq(s.draws, 1);
        assertEq(s.humanWins, 0);
        assertEq(arena.fallbackCount(), 0);
    }

    function test_fork_invalidMoves() public {
        vm.prank(alice);
        uint256 id = arena.newGame();
        vm.prank(bob);
        vm.expectRevert(INeuralArena.NotPlayer.selector);
        arena.play(id, 0);
        vm.startPrank(alice);
        vm.expectRevert(INeuralArena.InvalidCell.selector);
        arena.play(id, 9);
        arena.play(id, 0);
        vm.expectRevert(INeuralArena.CellOccupied.selector);
        arena.play(id, 4); // the bot's centre
        vm.expectRevert(INeuralArena.UnknownGame.selector);
        arena.play(id + 1, 0);
        vm.expectRevert(INeuralArena.InsufficientGasForInference.selector);
        arena.play{gas: 1_500_000}(id, 1);
        vm.stopPrank();
    }

    /// @notice Every human strategy against the real taped-out circuit through the contract.
    function test_fork_exhaustiveGameTree() public {
        vm.pauseGasMetering();
        vm.prank(alice);
        uint256 id = arena.newGame();
        (uint256 games, uint256 botWins, uint256 draws) = _explore(id);
        console2.log("games / bot wins / draws", games, botWins, draws);
        assertEq(games, 457);
        assertEq(botWins, 346);
        assertEq(draws, 111);
        assertEq(arena.stats().humanWins, 0);
        assertEq(arena.fallbackCount(), 0);
    }

    function _explore(uint256 id) internal returns (uint256 games, uint256 botWins, uint256 draws) {
        for (uint8 c; c < 9; ++c) {
            if (arena.board(id)[c] != 0) continue;
            uint256 snap = vm.snapshotState();
            vm.prank(alice);
            arena.play(id, c);
            INeuralArena.Game memory g = arena.gameState(id);
            assertEq(g.human & g.bot, 0);
            if (g.status == INeuralArena.Status.Active) {
                (uint256 x, uint256 y, uint256 z) = _explore(id);
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

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_fork_randomGamesNeverBrick(uint256 seed) public {
        vm.startPrank(alice);
        uint256 id = arena.newGame();
        for (uint256 turn; turn < 5; ++turn) {
            INeuralArena.Game memory g = arena.gameState(id);
            if (g.status != INeuralArena.Status.Active) break;
            uint8 c = uint8(uint256(keccak256(abi.encode(seed, turn))) % 9);
            while ((g.human | g.bot) & (uint16(1) << c) != 0) c = (c + 1) % 9;
            arena.play(id, c);
            g = arena.gameState(id);
            assertEq(g.human & g.bot, 0, "bot played an occupied cell");
        }
        vm.stopPrank();
        INeuralArena.Game memory end = arena.gameState(id);
        assertTrue(end.status != INeuralArena.Status.Active);
        assertTrue(end.status != INeuralArena.Status.HumanWon);
        assertEq(arena.fallbackCount(), 0);
    }

    // ------------------------------------------------------------ a fresh CPU through the factory

    function test_fork_freshCpu_mintTapeoutPlay() public {
        vm.deal(bob, 1 ether);
        vm.startPrank(bob);
        (address t, address c) = FACTORY.createCPU{value: FACTORY.deployFee()}(
            "Arena", "ARN", "Neural Arena test CPU", 100_000, 0.00001 ether
        );
        ITapeOutTransistors tr = ITapeOutTransistors(t);
        tr.mint{value: ArenaBotNetlist.NAND_COUNT * tr.mintPrice() + tr.protocolFee()}(0, ArenaBotNetlist.NAND_COUNT);
        uint256 id = ITapeOutCircuits(c).tapeout{value: ITapeOutCircuits(c).TAPEOUT_FEE()}(
            ArenaBotNetlist.NETLIST, ArenaBotNetlist.N_IN, ArenaBotNetlist.N_OUT
        );
        assertEq(tr.balanceOf(bob, 0), 0);
        NeuralArena a2 = new NeuralArena(IArenaCircuits(c), id);
        uint256 g = a2.newGame();
        a2.play(g, 4); // human centre
        assertEq(a2.board(g)[0], 1); // bot answers with a corner
        vm.stopPrank();
    }

    function test_fork_rejectsWrongCircuit() public {
        // circuit #1 on Cerebr is the 2-input AND neuron: wrong pins
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(IArenaCircuits(address(CEREBR)), 1);
        vm.expectRevert(INeuralArena.BadCircuit.selector);
        new NeuralArena(IArenaCircuits(address(CEREBR)), 10_000);
    }
}
