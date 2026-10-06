// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {NeuralArena} from "../src/arena/NeuralArena.sol";
import {IArenaCircuits} from "../src/arena/IArenaCircuits.sol";

/// @notice Deploys NeuralArena against a taped-out bot circuit (see ARENA.md).
/// @dev The signer comes from the CLI (--account / --ledger / --private-key), never from this file.
///      Env: BOT_CIRCUIT_ID (required), ARENA_CIRCUITS (default: the Cerebr processor on X Layer).
///      Rehearse on a fork first (nothing leaves the machine without --broadcast):
///        anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8603 --silent
///        BOT_CIRCUIT_ID=<id> forge script script/DeployArena.s.sol --rpc-url http://127.0.0.1:8603 --sender <deployer>
///      Mainnet (only the user signs): --rpc-url xlayer --broadcast --account <name>.
contract DeployArena is Script {
    address internal constant CEREBR_CIRCUITS = 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF;

    function run() external returns (NeuralArena arena) {
        uint256 botId = vm.envUint("BOT_CIRCUIT_ID");
        address circuits = vm.envOr("ARENA_CIRCUITS", CEREBR_CIRCUITS);
        require(circuits.code.length != 0, "circuits has no code (wrong chain?)");
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = IArenaCircuits(circuits).circuitInfo(botId);

        console2.log("== NeuralArena deploy ==");
        console2.log("chainId      ", block.chainid);
        console2.log("circuits     ", circuits);
        console2.log("bot circuit  ", botId);
        console2.log("nIn / nOut   ", nIn, nOut);
        console2.log("nState/gates ", nState, gates);

        vm.startBroadcast();
        arena = new NeuralArena(IArenaCircuits(circuits), botId);
        vm.stopBroadcast();

        console2.log("arena        ", address(arena));
        (uint8 cell,) = arena.previewBotMove(0, 0);
        console2.log("bot opening  ", cell);
    }
}
