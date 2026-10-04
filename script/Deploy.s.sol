// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit} from "../src/CerebrCircuit.sol";
import {CerebrLens} from "../src/CerebrLens.sol";
import {ERC6551Registry} from "../src/erc6551/ERC6551Registry.sol";
import {CerebrAccount} from "../src/erc6551/CerebrAccount.sol";

/// @notice Deploys the ERC-6551 pieces (if needed), CerebrProcessor (which deploys CerebrCircuit) and
///         CerebrLens, logs the curve economics and writes the addresses to deployments/<chainId>.json
///         (deployments/<chainId>.dry-run.json when not broadcasting).
/// @dev Flow: 1. registry = ERC6551_REGISTRY (default canonical) if it has code, else deploy the
///               vendored ERC6551Registry (testnet 1952 / anvil). An explicitly set ERC6551_REGISTRY
///               without code reverts instead.
///            2. account implementation = ERC6551_ACCOUNT_IMPL if set (must have code), else deploy
///               CerebrAccount.
///            3. CerebrProcessor(...) -> CerebrCircuit.  4. CerebrLens(processor).
/// @dev Env:
///      PRIVATE_KEY            (required) deployer; becomes owner
///      BASE_PRICE             (default 1e12 wei)
///      SLOPE                  (default 1e8 wei)
///      LAUNCH_BLOCKS          (default 3600 ~ 1 h; 0 disables the fair-launch guard)
///      WALLET_CAP_PER_BLOCK   (default 1,000 CBR, 18-dec; net buys per wallet per block)
///      BLOCK_CAP              (default 2,500 CBR, 18-dec; net buys per block, all wallets)
///      ERC6551_REGISTRY       (default canonical 0x000000006551c19487814612e58FE06813775758;
///                              deployed on X Layer mainnet 196, NOT on testnet 1952)
///      ERC6551_ACCOUNT_IMPL   (optional) existing CerebrAccount implementation; deployed if unset
///      Simulate: forge script script/Deploy.s.sol --rpc-url xlayer_testnet
///      Broadcast: forge script script/Deploy.s.sol --rpc-url xlayer_testnet --broadcast
contract Deploy is Script {
    uint256 internal constant DEFAULT_BASE_PRICE = 1e12; // 0.000001 OKB per CBR at supply 0
    uint256 internal constant DEFAULT_SLOPE = 1e8; // +0.0000000001 OKB per CBR minted
    uint256 internal constant DEFAULT_LAUNCH_BLOCKS = 3600; // ~1 h at X Layer's measured ~1.0 s blocks
    uint256 internal constant DEFAULT_WALLET_CAP = 1_000e18;
    uint256 internal constant DEFAULT_BLOCK_CAP = 2_500e18; // window absorbs <= 9M CBR (90% of MAX_SUPPLY)
    address internal constant CANONICAL_6551_REGISTRY = 0x000000006551c19487814612e58FE06813775758;

    function run() external returns (CerebrProcessor processor, CerebrCircuit circuit, CerebrLens lens) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console2.log("== Cerebr deploy ==");
        console2.log("chainId     ", block.chainid);
        console2.log("deployer    ", deployer);
        console2.log("balance(wei)", deployer.balance);

        vm.startBroadcast(pk);
        address registry = _resolveRegistry();
        address accountImpl = _resolveAccountImpl();
        processor = new CerebrProcessor(
            vm.envOr("BASE_PRICE", DEFAULT_BASE_PRICE),
            vm.envOr("SLOPE", DEFAULT_SLOPE),
            deployer,
            vm.envOr("LAUNCH_BLOCKS", DEFAULT_LAUNCH_BLOCKS),
            vm.envOr("WALLET_CAP_PER_BLOCK", DEFAULT_WALLET_CAP),
            vm.envOr("BLOCK_CAP", DEFAULT_BLOCK_CAP),
            registry,
            accountImpl
        );
        lens = new CerebrLens(processor);
        vm.stopBroadcast();

        circuit = processor.CIRCUIT();

        console2.log("CerebrProcessor ", address(processor));
        console2.log("CerebrCircuit   ", address(circuit));
        console2.log("ERC6551Registry ", registry);
        console2.log("AccountImpl     ", accountImpl);
        console2.log("CerebrLens      ", address(lens));
        console2.log("owner           ", processor.owner());
        console2.log("launch end block", processor.LAUNCH_END_BLOCK());

        _logEconomics(processor);
        _writeDeployment(processor, circuit, lens, registry, accountImpl, deployer);
    }

    /// @dev Registry from env (default canonical). Uses it if it has code on this chain. If the
    ///      default canonical address is empty (testnet / anvil), deploys the vendored registry.
    ///      An explicitly configured registry without code is a misconfiguration and reverts.
    function _resolveRegistry() internal returns (address registry) {
        registry = vm.envOr("ERC6551_REGISTRY", CANONICAL_6551_REGISTRY);
        if (registry.code.length != 0) {
            console2.log(registry == CANONICAL_6551_REGISTRY ? "ERC6551 registry: canonical" : "ERC6551 registry: env");
            return registry;
        }
        require(registry == CANONICAL_6551_REGISTRY, "ERC6551_REGISTRY has no code on this chain");
        registry = address(new ERC6551Registry());
        console2.log("ERC6551 registry: canonical missing, deployed vendored copy");
    }

    /// @dev Account implementation from env (must have code), else deploy CerebrAccount.
    function _resolveAccountImpl() internal returns (address impl) {
        impl = vm.envOr("ERC6551_ACCOUNT_IMPL", address(0));
        if (impl != address(0)) {
            require(impl.code.length != 0, "ERC6551_ACCOUNT_IMPL has no code on this chain");
            return impl;
        }
        impl = address(new CerebrAccount());
    }

    /// @dev Writes the addresses for the dApp / indexer. Only a real broadcast writes
    ///      deployments/<chainId>.json; simulations write deployments/<chainId>.dry-run.json.
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
        vm.serializeBool(k, "canonicalRegistry", registry == CANONICAL_6551_REGISTRY);
        string memory json = vm.serializeAddress(k, "accountImplementation", accountImpl);

        bool broadcast =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        string memory path = string.concat(
            vm.projectRoot(), "/deployments/", vm.toString(block.chainid), broadcast ? ".json" : ".dry-run.json"
        );
        vm.writeJson(json, path);
        console2.log("Addresses written to", path);
    }

    /// @dev Read-only quotes against the freshly deployed (supply 0) processor.
    function _logEconomics(CerebrProcessor p) internal view {
        uint256 max = p.MAX_SUPPLY();
        uint256 tape = p.TAPEOUT_COST();
        uint256 half = max / 2;

        uint256 startPrice = p.BASE_PRICE();
        uint256 endPrice = p.BASE_PRICE() + p.SLOPE() * (max / 1e18);
        uint256 fillCost = p.quoteBuy(max);
        uint256 tapeAt0 = p.quoteBuy(tape);
        // Cost of tape+half minus cost of half: each rounded up, so within 1 wei of exact.
        uint256 tapeAtHalf = p.quoteBuy(half + tape) - p.quoteBuy(half);

        console2.log("== Curve economics (wei; 1 OKB = 1e18 wei) ==");
        console2.log("BASE_PRICE (start price / CBR)", startPrice);
        console2.log("SLOPE (wei per CBR of supply) ", p.SLOPE());
        console2.log("End price @ MAX_SUPPLY / CBR  ", endPrice);
        _logOkb("Total OKB to fill the curve   ", fillCost);
        _logOkb("TapeOut (5,000 CBR) @ supply 0", tapeAt0);
        _logOkb("TapeOut (5,000 CBR) @ 50%     ", tapeAtHalf);
        _logOkb("Pro (20,000 CBR) @ supply 0   ", p.quoteBuy(p.PRO_TAPEOUT_COST()));
        _logOkb("Quantum (100k CBR) @ supply 0 ", p.quoteBuy(p.QUANTUM_TAPEOUT_COST()));
    }

    function _logOkb(string memory label, uint256 weiAmount) internal pure {
        // Prints e.g. "5010.000000 OKB" (6 decimal places, truncated).
        uint256 whole = weiAmount / 1e18;
        uint256 frac = (weiAmount % 1e18) / 1e12;
        console2.log(
            string.concat(label, " ", vm.toString(whole), ".", _pad6(frac), " OKB  (wei: ", vm.toString(weiAmount), ")")
        );
    }

    function _pad6(uint256 v) internal pure returns (string memory s) {
        s = vm.toString(v);
        while (bytes(s).length < 6) s = string.concat("0", s);
    }
}
