// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {ERC6551Fixture} from "./helpers/ERC6551TestHelpers.sol";

/// @dev Minimal base64 decoder + string helpers so tests can inspect on-chain metadata.
library TestStrings {
    function _val(uint8 ch) private pure returns (uint8) {
        if (ch >= 65 && ch <= 90) return ch - 65; // A-Z
        if (ch >= 97 && ch <= 122) return ch - 71; // a-z
        if (ch >= 48 && ch <= 57) return ch + 4; // 0-9
        if (ch == 43) return 62; // +
        if (ch == 47) return 63; // /
        revert("bad base64");
    }

    function decode64(string memory s) internal pure returns (string memory) {
        bytes memory d = bytes(s);
        require(d.length % 4 == 0, "b64 len");
        uint256 pad;
        if (d.length > 0 && d[d.length - 1] == "=") pad++;
        if (d.length > 1 && d[d.length - 2] == "=") pad++;
        bytes memory out = new bytes(d.length / 4 * 3 - pad);
        uint256 o;
        for (uint256 i; i < d.length; i += 4) {
            uint256 n = (uint256(_val(uint8(d[i]))) << 18) | (uint256(_val(uint8(d[i + 1]))) << 12)
                | (d[i + 2] == "=" ? 0 : uint256(_val(uint8(d[i + 2]))) << 6)
                | (d[i + 3] == "=" ? 0 : uint256(_val(uint8(d[i + 3]))));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
        return string(out);
    }

    function indexOf(string memory hay, string memory needle, uint256 from) internal pure returns (int256) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return -1;
        for (uint256 i = from; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return int256(i);
        }
        return -1;
    }

    function contains(string memory hay, string memory needle) internal pure returns (bool) {
        return indexOf(hay, needle, 0) >= 0;
    }

    function slice(string memory s, uint256 a, uint256 b) internal pure returns (string memory) {
        bytes memory x = bytes(s);
        bytes memory out = new bytes(b - a);
        for (uint256 i = a; i < b; ++i) {
            out[i - a] = x[i];
        }
        return string(out);
    }

    /// @dev Substring strictly between the first `startMarker` and the next `endMarker`.
    function between(string memory s, string memory startMarker, string memory endMarker)
        internal
        pure
        returns (string memory)
    {
        int256 a = indexOf(s, startMarker, 0);
        require(a >= 0, "start marker");
        uint256 st = uint256(a) + bytes(startMarker).length;
        int256 b = indexOf(s, endMarker, st);
        require(b >= 0, "end marker");
        return slice(s, st, uint256(b));
    }
}

/// @title Thorough tests for tiers, fusion, commit-reveal, fair-launch guard, counters and TBA nesting.
contract CerebrFeaturesTest is Test, ERC6551Fixture {
    using TestStrings for string;

    CerebrProcessor internal p;
    CerebrCircuit internal c;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant BASIC = 5_000e18;
    uint256 internal constant PRO = 20_000e18;
    uint256 internal constant QUANTUM = 100_000e18;

    function setUp() public {
        p = new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, address(registry6551), address(accountImpl6551));
        c = p.CIRCUIT();
    }

    // ================================================================ helpers

    function _cost(Tier t) internal pure returns (uint256) {
        if (t == Tier.Basic) return BASIC;
        if (t == Tier.Pro) return PRO;
        return QUANTUM;
    }

    function _buy(address who, uint256 amount) internal {
        _buyOn(p, who, amount);
    }

    function _buyOn(CerebrProcessor proc, address who, uint256 amount) internal {
        uint256 q = proc.quoteBuy(amount);
        vm.deal(who, who.balance + q);
        vm.prank(who);
        proc.buyTransistors{value: q}(amount, q);
    }

    /// @dev Reveal with a deterministic (test-chosen) hash for commitBlock + 1.
    function _reveal(uint256 id) internal {
        (,, uint64 commitBlock) = c.circuitInfo(id);
        if (block.number < commitBlock + 2) vm.roll(commitBlock + 2);
        vm.setBlockhash(commitBlock + 1, keccak256(abi.encode("bh", commitBlock + 1)));
        assertTrue(c.reveal(id));
    }

    function _tape(address who, Tier tier) internal returns (uint256 id) {
        vm.prank(who);
        id = p.tapeOutCircuitTier(tier);
    }

    /// @dev Buy, tape out and reveal a Circuit of `tier` for `who`.
    function _revealed(address who, Tier tier) internal returns (uint256 id) {
        _buy(who, _cost(tier));
        id = _tape(who, tier);
        _reveal(id);
    }

    /// @dev Produce a revealed Circuit of any tier (fusing up for Singularity) owned by `who`.
    function _make(address who, Tier tier) internal returns (uint256 id) {
        if (tier != Tier.Singularity) return _revealed(who, tier);
        uint256 a = _revealed(who, Tier.Quantum);
        uint256 b = _revealed(who, Tier.Quantum);
        _buy(who, QUANTUM);
        vm.prank(who);
        id = p.fuseCircuits(a, b);
        _reveal(id);
    }

    function _solvent() internal view {
        assertGe(address(p).balance, p.reserveRequired() + p.protocolFees(), "insolvent");
    }

    function _json(uint256 id) internal view returns (string memory) {
        string memory uri = c.tokenURI(id);
        string memory prefix = "data:application/json;base64,";
        assertEq(uri.slice(0, bytes(prefix).length), prefix, "uri prefix");
        return uri.slice(bytes(prefix).length, bytes(uri).length).decode64();
    }

    function _svgOf(string memory json) internal pure returns (string memory) {
        return json.between('"image":"data:image/svg+xml;base64,', '"').decode64();
    }

    // ================================================================ tiers: costs and burns

    function test_TapeOutCostView() public view {
        assertEq(p.tapeOutCost(Tier.Basic), BASIC);
        assertEq(p.tapeOutCost(Tier.Pro), PRO);
        assertEq(p.tapeOutCost(Tier.Quantum), QUANTUM);
        assertEq(p.TAPEOUT_COST(), BASIC);
        assertEq(p.PRO_TAPEOUT_COST(), PRO);
        assertEq(p.QUANTUM_TAPEOUT_COST(), QUANTUM);
    }

    function test_TapeOutCostSingularityReverts() public {
        vm.expectRevert(CerebrProcessor.TierNotMintable.selector);
        p.tapeOutCost(Tier.Singularity);
    }

    function test_TapeOutEachTier_BurnsExactAndEmits() public {
        _buy(alice, BASIC + PRO + QUANTUM + 1e18);
        Tier[3] memory tiers = [Tier.Basic, Tier.Pro, Tier.Quantum];
        uint256 burned;
        for (uint256 i; i < 3; ++i) {
            Tier t = tiers[i];
            uint256 cost = _cost(t);
            uint256 bal = p.balanceOf(alice);
            uint256 supply = p.totalSupply();
            uint256 okb = address(p).balance;
            uint256 surplus = p.surplusReserve();
            (uint256 curveValue,,) = p.quoteSell(cost);

            vm.expectEmit(true, true, true, true, address(p));
            emit CerebrProcessor.CircuitTapedOut(alice, i + 1, t, cost, supply - cost);
            uint256 id = _tape(alice, t);

            burned += cost;
            assertEq(id, i + 1);
            assertEq(p.balanceOf(alice), bal - cost, "user burn");
            assertEq(p.totalSupply(), supply - cost, "supply burn");
            assertEq(address(p).balance, okb, "okb moved on tape-out");
            assertGe(p.surplusReserve() + 2, surplus + curveValue, "surplus grew too little");
            assertEq(p.totalCbrBurned(), burned);
            assertEq(c.ownerOf(id), alice);
            (Tier stored, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
            assertEq(uint8(stored), uint8(t));
            assertFalse(revealed);
            assertEq(commitBlock, block.number);
            assertEq(c.seedOf(id), 0);
            assertEq(c.mintedByTier(t), 1);
        }
        assertEq(p.balanceOf(alice), 1e18);
        _solvent();
    }

    function test_TapeOutCircuitIsBasic() public {
        _buy(alice, BASIC);
        vm.expectEmit(true, true, true, true, address(p));
        emit CerebrProcessor.CircuitTapedOut(alice, 1, Tier.Basic, BASIC, 0);
        vm.prank(alice);
        uint256 id = p.tapeOutCircuit();
        assertEq(uint8(c.tierOf(id)), uint8(Tier.Basic));
        assertEq(p.balanceOf(alice), 0);
        assertEq(p.totalCbrBurned(), BASIC);
        assertEq(c.mintedByTier(Tier.Basic), 1);
    }

    function testFuzz_TapeOutTier(uint8 tRaw, uint256 extra) public {
        Tier t = Tier(bound(tRaw, 0, 2));
        extra = bound(extra, 0, 1_000_000e18);
        uint256 cost = _cost(t);
        _buy(alice, cost + extra);
        uint256 id = _tape(alice, t);
        assertEq(p.balanceOf(alice), extra);
        assertEq(p.totalCbrBurned(), cost);
        assertEq(uint8(c.tierOf(id)), uint8(t));
        assertEq(c.mintedByTier(t), 1);
        _solvent();
        // Burned backing is permanent: everyone can still exit, surplus remains.
        if (extra > 0) {
            vm.prank(alice);
            p.sellTransistors(extra, 0);
        }
        assertEq(p.totalSupply(), 0);
        assertGt(p.surplusReserve(), 0);
        _solvent();
    }

    function test_TapeOutInsufficientCbrRevertsEachTier() public {
        Tier[3] memory tiers = [Tier.Basic, Tier.Pro, Tier.Quantum];
        for (uint256 i; i < 3; ++i) {
            address u = makeAddr(string.concat("u", vm.toString(i)));
            uint256 cost = _cost(tiers[i]);
            _buy(u, cost - 1);
            vm.prank(u);
            vm.expectRevert(); // ERC20InsufficientBalance
            p.tapeOutCircuitTier(tiers[i]);
            assertEq(p.balanceOf(u), cost - 1);
        }
        assertEq(c.totalMinted(), 0);
        assertEq(p.totalCbrBurned(), 0);
    }

    function test_SingularityNotMintableDirectly() public {
        _buy(alice, 1_000_000e18);
        uint256 bal = p.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.TierNotMintable.selector);
        p.tapeOutCircuitTier(Tier.Singularity);
        assertEq(p.balanceOf(alice), bal);
        assertEq(c.totalMinted(), 0);
        assertEq(c.mintedByTier(Tier.Singularity), 0);
        assertEq(p.totalCbrBurned(), 0);
    }

    function test_TapeOutOutOfRangeEnumReverts() public {
        _buy(alice, 1_000_000e18);
        for (uint256 t = 4; t < 7; ++t) {
            vm.prank(alice);
            (bool ok,) = address(p).call(abi.encodeWithSelector(p.tapeOutCircuitTier.selector, t));
            assertFalse(ok);
        }
        assertEq(c.totalMinted(), 0);
    }

    function test_TapeOutPausedEveryTier() public {
        _buy(alice, BASIC + PRO + QUANTUM);
        vm.prank(owner);
        p.pause();
        vm.startPrank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        p.tapeOutCircuit();
        for (uint8 t; t < 4; ++t) {
            vm.expectRevert(Pausable.EnforcedPause.selector);
            p.tapeOutCircuitTier(Tier(t));
        }
        vm.stopPrank();
        vm.prank(owner);
        p.unpause();
        _tape(alice, Tier.Quantum);
    }

    function test_CircuitMintAndFuseOnlyProcessor() public {
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.mint(alice, Tier.Singularity);
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.fuse(alice, 1, 2);
    }

    // ================================================================ fusion

    function test_FuseBasicToPro() public {
        _assertFuseRaw(Tier.Basic);
    }

    function test_FuseProToQuantum() public {
        _assertFuseRaw(Tier.Pro);
    }

    function test_FuseQuantumToSingularity() public {
        _assertFuseRaw(Tier.Quantum);
        assertEq(c.mintedByTier(Tier.Singularity), 1);
        _reveal(c.totalMinted());
        CerebrCircuit.Traits memory t = c.traits(c.totalMinted());
        assertEq(uint8(t.tier), uint8(Tier.Singularity));
        assertGe(t.cores, 512);
        assertTrue(keccak256(bytes(t.rarity)) != keccak256("Common"));
    }

    struct FuseSnap {
        uint256 a;
        uint256 b;
        uint256 cost;
        uint256 supply;
        uint256 burned;
        uint256 okb;
        Tier childTier;
        uint256 childCount;
        uint256 inCount;
        uint256 child;
        address tba;
        uint256 seedA;
    }

    function _checkFuseLogs(FuseSnap memory f) internal view {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 transferSig = keccak256("Transfer(address,address,uint256)");
        address[3] memory fromE = [address(0), alice, alice];
        address[3] memory toE = [alice, f.tba, f.tba];
        uint256[3] memory idE = [f.child, f.a, f.b];
        uint256 n;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(c) || logs[i].topics[0] != transferSig) continue;
            assertLt(n, 3, "too many NFT transfers");
            assertEq(address(uint160(uint256(logs[i].topics[1]))), fromE[n], "from");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), toE[n], "to");
            assertEq(uint256(logs[i].topics[3]), idE[n], "id");
            n++;
        }
        assertEq(n, 3);
    }

    /// @dev Full fusion check incl. CircuitsFused event and raw ERC-721 Transfer logs.
    function _assertFuseRaw(Tier inputTier) internal {
        FuseSnap memory f;
        f.a = _make(alice, inputTier);
        f.b = _make(alice, inputTier);
        f.cost = _cost(inputTier);
        _buy(alice, f.cost + 7);
        f.supply = p.totalSupply();
        f.burned = p.totalCbrBurned();
        f.okb = address(p).balance;
        f.childTier = Tier(uint8(inputTier) + 1);
        f.childCount = c.mintedByTier(f.childTier);
        f.inCount = c.mintedByTier(inputTier);
        f.child = c.totalMinted() + 1;
        f.tba = registry6551.account(address(accountImpl6551), bytes32(0), block.chainid, address(c), f.child);
        f.seedA = c.seedOf(f.a);

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(p));
        emit CerebrProcessor.CircuitsFused(alice, f.child, f.a, f.b, f.childTier);
        vm.prank(alice);
        uint256 child = p.fuseCircuits(f.a, f.b);
        _checkFuseLogs(f);

        assertEq(child, f.child);
        assertEq(c.ownerOf(child), alice);
        assertEq(uint8(c.tierOf(child)), uint8(f.childTier));
        assertEq(c.tokenBoundAccount(child), f.tba);
        assertEq(c.tokenOfAccount(f.tba), child);
        assertEq(c.ownerOf(f.a), f.tba, "parent A not in child TBA");
        assertEq(c.ownerOf(f.b), f.tba, "parent B not in child TBA");
        assertEq(f.tba.code.length, 0, "TBA must not be deployed by fusion");
        assertEq(p.totalSupply(), f.supply - f.cost, "fusion burn");
        assertEq(p.balanceOf(alice), 7);
        assertEq(p.totalCbrBurned(), f.burned + f.cost);
        assertEq(address(p).balance, f.okb);
        assertEq(c.mintedByTier(f.childTier), f.childCount + 1);
        assertEq(c.mintedByTier(inputTier), f.inCount, "parents are not burned");
        (, bool revealed, uint64 commitBlock) = c.circuitInfo(child);
        assertFalse(revealed);
        assertEq(commitBlock, block.number);
        assertTrue(c.traits(f.a).revealed);
        assertEq(c.seedOf(f.a), f.seedA);
        _solvent();
    }

    function test_FuseSingularityReverts() public {
        uint256 s1 = _make(alice, Tier.Singularity);
        uint256 s2 = _make(alice, Tier.Singularity);
        _buy(alice, QUANTUM);
        vm.prank(alice);
        vm.expectRevert(CerebrCircuit.MaxTierReached.selector);
        p.fuseCircuits(s1, s2);
    }

    function test_FuseRevertsNotRevealedEitherSide() public {
        _buy(alice, 4 * BASIC);
        uint256 a = _tape(alice, Tier.Basic);
        uint256 b = _tape(alice, Tier.Basic);
        // Neither is ready yet, so the fusion's auto-reveal cannot reveal them.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.CircuitNotRevealed.selector, a));
        p.fuseCircuits(a, b);
        _reveal(a);
        // b became ready together with a; this tape-out's queue reveals it. b2 is sealed and not ready.
        uint256 b2 = _tape(alice, Tier.Basic);
        assertTrue(c.traits(b).revealed);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.CircuitNotRevealed.selector, b2));
        p.fuseCircuits(a, b2);
        _reveal(b2);
        vm.prank(alice);
        p.fuseCircuits(a, b2);
    }

    function test_FuseRevertsSameTierMismatchOwnership() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        uint256 pro = _make(alice, Tier.Pro);
        uint256 bobs = _make(bob, Tier.Basic);
        _buy(alice, BASIC);

        vm.startPrank(alice);
        vm.expectRevert(CerebrCircuit.SameCircuit.selector);
        p.fuseCircuits(a, a);
        vm.expectRevert(CerebrCircuit.TierMismatch.selector);
        p.fuseCircuits(a, pro);
        vm.expectRevert(CerebrCircuit.TierMismatch.selector);
        p.fuseCircuits(pro, b);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, bobs));
        p.fuseCircuits(a, bobs);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, bobs));
        p.fuseCircuits(bobs, a);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, 999));
        p.fuseCircuits(a, 999);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, 0));
        p.fuseCircuits(0, a);
        vm.stopPrank();

        // Bob cannot fuse alice's Circuits.
        _buy(bob, BASIC);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, a));
        p.fuseCircuits(a, b);

        assertEq(c.ownerOf(a), alice);
        assertEq(c.ownerOf(b), alice);
        assertEq(c.mintedByTier(Tier.Pro), 1);
    }

    function test_FuseApprovedOperatorCannotFuse() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        vm.prank(alice);
        c.setApprovalForAll(bob, true);
        _buy(bob, BASIC);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, a));
        p.fuseCircuits(a, b);
    }

    function test_FuseRequiresCbrAndIsAtomic() public {
        uint256 a = _make(alice, Tier.Pro);
        uint256 b = _make(alice, Tier.Pro);
        _buy(alice, PRO - 1);
        uint256 minted = c.totalMinted();
        vm.prank(alice);
        vm.expectRevert(); // ERC20InsufficientBalance
        p.fuseCircuits(a, b);
        assertEq(c.ownerOf(a), alice);
        assertEq(c.ownerOf(b), alice);
        assertEq(c.totalMinted(), minted);
        assertEq(c.mintedByTier(Tier.Quantum), 0);
        assertEq(p.balanceOf(alice), PRO - 1);
    }

    function test_FusePaused() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        _buy(alice, BASIC);
        vm.prank(owner);
        p.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        p.fuseCircuits(a, b);
        vm.prank(owner);
        p.unpause();
        vm.prank(alice);
        p.fuseCircuits(a, b);
    }

    function test_FuseParentHeldInTbaNotDirectlyOwned() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        uint256 holder = _make(alice, Tier.Basic);
        address tba = c.tokenBoundAccount(holder);
        vm.prank(alice);
        c.transferFrom(alice, tba, b);
        _buy(alice, BASIC);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.NotCircuitOwner.selector, b));
        p.fuseCircuits(a, b);
    }

    function test_FuseByTokenBoundAccount() public {
        // A TBA (acting via its owner) can fuse Circuits it holds directly.
        uint256 x = _make(alice, Tier.Basic);
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        address tba = c.tokenBoundAccount(x);
        vm.startPrank(alice);
        c.transferFrom(alice, tba, a);
        c.transferFrom(alice, tba, b);
        vm.stopPrank();
        _buy(tba, BASIC);
        vm.prank(tba);
        uint256 child = p.fuseCircuits(a, b);
        assertEq(c.ownerOf(child), tba);
        assertEq(c.ownerOf(a), c.tokenBoundAccount(child));
    }

    function test_FusedParentsRecoverableByChildTba() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        _buy(alice, BASIC);
        vm.prank(alice);
        uint256 child = p.fuseCircuits(a, b);
        address tba = c.tokenBoundAccount(child);

        // Transfer the child: the new owner now controls the parents through the TBA.
        vm.prank(alice);
        c.transferFrom(alice, bob, child);
        assertEq(c.ownerOf(a), tba);

        // The TBA (the account contract, simulated by prank) can move the parent out.
        vm.prank(tba);
        c.transferFrom(tba, bob, a);
        assertEq(c.ownerOf(a), bob);
        // Alice has no control any more.
        vm.prank(alice);
        vm.expectRevert();
        c.transferFrom(tba, alice, b);

        // Round-2 HIGH regression: recovered parents keep their fused mark and cannot be fused again.
        vm.prank(tba);
        c.transferFrom(tba, bob, b);
        assertEq(c.fusedInto(a), child);
        assertEq(c.fusedInto(b), child);
        _buy(bob, BASIC);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyFused.selector, a));
        p.fuseCircuits(a, b);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyFused.selector, b));
        p.fuseCircuits(b, a);
    }

    function test_FusedIntoMarksParentsAndMetadata() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        assertEq(c.fusedInto(a), 0);
        assertFalse(_json(a).contains("Fused Into"));
        _buy(alice, BASIC);
        vm.prank(alice);
        uint256 child = p.fuseCircuits(a, b);
        assertEq(c.fusedInto(a), child);
        assertEq(c.fusedInto(b), child);
        assertEq(c.fusedInto(child), 0);
        assertTrue(
            _json(a).contains(string.concat('{"trait_type":"Fused Into","value":"#', vm.toString(child), '"}]')),
            "fused attribute"
        );
    }

    /// Operators approved by a TBA cannot move Circuits out of it; the TBA itself can.
    function test_TbaApprovedOperatorCannotMoveCircuits() public {
        uint256 holder = _make(alice, Tier.Basic);
        uint256 x = _make(alice, Tier.Basic);
        address tba = c.tokenBoundAccount(holder);
        vm.prank(alice);
        c.transferFrom(alice, tba, x);
        vm.startPrank(tba);
        c.setApprovalForAll(bob, true);
        c.approve(carol, x);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AccountOperatorTransfer.selector, x));
        c.transferFrom(tba, bob, x);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AccountOperatorTransfer.selector, x));
        c.safeTransferFrom(tba, carol, x);
        // Operators of a plain wallet still work.
        uint256 y = _make(alice, Tier.Basic);
        vm.prank(alice);
        c.setApprovalForAll(bob, true);
        vm.prank(bob);
        c.transferFrom(alice, bob, y);
        assertEq(c.ownerOf(y), bob);
        // The TBA itself can move it.
        vm.prank(tba);
        c.transferFrom(tba, alice, x);
        assertEq(c.ownerOf(x), alice);
    }

    function test_FuseChainCountsAndBurns() public {
        // 4 Basic -> 2 Pro -> 1 Quantum.
        uint256[4] memory basics;
        for (uint256 i; i < 4; ++i) {
            basics[i] = _make(alice, Tier.Basic);
        }
        _buy(alice, 2 * BASIC + PRO);
        vm.startPrank(alice);
        uint256 pro1 = p.fuseCircuits(basics[0], basics[1]);
        uint256 pro2 = p.fuseCircuits(basics[2], basics[3]);
        vm.stopPrank();
        _reveal(pro1);
        _reveal(pro2);
        vm.prank(alice);
        uint256 q = p.fuseCircuits(pro1, pro2);
        assertEq(uint8(c.tierOf(q)), uint8(Tier.Quantum));
        assertEq(p.totalCbrBurned(), 4 * BASIC + 2 * BASIC + PRO);
        assertEq(c.mintedByTier(Tier.Basic), 4);
        assertEq(c.mintedByTier(Tier.Pro), 2);
        assertEq(c.mintedByTier(Tier.Quantum), 1);
        assertEq(c.totalMinted(), 7);
        // Nesting: basics[0] is in pro1's TBA, which is in q's TBA.
        assertEq(c.ownerOf(basics[0]), c.tokenBoundAccount(pro1));
        assertEq(c.ownerOf(pro1), c.tokenBoundAccount(q));
        assertEq(c.ownerOf(q), alice);
        _solvent();
    }

    // ================================================================ commit-reveal

    function test_RevealTooEarly() public {
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        uint256 mintBlock = block.number;
        assertEq(c.revealReadyBlock(id), mintBlock + 2);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.RevealTooEarly.selector, mintBlock + 2));
        c.reveal(id);
        vm.roll(mintBlock + 1);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.RevealTooEarly.selector, mintBlock + 2));
        c.reveal(id);
        vm.roll(mintBlock + 2);
        assertTrue(c.reveal(id));
    }

    function test_RevealSameTxAsMintImpossible() public {
        // A contract that tapes out and reveals atomically always reverts.
        Atomic atk = new Atomic(p);
        _buy(address(atk), BASIC);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.RevealTooEarly.selector, block.number + 2));
        atk.tapeAndReveal();
    }

    function test_RevealByThirdPartyEmits() public {
        _buy(alice, PRO);
        uint256 id = _tape(alice, Tier.Pro);
        uint256 mintBlock = block.number;
        vm.roll(mintBlock + 5);
        bytes32 bh = keccak256("block after mint");
        vm.setBlockhash(mintBlock + 1, bh);
        uint256 seed = uint256(keccak256(abi.encode(bh, id, block.chainid, address(c))));

        vm.expectEmit(true, false, false, true, address(c));
        emit CerebrCircuit.CircuitRevealed(id, Tier.Pro, seed);
        vm.prank(carol);
        assertTrue(c.reveal(id));
        assertEq(c.seedOf(id), seed);
        assertEq(c.ownerOf(id), alice, "reveal must not move the token");
        CerebrCircuit.Traits memory t = c.traits(id);
        assertTrue(t.revealed);
        assertEq(keccak256(abi.encode(t)), keccak256(abi.encode(c.computeTraits(seed, Tier.Pro))));

        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyRevealed.selector, id));
        c.reveal(id);
    }

    function test_RevealDeterministic_IndependentOfRevealerAndTime() public {
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        uint256 mintBlock = block.number;
        bytes32 bh = keccak256("H");
        vm.roll(mintBlock + 2);
        vm.setBlockhash(mintBlock + 1, bh);
        // Mint-block hash must be irrelevant (it was known at mint).
        vm.setBlockhash(mintBlock, keccak256("mint block"));

        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        c.reveal(id);
        uint256 s1 = c.seedOf(id);

        vm.revertToState(snap);
        vm.roll(mintBlock + 200);
        vm.setBlockhash(mintBlock + 1, bh);
        vm.setBlockhash(mintBlock, keccak256("different mint block hash"));
        vm.prank(bob);
        c.reveal(id);
        uint256 s2 = c.seedOf(id);
        assertEq(s1, s2);
        assertEq(s1, uint256(keccak256(abi.encode(bh, id, block.chainid, address(c)))));

        // Different hash of commitBlock + 1 gives a different seed.
        vm.revertToState(snap);
        vm.roll(mintBlock + 2);
        vm.setBlockhash(mintBlock + 1, keccak256("H2"));
        c.reveal(id);
        assertTrue(c.seedOf(id) != s1);
    }

    function test_RevealSameBlockMintsGetDifferentSeeds() public {
        _buy(alice, 2 * BASIC);
        uint256 a = _tape(alice, Tier.Basic);
        uint256 b = _tape(alice, Tier.Basic);
        vm.roll(block.number + 2);
        c.reveal(a);
        c.reveal(b);
        assertTrue(c.seedOf(a) != c.seedOf(b));
        assertTrue(c.seedOf(a) != 0);
    }

    function test_RevealSeedBoundToChainId() public {
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        uint256 mintBlock = block.number;
        vm.roll(mintBlock + 2);
        vm.setBlockhash(mintBlock + 1, keccak256("x"));
        uint256 snap = vm.snapshotState();
        c.reveal(id);
        uint256 s1 = c.seedOf(id);
        vm.revertToState(snap);
        vm.chainId(196);
        c.reveal(id);
        assertTrue(c.seedOf(id) != s1);
        assertEq(c.seedOf(id), uint256(keccak256(abi.encode(keccak256("x"), id, uint256(196), address(c)))));
    }

    function test_RevealAtWindowBoundary() public {
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        uint256 target = block.number + 1;
        // blockhash(target) is available up to block target + 256.
        vm.roll(target + 256);
        vm.setBlockhash(target, keccak256("t"));
        assertTrue(c.reveal(id));
        assertEq(c.seedOf(id), uint256(keccak256(abi.encode(keccak256("t"), id, block.chainid, address(c)))));
    }

    function test_RevealRecommitsAfterExpiry() public {
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        uint256 target = block.number + 1;
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("t")); // set, but it leaves the window anyway
        vm.roll(target + 257);
        assertEq(blockhash(target), bytes32(0));

        vm.expectEmit(true, false, false, true, address(c));
        emit CerebrCircuit.Recommitted(id, block.number);
        vm.prank(carol);
        assertFalse(c.reveal(id));
        (Tier t, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
        assertEq(uint8(t), uint8(Tier.Basic));
        assertFalse(revealed);
        assertEq(commitBlock, block.number);
        assertEq(c.seedOf(id), 0);
        assertEq(c.revealReadyBlock(id), block.number + 2);
        assertFalse(c.traits(id).revealed);

        // The re-commit is a fresh commitment: too early again in this block and the next.
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.RevealTooEarly.selector, block.number + 2));
        c.reveal(id);
        uint256 newCommit = block.number;
        vm.roll(newCommit + 2);
        bytes32 bh = keccak256("fresh");
        vm.setBlockhash(newCommit + 1, bh);
        assertTrue(c.reveal(id));
        assertEq(c.seedOf(id), uint256(keccak256(abi.encode(bh, id, block.chainid, address(c)))));
    }

    function test_RevealZeroHashChainQuirkRecommits() public {
        // Even inside the window, a zero blockhash is never used as entropy.
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        uint256 target = block.number + 1;
        vm.roll(target + 1);
        vm.setBlockhash(target, bytes32(0));
        assertFalse(c.reveal(id));
        assertEq(c.seedOf(id), 0);
    }

    function test_RevealNonexistentReverts() public {
        vm.roll(10);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        c.reveal(1);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 0));
        c.reveal(0);
    }

    function test_RevealWorksWhilePaused() public {
        _buy(alice, BASIC);
        uint256 id = _tape(alice, Tier.Basic);
        vm.prank(owner);
        p.pause();
        vm.roll(block.number + 2);
        assertTrue(c.reveal(id));
    }

    function test_RevealOfFusedChildAndNestedParentState() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        _buy(alice, BASIC);
        vm.prank(alice);
        uint256 child = p.fuseCircuits(a, b);
        assertEq(c.revealReadyBlock(child), block.number + 2);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.RevealTooEarly.selector, block.number + 2));
        c.reveal(child);
        _reveal(child);
        assertTrue(c.traits(child).revealed);
    }

    function test_TraitsUnrevealedOnlyTier() public {
        _buy(alice, QUANTUM);
        uint256 id = _tape(alice, Tier.Quantum);
        CerebrCircuit.Traits memory t = c.traits(id);
        assertEq(uint8(t.tier), uint8(Tier.Quantum));
        assertFalse(t.revealed);
        assertEq(bytes(t.architecture).length, 0);
        assertEq(bytes(t.rarity).length, 0);
        assertEq(t.cores, 0);
        assertEq(t.clockTenthsGHz, 0);
        assertEq(t.nodeNm, 0);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        c.traits(2);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        c.tierOf(2);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 2));
        c.revealReadyBlock(2);
    }

    function testFuzz_ComputeTraitsRanges(uint256 seed, uint8 tRaw) public view {
        Tier tier = Tier(bound(tRaw, 0, 3));
        CerebrCircuit.Traits memory t = c.computeTraits(seed, tier);
        assertTrue(t.revealed);
        assertEq(uint8(t.tier), uint8(tier));
        uint256[4] memory coreLo = [uint256(8), 32, 128, 512];
        uint256[4] memory coreHi = [uint256(128), 256, 512, 1024];
        uint256[4] memory clkLo = [uint256(10), 20, 30, 50];
        uint256[4] memory clkHi = [uint256(59), 69, 79, 99];
        uint256 ti = uint8(tier);
        assertGe(t.cores, coreLo[ti]);
        assertLe(t.cores, coreHi[ti]);
        assertGe(t.clockTenthsGHz, clkLo[ti]);
        assertLe(t.clockTenthsGHz, clkHi[ti]);
        uint256 n = t.nodeNm;
        if (ti == 0) assertTrue(n == 14 || n == 7 || n == 5 || n == 3);
        if (ti == 1) assertTrue(n == 7 || n == 5 || n == 3 || n == 2);
        if (ti == 2) assertTrue(n == 5 || n == 3 || n == 2 || n == 1);
        if (ti == 3) assertTrue(n == 3 || n == 2 || n == 1);
        bytes32 r = keccak256(bytes(t.rarity));
        assertTrue(
            r == keccak256("Common") || r == keccak256("Rare") || r == keccak256("Epic") || r == keccak256("Legendary")
        );
        if (tier == Tier.Singularity) assertTrue(r != keccak256("Common"));
        bytes32 arch = keccak256(bytes(t.architecture));
        assertTrue(
            arch == keccak256("Transformer") || arch == keccak256("Spiking") || arch == keccak256("Recurrent")
                || arch == keccak256("Convolutional") || arch == keccak256("Liquid")
        );
    }

    function test_ComputeTraitsRarityThresholds() public view {
        // Rarity lane = (seed & 0xffff) % 100. Check every boundary per tier.
        string[4] memory names = ["Common", "Rare", "Epic", "Legendary"];
        uint256[3][4] memory th =
            [[uint256(60), 85, 97], [uint256(35), 70, 92], [uint256(10), 45, 83], [uint256(0), 15, 60]];
        for (uint256 ti; ti < 4; ++ti) {
            for (uint256 roll; roll < 100; ++roll) {
                uint256 k = roll < th[ti][0] ? 0 : roll < th[ti][1] ? 1 : roll < th[ti][2] ? 2 : 3;
                assertEq(c.computeTraits(roll, Tier(ti)).rarity, names[k]);
            }
        }
    }

    // ---------------------------------------------------------------- metadata

    function test_SealedTokenURI() public {
        _buy(alice, PRO);
        uint256 id = _tape(alice, Tier.Pro);
        string memory json = _json(id);
        assertTrue(json.contains('"name":"Neural Circuit #1 (sealed)"'), "sealed name");
        assertTrue(json.contains('{"trait_type":"Tier","value":"Pro"}'), "tier attr");
        assertTrue(json.contains('{"trait_type":"Status","value":"Sealed"}'), "status attr");
        assertFalse(json.contains("Rarity"), "rarity leaked while sealed");
        string memory svg = _svgOf(json);
        assertTrue(svg.contains("SEALED WAFER"), "sealed svg");
        assertTrue(svg.contains(">Pro<"), "tier in svg");
        assertTrue(svg.contains("CEREBR #1"), "id in svg");

        _reveal(id);
        string memory json2 = _json(id);
        assertFalse(json2.contains("Sealed"));
        assertFalse(json2.contains("(sealed)"));
        assertTrue(json2.contains('"attributes":[{"trait_type":"Tier","value":"Pro"}'), "tier attr first");
        CerebrCircuit.Traits memory t = c.traits(id);
        assertTrue(json2.contains(string.concat('{"trait_type":"Rarity","value":"', t.rarity, '"}')));
        assertTrue(json2.contains(string.concat('"value":"', t.architecture, '"')));
        string memory svg2 = _svgOf(json2);
        assertFalse(svg2.contains("SEALED WAFER"));
        assertTrue(svg2.contains(string.concat("Pro | ", t.rarity)));
    }

    function test_TokenURIEveryTierSealedAndRevealed() public {
        string[4] memory names = ["Basic", "Pro", "Quantum", "Singularity"];
        for (uint8 ti; ti < 4; ++ti) {
            uint256 id = _make(alice, Tier(ti)); // revealed
            string memory json = _json(id);
            assertTrue(json.contains(string.concat('{"trait_type":"Tier","value":"', names[ti], '"}')));
            assertTrue(_svgOf(json).contains(names[ti]));
        }
        // The Singularity child of _make was revealed; its sealed form was visible before reveal.
        uint256 a = _make(bob, Tier.Quantum);
        uint256 b = _make(bob, Tier.Quantum);
        _buy(bob, QUANTUM);
        vm.prank(bob);
        uint256 s = p.fuseCircuits(a, b);
        string memory sealedJson = _json(s);
        assertTrue(
            sealedJson.contains('{"trait_type":"Tier","value":"Singularity"},{"trait_type":"Status","value":"Sealed"}')
        );
    }

    function test_TokenURINonexistentReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, 1));
        c.tokenURI(1);
    }

    // ================================================================ fair-launch guard

    function _launch(uint256 blocks, uint256 walletCap, uint256 blockCap) internal returns (CerebrProcessor q) {
        q = new CerebrProcessor(
            1e12, 1e8, owner, blocks, walletCap, blockCap, address(registry6551), address(accountImpl6551)
        );
    }

    function _tryBuy(CerebrProcessor q, address who, uint256 amount) internal {
        vm.deal(who, who.balance + 1_000 ether);
        vm.prank(who);
        q.buyTransistors{value: 1_000 ether}(amount, type(uint256).max);
    }

    function test_LaunchWalletCapExactBoundary() public {
        CerebrProcessor q = _launch(10, 1_000e18, 10_000e18);
        _tryBuy(q, alice, 400e18);
        _tryBuy(q, alice, 600e18); // exactly at cap
        (uint256 w, uint256 g) = q.launchCapRemaining(alice);
        assertEq(w, 0);
        assertEq(g, 9_000e18);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchWalletCapExceeded.selector, 0));
        q.buyTransistors{value: 1 ether}(1, type(uint256).max);
        // Other wallets unaffected.
        _tryBuy(q, bob, 1_000e18);
    }

    function test_LaunchWalletCapPartialRemainingInError() public {
        CerebrProcessor q = _launch(10, 1_000e18, 10_000e18);
        _tryBuy(q, alice, 300e18);
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchWalletCapExceeded.selector, 700e18));
        q.buyTransistors{value: 10 ether}(700e18 + 1, type(uint256).max);
    }

    function test_LaunchBlockCapAcrossWallets() public {
        CerebrProcessor q = _launch(10, 1_000e18, 2_500e18);
        _tryBuy(q, alice, 1_000e18);
        _tryBuy(q, bob, 1_000e18);
        (, uint256 g) = q.launchCapRemaining(carol);
        assertEq(g, 500e18);
        vm.deal(carol, 10 ether);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchBlockCapExceeded.selector, 500e18));
        q.buyTransistors{value: 10 ether}(500e18 + 1, type(uint256).max);
        _tryBuy(q, carol, 500e18);
        (uint256 w, uint256 g2) = q.launchCapRemaining(carol);
        assertEq(w, 500e18);
        assertEq(g2, 0);
    }

    function test_LaunchBlockCapCheckedBeforeWalletCap() public {
        CerebrProcessor q = _launch(10, 1_000e18, 1_500e18);
        _tryBuy(q, alice, 1_000e18);
        // Bob asks 600: wallet ok (1000), block remaining 500 -> block error.
        vm.deal(bob, 10 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchBlockCapExceeded.selector, 500e18));
        q.buyTransistors{value: 10 ether}(600e18, type(uint256).max);
        // Alice asks 1: wallet exhausted, block has room -> wallet error.
        vm.prank(alice);
        vm.deal(alice, 10 ether);
        vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchWalletCapExceeded.selector, 0));
        q.buyTransistors{value: 1 ether}(1, type(uint256).max);
    }

    function test_LaunchCapsResetNextBlock() public {
        CerebrProcessor q = _launch(10, 1_000e18, 1_000e18);
        _tryBuy(q, alice, 1_000e18);
        vm.roll(block.number + 1);
        (uint256 w, uint256 g) = q.launchCapRemaining(alice);
        assertEq(w, 1_000e18);
        assertEq(g, 1_000e18);
        _tryBuy(q, alice, 1_000e18);
        vm.roll(block.number + 3); // skipping blocks also resets
        _tryBuy(q, bob, 1_000e18);
    }

    function test_LaunchWindowEndExact() public {
        uint256 start = block.number;
        CerebrProcessor q = _launch(5, 100e18, 100e18);
        assertEq(q.LAUNCH_END_BLOCK(), start + 5);
        vm.roll(start + 4); // last capped block
        assertTrue(q.launchActive());
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchBlockCapExceeded.selector, 100e18));
        q.buyTransistors{value: 10 ether}(101e18, type(uint256).max);
        vm.roll(start + 5); // first uncapped block
        assertFalse(q.launchActive());
        _tryBuy(q, alice, 1_000_000e18);
        (uint256 w, uint256 g) = q.launchCapRemaining(alice);
        assertEq(w, type(uint256).max);
        assertEq(g, type(uint256).max);
        _tryBuy(q, alice, 1_000_000e18);
    }

    function test_LaunchDisabledWithZeroBlocks() public {
        CerebrProcessor q = _launch(0, 0, 0);
        assertFalse(q.launchActive());
        assertEq(q.LAUNCH_END_BLOCK(), block.number);
        _tryBuy(q, alice, 2_000_000e18);
        _tryBuy(q, alice, 2_000_000e18);
        // Non-zero caps with zero blocks are also ignored.
        CerebrProcessor q2 = _launch(0, 1, 1);
        _tryBuy(q2, alice, 1_000_000e18);
    }

    function test_LaunchSellsAndTapeOutsUncappedAndSellsNetCap() public {
        CerebrProcessor q = _launch(100, 5_000e18, 5_000e18);
        _tryBuy(q, alice, 5_000e18);
        vm.prank(alice);
        q.sellTransistors(1_000e18, 0); // never capped
        (uint256 w, uint256 g) = q.launchCapRemaining(alice);
        assertEq(w, 1_000e18, "same-block sell gives back wallet usage (net caps)");
        assertEq(g, 1_000e18, "same-block sell gives back block usage (net caps)");
        _tryBuy(q, alice, 1_000e18);
        (w, g) = q.launchCapRemaining(alice);
        assertEq(w, 0);
        assertEq(g, 0);
        // Selling more than this block's usage saturates at zero and never reverts.
        vm.prank(alice);
        q.sellTransistors(5_000e18, 0);
        (w, g) = q.launchCapRemaining(alice);
        assertEq(w, 5_000e18);
        assertEq(g, 5_000e18);
        _tryBuy(q, alice, 5_000e18);
        vm.roll(block.number + 1);
        // A sell in a later block does not touch usage of a block with no buys.
        vm.prank(alice);
        q.sellTransistors(1_000e18, 0);
        (w, g) = q.launchCapRemaining(alice);
        assertEq(w, 5_000e18);
        assertEq(g, 5_000e18);
        _tryBuy(q, alice, 1_000e18);
        vm.prank(alice);
        q.tapeOutCircuit(); // tape-out unaffected
        assertTrue(q.launchActive());
        // Sell everything else during the window, even while paused.
        _tryBuy(q, bob, 4_000e18); // block cap: 5,000 - alice's 1,000
        vm.prank(owner);
        q.pause();
        vm.prank(bob);
        q.sellTransistors(4_000e18, 0);
    }

    /// Round-2 LOW regression: an atomic buy+sell (multi-wallet griefer) can no longer fill the
    /// global block cap and lock honest buyers out.
    function test_LaunchAtomicRoundTripCannotFillBlockCap() public {
        CerebrProcessor q = _launch(100, 25_000e18, 100_000e18);
        address[4] memory bots = [makeAddr("bot0"), makeAddr("bot1"), makeAddr("bot2"), makeAddr("bot3")];
        for (uint256 i; i < 4; ++i) {
            _tryBuy(q, bots[i], 25_000e18);
        }
        (, uint256 g) = q.launchCapRemaining(alice);
        assertEq(g, 0, "cap filled");
        for (uint256 i; i < 4; ++i) {
            vm.prank(bots[i]);
            q.sellTransistors(25_000e18, 0);
        }
        (uint256 w, uint256 g2) = q.launchCapRemaining(alice);
        assertEq(g2, 100_000e18, "round trip released the block cap");
        assertEq(w, 25_000e18);
        _tryBuy(q, alice, 25_000e18); // honest buyer still gets in
        assertEq(q.balanceOf(alice), 25_000e18);
    }

    function test_CurveParamsUpperBound() public {
        address r = address(registry6551);
        address i = address(accountImpl6551);
        uint256 m = 1e36;
        vm.expectRevert(CerebrProcessor.InvalidCurveParams.selector);
        new CerebrProcessor(m + 1, 1e8, owner, 0, 0, 0, r, i);
        vm.expectRevert(CerebrProcessor.InvalidCurveParams.selector);
        new CerebrProcessor(1e12, m + 1, owner, 0, 0, 0, r, i);
        CerebrProcessor q = new CerebrProcessor(m, m, owner, 0, 0, 0, r, i);
        assertEq(q.MAX_CURVE_PARAM(), m);
        // The whole curve is quotable at the bounds.
        q.quoteBuy(q.MAX_SUPPLY());
    }

    function test_LaunchRevertedBuyDoesNotConsumeCap() public {
        CerebrProcessor q = _launch(10, 1_000e18, 1_000e18);
        uint256 cost = q.quoteBuy(1_000e18);
        vm.deal(alice, cost);
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.SlippageExceeded.selector);
        q.buyTransistors{value: cost}(1_000e18, cost - 1);
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.InsufficientPayment.selector);
        q.buyTransistors{value: cost - 1}(1_000e18, cost);
        (uint256 w, uint256 g) = q.launchCapRemaining(alice);
        assertEq(w, 1_000e18);
        assertEq(g, 1_000e18);
        vm.prank(alice);
        q.buyTransistors{value: cost}(1_000e18, cost);
    }

    function test_LaunchParamsValidated() public {
        address r = address(registry6551);
        address i = address(accountImpl6551);
        uint256 max = 10_000_000e18;
        vm.expectRevert(CerebrProcessor.InvalidLaunchParams.selector);
        new CerebrProcessor(1e12, 1e8, owner, 10, 0, 1e18, r, i);
        vm.expectRevert(CerebrProcessor.InvalidLaunchParams.selector);
        new CerebrProcessor(1e12, 1e8, owner, 10, 1e18, 0, r, i);
        vm.expectRevert(CerebrProcessor.InvalidLaunchParams.selector);
        new CerebrProcessor(1e12, 1e8, owner, 1_000_001, 1e18, 1e18, r, i);
        vm.expectRevert(CerebrProcessor.InvalidLaunchParams.selector);
        new CerebrProcessor(1e12, 1e8, owner, 10, max + 1, 1e18, r, i);
        vm.expectRevert(CerebrProcessor.InvalidLaunchParams.selector);
        new CerebrProcessor(1e12, 1e8, owner, 10, 1e18, max + 1, r, i);
        vm.expectRevert(CerebrCircuit.InvalidERC6551Config.selector);
        new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, address(0xdead), i);
        vm.expectRevert(CerebrCircuit.InvalidERC6551Config.selector);
        new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, r, address(0xbeef));
        // Boundaries are accepted.
        CerebrProcessor q = new CerebrProcessor(1e12, 1e8, owner, 1_000_000, max, max, r, i);
        assertEq(q.LAUNCH_END_BLOCK(), block.number + 1_000_000);
        assertEq(q.WALLET_CAP_PER_BLOCK(), max);
        assertEq(q.BLOCK_CAP(), max);
        q = new CerebrProcessor(1e12, 1e8, owner, 1, 1, 1, r, i);
        assertTrue(q.launchActive());
    }

    uint256 internal fzBlockUsed;
    mapping(address => uint256) internal fzWalletUsed;
    uint256 internal fzLastBlock;
    uint256 internal constant FZ_WCAP = 700e18;
    uint256 internal constant FZ_BCAP = 1_500e18;

    function _fzStep(CerebrProcessor q, address u, uint256 amt) internal {
        if (block.number != fzLastBlock) {
            fzBlockUsed = 0;
            fzWalletUsed[alice] = 0;
            fzWalletUsed[bob] = 0;
            fzWalletUsed[carol] = 0;
            fzLastBlock = block.number;
        }
        bool active = q.launchActive();
        // Every fourth step that holds CBR sells instead (net-buy caps give back same-block usage).
        if (amt % 4 == 0 && q.balanceOf(u) != 0) {
            uint256 sellAmt = amt > q.balanceOf(u) ? q.balanceOf(u) : amt;
            vm.prank(u);
            q.sellTransistors(sellAmt, 0); // never reverts because of the guard
            if (active) {
                fzBlockUsed = fzBlockUsed > sellAmt ? fzBlockUsed - sellAmt : 0;
                fzWalletUsed[u] = fzWalletUsed[u] > sellAmt ? fzWalletUsed[u] - sellAmt : 0;
                (uint256 wr2, uint256 br2) = q.launchCapRemaining(u);
                assertEq(wr2, FZ_WCAP - fzWalletUsed[u]);
                assertEq(br2, FZ_BCAP - fzBlockUsed);
            }
            return;
        }
        bool shouldPass = !active || (fzBlockUsed + amt <= FZ_BCAP && fzWalletUsed[u] + amt <= FZ_WCAP);
        vm.deal(u, 100 ether);
        vm.prank(u);
        (bool ok,) = address(q).call{value: 100 ether}(abi.encodeCall(q.buyTransistors, (amt, type(uint256).max)));
        assertEq(ok, shouldPass, "cap decision mismatch");
        if (ok) {
            fzBlockUsed += amt;
            fzWalletUsed[u] += amt;
        }
        if (active) {
            assertLe(fzBlockUsed, FZ_BCAP);
            assertLe(fzWalletUsed[u], FZ_WCAP);
            (uint256 wr, uint256 br) = q.launchCapRemaining(u);
            assertEq(wr, FZ_WCAP - fzWalletUsed[u]);
            assertEq(br, FZ_BCAP - fzBlockUsed);
        }
    }

    /// @dev Random multi-wallet, multi-block buys during the window never exceed either cap.
    function testFuzz_LaunchCapsHold(uint256[12] memory amounts, uint8[12] memory who, uint8[12] memory adv) public {
        CerebrProcessor q = _launch(8, FZ_WCAP, FZ_BCAP);
        address[3] memory users = [alice, bob, carol];
        fzLastBlock = block.number;
        for (uint256 i; i < 12; ++i) {
            if (adv[i] % 3 == 0) vm.roll(block.number + 1);
            _fzStep(q, users[who[i] % 3], bound(amounts[i], 1, 1_000e18));
        }
    }

    // ================================================================ counters

    function test_BurnCounterExcludesSellsIncludesFusion() public {
        _buy(alice, 50_000e18);
        vm.prank(alice);
        p.sellTransistors(10_000e18, 0);
        assertEq(p.totalCbrBurned(), 0, "sells counted");
        uint256 a = _tape(alice, Tier.Basic);
        uint256 b = _tape(alice, Tier.Basic);
        _reveal(a);
        _reveal(b);
        vm.prank(alice);
        p.fuseCircuits(a, b);
        assertEq(p.totalCbrBurned(), 3 * BASIC);
        _tape(alice, Tier.Pro);
        assertEq(p.totalCbrBurned(), 3 * BASIC + PRO);
    }

    function test_SurplusGrowsOnFusion() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        _buy(alice, BASIC);
        uint256 surplus = p.surplusReserve();
        (uint256 value,,) = p.quoteSell(BASIC);
        vm.prank(alice);
        p.fuseCircuits(a, b);
        assertGe(p.surplusReserve() + 2, surplus + value);
        // After everyone exits, the burned backing remains as surplus and fees stay separate.
        vm.prank(alice);
        vm.expectRevert(); // alice has 0 CBR
        p.sellTransistors(1, 0);
        assertEq(p.totalSupply(), 0);
        assertEq(p.reserveRequired(), 0);
        assertEq(p.surplusReserve(), address(p).balance - p.protocolFees());
    }

    function test_MintedByTierAndTotalMintedConsistent() public {
        _make(alice, Tier.Singularity); // 2 Q + 1 S
        _make(alice, Tier.Basic);
        _make(alice, Tier.Pro);
        uint256 sum;
        for (uint8 t; t < 4; ++t) {
            sum += c.mintedByTier(Tier(t));
        }
        assertEq(sum, c.totalMinted());
        assertEq(c.mintedByTier(Tier.Quantum), 2);
        assertEq(c.mintedByTier(Tier.Singularity), 1);
        assertEq(c.mintedByTier(Tier.Basic), 1);
        assertEq(c.mintedByTier(Tier.Pro), 1);
    }

    // ================================================================ TBA cycles and nesting

    function test_CycleProtectionDirect() public {
        uint256 a = _make(alice, Tier.Basic);
        uint256 b = _make(alice, Tier.Basic);
        _buy(alice, BASIC);
        vm.prank(alice);
        uint256 child = p.fuseCircuits(a, b);

        address childTba = c.tokenBoundAccount(child);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, child));
        c.transferFrom(alice, childTba, child);

        address aTba = c.tokenBoundAccount(a);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, child));
        c.transferFrom(alice, aTba, child);

        // safeTransferFrom is also guarded (to an undeployed TBA there is no receiver hook).
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, child));
        c.safeTransferFrom(alice, aTba, child);

        vm.prank(alice);
        c.transferFrom(alice, bob, child);
        assertEq(c.ownerOf(child), bob);
    }

    function test_SelfTbaTransferViaTbaItself() public {
        // A TBA cannot send its own token to itself either.
        uint256 x = _make(alice, Tier.Basic);
        address tbaX = c.tokenBoundAccount(x);
        uint256 y = _make(alice, Tier.Basic);
        vm.prank(alice);
        c.transferFrom(alice, tbaX, y); // y inside x
        address tbaY = c.tokenBoundAccount(y);
        // tbaX moving y into y's own TBA: cycle.
        vm.prank(tbaX);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, y));
        c.transferFrom(tbaX, tbaY, y);
        // Alice putting x into tbaY: x -> tbaY -> y -> tbaX -> x: cycle.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, x));
        c.transferFrom(alice, tbaY, x);
    }

    /// @dev Chain c[0] in TBA(c[1]) in ... in TBA(c[n-1]), alice owns c[n-1].
    function _chain(uint256 n) internal returns (uint256[] memory ids) {
        ids = new uint256[](n);
        _buy(alice, n * BASIC);
        vm.startPrank(alice);
        for (uint256 i; i < n; ++i) {
            ids[i] = p.tapeOutCircuit();
        }
        for (uint256 i; i + 1 < n; ++i) {
            c.transferFrom(alice, c.tokenBoundAccount(ids[i + 1]), ids[i]);
        }
        vm.stopPrank();
    }

    function test_NestingDepthBoundary() public {
        uint256[] memory ids = _chain(16);
        _buy(alice, 2 * BASIC);
        vm.startPrank(alice);
        uint256 extra = p.tapeOutCircuit();
        address tba0 = c.tokenBoundAccount(ids[0]);
        address tba1 = c.tokenBoundAccount(ids[1]);
        // Into TBA(ids[0]): 16 Circuit hops above it -> too deep.
        vm.expectRevert(CerebrCircuit.NestingTooDeep.selector);
        c.transferFrom(alice, tba0, extra);
        // Into TBA(ids[1]): 15 hops -> allowed.
        c.transferFrom(alice, tba1, extra);
        vm.stopPrank();
        assertEq(c.ownerOf(extra), c.tokenBoundAccount(ids[1]));

        // The top of the chain into the bottom TBA is a cycle (detected exactly at the 16th hop).
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, ids[15]));
        c.transferFrom(alice, tba0, ids[15]);

        // Deeply nested tokens can always be withdrawn to an EOA by their direct holder.
        address holder = c.tokenBoundAccount(ids[1]);
        vm.prank(holder);
        c.transferFrom(holder, alice, ids[0]);
        assertEq(c.ownerOf(ids[0]), alice);
    }

    function test_DeepChainCycleBeyondDepthStillReverts() public {
        uint256[] memory ids = _chain(18);
        address tba0 = c.tokenBoundAccount(ids[0]);
        // Cycle longer than MAX_NESTING_DEPTH: still blocked (as NestingTooDeep).
        vm.prank(alice);
        vm.expectRevert(CerebrCircuit.NestingTooDeep.selector);
        c.transferFrom(alice, tba0, ids[17]);
    }

    function test_TokenOfAccountMapping() public {
        _buy(alice, 2 * BASIC);
        uint256 a = _tape(alice, Tier.Basic);
        uint256 b = _tape(alice, Tier.Basic);
        assertEq(c.tokenOfAccount(c.tokenBoundAccount(a)), a);
        assertEq(c.tokenOfAccount(c.tokenBoundAccount(b)), b);
        assertTrue(c.tokenBoundAccount(a) != c.tokenBoundAccount(b));
        assertEq(c.tokenOfAccount(alice), 0);
        // Counterfactual address equals what the registry later deploys.
        address created = registry6551.createAccount(address(accountImpl6551), bytes32(0), block.chainid, address(c), a);
        assertEq(created, c.tokenBoundAccount(a));
        assertGt(created.code.length, 0);
    }
}

contract Atomic {
    CerebrProcessor internal immutable P;

    constructor(CerebrProcessor p) {
        P = p;
    }

    function tapeAndReveal() external {
        uint256 id = P.tapeOutCircuit();
        P.CIRCUIT().reveal(id);
    }
}
