// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {MockERC6551Registry, DummyAccountImpl} from "./helpers/ERC6551TestHelpers.sol";

/// @dev Exposes the internal curve integral for direct property testing.
contract CurveHarness is CerebrProcessor {
    constructor(uint256 b, uint256 s, address o)
        CerebrProcessor(b, s, o, 0, 0, 0, address(new MockERC6551Registry()), address(new DummyAccountImpl()))
    {}

    function curveCost(uint256 a, uint256 b, Math.Rounding r) external view returns (uint256) {
        return _curveCost(a, b, r);
    }

    function priceAt(uint256 s) external view returns (uint256) {
        return _priceAt(s);
    }
}

/// @title Stateless fuzz tests for the Cerebr bonding curve.
contract CerebrFuzzTest is Test {
    uint256 internal constant BASE = 1e12;
    uint256 internal constant SLOPE = 1e8;
    uint256 internal constant MAX = 10_000_000e18;
    uint256 internal constant TAPEOUT = 5_000e18;

    CurveHarness internal p;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        p = new CurveHarness(BASE, SLOPE, owner);
    }

    // ------------------------------------------------------------ helpers

    function _buy(CerebrProcessor proc, address who, uint256 amount) internal returns (uint256 cost) {
        uint256 q = proc.quoteBuy(amount);
        vm.deal(who, who.balance + q);
        vm.prank(who);
        cost = proc.buyTransistors{value: q}(amount, q);
        assertEq(cost, q, "cost != quote");
    }

    function _solvent(CerebrProcessor proc) internal view {
        assertGe(address(proc).balance, proc.reserveRequired() + proc.protocolFees(), "insolvent");
    }

    // ------------------------------------------------------------ (1) solvency

    function testFuzz_SolventAfterBuySellSequence(uint256 a1, uint256 a2, uint256 s1, uint256 s2) public {
        a1 = bound(a1, 1, MAX / 2);
        a2 = bound(a2, 1, MAX - a1);
        _buy(p, alice, a1);
        _solvent(p);
        _buy(p, bob, a2);
        _solvent(p);

        s1 = bound(s1, 1, a1);
        vm.prank(alice);
        p.sellTransistors(s1, 0);
        _solvent(p);

        s2 = bound(s2, 1, a2);
        vm.prank(bob);
        p.sellTransistors(s2, 0);
        _solvent(p);

        // Everyone exits fully -> still solvent, and balance >= fees.
        uint256 ra = p.balanceOf(alice);
        if (ra > 0) {
            vm.prank(alice);
            p.sellTransistors(ra, 0);
        }
        uint256 rb = p.balanceOf(bob);
        if (rb > 0) {
            vm.prank(bob);
            p.sellTransistors(rb, 0);
        }
        assertEq(p.totalSupply(), 0);
        assertEq(p.reserveRequired(), 0);
        _solvent(p);

        if (p.protocolFees() > 0) {
            vm.prank(owner);
            p.withdrawFees(payable(owner));
        }
        _solvent(p);
    }

    /// Many tiny buys (rounding-up dust accumulates in favour of the reserve) then one big sell.
    function testFuzz_SolventManySmallBuysOneSell(uint256 seed) public {
        uint256 n = bound(seed, 1, 30);
        for (uint256 i; i < n; ++i) {
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i))), 1, 1e18);
            _buy(p, alice, amt);
        }
        _solvent(p);
        uint256 bal = p.balanceOf(alice);
        vm.prank(alice);
        p.sellTransistors(bal, 0);
        _solvent(p);
    }

    /// Many tiny sells after one big buy (rounding-down protects reserve).
    function testFuzz_SolventOneBuyManySmallSells(uint256 amount, uint256 seed) public {
        amount = bound(amount, 1e18, MAX);
        _buy(p, alice, amount);
        for (uint256 i; i < 30; ++i) {
            uint256 bal = p.balanceOf(alice);
            if (bal == 0) break;
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i))), 1, bal);
            vm.prank(alice);
            p.sellTransistors(amt, 0);
            _solvent(p);
        }
    }

    // ------------------------------------------------------------ (2) no arbitrage

    function testFuzz_BuyThenSellNoProfit(uint256 pre, uint256 amount) public {
        pre = bound(pre, 0, MAX - 1);
        amount = bound(amount, 1, MAX - pre);
        if (pre > 0) _buy(p, bob, pre);

        uint256 paid = _buy(p, alice, amount);
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 net = p.sellTransistors(amount, 0);
        assertEq(alice.balance - before, net);
        assertLe(net, paid, "arbitrage: sold for more than paid");
        _solvent(p);
    }

    /// Splitting a buy into two parts and selling in one go must not profit either.
    function testFuzz_SplitBuySingleSellNoProfit(uint256 a, uint256 b) public {
        a = bound(a, 1, MAX / 2);
        b = bound(b, 1, MAX / 2);
        uint256 paid = _buy(p, alice, a) + _buy(p, alice, b);
        vm.prank(alice);
        uint256 net = p.sellTransistors(a + b, 0);
        assertLe(net, paid);
    }

    /// Single buy then split sells must not profit.
    function testFuzz_SingleBuySplitSellNoProfit(uint256 a, uint256 b) public {
        a = bound(a, 1, MAX / 2);
        b = bound(b, 1, MAX / 2);
        uint256 paid = _buy(p, alice, a + b);
        vm.startPrank(alice);
        uint256 net = p.sellTransistors(a, 0) + p.sellTransistors(b, 0);
        vm.stopPrank();
        assertLe(net, paid);
    }

    // ------------------------------------------------------------ (3) additivity

    function testFuzz_CostAdditive(uint256 a, uint256 b, uint256 c) public view {
        a = bound(a, 0, MAX);
        b = bound(b, a, MAX);
        c = bound(c, b, MAX);
        uint256 ceilAB = p.curveCost(a, b, Math.Rounding.Ceil);
        uint256 ceilBC = p.curveCost(b, c, Math.Rounding.Ceil);
        uint256 ceilAC = p.curveCost(a, c, Math.Rounding.Ceil);
        // Buy direction: splitting never makes it cheaper, and costs at most 2 wei extra.
        assertGe(ceilAB + ceilBC, ceilAC, "split buy cheaper");
        assertLe(ceilAB + ceilBC, ceilAC + 2, "split buy > 2 wei dearer");

        uint256 floorAB = p.curveCost(a, b, Math.Rounding.Floor);
        uint256 floorBC = p.curveCost(b, c, Math.Rounding.Floor);
        uint256 floorAC = p.curveCost(a, c, Math.Rounding.Floor);
        // Sell direction: splitting never pays more, at most 2 wei less.
        assertLe(floorAB + floorBC, floorAC, "split sell pays more");
        assertGe(floorAB + floorBC + 2, floorAC, "split sell > 2 wei cheaper");

        // Ceil and floor differ by at most 2 wei (one per term).
        assertGe(ceilAC, floorAC);
        assertLe(ceilAC - floorAC, 2);
    }

    /// Integral sanity: cost is bounded by price at endpoints (trapezoid of a linear curve is exact).
    function testFuzz_CostBetweenEndpointPrices(uint256 a, uint256 b) public view {
        a = bound(a, 0, MAX - 1);
        b = bound(b, a + 1, MAX);
        uint256 d = b - a;
        uint256 c = p.curveCost(a, b, Math.Rounding.Floor);
        // Exact (unrounded) endpoint prices scaled by 1e18: BASE*1e18 + SLOPE*s.
        uint256 lo = Math.mulDiv(BASE * 1e18 + SLOPE * a, d, 1e36);
        uint256 hi = Math.mulDiv(BASE * 1e18 + SLOPE * b, d, 1e36, Math.Rounding.Ceil);
        assertGe(c + 2, lo, "below low endpoint");
        assertLe(c, hi, "above high endpoint");
    }

    function testFuzz_ZeroWidthIsFree(uint256 a) public view {
        a = bound(a, 0, MAX);
        assertEq(p.curveCost(a, a, Math.Rounding.Ceil), 0);
    }

    // ------------------------------------------------------------ (4) supply cap

    function testFuzz_CannotExceedMaxSupply(uint256 pre, uint256 extra) public {
        pre = bound(pre, 1, MAX);
        _buy(p, alice, pre);
        extra = bound(extra, MAX - pre + 1, MAX + 1);
        vm.deal(bob, type(uint128).max);
        vm.prank(bob);
        vm.expectRevert(CerebrProcessor.MaxSupplyExceeded.selector);
        p.buyTransistors{value: type(uint128).max}(extra, type(uint256).max);
        assertLe(p.totalSupply(), MAX);
    }

    // ------------------------------------------------------------ (5) monotonic price

    function testFuzz_PriceMonotonic(uint256 s1, uint256 s2) public view {
        s1 = bound(s1, 0, MAX);
        s2 = bound(s2, s1, MAX);
        assertLe(p.priceAt(s1), p.priceAt(s2));
    }

    function testFuzz_CurrentPriceRisesOnBuyFallsOnSell(uint256 a, uint256 s) public {
        a = bound(a, 1, MAX);
        uint256 p0 = p.currentPrice();
        _buy(p, alice, a);
        uint256 p1 = p.currentPrice();
        assertGe(p1, p0);
        s = bound(s, 1, a);
        vm.prank(alice);
        p.sellTransistors(s, 0);
        assertLe(p.currentPrice(), p1);
    }

    // ------------------------------------------------------------ (6) tape-out surplus

    function testFuzz_TapeOutGrowsSurplus(uint256 pre, uint256 amount) public {
        pre = bound(pre, 0, MAX - TAPEOUT);
        amount = bound(amount, TAPEOUT, MAX - pre);
        if (pre > 0) _buy(p, bob, pre);
        _buy(p, alice, amount);

        uint256 s = p.totalSupply();
        uint256 burnedValue = p.curveCost(s - TAPEOUT, s, Math.Rounding.Floor);
        uint256 surplusBefore = p.surplusReserve();
        uint256 balBefore = address(p).balance;

        vm.prank(alice);
        uint256 id = p.tapeOutCircuit();

        assertEq(address(p).balance, balBefore, "tapeOut moved OKB");
        assertEq(p.CIRCUIT().ownerOf(id), alice);
        assertEq(p.totalSupply(), s - TAPEOUT);
        uint256 surplusAfter = p.surplusReserve();
        // Surplus grows by the curve value of the burned CBR (within 2 wei rounding).
        assertGe(surplusAfter + 2, surplusBefore + burnedValue, "surplus grew too little");
        assertLe(surplusAfter, surplusBefore + burnedValue + 2, "surplus grew too much");
        _solvent(p);
    }

    /// After a tape-out, all remaining holders can fully exit and the burned backing remains locked.
    function testFuzz_TapeOutThenEveryoneExits(uint256 amount) public {
        amount = bound(amount, TAPEOUT, MAX);
        _buy(p, alice, amount);
        vm.prank(alice);
        p.tapeOutCircuit();
        uint256 rest = p.balanceOf(alice);
        if (rest > 0) {
            vm.prank(alice);
            p.sellTransistors(rest, 0);
        }
        assertEq(p.totalSupply(), 0);
        assertEq(p.reserveRequired(), 0);
        // Locked surplus is at least the curve value of the first TAPEOUT tokens... minus rounding.
        assertGe(p.surplusReserve() + 2, p.curveCost(0, TAPEOUT, Math.Rounding.Floor));
        if (p.protocolFees() > 0) {
            vm.prank(owner);
            p.withdrawFees(payable(owner));
        }
        assertGt(address(p).balance, 0, "burned backing escaped");
    }

    function testFuzz_TapeOutInsufficientReverts(uint256 amount) public {
        amount = bound(amount, 0, TAPEOUT - 1);
        if (amount > 0) _buy(p, alice, amount);
        vm.prank(alice);
        vm.expectRevert();
        p.tapeOutCircuit();
    }

    // ------------------------------------------------------------ (7) overflow at extremes

    function testFuzz_NoOverflowExtremeParams(uint256 base, uint256 slope, uint256 amount) public {
        base = bound(base, 1, 1e18);
        slope = bound(slope, 1, 1e15);
        amount = bound(amount, 1, MAX);
        CurveHarness q = new CurveHarness(base, slope, owner);

        uint256 full = q.curveCost(0, MAX, Math.Rounding.Ceil);
        assertGe(full, base * 10_000_000); // sanity
        q.priceAt(MAX);

        _buy(q, alice, amount);
        if (amount < MAX) _buy(q, bob, MAX - amount);
        assertEq(q.totalSupply(), MAX);
        _solvent(q);
        q.reserveRequired();
        q.currentPrice();
        q.quoteSell(MAX);
        q.surplusReserve();

        vm.prank(alice);
        q.sellTransistors(amount, 0);
        _solvent(q);
    }

    function test_MaxParamsFullCurve() public {
        CurveHarness q = new CurveHarness(1e18, 1e15, owner);
        uint256 cost = _buy(q, alice, MAX);
        // Exact: 1e18*1e7 + 1e15*(1e7)^2/2 = 1e25 + 5e28
        assertEq(cost, 1e25 + 5e28);
        assertEq(q.reserveRequired(), cost);
        vm.prank(alice);
        uint256 net = q.sellTransistors(MAX, 0);
        assertEq(net, cost - cost / 100);
        _solvent(q);
    }

    // ------------------------------------------------------------ misc safety

    function testFuzz_SlippageGuards(uint256 amount) public {
        amount = bound(amount, 1, MAX);
        uint256 q = p.quoteBuy(amount);
        vm.deal(alice, q);
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.SlippageExceeded.selector);
        p.buyTransistors{value: q}(amount, q - 1);

        vm.prank(alice);
        p.buyTransistors{value: q}(amount, q);
        (,, uint256 net) = p.quoteSell(amount);
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.SlippageExceeded.selector);
        p.sellTransistors(amount, net + 1);
    }

    function testFuzz_ExcessRefunded(uint256 amount, uint256 extra) public {
        amount = bound(amount, 1, MAX);
        extra = bound(extra, 0, 1000 ether);
        uint256 q = p.quoteBuy(amount);
        vm.deal(alice, q + extra);
        vm.prank(alice);
        p.buyTransistors{value: q + extra}(amount, type(uint256).max);
        assertEq(alice.balance, extra);
        assertEq(address(p).balance, q);
    }

    function testFuzz_QuoteSellMatchesSell(uint256 amount, uint256 sellAmt) public {
        amount = bound(amount, 1, MAX);
        sellAmt = bound(sellAmt, 1, amount);
        _buy(p, alice, amount);
        (uint256 gross, uint256 fee, uint256 net) = p.quoteSell(sellAmt);
        assertEq(gross, fee + net);
        assertEq(fee, gross / 100);
        uint256 feesBefore = p.protocolFees();
        vm.prank(alice);
        uint256 got = p.sellTransistors(sellAmt, net);
        assertEq(got, net);
        assertEq(p.protocolFees() - feesBefore, fee);
    }

    function testFuzz_OwnerCannotDrainReserve(uint256 amount, uint256 s) public {
        amount = bound(amount, 1e18, MAX);
        _buy(p, alice, amount);
        s = bound(s, 1, amount);
        vm.prank(alice);
        p.sellTransistors(s, 0);
        uint256 fees = p.protocolFees();
        uint256 balBefore = address(p).balance;
        if (fees == 0) return;
        vm.prank(owner);
        p.withdrawFees(payable(owner));
        assertEq(owner.balance, fees);
        assertEq(address(p).balance, balBefore - fees);
        _solvent(p);
        vm.prank(owner);
        vm.expectRevert(CerebrProcessor.ZeroAmount.selector);
        p.withdrawFees(payable(owner));
    }
}
