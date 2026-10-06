// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CerebrAgent} from "../src/agent/CerebrAgent.sol";
import {IAgentCircuits, IAgentOpener, ICerebrAgent} from "../src/agent/ICerebrAgent.sol";

/// @notice Deploys CerebrAgent against a taped-out 5-in/1-out policy circuit (see AGENT.md).
/// @dev The signer comes from the CLI (--account / --ledger / --private-key), never from this file.
///      Env (defaults in brackets):
///        POLICY_CIRCUIT_ID      required (8 = the Go/No-Go Neuron on the Cerebr processor)
///        AGENT_CIRCUITS         [Cerebr processor 0xB04E…93FF]
///        AGENT_OPENER           [TapeOut opener 0x536a…0106]; set 0x0000000000000000000000000000000000000000 to disable
///        CALM_MAX_BASEFEE       [50000000 = 0.05 gwei]
///        SPIKE_BPS              [15000 = 1.5x EMA]
///        WINDOW_START_HOUR      [13]   WINDOW_END_HOUR [21]   (UTC, end exclusive)
///        REST_BLOCKS            [43200 = 12h at 1s blocks]
///        REFRACTORY_BLOCKS      [3600 = 1h]
///        MIN_INTERVAL_BLOCKS    [300 = 5 min]
///      Rehearse on a fork first (nothing leaves the machine without --broadcast):
///        anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8605 --silent
///        POLICY_CIRCUIT_ID=8 forge script script/DeployAgent.s.sol --rpc-url http://127.0.0.1:8605 --sender <deployer>
///      Mainnet (only the user signs): --rpc-url xlayer --broadcast --account <name>.
contract DeployAgent is Script {
    address internal constant CEREBR_CIRCUITS = 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF;
    address internal constant TAPEOUT_OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;

    function run() external returns (CerebrAgent agent) {
        uint256 policyId = vm.envUint("POLICY_CIRCUIT_ID");
        address circuits = vm.envOr("AGENT_CIRCUITS", CEREBR_CIRCUITS);
        address opener = vm.envOr("AGENT_OPENER", TAPEOUT_OPENER);
        require(circuits.code.length != 0, "circuits has no code (wrong chain?)");
        ICerebrAgent.Config memory cfg = ICerebrAgent.Config({
            calmMaxBasefee: uint64(vm.envOr("CALM_MAX_BASEFEE", uint256(50_000_000))),
            spikeBps: uint32(vm.envOr("SPIKE_BPS", uint256(15_000))),
            windowStartHour: uint8(vm.envOr("WINDOW_START_HOUR", uint256(13))),
            windowEndHour: uint8(vm.envOr("WINDOW_END_HOUR", uint256(21))),
            restBlocks: uint32(vm.envOr("REST_BLOCKS", uint256(43_200))),
            refractoryBlocks: uint32(vm.envOr("REFRACTORY_BLOCKS", uint256(3_600))),
            minIntervalBlocks: uint32(vm.envOr("MIN_INTERVAL_BLOCKS", uint256(300)))
        });
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = IAgentCircuits(circuits).circuitInfo(policyId);

        console2.log("== CerebrAgent deploy ==");
        console2.log("chainId        ", block.chainid);
        console2.log("circuits       ", circuits);
        console2.log("opener         ", opener);
        console2.log("policy circuit ", policyId);
        console2.log("nIn / nOut     ", nIn, nOut);
        console2.log("nState / gates ", nState, gates);
        console2.log("calmMaxBasefee ", cfg.calmMaxBasefee);
        console2.log("spikeBps       ", cfg.spikeBps);
        console2.log("window (UTC)   ", cfg.windowStartHour, cfg.windowEndHour);
        console2.log("rest / refract ", cfg.restBlocks, cfg.refractoryBlocks);
        console2.log("minInterval    ", cfg.minIntervalBlocks);

        vm.startBroadcast();
        agent = new CerebrAgent(IAgentCircuits(circuits), policyId, IAgentOpener(opener), cfg);
        vm.stopBroadcast();

        console2.log("agent          ", address(agent));
        console2.log("brain wallet   ", agent.brainWallet());
        ICerebrAgent.Observation memory o = agent.observeAt(block.basefee);
        console2.log("observe inputs ", o.inputs);
        console2.log("preview verdict", uint8(o.verdict));
    }
}
