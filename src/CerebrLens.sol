// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CerebrProcessor} from "./CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "./CerebrCircuit.sol";

/// @title CerebrLens
/// @notice Read-only helper for front-ends and indexers. Holds no state and no funds; every function
///         is a view over CerebrProcessor / CerebrCircuit. Safe to redeploy at any time.
/// @dev Gas-heavy views (userState, curvePoints) are meant for eth_call, not for on-chain use.
contract CerebrLens {
    uint256 private constant WAD = 1e18;
    uint256 private constant EIGHT_WAD_SQ = 8e36;
    /// @notice Max number of segments for curvePoints.
    uint256 public constant MAX_CURVE_POINTS = 1000;

    /// @notice Processor this lens reads.
    CerebrProcessor public immutable PROCESSOR;
    /// @notice Circuit collection of PROCESSOR.
    CerebrCircuit public immutable CIRCUIT;

    /// @notice Snapshot of protocol-wide state.
    struct ProtocolState {
        uint256 blockNumber;
        uint256 totalSupply;
        uint256 maxSupply;
        uint256 currentPrice;
        uint256 basePrice;
        uint256 slope;
        uint256 balance; // OKB held by the processor
        uint256 reserveRequired;
        uint256 protocolFees;
        uint256 surplusReserve;
        uint256 totalCbrBurned;
        uint256 totalCircuits;
        uint256[4] mintedByTier; // Basic, Pro, Quantum, Singularity
        uint256[3] tapeOutCosts; // Basic, Pro, Quantum
        uint256 sellFeeBps;
        bool paused;
        bool launchActive;
        uint256 launchEndBlock;
        uint256 walletCapPerBlock;
        uint256 blockCap;
        address processor;
        address circuit;
        address erc6551Registry;
        address accountImplementation;
    }

    /// @notice One Circuit as seen by the dApp.
    struct CircuitView {
        uint256 id;
        Tier tier;
        bool revealed;
        uint256 commitBlock;
        uint256 revealReadyBlock;
        uint256 seed; // 0 until revealed
        CerebrCircuit.Traits traits;
        address tba; // ERC-6551 token-bound account (counterfactual)
        bool tbaDeployed;
        uint256 tbaBalance; // OKB held by the account
        uint256 fusedInto; // child this Circuit was fused into (0 = can still be a fusion parent)
    }

    /// @notice A user's position.
    struct UserState {
        address user;
        uint256 cbrBalance;
        uint256 okbBalance;
        uint256 launchWalletRemaining;
        uint256 launchBlockRemaining;
        CircuitView[] circuits; // Circuits the user owns directly (not ones nested inside accounts)
    }

    error InvalidPointCount();

    constructor(CerebrProcessor processor) {
        PROCESSOR = processor;
        CIRCUIT = processor.CIRCUIT();
    }

    // ------------------------------------------------------------------
    // Quotes
    // ------------------------------------------------------------------

    /// @notice Largest CBR amount whose quoteBuy fits in `okbIn` wei, at the current supply.
    /// @dev Closed form, then exact correction. With s = supply, a = amount (18-dec):
    ///      exact cost E(a) = BASE*a/1e18 + SLOPE*a*(2s+a)/2e36, and quoteBuy(a) is in [E(a), E(a)+2)
    ///      (two ceil roundings). Multiplying by 2e36: SLOPE*a^2 + B*a - 2e36*okb = 0 with
    ///      B = 2e18*BASE + 2*SLOPE*s, so a = 4e36*okb / (B + sqrt(B^2 + 8e36*SLOPE*okb)).
    ///      The root for budget okb-2 is affordable and the root for okb (+2) is not, so a binary
    ///      search between them (about log2(2e18 / price) quoteBuy calls) finds the exact maximum.
    ///      The brackets are re-checked against quoteBuy and widened if needed, so the result is
    ///      exact for any curve parameters the Processor accepts (<= MAX_CURVE_PARAM). Ignores the launch caps (see
    ///      PROCESSOR.launchCapRemaining) and never exceeds MAX_SUPPLY - supply.
    /// @return amount Max CBR (18-dec) such that PROCESSOR.quoteBuy(amount) <= okbIn.
    /// @return cost PROCESSOR.quoteBuy(amount).
    function quoteBuyExactOKB(uint256 okbIn) external view returns (uint256 amount, uint256 cost) {
        CerebrProcessor p = PROCESSOR;
        uint256 s = p.totalSupply();
        uint256 maxAmount = p.MAX_SUPPLY() - s;
        if (maxAmount == 0) return (0, 0);
        cost = p.quoteBuy(maxAmount);
        if (cost <= okbIn) return (maxAmount, cost);
        // From here on quoteBuy(maxAmount) > okbIn and quoteBuy(0) == 0 <= okbIn.

        uint256 base = p.BASE_PRICE();
        uint256 slope = p.SLOPE();
        uint256 lo = okbIn > 2 ? Math.min(_root(s, okbIn - 2, base, slope), maxAmount) : 0;
        for (uint256 step = 1; lo != 0 && p.quoteBuy(lo) > okbIn; step <<= 1) {
            lo = lo > step ? lo - step : 0;
        }
        uint256 hi = Math.min(Math.max(_root(s, okbIn, base, slope) + 2, lo + 1), maxAmount);
        for (uint256 step = 1; p.quoteBuy(hi) <= okbIn; step <<= 1) {
            lo = hi;
            hi = Math.min(hi + step, maxAmount);
        }
        // Invariant: quoteBuy(lo) <= okbIn < quoteBuy(hi).
        while (hi - lo > 1) {
            uint256 mid = lo + (hi - lo) / 2;
            if (p.quoteBuy(mid) <= okbIn) lo = mid;
            else hi = mid;
        }
        return (lo, p.quoteBuy(lo));
    }

    /// @notice OKB cost (wei, rounded up) to buy `amount` CBR now. Same as PROCESSOR.quoteBuy.
    function quoteBuy(uint256 amount) external view returns (uint256) {
        return PROCESSOR.quoteBuy(amount);
    }

    /// @notice Refund breakdown for selling `amount` CBR now. Same as PROCESSOR.quoteSell.
    function quoteSell(uint256 amount) external view returns (uint256 gross, uint256 fee, uint256 net) {
        return PROCESSOR.quoteSell(amount);
    }

    // ------------------------------------------------------------------
    // Snapshots
    // ------------------------------------------------------------------

    /// @notice One-call snapshot of the whole protocol.
    function protocolState() external view returns (ProtocolState memory st) {
        CerebrProcessor p = PROCESSOR;
        CerebrCircuit c = CIRCUIT;
        st.blockNumber = block.number;
        st.totalSupply = p.totalSupply();
        st.maxSupply = p.MAX_SUPPLY();
        st.currentPrice = p.currentPrice();
        st.basePrice = p.BASE_PRICE();
        st.slope = p.SLOPE();
        st.balance = address(p).balance;
        st.reserveRequired = p.reserveRequired();
        st.protocolFees = p.protocolFees();
        st.surplusReserve = p.surplusReserve();
        st.totalCbrBurned = p.totalCbrBurned();
        st.totalCircuits = c.totalMinted();
        for (uint256 i; i < 4; ++i) {
            st.mintedByTier[i] = c.mintedByTier(Tier(i));
        }
        st.tapeOutCosts = [p.TAPEOUT_COST(), p.PRO_TAPEOUT_COST(), p.QUANTUM_TAPEOUT_COST()];
        st.sellFeeBps = p.SELL_FEE_BPS();
        st.paused = p.paused();
        st.launchActive = p.launchActive();
        st.launchEndBlock = p.LAUNCH_END_BLOCK();
        st.walletCapPerBlock = p.WALLET_CAP_PER_BLOCK();
        st.blockCap = p.BLOCK_CAP();
        st.processor = address(p);
        st.circuit = address(c);
        st.erc6551Registry = address(c.ERC6551_REGISTRY());
        st.accountImplementation = c.ACCOUNT_IMPLEMENTATION();
    }

    /// @notice Balance, launch allowance and every Circuit `user` owns directly.
    /// @dev Iterates ownerOf over 1..totalMinted (eth_call only).
    function userState(address user) external view returns (UserState memory u) {
        u.user = user;
        u.cbrBalance = PROCESSOR.balanceOf(user);
        u.okbBalance = user.balance;
        (u.launchWalletRemaining, u.launchBlockRemaining) = PROCESSOR.launchCapRemaining(user);

        uint256 total = CIRCUIT.totalMinted();
        uint256 owned = CIRCUIT.balanceOf(user);
        u.circuits = new CircuitView[](owned);
        uint256 n;
        for (uint256 id = 1; id <= total && n < owned; ++id) {
            if (CIRCUIT.ownerOf(id) == user) u.circuits[n++] = circuitView(id);
        }
    }

    /// @notice Full view of Circuit `id`. Reverts if it does not exist.
    function circuitView(uint256 id) public view returns (CircuitView memory v) {
        CerebrCircuit c = CIRCUIT;
        (Tier tier, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
        v.id = id;
        v.tier = tier;
        v.revealed = revealed;
        v.commitBlock = commitBlock;
        v.revealReadyBlock = uint256(commitBlock) + 2;
        v.seed = c.seedOf(id);
        v.traits = c.traits(id);
        v.tba = c.tokenBoundAccount(id);
        v.tbaDeployed = v.tba.code.length != 0;
        v.tbaBalance = v.tba.balance;
        v.fusedInto = c.fusedInto(id);
    }

    /// @notice `n + 1` evenly spaced points (supply, spot price) from 0 to MAX_SUPPLY for charts,
    ///         plus the current position.
    /// @param n Number of segments, 1..MAX_CURVE_POINTS.
    function curvePoints(uint256 n)
        external
        view
        returns (uint256[] memory supplies, uint256[] memory prices, uint256 currentSupply, uint256 currentPrice)
    {
        if (n == 0 || n > MAX_CURVE_POINTS) revert InvalidPointCount();
        uint256 max = PROCESSOR.MAX_SUPPLY();
        uint256 base = PROCESSOR.BASE_PRICE();
        uint256 slope = PROCESSOR.SLOPE();
        supplies = new uint256[](n + 1);
        prices = new uint256[](n + 1);
        for (uint256 i; i <= n; ++i) {
            uint256 sup = max * i / n;
            supplies[i] = sup;
            prices[i] = base + Math.mulDiv(slope, sup, WAD); // same formula as the processor
        }
        currentSupply = PROCESSOR.totalSupply();
        currentPrice = PROCESSOR.currentPrice();
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    /// @dev Approximate real root a of E(a) = budget: 4e36*budget / (B + sqrt(B^2 + 8e36*SLOPE*budget)).
    ///      Terms are scaled down by 2^(2k) when needed so nothing overflows; the result is only a
    ///      starting point, quoteBuyExactOKB re-checks it.
    function _root(uint256 s, uint256 budget, uint256 base, uint256 slope) private pure returns (uint256) {
        uint256 b = 2 * WAD * base + 2 * slope * s;
        uint256 x = EIGHT_WAD_SQ * slope;
        uint256 bitsB = 2 * Math.log2(b) + 2;
        uint256 bitsX = Math.log2(x) + Math.log2(budget) + 2;
        uint256 bits = Math.max(bitsB, bitsX);
        uint256 k = bits > 253 ? (bits - 253 + 1) / 2 : 0;
        // 1 << (2 * k) is the intended power of two 2^(2k), not a reversed shift.
        // forge-lint: disable-next-line(incorrect-shift)
        uint256 q = Math.sqrt(Math.mulDiv(b, b, 1 << (2 * k)) + Math.mulDiv(x, budget, 1 << (2 * k))) << k;
        return Math.mulDiv(4e36, budget, b + q);
    }
}
