// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {ERC6551Fixture} from "./helpers/ERC6551TestHelpers.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @dev Re-enters the processor from its receive() hook. If `swallow` is true it catches the
///      inner revert (so the outer call can complete); otherwise it bubbles it up.
contract Reenterer {
    enum Mode {
        None,
        Buy,
        Sell,
        TapeOut,
        Withdraw
    }

    CerebrProcessor public immutable p;
    Mode public mode;
    bool public swallow;
    bool public reentered; // true if the re-entrant call SUCCEEDED
    bool public attempted;

    constructor(CerebrProcessor _p) {
        p = _p;
    }

    function setMode(Mode m, bool s) external {
        mode = m;
        swallow = s;
    }

    function buy(uint256 amount, uint256 maxCost) external payable returns (uint256) {
        return p.buyTransistors{value: msg.value}(amount, maxCost);
    }

    function sell(uint256 amount, uint256 minRefund) external returns (uint256) {
        return p.sellTransistors(amount, minRefund);
    }

    receive() external payable {
        if (mode == Mode.None || attempted) return;
        attempted = true;
        bytes memory data;
        uint256 v;
        if (mode == Mode.Buy) {
            data = abi.encodeCall(CerebrProcessor.buyTransistors, (1e18, type(uint256).max));
            v = 1 ether;
        } else if (mode == Mode.Sell) {
            data = abi.encodeCall(CerebrProcessor.sellTransistors, (1e18, 0));
        } else if (mode == Mode.TapeOut) {
            data = abi.encodeCall(CerebrProcessor.tapeOutCircuit, ());
        } else {
            data = abi.encodeCall(CerebrProcessor.withdrawFees, (payable(address(this))));
        }
        (bool ok, bytes memory ret) = address(p).call{value: v}(data);
        reentered = ok;
        if (!ok && !swallow) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

/// @dev Contract that cannot receive native OKB.
contract NoReceive {
    function buy(CerebrProcessor p, uint256 amount, uint256 maxCost) external payable {
        p.buyTransistors{value: msg.value}(amount, maxCost);
    }

    function sell(CerebrProcessor p, uint256 amount) external {
        p.sellTransistors(amount, 0);
    }
}

contract CerebrProcessorTest is Test, ERC6551Fixture {
    CerebrProcessor internal p;
    CerebrCircuit internal c;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant BASE = 1e12;
    uint256 internal constant SLOPE = 1e8;

    // Hand-computed curve values for BASE=1e12 wei, SLOPE=1e8 wei (per whole CBR):
    //   cost(a,b) = BASE*(b-a)/1e18 + SLOPE*(b-a)*(b+a)/2e36
    // 0 -> 1,000:     1e15 + 1e8*1e21*1e21/2e36       = 1e15 + 5e13     = 1_050_000_000_000_000
    // 1,000 -> 2,000: 1e15 + 1e8*1e21*3e21/2e36       = 1e15 + 1.5e14   = 1_150_000_000_000_000
    // 0 -> 2,000:     2e15 + 1e8*2e21*2e21/2e36       = 2e15 + 2e14     = 2_200_000_000_000_000
    // 0 -> 5,000:     5e15 + 1e8*5e21*5e21/2e36       = 5e15 + 1.25e15  = 6_250_000_000_000_000
    // 0 -> 10M:       1e19 + 1e8*1e25*1e25/2e36       = 1e19 + 5e21     = 5_010_000_000_000_000_000_000
    uint256 internal constant COST_0_1K = 1_050_000_000_000_000;
    uint256 internal constant COST_1K_2K = 1_150_000_000_000_000;
    uint256 internal constant COST_0_2K = 2_200_000_000_000_000;
    uint256 internal constant COST_0_5K = 6_250_000_000_000_000;
    uint256 internal constant COST_0_MAX = 5_010_000_000_000_000_000_000;

    event TransistorsBought(address indexed buyer, uint256 amount, uint256 cost, uint256 newPrice, uint256 newSupply);
    event TransistorsSold(
        address indexed seller, uint256 amount, uint256 net, uint256 fee, uint256 newPrice, uint256 newSupply
    );
    event CircuitTapedOut(
        address indexed owner, uint256 indexed tokenId, Tier indexed tier, uint256 cbrBurned, uint256 newSupply
    );
    event FeesWithdrawn(address indexed to, uint256 amount);

    function setUp() public {
        p = _deploy(BASE, SLOPE, owner);
        c = p.CIRCUIT();
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _deploy(uint256 base, uint256 slope, address o) internal returns (CerebrProcessor) {
        return new CerebrProcessor(base, slope, o, 0, 0, 0, address(registry6551), address(accountImpl6551));
    }

    /// @dev Advance past the reveal block and reveal `id` (sets the commit+1 block hash explicitly).
    function _reveal(uint256 id) internal {
        (,, uint64 commitBlock) = c.circuitInfo(id);
        if (block.number < commitBlock + 2) vm.roll(commitBlock + 2);
        vm.setBlockhash(commitBlock + 1, keccak256(abi.encode("bh", commitBlock + 1)));
        assertTrue(c.reveal(id), "reveal");
    }

    function _buy(address who, uint256 amount) internal returns (uint256 cost) {
        cost = p.quoteBuy(amount);
        vm.prank(who);
        p.buyTransistors{value: cost}(amount, cost);
    }

    function _assertSolvent() internal view {
        assertGe(address(p).balance, p.reserveRequired() + p.protocolFees(), "insolvent");
    }

    // ------------------------------------------------------------------ constructor / config

    function test_Constructor() public view {
        assertEq(p.BASE_PRICE(), BASE);
        assertEq(p.SLOPE(), SLOPE);
        assertEq(p.owner(), owner);
        assertEq(c.PROCESSOR(), address(p));
        assertEq(p.name(), "Cerebr Transistor");
        assertEq(p.symbol(), "CBR");
        assertEq(c.name(), "Cerebr Neural Circuit");
        assertEq(c.symbol(), "CIRCUIT");
        assertEq(p.MAX_SUPPLY(), 10_000_000e18);
        assertEq(p.TAPEOUT_COST(), 5_000e18);
        assertEq(p.SELL_FEE_BPS(), 100);
        assertEq(p.BPS(), 10_000);
        assertEq(p.currentPrice(), BASE);
        assertEq(p.reserveRequired(), 0);
    }

    function test_Constructor_RevertsOnZeroParams() public {
        vm.expectRevert(CerebrProcessor.InvalidCurveParams.selector);
        _deploy(0, SLOPE, owner);
        vm.expectRevert(CerebrProcessor.InvalidCurveParams.selector);
        _deploy(BASE, 0, owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        _deploy(BASE, SLOPE, address(0));
    }

    // ------------------------------------------------------------------ quotes / math

    function test_QuoteBuy_HandComputed() public {
        assertEq(p.quoteBuy(1_000e18), COST_0_1K);
        assertEq(p.quoteBuy(2_000e18), COST_0_2K);
        assertEq(p.quoteBuy(5_000e18), COST_0_5K);
        assertEq(p.quoteBuy(10_000_000e18), COST_0_MAX);
        _buy(alice, 1_000e18);
        assertEq(p.quoteBuy(1_000e18), COST_1K_2K);
        // path independence: 0->1k + 1k->2k == 0->2k
        assertEq(COST_0_1K + COST_1K_2K, COST_0_2K);
    }

    function test_CurrentPrice_HandComputed() public {
        _buy(alice, 1_000e18);
        // 1e12 + 1e8 * 1000 = 1.1e12
        assertEq(p.currentPrice(), 1_100_000_000_000);
        _buy(alice, 4_000e18);
        // 1e12 + 1e8 * 5000 = 1.5e12
        assertEq(p.currentPrice(), 1_500_000_000_000);
    }

    function test_QuoteSell_HandComputed() public {
        _buy(alice, 2_000e18);
        (uint256 gross, uint256 fee, uint256 net) = p.quoteSell(1_000e18);
        assertEq(gross, COST_1K_2K);
        assertEq(fee, 11_500_000_000_000); // 1% of 1.15e15
        assertEq(net, 1_138_500_000_000_000);
        (gross, fee, net) = p.quoteSell(2_000e18);
        assertEq(gross, COST_0_2K);
        assertEq(fee, 22_000_000_000_000);
        assertEq(net, 2_178_000_000_000_000);
    }

    function test_QuoteSell_RevertsAboveSupply() public {
        _buy(alice, 1_000e18);
        vm.expectRevert();
        p.quoteSell(1_000e18 + 1);
    }

    function test_QuoteBuy_RevertsAboveMax() public {
        vm.expectRevert(CerebrProcessor.MaxSupplyExceeded.selector);
        p.quoteBuy(10_000_000e18 + 1);
    }

    function test_Rounding_BuyUpSellDown_Dust() public {
        // 1 wei of CBR: base term = 1e12/1e18 -> ceil 1; slope term 1e8*1*1/2e36 -> ceil 1
        assertEq(p.quoteBuy(1), 2);
        _buy(alice, 1);
        (uint256 gross, uint256 fee, uint256 net) = p.quoteSell(1);
        assertEq(gross, 0);
        assertEq(fee, 0);
        assertEq(net, 0);
        assertEq(p.reserveRequired(), 2);
        _assertSolvent();
    }

    function test_ReserveRequired_MatchesPaid() public {
        _buy(alice, 1_000e18);
        _buy(bob, 1_000e18);
        assertEq(p.reserveRequired(), COST_0_2K);
        assertEq(address(p).balance, COST_0_2K);
        assertEq(p.surplusReserve(), 0);
    }

    // ------------------------------------------------------------------ buy

    function test_Buy_MintsAndCharges() public {
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 cost = p.buyTransistors{value: COST_0_1K}(1_000e18, COST_0_1K);
        assertEq(cost, COST_0_1K);
        assertEq(p.balanceOf(alice), 1_000e18);
        assertEq(p.totalSupply(), 1_000e18);
        assertEq(alice.balance, before - COST_0_1K);
        assertEq(address(p).balance, COST_0_1K);
    }

    function test_Buy_RefundsExcess() public {
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 cost = p.buyTransistors{value: 5 ether}(1_000e18, type(uint256).max);
        assertEq(cost, COST_0_1K);
        assertEq(alice.balance, before - COST_0_1K);
        assertEq(address(p).balance, COST_0_1K);
    }

    function test_Buy_EmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(p));
        emit TransistorsBought(alice, 1_000e18, COST_0_1K, 1_100_000_000_000, 1_000e18);
        vm.prank(alice);
        p.buyTransistors{value: COST_0_1K}(1_000e18, COST_0_1K);
    }

    function test_Buy_RevertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.ZeroAmount.selector);
        p.buyTransistors{value: 1 ether}(0, type(uint256).max);
    }

    function test_Buy_RevertsSlippage() public {
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.SlippageExceeded.selector);
        p.buyTransistors{value: 1 ether}(1_000e18, COST_0_1K - 1);
    }

    function test_Buy_SlippageAfterFrontRun() public {
        uint256 quoted = p.quoteBuy(1_000e18);
        _buy(bob, 1_000e18); // front-runner moves the price
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.SlippageExceeded.selector);
        p.buyTransistors{value: 1 ether}(1_000e18, quoted);
    }

    function test_Buy_RevertsInsufficientPayment() public {
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.InsufficientPayment.selector);
        p.buyTransistors{value: COST_0_1K - 1}(1_000e18, type(uint256).max);
    }

    function test_Buy_MaxSupplyExactlyThenCap() public {
        vm.deal(alice, COST_0_MAX + 1 ether);
        vm.prank(alice);
        uint256 cost = p.buyTransistors{value: COST_0_MAX}(10_000_000e18, COST_0_MAX);
        assertEq(cost, COST_0_MAX);
        assertEq(p.totalSupply(), p.MAX_SUPPLY());
        // price at cap: 1e12 + 1e8 * 1e7 = 1.001e15
        assertEq(p.currentPrice(), 1_001_000_000_000_000);

        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.MaxSupplyExceeded.selector);
        p.buyTransistors{value: 1 ether}(1, type(uint256).max);
        _assertSolvent();
    }

    function test_Buy_RevertsOverMax() public {
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.MaxSupplyExceeded.selector);
        p.buyTransistors{value: 1 ether}(10_000_000e18 + 1, type(uint256).max);
    }

    function test_Buy_RefundToNonReceiverReverts() public {
        NoReceive nr = new NoReceive();
        vm.deal(address(nr), 0);
        // exact payment: no refund needed, succeeds
        nr.buy{value: COST_0_1K}(p, 1_000e18, COST_0_1K);
        assertEq(p.balanceOf(address(nr)), 1_000e18);
        // overpayment: refund fails -> whole tx reverts
        vm.expectRevert(CerebrProcessor.TransferFailed.selector);
        nr.buy{value: 1 ether}(p, 1_000e18, type(uint256).max);
    }

    function test_DirectDepositReverts() public {
        vm.prank(alice);
        (bool ok, bytes memory ret) = address(p).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(bytes4(ret), CerebrProcessor.DirectDepositsDisabled.selector);
    }

    // ------------------------------------------------------------------ sell

    function test_Sell_RefundsNetAndAccruesFee() public {
        _buy(alice, 2_000e18);
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 net = p.sellTransistors(1_000e18, 0);
        assertEq(net, 1_138_500_000_000_000);
        assertEq(alice.balance, before + net);
        assertEq(p.balanceOf(alice), 1_000e18);
        assertEq(p.totalSupply(), 1_000e18);
        assertEq(p.protocolFees(), 11_500_000_000_000);
        // contract keeps 0->1k reserve + fee
        assertEq(address(p).balance, COST_0_1K + 11_500_000_000_000);
        assertEq(p.reserveRequired(), COST_0_1K);
        _assertSolvent();
    }

    function test_Sell_EmitsEvent() public {
        _buy(alice, 2_000e18);
        vm.expectEmit(true, false, false, true, address(p));
        emit TransistorsSold(alice, 1_000e18, 1_138_500_000_000_000, 11_500_000_000_000, 1_100_000_000_000, 1_000e18);
        vm.prank(alice);
        p.sellTransistors(1_000e18, 0);
    }

    function test_Sell_RevertsSlippage() public {
        _buy(alice, 2_000e18);
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.SlippageExceeded.selector);
        p.sellTransistors(1_000e18, 1_138_500_000_000_000 + 1);
        // exact minRefund passes
        vm.prank(alice);
        p.sellTransistors(1_000e18, 1_138_500_000_000_000);
    }

    function test_Sell_RevertsZero() public {
        vm.prank(alice);
        vm.expectRevert(CerebrProcessor.ZeroAmount.selector);
        p.sellTransistors(0, 0);
    }

    function test_Sell_RevertsInsufficientBalance() public {
        _buy(alice, 1_000e18);
        _buy(bob, 1_000e18);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 1_000e18, 1_500e18)
        );
        p.sellTransistors(1_500e18, 0);
    }

    function test_Sell_FullRoundTripLosesOnlyFee() public {
        uint256 start = alice.balance;
        uint256 cost = _buy(alice, 5_000e18);
        vm.prank(alice);
        uint256 net = p.sellTransistors(5_000e18, 0);
        assertEq(cost, COST_0_5K);
        assertEq(net, COST_0_5K - COST_0_5K / 100);
        assertEq(start - alice.balance, COST_0_5K / 100);
        assertEq(p.totalSupply(), 0);
        assertEq(address(p).balance, p.protocolFees());
    }

    function test_Sell_ToNonReceiverReverts() public {
        NoReceive nr = new NoReceive();
        nr.buy{value: COST_0_1K}(p, 1_000e18, COST_0_1K);
        vm.expectRevert(CerebrProcessor.TransferFailed.selector);
        nr.sell(p, 1_000e18);
        assertEq(p.balanceOf(address(nr)), 1_000e18); // burn rolled back
    }

    // ------------------------------------------------------------------ tape-out

    function test_TapeOut_BurnsExactlyAndMintsSequentialIds() public {
        _buy(alice, 12_000e18);
        uint256 supplyBefore = p.totalSupply();

        vm.prank(alice);
        uint256 id1 = p.tapeOutCircuit();
        assertEq(id1, 1);
        assertEq(p.balanceOf(alice), 7_000e18);
        assertEq(p.totalSupply(), supplyBefore - 5_000e18);
        assertEq(c.ownerOf(1), alice);

        vm.prank(alice);
        uint256 id2 = p.tapeOutCircuit();
        assertEq(id2, 2);
        assertEq(p.balanceOf(alice), 2_000e18);
        assertEq(c.ownerOf(2), alice);
        assertEq(c.balanceOf(alice), 2);
        assertEq(c.totalMinted(), 2);

        _buy(bob, 5_000e18);
        vm.prank(bob);
        assertEq(p.tapeOutCircuit(), 3);
        assertEq(c.ownerOf(3), bob);
        assertEq(p.balanceOf(bob), 0);
    }

    function test_TapeOut_EmitsEventUnrevealed() public {
        _buy(alice, 5_000e18);
        vm.expectEmit(true, true, true, true, address(p));
        emit CircuitTapedOut(alice, 1, Tier.Basic, 5_000e18, 0);
        vm.prank(alice);
        p.tapeOutCircuit();
        assertEq(c.seedOf(1), 0);
        (Tier tier, bool revealed, uint64 commitBlock) = c.circuitInfo(1);
        assertEq(uint8(tier), uint8(Tier.Basic));
        assertFalse(revealed);
        assertEq(commitBlock, block.number);
        assertEq(p.totalCbrBurned(), 5_000e18);
    }

    function test_RenounceOwnership_Disabled() public {
        vm.prank(owner);
        vm.expectRevert(CerebrProcessor.RenounceDisabled.selector);
        p.renounceOwnership();
        assertEq(p.owner(), owner);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        p.renounceOwnership();
    }

    function test_Circuit_ContractURI() public view {
        bytes memory uri = bytes(c.contractURI());
        assertTrue(_contains(uri, bytes("data:application/json;base64,")), "prefix");
        assertGt(uri.length, 200);
    }

    function test_TapeOut_RevertsWithoutBalance() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 0, 5_000e18));
        p.tapeOutCircuit();

        _buy(alice, 4_999e18);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 4_999e18, 5_000e18)
        );
        p.tapeOutCircuit();
        assertEq(c.totalMinted(), 0);
    }

    function test_TapeOut_CreatesSurplusAndLowersPrice() public {
        _buy(alice, 10_000e18);
        uint256 priceBefore = p.currentPrice();
        assertEq(p.surplusReserve(), 0);
        vm.prank(alice);
        p.tapeOutCircuit();
        // Supply drops 10k -> 5k: price drops (curve is supply-driven) ...
        assertLt(p.currentPrice(), priceBefore);
        assertEq(p.currentPrice(), 1_500_000_000_000);
        // ... but the backing of the burned 5k (cost 5k->10k) stays as surplus.
        // cost(5k,10k) = 5e15 + 1e8*5e21*15e21/2e36 = 5e15 + 3.75e15 = 8.75e15
        assertEq(p.surplusReserve(), 8_750_000_000_000_000);
        assertEq(p.reserveRequired(), COST_0_5K);
        _assertSolvent();
    }

    // ------------------------------------------------------------------ pause

    function test_Pause_BlocksBuyAndTapeOutButNotSell() public {
        _buy(alice, 6_000e18);
        vm.prank(owner);
        p.pause();

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        p.buyTransistors{value: 1 ether}(1e18, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        p.tapeOutCircuit();

        vm.prank(alice);
        uint256 net = p.sellTransistors(1_000e18, 0);
        assertGt(net, 0);

        vm.prank(owner);
        p.unpause();
        vm.prank(alice);
        assertEq(p.tapeOutCircuit(), 1);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        p.pause();
        vm.prank(owner);
        p.pause();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        p.unpause();
    }

    // ------------------------------------------------------------------ fees / owner powers

    function test_WithdrawFees_OnlyOwner() public {
        _buy(alice, 2_000e18);
        vm.prank(alice);
        p.sellTransistors(1_000e18, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        p.withdrawFees(payable(alice));
    }

    function test_WithdrawFees_SendsOnlyFees() public {
        _buy(alice, 2_000e18);
        vm.prank(alice);
        p.sellTransistors(1_000e18, 0);
        uint256 fees = p.protocolFees();
        assertEq(fees, 11_500_000_000_000);

        vm.expectEmit(true, false, false, true, address(p));
        emit FeesWithdrawn(treasury, fees);
        vm.prank(owner);
        p.withdrawFees(payable(treasury));

        assertEq(treasury.balance, fees);
        assertEq(p.protocolFees(), 0);
        assertEq(address(p).balance, COST_0_1K);
        assertEq(address(p).balance, p.reserveRequired());
        _assertSolvent();

        // second withdraw has nothing
        vm.prank(owner);
        vm.expectRevert(CerebrProcessor.ZeroAmount.selector);
        p.withdrawFees(payable(treasury));
    }

    function test_WithdrawFees_RevertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(CerebrProcessor.ZeroAddress.selector);
        p.withdrawFees(payable(address(0)));
    }

    function test_OwnerCannotDrainReserveOrSurplus() public {
        _buy(alice, 10_000e18);
        vm.prank(alice);
        p.tapeOutCircuit();
        uint256 surplus = p.surplusReserve();
        assertGt(surplus, 0);

        // No fees yet: owner can withdraw nothing.
        vm.prank(owner);
        vm.expectRevert(CerebrProcessor.ZeroAmount.selector);
        p.withdrawFees(payable(owner));

        // Alice exits completely; owner withdraws fees; surplus is still locked.
        vm.prank(alice);
        p.sellTransistors(5_000e18, 0);
        uint256 fees = p.protocolFees();
        vm.prank(owner);
        p.withdrawFees(payable(owner));
        assertEq(owner.balance, fees);
        assertEq(p.totalSupply(), 0);
        assertEq(address(p).balance, surplus);
        assertEq(p.surplusReserve(), surplus);
    }

    function test_Ownable2Step() public {
        vm.prank(owner);
        p.transferOwnership(bob);
        assertEq(p.owner(), owner);
        assertEq(p.pendingOwner(), bob);
        vm.prank(bob);
        p.acceptOwnership();
        assertEq(p.owner(), bob);
    }

    // ------------------------------------------------------------------ reentrancy

    function test_Reentrancy_OnBuyRefund_Bubbles() public {
        Reenterer r = new Reenterer(p);
        vm.deal(address(r), 10 ether);
        r.setMode(Reenterer.Mode.Buy, false);
        // excess value triggers refund -> receive -> re-enter buy -> ReentrancyGuard -> TransferFailed
        vm.expectRevert(CerebrProcessor.TransferFailed.selector);
        r.buy{value: 1 ether}(1_000e18, type(uint256).max);
        assertEq(p.totalSupply(), 0);
    }

    function test_Reentrancy_OnBuyRefund_SwallowedIsHarmless() public {
        Reenterer r = new Reenterer(p);
        r.setMode(Reenterer.Mode.Buy, true);
        vm.deal(address(this), 1 ether);
        r.buy{value: 1 ether}(1_000e18, type(uint256).max);
        assertTrue(r.attempted());
        assertFalse(r.reentered());
        assertEq(p.balanceOf(address(r)), 1_000e18);
        assertEq(address(r).balance, 1 ether - COST_0_1K);
        _assertSolvent();
    }

    function test_Reentrancy_OnSell_Bubbles() public {
        Reenterer r = new Reenterer(p);
        r.buy{value: COST_0_2K}(2_000e18, COST_0_2K);
        r.setMode(Reenterer.Mode.Sell, false);
        vm.expectRevert(CerebrProcessor.TransferFailed.selector);
        r.sell(1_000e18, 0);
        assertEq(p.balanceOf(address(r)), 2_000e18);
    }

    function test_Reentrancy_OnSell_SwallowedIsHarmless() public {
        Reenterer r = new Reenterer(p);
        r.buy{value: COST_0_2K}(2_000e18, COST_0_2K);
        r.setMode(Reenterer.Mode.Sell, true);
        uint256 net = r.sell(1_000e18, 0);
        assertFalse(r.reentered());
        assertEq(net, 1_138_500_000_000_000);
        assertEq(address(r).balance, net);
        assertEq(p.balanceOf(address(r)), 1_000e18);
        _assertSolvent();
    }

    function test_Reentrancy_TapeOutDuringSell_Blocked() public {
        Reenterer r = new Reenterer(p);
        vm.deal(address(this), COST_0_5K + COST_0_1K * 10);
        r.buy{value: p.quoteBuy(6_000e18)}(6_000e18, type(uint256).max);
        r.setMode(Reenterer.Mode.TapeOut, true);
        r.sell(1_000e18, 0);
        assertFalse(r.reentered());
        assertEq(c.totalMinted(), 0);
    }

    function test_Reentrancy_WithdrawFeesByOwnerContract() public {
        Reenterer r = new Reenterer(p);
        // make the attacker the owner
        vm.prank(owner);
        p.transferOwnership(address(r));
        vm.prank(address(r));
        p.acceptOwnership();

        _buy(alice, 2_000e18);
        vm.prank(alice);
        p.sellTransistors(1_000e18, 0);
        uint256 fees = p.protocolFees();
        r.setMode(Reenterer.Mode.Withdraw, true);
        vm.prank(address(r));
        p.withdrawFees(payable(address(r)));
        assertFalse(r.reentered());
        assertEq(address(r).balance, fees);
        assertEq(address(p).balance, p.reserveRequired());
    }

    // ------------------------------------------------------------------ circuit NFT

    function test_Circuit_MintOnlyProcessor() public {
        vm.prank(alice);
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.mint(alice, Tier.Basic);
        vm.prank(owner);
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.mint(owner, Tier.Basic);
        vm.prank(alice);
        vm.expectRevert(CerebrCircuit.OnlyProcessor.selector);
        c.fuse(alice, 1, 2);
        vm.prank(address(p));
        assertEq(c.mint(bob, Tier.Basic), 1);
        assertEq(c.ownerOf(1), bob);
    }

    function test_Circuit_TraitsRanges() public {
        for (uint256 i; i < 50; ++i) {
            CerebrCircuit.Traits memory t = c.computeTraits(uint256(keccak256(abi.encode(i))), Tier.Basic);
            assertGe(t.cores, 8);
            assertLe(t.cores, 128);
            assertGe(t.clockTenthsGHz, 10);
            assertLe(t.clockTenthsGHz, 59);
            assertTrue(t.nodeNm == 3 || t.nodeNm == 5 || t.nodeNm == 7 || t.nodeNm == 14);
            assertGt(bytes(t.architecture).length, 0);
            assertGt(bytes(t.rarity).length, 0);
        }
    }

    function test_Circuit_TraitsDeterministicKnownSeed() public {
        // seed = 0 (Basic): rarity 0 -> Common, arch 0 -> Transformer, cores 8, clock 1.0, node idx 0 -> 14
        CerebrCircuit.Traits memory t = c.computeTraits(0, Tier.Basic);
        assertTrue(t.revealed);
        assertEq(t.rarity, "Common");
        assertEq(t.architecture, "Transformer");
        assertEq(t.cores, 8);
        assertEq(t.clockTenthsGHz, 10);
        assertEq(t.nodeNm, 14);
        // lanes: rarity 99 -> Legendary, arch 4 -> Liquid, cores 8+120, clock 10+49, node idx 3 -> 3
        uint256 seed = 99 | (4 << 16) | (120 << 32) | (49 << 48) | (3 << 64);
        t = c.computeTraits(seed, Tier.Basic);
        assertEq(t.rarity, "Legendary");
        assertEq(t.architecture, "Liquid");
        assertEq(t.cores, 128);
        assertEq(t.clockTenthsGHz, 59);
        assertEq(t.nodeNm, 3);
        // Singularity with the same seed: cores 512+120, clock 50+49, node idx 3+3 -> 1
        t = c.computeTraits(seed, Tier.Singularity);
        assertEq(uint8(t.tier), uint8(Tier.Singularity));
        assertEq(t.cores, 632);
        assertEq(t.clockTenthsGHz, 99);
        assertEq(t.nodeNm, 1);
        // Singularity has no Common: roll 0 -> Rare
        assertEq(c.computeTraits(0, Tier.Singularity).rarity, "Rare");
    }

    function test_Circuit_TraitsRevertNonexistent() public {
        vm.expectRevert();
        c.traits(1);
        vm.expectRevert();
        c.tokenURI(1);
    }

    function test_Circuit_TokenURIDecodes() public {
        _buy(alice, 5_000e18);
        vm.prank(alice);
        p.tapeOutCircuit();
        string memory prefix = "data:application/json;base64,";

        // Sealed (unrevealed) metadata shows only the tier and a wafer image.
        bytes memory sealedJson = _b64decode(_slice(bytes(c.tokenURI(1)), bytes(prefix).length));
        assertTrue(_startsWith(sealedJson, bytes('{"name":"Neural Circuit #1 (sealed)"')), "sealed name");
        assertTrue(_contains(sealedJson, bytes('{"trait_type":"Tier","value":"Basic"}')), "sealed tier");
        assertTrue(_contains(sealedJson, bytes('{"trait_type":"Status","value":"Sealed"}')), "sealed status");

        _reveal(1);
        string memory uri = c.tokenURI(1);
        assertTrue(_startsWith(bytes(uri), bytes(prefix)), "uri prefix");

        bytes memory json = _b64decode(_slice(bytes(uri), bytes(prefix).length));
        assertTrue(_startsWith(json, bytes('{"name":"Neural Circuit #1","description":"')), "json prefix");
        assertEq(json[json.length - 1], bytes1("}"));
        assertTrue(
            _contains(
                json,
                bytes('"attributes":[{"trait_type":"Tier","value":"Basic"},{"trait_type":"Architecture","value":"')
            ),
            "attrs"
        );
        assertTrue(_contains(json, bytes('"trait_type":"Rarity"')), "rarity");

        // extract and decode embedded SVG
        bytes memory imgKey = bytes('"image":"data:image/svg+xml;base64,');
        uint256 start = _indexOf(json, imgKey) + imgKey.length;
        uint256 end = start;
        while (json[end] != '"') ++end;
        bytes memory svg = _b64decode(_sub(json, start, end));
        assertTrue(_startsWith(svg, bytes('<svg xmlns="http://www.w3.org/2000/svg"')), "svg prefix");
        assertTrue(_contains(svg, bytes("CEREBR #1")), "svg label");
        assertTrue(_startsWith(_slice(svg, svg.length - 6), bytes("</svg>")), "svg suffix");
    }

    // ------------------------------------------------------------------ fuzz: solvency & rounding

    function testFuzz_BuySellSolvency(uint96 a1, uint96 a2, uint96 s1) public {
        uint256 b1 = bound(uint256(a1), 1, 4_000_000e18);
        uint256 b2 = bound(uint256(a2), 1, 4_000_000e18);
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
        _buy(alice, b1);
        _buy(bob, b2);
        _assertSolvent();
        uint256 sAmt = bound(uint256(s1), 1, b1);
        vm.prank(alice);
        p.sellTransistors(sAmt, 0);
        _assertSolvent();
        vm.prank(bob);
        p.sellTransistors(b2, 0);
        _assertSolvent();
        if (p.balanceOf(alice) > 0) {
            uint256 rest = p.balanceOf(alice);
            vm.prank(alice);
            p.sellTransistors(rest, 0);
        }
        _assertSolvent();
        assertEq(p.totalSupply(), 0);
        if (p.protocolFees() > 0) {
            vm.prank(owner);
            p.withdrawFees(payable(treasury));
        }
        assertEq(address(p).balance, p.surplusReserve()); // only rounding dust left
    }

    function testFuzz_SplitBuyNeverCheaper(uint96 x, uint96 y) public {
        uint256 a = bound(uint256(x), 1, 1_000_000e18);
        uint256 b = bound(uint256(y), 1, 1_000_000e18);
        uint256 single = p.quoteBuy(a + b);
        vm.deal(alice, 1e30);
        uint256 c1 = _buy(alice, a);
        uint256 c2 = _buy(alice, b);
        assertGe(c1 + c2, single); // splitting can't beat the curve (rounding favours protocol)
        assertLe(c1 + c2, single + 2); // and only by at most 2 wei of rounding per extra buy
    }

    function testFuzz_SellNeverExceedsBuy(uint96 x) public {
        uint256 a = bound(uint256(x), 1, 10_000_000e18);
        vm.deal(alice, 1e30);
        uint256 cost = _buy(alice, a);
        (uint256 gross,,) = p.quoteSell(a);
        assertLe(gross, cost);
    }

    // ------------------------------------------------------------------ bytes utils

    function _startsWith(bytes memory s, bytes memory pre) internal pure returns (bool) {
        if (s.length < pre.length) return false;
        for (uint256 i; i < pre.length; ++i) {
            if (s[i] != pre[i]) return false;
        }
        return true;
    }

    function _indexOf(bytes memory s, bytes memory needle) internal pure returns (uint256) {
        if (needle.length > s.length) return type(uint256).max;
        for (uint256 i; i <= s.length - needle.length; ++i) {
            bool m = true;
            for (uint256 j; j < needle.length; ++j) {
                if (s[i + j] != needle[j]) {
                    m = false;
                    break;
                }
            }
            if (m) return i;
        }
        return type(uint256).max;
    }

    function _contains(bytes memory s, bytes memory needle) internal pure returns (bool) {
        return _indexOf(s, needle) != type(uint256).max;
    }

    function _sub(bytes memory s, uint256 from, uint256 to) internal pure returns (bytes memory out) {
        out = new bytes(to - from);
        for (uint256 i; i < out.length; ++i) {
            out[i] = s[from + i];
        }
    }

    function _slice(bytes memory s, uint256 from) internal pure returns (bytes memory) {
        return _sub(s, from, s.length);
    }

    function _b64val(bytes1 ch) internal pure returns (uint256) {
        uint8 v = uint8(ch);
        if (v >= 65 && v <= 90) return v - 65;
        if (v >= 97 && v <= 122) return v - 71;
        if (v >= 48 && v <= 57) return v + 4;
        if (v == 43) return 62;
        if (v == 47) return 63;
        revert("bad b64 char");
    }

    function _b64decode(bytes memory data) internal pure returns (bytes memory out) {
        require(data.length % 4 == 0, "bad b64 len");
        uint256 pad;
        if (data.length > 0 && data[data.length - 1] == "=") pad++;
        if (data.length > 1 && data[data.length - 2] == "=") pad++;
        out = new bytes((data.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < data.length; i += 4) {
            uint256 n = (_b64val(data[i]) << 18) | (_b64val(data[i + 1]) << 12)
                | ((data[i + 2] == "=" ? 0 : _b64val(data[i + 2])) << 6)
                | (data[i + 3] == "=" ? 0 : _b64val(data[i + 3]));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(n >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(n));
        }
    }
}
