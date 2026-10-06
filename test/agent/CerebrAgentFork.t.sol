// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CerebrAgent} from "../../src/agent/CerebrAgent.sol";
import {IAgentCircuits, IAgentOpener, ICerebrAgent} from "../../src/agent/ICerebrAgent.sol";
import {ITapeOutCircuits, ITapeOutOpener} from "../../src/scope/ITapeOut.sol";
import {GoNoGo} from "./AgentMocks.sol";

interface ITapeOutAccount {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
    function owner() external view returns (address);
    function EXEC_FEE() external view returns (uint256);
}

/// @notice Fork tests against the real Cerebr processor and TapeOut opener on X Layer.
///         Start a fork first:
///           anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8605 --silent
///         Then:  AGENT_FORK_RPC=http://127.0.0.1:8605 forge test --match-path 'test/agent/*' -vv
///         Without AGENT_FORK_RPC the suite is skipped. Nothing is broadcast.
contract CerebrAgentForkTest is Test {
    ITapeOutCircuits constant CEREBR = ITapeOutCircuits(0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF);
    ITapeOutOpener constant OPENER = ITapeOutOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    address constant CREATOR = 0xc742AdA2872a042dD36D2E706907b4036968960C;
    uint256 constant POLICY = 8; // "Go/No-Go Neuron"
    uint256 constant XOR = 5; // its brain wallet is opened on mainnet
    bytes32 constant DECISION_SIG =
        keccak256("Decision(uint256,address,uint8,uint256,uint256,uint256,uint256,uint8,uint8,bool)");

    CerebrAgent agent;

    function _cfg() internal pure returns (ICerebrAgent.Config memory) {
        return ICerebrAgent.Config({
            calmMaxBasefee: 50_000_000,
            spikeBps: 15_000,
            windowStartHour: 13,
            windowEndHour: 21,
            restBlocks: 43_200,
            refractoryBlocks: 3_600,
            minIntervalBlocks: 300
        });
    }

    function setUp() public {
        string memory rpc = vm.envOr("AGENT_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        agent = new CerebrAgent(IAgentCircuits(address(CEREBR)), POLICY, IAgentOpener(address(OPENER)), _cfg());
    }

    function _next(uint256 blocks) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks);
    }

    function _setHour(uint256 h) internal {
        vm.warp(block.timestamp - (block.timestamp % 1 days) + 1 days + h * 1 hours);
    }

    function test_fork_policyCircuit() public view {
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = CEREBR.circuitInfo(POLICY);
        assertEq(nIn, 5);
        assertEq(nOut, 1);
        assertEq(nState, 0);
        assertEq(gates, 19);
        assertEq(CEREBR.ownerOf(POLICY), CREATOR);
        assertEq(agent.brainWallet(), OPENER.accountOf(address(CEREBR), POLICY));
        // the real circuit IS the reference neuron on all 32 inputs
        for (uint256 x; x < 32; ++x) {
            bytes memory input = new bytes(1);
            input[0] = bytes1(uint8(x));
            bytes memory out = CEREBR.eval(POLICY, input);
            assertEq(out.length, 1);
            assertEq(uint8(out[0]), GoNoGo.fire(uint8(x)), vm.toString(x));
        }
        console2.log("brain wallet of #8 ", agent.brainWallet());
        console2.log("opened             ", OPENER.isOpened(address(CEREBR), POLICY));
    }

    /// @dev Drives every pin with basefee / time / rest changes and replays each Decision through eval().
    function test_fork_drivenDecisionsReplayThroughEval() public {
        uint256[8] memory fees =
            [uint256(20_000_000), 20_000_000, 20_000_000, 45_000_000, 90_000_000, 20_000_000, 20_000_000, 20_000_000];
        uint256[8] memory hours_ = [uint256(14), 14, 15, 2, 14, 3, 16, 16];
        uint256[8] memory gaps = [uint256(0), 600, 3600, 600, 600, 43_200, 600, 600];
        vm.recordLogs();
        for (uint256 i; i < 8; ++i) {
            _next(gaps[i] == 0 ? 1 : gaps[i]);
            _setHour(hours_[i]);
            vm.fee(fees[i]);
            ICerebrAgent.Observation memory o = agent.observe();
            (, ICerebrAgent.Verdict v) = agent.act();
            assertEq(uint8(v), uint8(o.verdict));
            assertTrue(v != ICerebrAgent.Verdict.Abstain);
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        uint256 goes;
        uint8 inputsSeen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != DECISION_SIG) continue;
            (,,,, uint8 inputs, uint8 outputs,) =
                abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint8, uint8, bool));
            // replay: anyone can recompute the output with the circuit itself
            bytes memory input = new bytes(1);
            input[0] = bytes1(inputs);
            assertEq(uint8(CEREBR.eval(POLICY, input)[0]), outputs);
            assertEq(outputs, GoNoGo.fire(inputs));
            (uint8 replayed, bool matches) = agent.replay(uint256(logs[i].topics[1]));
            assertTrue(matches);
            assertEq(replayed, outputs);
            inputsSeen |= inputs;
            goes += outputs;
            seen++;
            console2.log("seq / inputs / go", uint256(logs[i].topics[1]), inputs, outputs);
        }
        assertEq(seen, 8);
        assertEq(inputsSeen, 31, "every pin fired at least once");
        assertGt(goes, 0);
        assertLt(goes, 8);
    }

    function test_fork_gas() public {
        vm.fee(20_000_000);
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
        uint256 steady = g0 - gasleft();
        console2.log("act execution gas, first decision   ", first);
        console2.log("act execution gas, ring wrapped     ", steady);
        console2.log("(add 21000 intrinsic + calldata for the tx gas)");
    }

    /// @dev Opens #8's brain wallet on the fork (anyone may pay 0.08 OKB) and has the circuit owner make the
    ///      neuron act through it with account.execute (EXEC_FEE 0.0013 OKB). #5's opened account is not #8's.
    function test_fork_brainWalletCheckpoint() public {
        address payer = makeAddr("payer");
        vm.deal(payer, 1 ether);
        address bw = agent.brainWallet();
        if (!OPENER.isOpened(address(CEREBR), POLICY)) {
            uint256 fee = OPENER.FEE();
            vm.prank(payer);
            assertEq(OPENER.open{value: fee}(address(CEREBR), POLICY), bw);
        }
        ITapeOutAccount account = ITapeOutAccount(bw);
        address owner = account.owner();
        assertEq(owner, CEREBR.ownerOf(POLICY));
        uint256 execFee = account.EXEC_FEE();
        console2.log("EXEC_FEE (wei)", execFee);
        vm.deal(owner, owner.balance + 1 ether);

        uint256 g0 = gasleft();
        vm.prank(owner);
        account.execute{value: execFee}(address(agent), 0, abi.encodeCall(CerebrAgent.act, ()), 0);
        console2.log("checkpoint execution gas (execute -> act)", g0 - gasleft());
        ICerebrAgent.Record memory r = agent.latestDecision();
        assertTrue(r.viaBrainWallet);
        assertEq(r.caller, bw);
        assertEq(agent.stats().brainWalletCount, 1);

        // #5's opened account (same owner) is a different neuron's wallet: not attributed.
        _next(300);
        ITapeOutAccount xorAccount = ITapeOutAccount(OPENER.accountOf(address(CEREBR), XOR));
        assertTrue(OPENER.isOpened(address(CEREBR), XOR));
        address xorOwner = xorAccount.owner();
        vm.deal(xorOwner, xorOwner.balance + 1 ether);
        vm.prank(xorOwner);
        xorAccount.execute{value: execFee}(address(agent), 0, abi.encodeCall(CerebrAgent.act, ()), 0);
        r = agent.latestDecision();
        assertFalse(r.viaBrainWallet);
        assertEq(r.caller, address(xorAccount));

        // a stranger cannot make the neuron's wallet act
        _next(300);
        vm.prank(payer);
        vm.expectRevert();
        account.execute{value: execFee}(address(agent), 0, abi.encodeCall(CerebrAgent.act, ()), 0);
    }

    function test_fork_constructorRejectsWrongShapes() public {
        ICerebrAgent.Config memory c = _cfg();
        vm.expectRevert(ICerebrAgent.BadCircuit.selector);
        new CerebrAgent(IAgentCircuits(address(CEREBR)), XOR, IAgentOpener(address(OPENER)), c); // 2 inputs
        vm.expectRevert(ICerebrAgent.BadCircuit.selector);
        new CerebrAgent(IAgentCircuits(address(CEREBR)), 16, IAgentOpener(address(OPENER)), c); // arena bot
        vm.expectRevert(ICerebrAgent.BadCircuit.selector);
        new CerebrAgent(IAgentCircuits(address(CEREBR)), 10_000, IAgentOpener(address(OPENER)), c); // no circuit
    }
}
