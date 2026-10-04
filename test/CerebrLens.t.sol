// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {CerebrLens} from "../src/CerebrLens.sol";
import {ERC6551Registry} from "../src/erc6551/ERC6551Registry.sol";
import {CerebrAccount} from "../src/erc6551/CerebrAccount.sol";

/// @title CerebrLens tests: exact-OKB buy quotes (fuzzed optimality), snapshots, user state, chart points.
contract CerebrLensTest is Test {
    ERC6551Registry internal registry;
    CerebrAccount internal impl;
    CerebrProcessor internal p;
    CerebrCircuit internal c;
    CerebrLens internal lens;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        registry = new ERC6551Registry();
        impl = new CerebrAccount();
        p = new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, address(registry), address(impl));
        c = p.CIRCUIT();
        lens = new CerebrLens(p);
    }

    // ------------------------------------------------------------ helpers

    function _buy(CerebrProcessor proc, address who, uint256 amount) internal {
        if (amount == 0) return;
        uint256 q = proc.quoteBuy(amount);
        vm.deal(who, who.balance + q);
        vm.prank(who);
        proc.buyTransistors{value: q}(amount, q);
    }

    function _tape(address who, Tier tier) internal returns (uint256 id) {
        _buy(p, who, p.tapeOutCost(tier));
        vm.prank(who);
        id = p.tapeOutCircuitTier(tier);
    }

    function _reveal(uint256 id) internal {
        (,, uint64 commitBlock) = c.circuitInfo(id);
        if (block.number < commitBlock + 2) vm.roll(commitBlock + 2);
        vm.setBlockhash(commitBlock + 1, keccak256(abi.encode("bh", commitBlock + 1)));
        assertTrue(c.reveal(id));
    }

    /// @dev amount is affordable, exactly priced, and amount + 1 token-wei is not affordable.
    function _assertOptimal(CerebrProcessor proc, CerebrLens l, uint256 okbIn) internal view {
        (uint256 amount, uint256 cost) = l.quoteBuyExactOKB(okbIn);
        uint256 room = proc.MAX_SUPPLY() - proc.totalSupply();
        assertLe(amount, room, "above max supply");
        assertEq(cost, amount == 0 ? 0 : proc.quoteBuy(amount), "cost != quoteBuy");
        assertLe(cost, okbIn, "over budget");
        if (amount < room) assertGt(proc.quoteBuy(amount + 1), okbIn, "not optimal");
    }

    // ------------------------------------------------------------ quoteBuyExactOKB

    function test_QuoteBuyExactOKB_Edges() public {
        (uint256 amount, uint256 cost) = lens.quoteBuyExactOKB(0);
        assertEq(cost, 0);
        assertGt(p.quoteBuy(amount + 1), 0);
        _assertOptimal(p, lens, 0);
        _assertOptimal(p, lens, 1);
        _assertOptimal(p, lens, 2);
        _assertOptimal(p, lens, 3);
        _assertOptimal(p, lens, 1 ether);

        // Whole curve and beyond.
        uint256 fill = p.quoteBuy(p.MAX_SUPPLY());
        (amount, cost) = lens.quoteBuyExactOKB(fill);
        assertEq(amount, p.MAX_SUPPLY());
        assertEq(cost, fill);
        (amount,) = lens.quoteBuyExactOKB(type(uint128).max);
        assertEq(amount, p.MAX_SUPPLY());
        _assertOptimal(p, lens, fill - 1);

        // Sold out.
        _buy(p, alice, p.MAX_SUPPLY());
        (amount, cost) = lens.quoteBuyExactOKB(1000 ether);
        assertEq(amount, 0);
        assertEq(cost, 0);
    }

    function test_QuoteBuyExactOKB_BuysWhatItQuotes() public {
        _buy(p, bob, 1_234_567e18);
        uint256 budget = 3.3 ether;
        uint256 g = gasleft();
        (uint256 amount, uint256 cost) = lens.quoteBuyExactOKB(budget);
        assertLt(g - gasleft(), 300_000, "quote gas");
        vm.deal(alice, budget);
        vm.prank(alice);
        uint256 charged = p.buyTransistors{value: budget}(amount, budget);
        assertEq(charged, cost);
        assertEq(p.balanceOf(alice), amount);
        assertEq(alice.balance, budget - cost);
    }

    function testFuzz_QuoteBuyExactOKB(uint256 supply, uint256 okbIn) public {
        supply = bound(supply, 0, p.MAX_SUPPLY());
        _buy(p, bob, supply);
        okbIn = bound(okbIn, 0, 6_000 ether);
        _assertOptimal(p, lens, okbIn);
    }

    function testFuzz_QuoteBuyExactOKB_SmallBudgets(uint256 supply, uint256 okbIn) public {
        supply = bound(supply, 0, p.MAX_SUPPLY());
        _buy(p, bob, supply);
        okbIn = bound(okbIn, 0, 1e15);
        _assertOptimal(p, lens, okbIn);
    }

    /// @notice Optimality holds for arbitrary curve parameters too.
    function testFuzz_QuoteBuyExactOKB_AnyCurve(uint256 base, uint256 slope, uint256 supply, uint256 okbIn) public {
        base = bound(base, 1, 1e21);
        slope = bound(slope, 1, 1e15);
        CerebrProcessor proc = new CerebrProcessor(base, slope, owner, 0, 0, 0, address(registry), address(impl));
        CerebrLens l = new CerebrLens(proc);
        supply = bound(supply, 0, proc.MAX_SUPPLY());
        _buy(proc, bob, supply);
        uint256 room = proc.MAX_SUPPLY() - supply;
        uint256 fill = room == 0 ? 0 : proc.quoteBuy(room);
        okbIn = bound(okbIn, 0, fill + 1);
        _assertOptimal(proc, l, okbIn);
    }

    function test_QuoteSellPassThrough() public {
        _buy(p, alice, 50_000e18);
        (uint256 g1, uint256 f1, uint256 n1) = lens.quoteSell(10_000e18);
        (uint256 g2, uint256 f2, uint256 n2) = p.quoteSell(10_000e18);
        assertEq(g1, g2);
        assertEq(f1, f2);
        assertEq(n1, n2);
        assertEq(lens.quoteBuy(1e18), p.quoteBuy(1e18));
    }

    // ------------------------------------------------------------ snapshots

    function test_ProtocolState() public {
        _tape(alice, Tier.Basic);
        _tape(alice, Tier.Pro);
        _buy(p, bob, 10_000e18);
        vm.prank(bob);
        p.sellTransistors(4_000e18, 0);

        CerebrLens.ProtocolState memory st = lens.protocolState();
        assertEq(st.blockNumber, block.number);
        assertEq(st.totalSupply, p.totalSupply());
        assertEq(st.maxSupply, p.MAX_SUPPLY());
        assertEq(st.currentPrice, p.currentPrice());
        assertEq(st.basePrice, 1e12);
        assertEq(st.slope, 1e8);
        assertEq(st.balance, address(p).balance);
        assertEq(st.reserveRequired, p.reserveRequired());
        assertEq(st.protocolFees, p.protocolFees());
        assertGt(st.protocolFees, 0);
        assertEq(st.surplusReserve, p.surplusReserve());
        assertGt(st.surplusReserve, 0);
        assertEq(st.totalCbrBurned, 25_000e18);
        assertEq(st.totalCircuits, 2);
        assertEq(st.mintedByTier[0], 1);
        assertEq(st.mintedByTier[1], 1);
        assertEq(st.mintedByTier[2], 0);
        assertEq(st.mintedByTier[3], 0);
        assertEq(st.tapeOutCosts[0], 5_000e18);
        assertEq(st.tapeOutCosts[1], 20_000e18);
        assertEq(st.tapeOutCosts[2], 100_000e18);
        assertEq(st.sellFeeBps, 100);
        assertFalse(st.paused);
        assertFalse(st.launchActive);
        assertEq(st.processor, address(p));
        assertEq(st.circuit, address(c));
        assertEq(st.erc6551Registry, address(registry));
        assertEq(st.accountImplementation, address(impl));

        vm.prank(owner);
        p.pause();
        assertTrue(lens.protocolState().paused);
    }

    function test_UserState() public {
        uint256 a = _tape(alice, Tier.Basic);
        uint256 b = _tape(alice, Tier.Basic);
        uint256 q = _tape(alice, Tier.Quantum);
        uint256 bobs = _tape(bob, Tier.Pro);
        _buy(p, alice, 7_000e18); // same block as the mints: nothing is ready for auto-reveal
        _reveal(a);
        _reveal(b);

        CerebrLens.UserState memory u = lens.userState(alice);
        assertEq(u.user, alice);
        assertEq(u.cbrBalance, 7_000e18);
        assertEq(u.okbBalance, alice.balance);
        assertEq(u.launchWalletRemaining, type(uint256).max);
        assertEq(u.launchBlockRemaining, type(uint256).max);
        assertEq(u.circuits.length, 3);
        assertEq(u.circuits[0].id, a);
        assertEq(u.circuits[1].id, b);
        assertEq(u.circuits[2].id, q);

        CerebrLens.CircuitView memory v = u.circuits[0];
        assertEq(uint8(v.tier), uint8(Tier.Basic));
        assertTrue(v.revealed);
        assertTrue(v.traits.revealed);
        assertEq(v.seed, c.seedOf(a));
        assertEq(v.traits.cores, c.computeTraits(c.seedOf(a), Tier.Basic).cores);
        assertEq(keccak256(bytes(v.traits.rarity)), keccak256(bytes(c.traits(a).rarity)));
        assertEq(v.tba, c.tokenBoundAccount(a));
        assertEq(v.tba, registry.account(address(impl), bytes32(0), block.chainid, address(c), a));
        assertFalse(v.tbaDeployed);
        assertEq(v.revealReadyBlock, c.revealReadyBlock(a));

        CerebrLens.CircuitView memory vq = u.circuits[2];
        assertEq(uint8(vq.tier), uint8(Tier.Quantum));
        assertFalse(vq.revealed);
        assertFalse(vq.traits.revealed);
        assertEq(uint8(vq.traits.tier), uint8(Tier.Quantum));
        assertEq(vq.seed, 0);
        assertEq(bytes(vq.traits.rarity).length, 0);

        // Activate + fund a's wallet.
        registry.createAccount(address(impl), bytes32(0), block.chainid, address(c), a);
        vm.deal(c.tokenBoundAccount(a), 2 ether);
        v = lens.userState(alice).circuits[0];
        assertTrue(v.tbaDeployed);
        assertEq(v.tbaBalance, 2 ether);

        // Fusion: parents leave alice's direct holdings, the child joins.
        vm.prank(alice);
        uint256 child = p.fuseCircuits(a, b);
        u = lens.userState(alice);
        assertEq(u.circuits.length, 2);
        assertEq(u.circuits[0].id, q);
        assertEq(u.circuits[1].id, child);
        assertEq(uint8(u.circuits[1].tier), uint8(Tier.Pro));
        assertEq(u.cbrBalance, 2_000e18);
        // The parents show up under the child's wallet.
        CerebrLens.UserState memory nested = lens.userState(c.tokenBoundAccount(child));
        assertEq(nested.circuits.length, 2);
        assertEq(nested.circuits[0].id, a);
        assertEq(nested.circuits[1].id, b);
        assertEq(nested.circuits[0].fusedInto, child, "parent A fused mark");
        assertEq(nested.circuits[1].fusedInto, child, "parent B fused mark");
        assertEq(u.circuits[1].fusedInto, 0, "child not fused");

        // Transfer moves the view to bob.
        vm.prank(alice);
        c.transferFrom(alice, bob, q);
        u = lens.userState(bob);
        assertEq(u.circuits.length, 2);
        assertEq(u.circuits[0].id, q); // ascending id order
        assertEq(u.circuits[1].id, bobs);
        assertEq(lens.userState(makeAddr("nobody")).circuits.length, 0);
    }

    function test_UserStateLaunchCaps() public {
        CerebrProcessor proc =
            new CerebrProcessor(1e12, 1e8, owner, 100, 25_000e18, 100_000e18, address(registry), address(impl));
        CerebrLens l = new CerebrLens(proc);
        _buy(proc, alice, 10_000e18);
        CerebrLens.UserState memory u = l.userState(alice);
        assertEq(u.launchWalletRemaining, 15_000e18);
        assertEq(u.launchBlockRemaining, 90_000e18);
        assertTrue(l.protocolState().launchActive);
        assertEq(l.protocolState().launchEndBlock, block.number + 100);
    }

    function test_CircuitViewRevertsForMissing() public {
        vm.expectRevert();
        lens.circuitView(1);
    }

    // ------------------------------------------------------------ chart

    function test_CurvePoints() public {
        _buy(p, alice, 2_500_000e18);
        (uint256[] memory s, uint256[] memory pr, uint256 cs, uint256 cp) = lens.curvePoints(10);
        assertEq(s.length, 11);
        assertEq(pr.length, 11);
        assertEq(s[0], 0);
        assertEq(s[10], p.MAX_SUPPLY());
        assertEq(pr[0], p.BASE_PRICE());
        assertEq(pr[10], p.BASE_PRICE() + p.SLOPE() * 10_000_000);
        for (uint256 i = 1; i <= 10; ++i) {
            assertGt(s[i], s[i - 1]);
            assertGt(pr[i], pr[i - 1]);
        }
        assertEq(cs, 2_500_000e18);
        assertEq(cp, p.currentPrice());
        assertEq(pr[0] + (pr[10] - pr[0]) / 4, cp);

        vm.expectRevert(CerebrLens.InvalidPointCount.selector);
        lens.curvePoints(0);
        vm.expectRevert(CerebrLens.InvalidPointCount.selector);
        lens.curvePoints(1001);
        (s,,,) = lens.curvePoints(1000);
        assertEq(s.length, 1001);
    }
}
