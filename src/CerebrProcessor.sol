// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CerebrCircuit, Tier} from "./CerebrCircuit.sol";

/// @title CerebrProcessor
/// @notice Linear bonding-curve issuer of Transistors ($CBR) backed by native OKB, plus two CBR
///         sinks: "tape-out" (burn 5k / 20k / 100k CBR for a Basic / Pro / Quantum Neural Circuit
///         NFT) and "fusion" (burn CBR to fuse two same-tier Circuits into the next tier).
/// @dev Core invariant: address(this).balance >= reserveRequired() + protocolFees.
///      Buys round cost UP, sells round refunds DOWN, so the curve can never be under-collateralised.
///      CBR burned by tape-outs and fusions leaves its OKB backing in the contract forever
///      (surplusReserve()). The surplus a burn adds is the curve value of the burned slice at the
///      supply when the burn executes; a holder can lower that point with a sell -> burn -> rebuy
///      sequence (paying the 1% sell fee), so the surplus is a lower bound set by the burner, not a
///      fixed amount per CBR. Nobody else's refund depends on it.
///      Fair-launch guard: for the first `launchBlocks` blocks after deployment, NET buys are capped
///      per wallet per block and globally per block (a sell in the same block gives back the
///      seller's and the block's usage, so an atomic buy+sell cannot fill the cap). The per-wallet
///      cap is sybil-able (one actor can use many wallets); the global per-block cap is the real
///      guard. Sells are never capped, paused or made to revert by the guard.
contract CerebrProcessor is ERC20, Ownable2Step, ReentrancyGuardTransient, Pausable {
    /// @notice Hard cap on CBR supply (18 decimals).
    uint256 public constant MAX_SUPPLY = 10_000_000e18;
    /// @notice CBR burned per Basic Circuit tape-out (also the Basic+Basic fusion cost).
    uint256 public constant TAPEOUT_COST = 5_000e18;
    /// @notice CBR burned per Pro Circuit tape-out (also the Pro+Pro fusion cost).
    uint256 public constant PRO_TAPEOUT_COST = 20_000e18;
    /// @notice CBR burned per Quantum Circuit tape-out (also the Quantum+Quantum fusion cost).
    uint256 public constant QUANTUM_TAPEOUT_COST = 100_000e18;
    /// @notice Upper bound on the constructor's launchBlocks (sanity limit).
    uint256 public constant MAX_LAUNCH_BLOCKS = 1_000_000;
    /// @notice Upper bound on basePrice and slope (keeps every view, incl. the Lens, overflow-free).
    uint256 public constant MAX_CURVE_PARAM = 1e36;
    /// @notice Protocol fee on sells, in basis points (1%).
    uint256 public constant SELL_FEE_BPS = 100;
    /// @notice Basis-point denominator.
    uint256 public constant BPS = 10_000;
    /// @notice Max sealed Circuits each buy settles from the Circuit reveal queue (tape-outs and
    ///         fusions settle CIRCUIT.AUTO_REVEAL_PER_MINT inside mint/fuse). Sells settle none.
    uint256 public constant AUTO_REVEAL_PER_BUY = 1;

    uint256 private constant WAD = 1e18;
    uint256 private constant TWO_WAD_SQ = 2e36;

    /// @notice Price (wei of OKB) of one whole CBR at supply 0.
    uint256 public immutable BASE_PRICE;
    /// @notice Price increase (wei) per whole CBR of supply.
    uint256 public immutable SLOPE;
    /// @notice The Neural Circuit NFT collection minted by this processor.
    CerebrCircuit public immutable CIRCUIT;

    /// @notice Buys are capped while block.number < LAUNCH_END_BLOCK (deploy block + launchBlocks).
    uint256 public immutable LAUNCH_END_BLOCK;
    /// @notice Max CBR one wallet may buy in one block during the launch window.
    uint256 public immutable WALLET_CAP_PER_BLOCK;
    /// @notice Max CBR all wallets together may buy in one block during the launch window.
    uint256 public immutable BLOCK_CAP;

    /// @dev Launch-window usage for one block (one slot). Only written during the launch window.
    struct LaunchUsage {
        uint64 blockNumber;
        uint192 bought;
    }

    /// @notice Accrued, owner-withdrawable sell fees (wei). Separate from curve reserve.
    uint256 public protocolFees;

    /// @notice Cumulative CBR destroyed by sinks (tape-outs and fusions). Sells are not counted.
    uint256 public totalCbrBurned;

    /// @dev Global launch-window usage of the latest block that had a buy.
    LaunchUsage private _launchBlockUsage;
    /// @dev Per-wallet launch-window usage of the latest block that wallet bought in.
    mapping(address => LaunchUsage) private _launchWalletUsage;

    /// @notice An amount argument (or accrued fees) was zero.
    error ZeroAmount();
    /// @notice Constructor basePrice or slope was zero or above MAX_CURVE_PARAM.
    error InvalidCurveParams();
    /// @notice The buy would push circulating supply above MAX_SUPPLY.
    error MaxSupplyExceeded();
    /// @notice Cost exceeded maxCost (buy) or net refund fell below minRefund (sell).
    error SlippageExceeded();
    /// @notice msg.value is below the quoted cost.
    error InsufficientPayment();
    /// @notice A native OKB transfer failed.
    error TransferFailed();
    /// @notice Plain OKB transfers are rejected; use buyTransistors.
    error DirectDepositsDisabled();
    /// @notice Recipient was the zero address.
    error ZeroAddress();
    /// @notice Renouncing ownership is disabled (it would strand fees and pause state).
    error RenounceDisabled();
    /// @notice Launch parameters are invalid (window too long, or a zero / oversized cap).
    error InvalidLaunchParams();
    /// @notice This buy exceeds the wallet's launch-window cap for this block.
    error LaunchWalletCapExceeded(uint256 remaining);
    /// @notice This buy exceeds the global launch-window cap for this block.
    error LaunchBlockCapExceeded(uint256 remaining);
    /// @notice Singularity Circuits cannot be taped out; they come only from fusion.
    error TierNotMintable();

    /// @notice `buyer` minted `amount` CBR for `cost` wei; supply and spot price after the trade.
    event TransistorsBought(address indexed buyer, uint256 amount, uint256 cost, uint256 newPrice, uint256 newSupply);
    /// @notice `seller` burned `amount` CBR for `net` wei (after `fee`); supply and spot price after the trade.
    event TransistorsSold(
        address indexed seller, uint256 amount, uint256 net, uint256 fee, uint256 newPrice, uint256 newSupply
    );
    /// @notice `owner` burned `cbrBurned` CBR and received unrevealed Circuit `tokenId` of `tier`.
    ///         Traits are revealed later on the Circuit contract (CircuitRevealed).
    event CircuitTapedOut(
        address indexed owner, uint256 indexed tokenId, Tier indexed tier, uint256 cbrBurned, uint256 newSupply
    );
    /// @notice `owner` fused `parentA` + `parentB` into unrevealed Circuit `childId` of `tier` (the
    ///         child's tier). The parents now sit in the child's token-bound account. The CBR burned
    ///         equals the parents' tier tape-out cost.
    event CircuitsFused(address indexed owner, uint256 indexed childId, uint256 parentA, uint256 parentB, Tier tier);
    /// @notice Owner withdrew `amount` wei of accrued sell fees to `to`.
    event FeesWithdrawn(address indexed to, uint256 amount);

    /// @param basePrice Wei of OKB per whole CBR at supply 0 (non-zero).
    /// @param slope Wei increase in price per whole CBR minted (non-zero).
    /// @param initialOwner Protocol owner (fee recipient admin, pauser).
    /// @param launchBlocks Length of the fair-launch window in blocks (0 disables the guard).
    /// @param walletCapPerBlock Max CBR (18-dec) per wallet per block during the window.
    /// @param blockCap Max CBR (18-dec) for all buyers per block during the window.
    /// @param erc6551Registry ERC-6551 registry (canonical on mainnet; deploy one on testnet).
    /// @param erc6551AccountImpl ERC-6551 account implementation for Circuit token-bound accounts.
    constructor(
        uint256 basePrice,
        uint256 slope,
        address initialOwner,
        uint256 launchBlocks,
        uint256 walletCapPerBlock,
        uint256 blockCap,
        address erc6551Registry,
        address erc6551AccountImpl
    ) ERC20("Cerebr Transistor", "CBR") Ownable(initialOwner) {
        if (basePrice == 0 || slope == 0 || basePrice > MAX_CURVE_PARAM || slope > MAX_CURVE_PARAM) {
            revert InvalidCurveParams();
        }
        if (launchBlocks != 0) {
            if (
                launchBlocks > MAX_LAUNCH_BLOCKS || walletCapPerBlock == 0 || blockCap == 0
                    || walletCapPerBlock > MAX_SUPPLY || blockCap > MAX_SUPPLY
            ) revert InvalidLaunchParams();
        }
        BASE_PRICE = basePrice;
        SLOPE = slope;
        LAUNCH_END_BLOCK = block.number + launchBlocks;
        WALLET_CAP_PER_BLOCK = walletCapPerBlock;
        BLOCK_CAP = blockCap;
        CIRCUIT = new CerebrCircuit(address(this), erc6551Registry, erc6551AccountImpl);
    }

    /// @dev Reject plain OKB transfers; OKB enters only via buyTransistors.
    receive() external payable {
        revert DirectDepositsDisabled();
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Spot price (wei per whole CBR) at the current supply.
    function currentPrice() public view returns (uint256) {
        return _priceAt(totalSupply());
    }

    /// @notice OKB cost (wei, rounded up) to buy `amount` CBR (18-dec units) now.
    /// @dev Reverts if the purchase would exceed MAX_SUPPLY.
    function quoteBuy(uint256 amount) external view returns (uint256 cost) {
        uint256 s = totalSupply();
        if (s + amount > MAX_SUPPLY) revert MaxSupplyExceeded();
        cost = _curveCost(s, s + amount, Math.Rounding.Ceil);
    }

    /// @notice Refund breakdown (wei) for selling `amount` CBR now.
    /// @return gross Curve value (rounded down).
    /// @return fee Protocol fee (1% of gross, rounded down).
    /// @return net Paid to seller.
    function quoteSell(uint256 amount) external view returns (uint256 gross, uint256 fee, uint256 net) {
        uint256 s = totalSupply();
        gross = _curveCost(s - amount, s, Math.Rounding.Floor); // underflow reverts if amount > supply
        fee = gross * SELL_FEE_BPS / BPS;
        net = gross - fee;
    }

    /// @notice OKB required to buy back every outstanding CBR along the curve (rounded up).
    function reserveRequired() public view returns (uint256) {
        return _curveCost(0, totalSupply(), Math.Rounding.Ceil);
    }

    /// @notice OKB held above curve requirements and fees: permanent backing left by tape-out burns.
    /// @dev Unreachable by anyone; it over-collateralises the curve. Forced OKB (selfdestruct) also
    ///      lands here, and mid-transaction (during a buy refund callback) the value reads high.
    function surplusReserve() external view returns (uint256) {
        uint256 locked = reserveRequired() + protocolFees;
        uint256 bal = address(this).balance;
        return bal > locked ? bal - locked : 0;
    }

    /// @notice CBR burned to tape out a Circuit of `tier`; also the cost to fuse two `tier` Circuits.
    /// @dev Reverts TierNotMintable for Singularity.
    function tapeOutCost(Tier tier) public pure returns (uint256) {
        if (tier == Tier.Basic) return TAPEOUT_COST;
        if (tier == Tier.Pro) return PRO_TAPEOUT_COST;
        if (tier == Tier.Quantum) return QUANTUM_TAPEOUT_COST;
        revert TierNotMintable();
    }

    /// @notice True while the fair-launch buy caps apply.
    function launchActive() public view returns (bool) {
        return block.number < LAUNCH_END_BLOCK;
    }

    /// @notice CBR `buyer` can still buy in the current block under the launch caps.
    /// @return walletRemaining Remaining per-wallet allowance (type(uint256).max if no window).
    /// @return blockRemaining Remaining global allowance (type(uint256).max if no window).
    function launchCapRemaining(address buyer) external view returns (uint256 walletRemaining, uint256 blockRemaining) {
        if (!launchActive()) return (type(uint256).max, type(uint256).max);
        LaunchUsage memory g = _launchBlockUsage;
        LaunchUsage memory w = _launchWalletUsage[buyer];
        uint256 gUsed = g.blockNumber == block.number ? g.bought : 0;
        uint256 wUsed = w.blockNumber == block.number ? w.bought : 0;
        blockRemaining = BLOCK_CAP > gUsed ? BLOCK_CAP - gUsed : 0;
        walletRemaining = WALLET_CAP_PER_BLOCK > wUsed ? WALLET_CAP_PER_BLOCK - wUsed : 0;
    }

    // ------------------------------------------------------------------
    // Bonding curve
    // ------------------------------------------------------------------

    /// @notice Buy `amount` CBR (18-dec units) with OKB. Excess msg.value is refunded.
    ///         Also settles up to AUTO_REVEAL_PER_BUY sealed Circuits from the reveal queue
    ///         (bounded, never reverts; see CerebrCircuit.processRevealQueue).
    /// @param amount CBR to mint.
    /// @param maxCost Slippage guard: revert if cost exceeds this (wei).
    /// @return cost OKB charged (wei).
    function buyTransistors(uint256 amount, uint256 maxCost)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 cost)
    {
        if (amount == 0) revert ZeroAmount();
        uint256 s = totalSupply();
        uint256 newSupply = s + amount;
        if (newSupply > MAX_SUPPLY) revert MaxSupplyExceeded();
        cost = _curveCost(s, newSupply, Math.Rounding.Ceil);
        if (cost > maxCost) revert SlippageExceeded();
        if (msg.value < cost) revert InsufficientPayment();
        if (block.number < LAUNCH_END_BLOCK) _consumeLaunchCaps(msg.sender, amount);

        _mint(msg.sender, amount);
        emit TransistorsBought(msg.sender, amount, cost, _priceAt(newSupply), newSupply);
        CIRCUIT.processRevealQueue(AUTO_REVEAL_PER_BUY);

        uint256 excess = msg.value - cost;
        if (excess != 0) _sendValue(payable(msg.sender), excess);
    }

    /// @notice Sell `amount` CBR back to the curve for OKB, minus the 1% fee. Never pausable or capped.
    ///         During the launch window a sell also gives back same-block buy-cap usage.
    ///         Sells never touch the Circuit contract (no auto-reveal): the exit path stays minimal.
    /// @param amount CBR to burn.
    /// @param minRefund Slippage guard: revert if net refund is below this (wei).
    /// @return net OKB sent to the seller (wei).
    function sellTransistors(uint256 amount, uint256 minRefund) external nonReentrant returns (uint256 net) {
        if (amount == 0) revert ZeroAmount();
        uint256 s = totalSupply();
        // Explicit check (vs relying on _burn) gives a clean error before the curve math.
        uint256 bal = balanceOf(msg.sender);
        if (amount > bal) revert ERC20InsufficientBalance(msg.sender, bal, amount);
        uint256 newSupply = s - amount; // safe: amount <= bal <= s
        uint256 gross = _curveCost(newSupply, s, Math.Rounding.Floor);
        uint256 fee = gross * SELL_FEE_BPS / BPS;
        net = gross - fee;
        if (net < minRefund) revert SlippageExceeded();

        _burn(msg.sender, amount);
        protocolFees += fee;
        if (block.number < LAUNCH_END_BLOCK) _releaseLaunchCaps(msg.sender, amount);
        emit TransistorsSold(msg.sender, amount, net, fee, _priceAt(newSupply), newSupply);

        if (net != 0) _sendValue(payable(msg.sender), net);
    }

    // ------------------------------------------------------------------
    // Tape-out
    // ------------------------------------------------------------------

    /// @notice Burn TAPEOUT_COST (5,000) CBR and mint an unrevealed Basic Neural Circuit NFT.
    /// @dev Same as tapeOutCircuitTier(Tier.Basic).
    /// @return tokenId Newly minted Circuit id.
    function tapeOutCircuit() external nonReentrant whenNotPaused returns (uint256 tokenId) {
        return _tapeOut(Tier.Basic);
    }

    /// @notice Burn tapeOutCost(tier) CBR and mint an unrevealed Circuit of `tier`
    ///         (Basic, Pro or Quantum). Traits are revealed later with CIRCUIT.reveal(tokenId).
    /// @dev The burned CBR's OKB backing stays in the contract, over-collateralising the curve.
    ///      The trait seed is not known at mint (commit-reveal), so reverting cannot re-roll it.
    ///      The mint first auto-reveals up to CIRCUIT.AUTO_REVEAL_PER_MINT ready Circuits (FIFO).
    /// @return tokenId Newly minted Circuit id.
    function tapeOutCircuitTier(Tier tier) external nonReentrant whenNotPaused returns (uint256 tokenId) {
        return _tapeOut(tier);
    }

    /// @notice Fuse two revealed Circuits of the same tier (below Singularity) that the caller owns
    ///         directly into one unrevealed Circuit of the next tier, burning tapeOutCost(parent tier).
    ///         Basic+Basic+5k -> Pro, Pro+Pro+20k -> Quantum, Quantum+Quantum+100k -> Singularity.
    ///         The parents are NOT burned: they move into the child's ERC-6551 token-bound account,
    ///         so anything they (or their own accounts) hold stays recoverable by the child's owner.
    /// @return childId New Circuit id.
    function fuseCircuits(uint256 idA, uint256 idB) external nonReentrant whenNotPaused returns (uint256 childId) {
        Tier inputTier;
        (childId, inputTier) = CIRCUIT.fuse(msg.sender, idA, idB);
        _sinkBurn(msg.sender, tapeOutCost(inputTier));
        emit CircuitsFused(msg.sender, childId, idA, idB, Tier(uint8(inputTier) + 1));
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------

    /// @notice Withdraw accrued sell fees only. Curve reserve and surplus are untouchable.
    /// @param to Recipient.
    function withdrawFees(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = protocolFees;
        if (amount == 0) revert ZeroAmount();
        protocolFees = 0;
        emit FeesWithdrawn(to, amount);
        _sendValue(to, amount);
    }

    /// @notice Pause buys, tape-outs and fusions (sells and reveals stay open).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume buys, tape-outs and fusions.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Disabled: renouncing would permanently strand protocolFees and could freeze pause state.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _tapeOut(Tier tier) private returns (uint256 tokenId) {
        uint256 cost = tapeOutCost(tier); // reverts for Singularity
        _sinkBurn(msg.sender, cost);
        tokenId = CIRCUIT.mint(msg.sender, tier);
        emit CircuitTapedOut(msg.sender, tokenId, tier, cost, totalSupply());
    }

    /// @dev Burn CBR into a sink. Its OKB backing stays as surplus forever.
    function _sinkBurn(address from, uint256 amount) private {
        _burn(from, amount);
        totalCbrBurned += amount;
    }

    /// @dev Charge `amount` against the launch caps for this block. Only called inside the window.
    ///      Caps are <= MAX_SUPPLY < 2^192, so the uint192 casts are safe after the checks.
    function _consumeLaunchCaps(address buyer, uint256 amount) private {
        LaunchUsage memory g = _launchBlockUsage;
        uint256 gUsed = g.blockNumber == block.number ? g.bought : 0;
        if (amount > BLOCK_CAP - gUsed) revert LaunchBlockCapExceeded(BLOCK_CAP - gUsed);

        LaunchUsage memory w = _launchWalletUsage[buyer];
        uint256 wUsed = w.blockNumber == block.number ? w.bought : 0;
        if (amount > WALLET_CAP_PER_BLOCK - wUsed) revert LaunchWalletCapExceeded(WALLET_CAP_PER_BLOCK - wUsed);

        // casting to 'uint192' is safe because gUsed + amount <= BLOCK_CAP <= MAX_SUPPLY < 2^192
        // forge-lint: disable-next-line(unsafe-typecast)
        _launchBlockUsage = LaunchUsage(uint64(block.number), uint192(gUsed + amount));
        // casting to 'uint192' is safe because wUsed + amount <= WALLET_CAP_PER_BLOCK <= MAX_SUPPLY < 2^192
        // forge-lint: disable-next-line(unsafe-typecast)
        _launchWalletUsage[buyer] = LaunchUsage(uint64(block.number), uint192(wUsed + amount));
    }

    /// @dev Give back same-block launch usage on a sell (net-buy caps). Saturating, never reverts.
    function _releaseLaunchCaps(address seller, uint256 amount) private {
        LaunchUsage memory g = _launchBlockUsage;
        if (g.blockNumber == block.number && g.bought != 0) {
            // casting to 'uint192' is safe because the result is <= g.bought
            // forge-lint: disable-next-line(unsafe-typecast)
            _launchBlockUsage.bought = g.bought > amount ? uint192(g.bought - amount) : 0;
        }
        LaunchUsage memory w = _launchWalletUsage[seller];
        if (w.blockNumber == block.number && w.bought != 0) {
            // casting to 'uint192' is safe because the result is <= w.bought
            // forge-lint: disable-next-line(unsafe-typecast)
            _launchWalletUsage[seller].bought = w.bought > amount ? uint192(w.bought - amount) : 0;
        }
    }

    function _priceAt(uint256 supply) internal view returns (uint256) {
        return BASE_PRICE + Math.mulDiv(SLOPE, supply, WAD);
    }

    /// @dev Integral of the price curve from supply a to b (a <= b, 18-dec units), in wei:
    ///      BASE_PRICE*(b-a)/1e18 + SLOPE*(b-a)*(b+a)/2e36. Each term rounded per `r`.
    ///      (b-a)*(b+a) <= 1e25 * 2e25 = 2e50, far below 2^256; mulDiv handles the rest at 512-bit.
    function _curveCost(uint256 a, uint256 b, Math.Rounding r) internal view returns (uint256) {
        uint256 d = b - a;
        return Math.mulDiv(BASE_PRICE, d, WAD, r) + Math.mulDiv(SLOPE, d * (b + a), TWO_WAD_SQ, r);
    }

    function _sendValue(address payable to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
