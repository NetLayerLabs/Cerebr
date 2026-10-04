// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {CerebrLens} from "../src/CerebrLens.sol";
import {ERC6551Registry} from "../src/erc6551/ERC6551Registry.sol";
import {CerebrAccount} from "../src/erc6551/CerebrAccount.sol";

/// @title LocalDemo
/// @notice LOCAL ANVIL ONLY. Deploys the full Cerebr stack and seeds demo activity for the dApp.
///         Refuses to run on any chain other than 31337. Uses anvil's well-known PUBLIC test keys
///         (derived from the default "test test ... junk" mnemonic). Never use these keys elsewhere.
/// @dev Two phases, because reveals need the hash of a block mined AFTER each mint:
///      1. run():      deploy registry (vendored) + CerebrAccount + Processor(+Circuit) + Lens,
///                     write deployments/31337.json, then buys / sells / tape-outs from 4 accounts.
///      2. finalize(): (after a couple of blocks) reveal every ready Circuit, fuse two of the
///                     deployer's Basic Circuits into a Pro, activate the child's brain wallet and
///                     send it a little OKB.
///      anvil --port 8547 &
///      forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8547 --broadcast
///      cast rpc anvil_mine 2 --rpc-url http://127.0.0.1:8547
///      forge script script/LocalDemo.s.sol --sig "finalize()" --rpc-url http://127.0.0.1:8547 --broadcast
///      Env: LAUNCH_BLOCKS (default 0 = guard off locally), WALLET_CAP_PER_BLOCK, BLOCK_CAP,
///           BASE_PRICE, SLOPE.
contract LocalDemo is Script {
    /// @dev anvil's default PUBLIC test mnemonic (LOCAL ONLY). Accounts 0..3 are derived from it.
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    uint256 internal constant ANVIL_CHAIN_ID = 31337;

    error NotAnvil(uint256 chainId);

    uint256 internal PK0;
    uint256 internal PK1;
    uint256 internal PK2;
    uint256 internal PK3;

    modifier onlyAnvil() {
        if (block.chainid != ANVIL_CHAIN_ID) revert NotAnvil(block.chainid);
        PK0 = vm.deriveKey(ANVIL_MNEMONIC, 0);
        PK1 = vm.deriveKey(ANVIL_MNEMONIC, 1);
        PK2 = vm.deriveKey(ANVIL_MNEMONIC, 2);
        PK3 = vm.deriveKey(ANVIL_MNEMONIC, 3);
        _;
    }

    /// @notice Phase 1: deploy and seed trades + tape-outs.
    function run() external onlyAnvil returns (CerebrProcessor processor, CerebrCircuit circuit, CerebrLens lens) {
        address deployer = vm.addr(PK0);

        vm.startBroadcast(PK0);
        ERC6551Registry registry = new ERC6551Registry();
        CerebrAccount accountImpl = new CerebrAccount();
        processor = new CerebrProcessor(
            vm.envOr("BASE_PRICE", uint256(1e12)),
            vm.envOr("SLOPE", uint256(1e8)),
            deployer,
            vm.envOr("LAUNCH_BLOCKS", uint256(0)),
            vm.envOr("WALLET_CAP_PER_BLOCK", uint256(25_000e18)),
            vm.envOr("BLOCK_CAP", uint256(100_000e18)),
            address(registry),
            address(accountImpl)
        );
        lens = new CerebrLens(processor);
        vm.stopBroadcast();
        circuit = processor.CIRCUIT();

        _writeDeployment(processor, circuit, lens, address(registry), address(accountImpl), deployer);

        // --- Seed activity -------------------------------------------------------------
        // Deployer: 3 Basic Circuits (two of them get fused in finalize()).
        _buy(processor, PK0, 20_000e18);
        _tapeOut(processor, PK0, Tier.Basic);
        _tapeOut(processor, PK0, Tier.Basic);
        _tapeOut(processor, PK0, Tier.Basic);

        // Account 1: Basic + Pro.
        _buy(processor, PK1, 40_000e18);
        _tapeOut(processor, PK1, Tier.Basic);
        _tapeOut(processor, PK1, Tier.Pro);

        // Account 2: Quantum, then trims its position.
        _buy(processor, PK2, 120_000e18);
        _tapeOut(processor, PK2, Tier.Quantum);
        _sell(processor, PK2, 8_000e18);

        // Account 3: pure trader.
        _buy(processor, PK3, 15_000e18);
        _sell(processor, PK3, 5_000e18);

        console2.log("== LocalDemo phase 1 done ==");
        console2.log("CerebrProcessor ", address(processor));
        console2.log("CerebrCircuit   ", address(circuit));
        console2.log("CerebrLens      ", address(lens));
        console2.log("ERC6551Registry ", address(registry));
        console2.log("CerebrAccount   ", address(accountImpl));
        console2.log("supply (CBR wei)", processor.totalSupply());
        console2.log("burned (CBR wei)", processor.totalCbrBurned());
        console2.log("circuits        ", circuit.totalMinted());
    }

    /// @notice Phase 2: reveal ready Circuits, fuse two deployer Basics, activate the child's TBA.
    function finalize() external onlyAnvil {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/deployments/31337.json"));
        CerebrProcessor processor = CerebrProcessor(payable(vm.parseJsonAddress(json, ".processor")));
        CerebrCircuit circuit = processor.CIRCUIT();
        ERC6551Registry registry = ERC6551Registry(vm.parseJsonAddress(json, ".erc6551Registry"));

        uint256 total = circuit.totalMinted();
        uint256 revealed;
        vm.startBroadcast(PK3); // anyone can reveal: a keeper-style account does it
        for (uint256 id = 1; id <= total; ++id) {
            (, bool isRevealed,) = circuit.circuitInfo(id);
            if (isRevealed || block.number < circuit.revealReadyBlock(id)) continue;
            if (circuit.reveal(id)) ++revealed;
        }
        vm.stopBroadcast();
        console2.log("revealed", revealed);

        // Fuse the deployer's first two revealed Basic Circuits.
        address deployer = vm.addr(PK0);
        uint256 a;
        uint256 b;
        for (uint256 id = 1; id <= total && b == 0; ++id) {
            (Tier tier, bool isRevealed,) = circuit.circuitInfo(id);
            if (circuit.ownerOf(id) != deployer || tier != Tier.Basic || !isRevealed) continue;
            if (a == 0) a = id;
            else b = id;
        }
        if (b == 0) {
            console2.log("fusion skipped: deployer has < 2 revealed Basic Circuits (mine 2 blocks, rerun)");
            return;
        }
        uint256 cost = processor.TAPEOUT_COST();
        uint256 bal = processor.balanceOf(deployer);
        if (bal < cost) _buy(processor, PK0, cost - bal);

        vm.startBroadcast(PK0);
        uint256 child = processor.fuseCircuits(a, b);
        address tba = registry.createAccount(
            circuit.ACCOUNT_IMPLEMENTATION(), bytes32(0), block.chainid, address(circuit), child
        );
        (bool ok,) = payable(tba).call{value: 0.05 ether}("");
        require(ok, "fund tba");
        vm.stopBroadcast();

        console2.log("fused into child", child);
        console2.log("child brain wallet", tba);
    }

    // ------------------------------------------------------------------

    function _buy(CerebrProcessor p, uint256 pk, uint256 amount) internal {
        uint256 cost = p.quoteBuy(amount);
        vm.broadcast(pk);
        p.buyTransistors{value: cost}(amount, cost);
    }

    function _sell(CerebrProcessor p, uint256 pk, uint256 amount) internal {
        (,, uint256 net) = p.quoteSell(amount);
        vm.broadcast(pk);
        p.sellTransistors(amount, net);
    }

    function _tapeOut(CerebrProcessor p, uint256 pk, Tier tier) internal {
        vm.broadcast(pk);
        if (tier == Tier.Basic) p.tapeOutCircuit();
        else p.tapeOutCircuitTier(tier);
    }

    /// @dev Same keys as script/Deploy.s.sol so the dApp's sync script handles both.
    function _writeDeployment(
        CerebrProcessor processor,
        CerebrCircuit circuit,
        CerebrLens lens,
        address registry,
        address accountImpl,
        address deployer
    ) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeUint(k, "launchEndBlock", processor.LAUNCH_END_BLOCK());
        vm.serializeAddress(k, "owner", deployer);
        vm.serializeAddress(k, "processor", address(processor));
        vm.serializeAddress(k, "circuit", address(circuit));
        vm.serializeAddress(k, "lens", address(lens));
        vm.serializeAddress(k, "erc6551Registry", registry);
        vm.serializeBool(k, "canonicalRegistry", false);
        string memory json = vm.serializeAddress(k, "accountImplementation", accountImpl);
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/31337.json"));
    }
}
