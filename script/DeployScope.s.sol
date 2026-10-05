// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CerebrScope} from "../src/scope/CerebrScope.sol";
import {ITapeOutFactory, ITapeOutOpener} from "../src/scope/ITapeOut.sol";

/// @notice Deploys CerebrScope (read-only lens + label registry) against TapeOut on X Layer.
/// @dev The signer comes from the CLI (--account / --ledger / --private-key), never from this file.
///      Rehearse on a fork first (no --broadcast, nothing leaves the machine):
///        anvil --fork-url https://rpc.xlayer.tech --port 8562 --chain-id 196
///        forge script script/DeployScope.s.sol --rpc-url http://127.0.0.1:8562 --sender <deployer>
///      Mainnet (only the user signs): add --rpc-url xlayer --broadcast --account <name>.
///      Env (optional): TAPEOUT_FACTORY, TAPEOUT_OPENER (default: X Layer mainnet addresses),
///                      CEREBR_CIRCUITS (our CPU's circuits address; sanity-checked after deploy).
contract DeployScope is Script {
    address internal constant XLAYER_FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    address internal constant XLAYER_OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;

    function run() external returns (CerebrScope scope) {
        address factory = vm.envOr("TAPEOUT_FACTORY", XLAYER_FACTORY);
        address opener = vm.envOr("TAPEOUT_OPENER", XLAYER_OPENER);
        require(factory.code.length != 0, "factory has no code (wrong chain?)");
        require(opener.code.length != 0, "opener has no code (wrong chain?)");

        console2.log("== CerebrScope deploy ==");
        console2.log("chainId  ", block.chainid);
        console2.log("factory  ", factory);
        console2.log("opener   ", opener);
        console2.log("CPUs     ", ITapeOutFactory(factory).cpuCount());

        vm.startBroadcast();
        scope = new CerebrScope(ITapeOutFactory(factory), ITapeOutOpener(opener));
        vm.stopBroadcast();
        console2.log("scope    ", address(scope));

        address circuits = vm.envOr("CEREBR_CIRCUITS", address(0));
        if (circuits != address(0)) {
            CerebrScope.ProcessorView memory p = scope.processor(circuits);
            console2.log("processor", p.name);
            console2.log("circuits ", p.circuitCount);
            if (p.circuitCount != 0) console2.log(scope.tokenURI(circuits, 1));
        }
    }
}
