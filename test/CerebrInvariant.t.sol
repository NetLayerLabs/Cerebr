// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {ERC6551Fixture} from "./helpers/ERC6551TestHelpers.sol";

/// @dev Drives random buy / sell / tiered tape-outs / reveal (incl. expiry re-commit) / fusion /
///      TBA nesting and un-nesting / round-trip / withdrawFees / pause across several actors.
///      Every action that runs the auto-reveal queue (buy, tape-out, fusion, permissionless poke) is
///      checked against an independent FIFO model: exactly the expected ids reveal / re-commit.
///      Works with the fair-launch guard on or off (buys are clamped to the live caps).
///      Per-action properties are asserted inline; global ones are checked by the invariant suites.
contract Handler is Test {
    CerebrProcessor public immutable p;
    CerebrCircuit public immutable c;
    address public immutable owner;
    address[] public actors;

    uint256 internal constant MAX = 10_000_000e18;

    // Ghosts
    uint256 public ghostPaidIn;
    uint256 public ghostPaidOut; // to sellers
    uint256 public ghostFeesWithdrawn;
    uint256 public ghostTapeOuts;
    uint256 public ghostFusions;
    uint256 public ghostBurned; // CBR burned by tape-outs + fusions
    uint256 public ghostRecommits;
    uint256 public ghostReveals;
    uint256 public ghostMaxSupplySeen;
    uint256 public ghostQueueReveals;
    uint256 public ghostQueueRecommits;
    uint256[4] internal _ghostMinted;
    // Fair-launch tracking (only while the window is active).
    uint256 public ghostLaunchBlock;
    uint256 public ghostLaunchBlockBought;
    mapping(address => uint256) public ghostLaunchWalletBought;
    mapping(address => uint256) internal _ghostLaunchWalletBlock;
    uint256 public ghostMaxLaunchBlockBought;
    uint256 public ghostMaxLaunchWalletBought;
    mapping(bytes32 => uint256) public calls;

    constructor(CerebrProcessor _p, address _owner) {
        p = _p;
        c = _p.CIRCUIT();
        owner = _owner;
        for (uint256 i; i < 5; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    function ghostMinted(uint256 t) external view returns (uint256) {
        return _ghostMinted[t];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _trackSupply() internal {
        uint256 s = p.totalSupply();
        if (s > ghostMaxSupplySeen) ghostMaxSupplySeen = s;
    }

    function _cost(Tier t) internal pure returns (uint256) {
        if (t == Tier.Basic) return 5_000e18;
        if (t == Tier.Pro) return 20_000e18;
        return 100_000e18;
    }

    /// @dev Largest buy allowed right now for `a` (supply cap and launch caps).
    function _buyRoom(address a) internal view returns (uint256 room) {
        room = MAX - p.totalSupply();
        (uint256 w, uint256 g) = p.launchCapRemaining(a);
        if (w < room) room = w;
        if (g < room) room = g;
    }

    function _recordLaunch(address a, uint256 amount) internal {
        if (!p.launchActive()) return;
        if (ghostLaunchBlock != block.number) {
            ghostLaunchBlock = block.number;
            ghostLaunchBlockBought = 0;
        }
        if (_ghostLaunchWalletBlock[a] != block.number) {
            _ghostLaunchWalletBlock[a] = block.number;
            ghostLaunchWalletBought[a] = 0;
        }
        ghostLaunchBlockBought += amount;
        ghostLaunchWalletBought[a] += amount;
        if (ghostLaunchBlockBought > ghostMaxLaunchBlockBought) ghostMaxLaunchBlockBought = ghostLaunchBlockBought;
        if (ghostLaunchWalletBought[a] > ghostMaxLaunchWalletBought) {
            ghostMaxLaunchWalletBought = ghostLaunchWalletBought[a];
        }
    }

    /// @dev Mirror of the net-buy launch caps: a sell gives back same-block usage (saturating).
    function _recordLaunchSell(address a, uint256 amount) internal {
        if (!p.launchActive()) return;
        if (ghostLaunchBlock == block.number) {
            ghostLaunchBlockBought = ghostLaunchBlockBought > amount ? ghostLaunchBlockBought - amount : 0;
        }
        if (_ghostLaunchWalletBlock[a] == block.number) {
            ghostLaunchWalletBought[a] = ghostLaunchWalletBought[a] > amount ? ghostLaunchWalletBought[a] - amount : 0;
        }
    }

    /// @dev Exact buy (amount must fit _buyRoom). Records ghosts.
    function _doBuy(address a, uint256 amount) internal {
        uint256 cost = p.quoteBuy(amount);
        vm.deal(a, a.balance + cost);
        _recordLaunch(a, amount);
        QueueExp memory e = _queueExpect(p.AUTO_REVEAL_PER_BUY());
        vm.prank(a);
        p.buyTransistors{value: cost}(amount, cost);
        _queueCheck(e);
        ghostPaidIn += cost;
        _trackSupply();
    }

    /// @dev Top `a` up to `need` CBR, rolling blocks if the launch caps bind. False if impossible.
    function _ensureCbr(address a, uint256 need) internal returns (bool) {
        for (uint256 i; i < 40; ++i) {
            uint256 bal = p.balanceOf(a);
            if (bal >= need) return true;
            if (p.totalSupply() + (need - bal) > MAX) return false;
            uint256 room = _buyRoom(a);
            if (room == 0) {
                vm.roll(block.number + 1);
                continue;
            }
            uint256 amt = need - bal;
            if (amt > room) amt = room;
            _doBuy(a, amt);
        }
        return p.balanceOf(a) >= need;
    }

    // ------------------------------------------------------------ reveal-queue model

    struct QueueExp {
        uint256 head;
        uint256 newHead;
        bool[] rev;
        uint256[] cb;
        uint8[] act; // 0 untouched, 1 reveal, 2 re-commit
        uint256[] seeds;
    }

    /// @dev Independent model of CerebrCircuit's FIFO auto-reveal for a call settling up to `k`.
    function _queueExpect(uint256 k) internal view returns (QueueExp memory e) {
        e.head = c.revealQueueHead();
        uint256 len = c.totalMinted() + 1 - e.head;
        e.rev = new bool[](len);
        e.cb = new uint256[](len);
        e.act = new uint8[](len);
        e.seeds = new uint256[](len);
        for (uint256 j; j < len; ++j) {
            (, bool r, uint64 cb) = c.circuitInfo(e.head + j);
            e.rev[j] = r;
            e.cb[j] = cb;
        }
        e.newHead = e.head;
        uint256 budget = k < len ? k : len;
        uint256 steps = budget + c.AUTO_REVEAL_MAX_SKIPS();
        uint256 settled;
        bool headMoves = true;
        for (uint256 j; j < len && settled < budget && steps > 0; ++j) {
            steps--;
            if (!e.rev[j]) {
                if (block.number <= e.cb[j] + 1) break; // FIFO: first not-ready stops the walk
                bytes32 bh = blockhash(e.cb[j] + 1);
                if (bh == bytes32(0)) {
                    e.act[j] = 2;
                    headMoves = false;
                } else {
                    e.act[j] = 1;
                    e.seeds[j] = uint256(keccak256(abi.encode(bh, e.head + j, block.chainid, address(c))));
                }
                settled++;
            }
            if (headMoves) e.newHead = e.head + j + 1;
        }
    }

    function _queueCheck(QueueExp memory e) internal {
        for (uint256 j; j < e.act.length; ++j) {
            uint256 id = e.head + j;
            (, bool r, uint64 cb) = c.circuitInfo(id);
            if (e.act[j] == 1) {
                assertTrue(r, "queue: expected reveal");
                assertEq(c.seedOf(id), e.seeds[j], "queue: seed");
                ghostQueueReveals++;
                ghostReveals++;
            } else if (e.act[j] == 2) {
                assertFalse(r, "queue: expected re-commit");
                assertEq(cb, block.number, "queue: re-commit block");
                ghostQueueRecommits++;
                ghostRecommits++;
            } else {
                assertEq(r, e.rev[j], "queue: touched an id out of turn");
                assertEq(cb, e.cb[j], "queue: changed an id out of turn");
            }
        }
        assertEq(c.revealQueueHead(), e.newHead, "queue: head");
    }

    /// Anyone may poke the queue directly (keeper-style). Never reverts; matches the model.
    function queuePoke(uint256 k, uint256 actorSeed) public {
        k = bound(k, 0, 6);
        QueueExp memory e = _queueExpect(k);
        vm.prank(_actor(actorSeed));
        c.processRevealQueue(k);
        _queueCheck(e);
        calls["queuePoke"]++;
    }

    // ------------------------------------------------------------ curve

    function buy(uint256 actorSeed, uint256 amount) public {
        if (p.paused()) return;
        address a = _actor(actorSeed);
        uint256 room = _buyRoom(a);
        if (room == 0) {
            vm.roll(block.number + 1);
            room = _buyRoom(a);
            if (room == 0) return;
        }
        // Mix small and large buys so we hit both dust rounding and big jumps.
        amount = amount % 2 == 0 ? bound(amount, 1, 1e18) : bound(amount, 1, room);
        if (amount > room) amount = room;
        uint256 cost = p.quoteBuy(amount);
        uint256 priceBefore = p.currentPrice();
        vm.deal(a, a.balance + cost + 1 ether);
        uint256 balBefore = a.balance;
        _recordLaunch(a, amount);
        QueueExp memory e = _queueExpect(p.AUTO_REVEAL_PER_BUY());
        vm.prank(a);
        uint256 charged = p.buyTransistors{value: cost + 1 ether}(amount, cost);
        _queueCheck(e);
        assertEq(charged, cost);
        assertEq(balBefore - a.balance, cost, "excess not refunded");
        assertGe(p.currentPrice(), priceBefore, "price fell on buy");
        ghostPaidIn += cost;
        calls["buy"]++;
        _trackSupply();
    }

    /// Launch guard: a buy of one unit more than the remaining allowance always reverts.
    function capProbe(uint256 actorSeed) public {
        if (p.paused() || !p.launchActive()) return;
        address a = _actor(actorSeed);
        (uint256 w, uint256 g) = p.launchCapRemaining(a);
        uint256 over = (w < g ? w : g) + 1;
        if (p.totalSupply() + over > MAX) return;
        vm.deal(a, a.balance + 10_000 ether);
        vm.prank(a);
        if (g <= w) vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchBlockCapExceeded.selector, g));
        else vm.expectRevert(abi.encodeWithSelector(CerebrProcessor.LaunchWalletCapExceeded.selector, w));
        p.buyTransistors{value: 10_000 ether}(over, type(uint256).max);
        calls["capProbe"]++;
    }

    function sell(uint256 actorSeed, uint256 amount) public {
        address a = _actor(actorSeed);
        uint256 bal = p.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        (,, uint256 quoted) = p.quoteSell(amount);
        uint256 priceBefore = p.currentPrice();
        uint256 ethBefore = a.balance;
        uint256 burnedBefore = p.totalCbrBurned();
        QueueExp memory e = _queueExpect(0); // sells never settle anything
        vm.prank(a);
        uint256 net = p.sellTransistors(amount, quoted);
        _queueCheck(e);
        _recordLaunchSell(a, amount);
        assertEq(net, quoted);
        assertEq(a.balance - ethBefore, net);
        assertLe(p.currentPrice(), priceBefore, "price rose on sell");
        assertEq(p.totalCbrBurned(), burnedBefore, "sell counted as sink burn");
        ghostPaidOut += net;
        calls["sell"]++;
    }

    /// Buying then immediately selling the same amount never profits.
    function roundTrip(uint256 actorSeed, uint256 amount) public {
        if (p.paused()) return;
        address a = _actor(actorSeed);
        uint256 room = _buyRoom(a);
        if (room == 0) return;
        amount = bound(amount, 1, room);
        uint256 cost = p.quoteBuy(amount);
        vm.deal(a, a.balance + cost);
        _recordLaunch(a, amount);
        QueueExp memory e = _queueExpect(p.AUTO_REVEAL_PER_BUY());
        vm.startPrank(a);
        p.buyTransistors{value: cost}(amount, cost);
        uint256 net = p.sellTransistors(amount, 0);
        vm.stopPrank();
        _queueCheck(e);
        _recordLaunchSell(a, amount);
        // Net-buy caps: an atomic round trip leaves the wallet's and the block's usage unchanged.
        if (p.launchActive()) {
            (uint256 w, uint256 g) = p.launchCapRemaining(a);
            assertEq(w, p.WALLET_CAP_PER_BLOCK() - ghostLaunchWalletBought[a], "round trip kept wallet cap");
            assertEq(g, p.BLOCK_CAP() - ghostLaunchBlockBought, "round trip kept block cap");
        }
        assertLe(net, cost, "round-trip arbitrage");
        ghostPaidIn += cost;
        ghostPaidOut += net;
        calls["roundTrip"]++;
        _trackSupply();
    }

    // ------------------------------------------------------------ tape-out

    function _tapeOut(address a, Tier tier) internal returns (bool ok, uint256 id) {
        uint256 cost = _cost(tier);
        if (!_ensureCbr(a, cost)) return (false, 0);
        uint256 sBefore = p.totalSupply();
        (uint256 burnedValue,,) = p.quoteSell(cost); // floor-rounded curve value of burned CBR
        uint256 surplusBefore = p.surplusReserve();
        uint256 balBefore = address(p).balance;
        uint256 minted = c.totalMinted();
        QueueExp memory e = _queueExpect(c.AUTO_REVEAL_PER_MINT());

        vm.prank(a);
        id = (tier == Tier.Basic && minted % 2 == 0) ? p.tapeOutCircuit() : p.tapeOutCircuitTier(tier);
        _queueCheck(e);

        assertEq(id, minted + 1);
        assertEq(c.ownerOf(id), a);
        (Tier t, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
        assertEq(uint8(t), uint8(tier));
        assertFalse(revealed);
        assertEq(commitBlock, block.number);
        assertEq(p.totalSupply(), sBefore - cost);
        assertEq(address(p).balance, balBefore);
        assertGe(p.surplusReserve() + 2, surplusBefore + burnedValue, "surplus grew too little");
        ghostTapeOuts++;
        ghostBurned += cost;
        _ghostMinted[uint8(tier)]++;
        return (true, id);
    }

    function tapeOut(uint256 actorSeed, uint256 tierSeed) public {
        if (p.paused()) return;
        // Skew towards Basic so fusion pairs appear often.
        uint256 r = tierSeed % 10;
        Tier tier = r < 6 ? Tier.Basic : r < 9 ? Tier.Pro : Tier.Quantum;
        (bool ok,) = _tapeOut(_actor(actorSeed), tier);
        if (ok) calls["tapeOut"]++;
    }

    /// Singularity can never be taped out directly.
    function tapeOutSingularity(uint256 actorSeed) public {
        if (p.paused()) return;
        address a = _actor(actorSeed);
        uint256 bal = p.balanceOf(a);
        vm.prank(a);
        vm.expectRevert(CerebrProcessor.TierNotMintable.selector);
        p.tapeOutCircuitTier(Tier.Singularity);
        assertEq(p.balanceOf(a), bal);
        calls["tapeOutSingularity"]++;
    }

    // ------------------------------------------------------------ reveal

    function _revealNow(uint256 id, address caller) internal returns (bool) {
        (Tier tier,, uint64 commitBlock) = c.circuitInfo(id);
        if (block.number < uint256(commitBlock) + 2) vm.roll(uint256(commitBlock) + 2);
        bytes32 bh = blockhash(uint256(commitBlock) + 1);
        vm.prank(caller);
        bool res = c.reveal(id);
        if (bh == bytes32(0)) {
            assertFalse(res, "zero hash used");
            (,, uint64 nc) = c.circuitInfo(id);
            assertEq(nc, block.number);
            ghostRecommits++;
            return false;
        }
        assertTrue(res);
        assertEq(c.seedOf(id), uint256(keccak256(abi.encode(bh, id, block.chainid, address(c)))));
        assertEq(uint8(c.traits(id).tier), uint8(tier));
        ghostReveals++;
        return true;
    }

    function reveal(uint256 idSeed, uint256 mode) public {
        uint256 n = c.totalMinted();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        (, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
        if (revealed) {
            vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyRevealed.selector, id));
            c.reveal(id);
            return;
        }
        if (block.number < uint256(commitBlock) + 2) {
            vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.RevealTooEarly.selector, uint256(commitBlock) + 2));
            c.reveal(id);
        }
        // Occasionally let the hash expire to exercise the re-commit path.
        if (mode % 8 == 0 && block.number <= uint256(commitBlock) + 1 + 256) vm.roll(uint256(commitBlock) + 1 + 257);
        _revealNow(id, _actor(mode >> 8)); // anyone may reveal
        calls["reveal"]++;
    }

    // ------------------------------------------------------------ fusion

    /// @dev First revealed Circuit of `tier` owned directly by `a`, skipping `skip`.
    function _findRevealed(address a, Tier tier, uint256 skip) internal view returns (uint256) {
        uint256 n = c.totalMinted();
        for (uint256 id = 1; id <= n; ++id) {
            if (id == skip || c.ownerOf(id) != a || c.fusedInto(id) != 0) continue;
            (Tier t, bool revealed,) = c.circuitInfo(id);
            if (revealed && t == tier) return id;
        }
        return 0;
    }

    /// @dev Get a revealed Circuit of `tier` for `a`, taping out (and revealing) one if needed.
    function _obtainRevealed(address a, Tier tier, uint256 skip) internal returns (uint256 id) {
        id = _findRevealed(a, tier, skip);
        if (id != 0) return id;
        bool ok;
        (ok, id) = _tapeOut(a, tier);
        if (!ok) return 0;
        // Reveal (a re-commit can only happen if > 256 blocks pass, so loop at most twice).
        for (uint256 i; i < 3 && !_revealNow(id, a); ++i) {}
        (, bool revealed,) = c.circuitInfo(id);
        if (!revealed) return 0;
    }

    function fuse(uint256 actorSeed, uint256 tierSeed) public {
        if (p.paused()) return;
        address a = _actor(actorSeed);
        Tier tier = Tier(tierSeed % 6 < 4 ? 0 : tierSeed % 6 < 5 ? 1 : 2);
        uint256 idA = _obtainRevealed(a, tier, 0);
        if (idA == 0) return;
        uint256 idB = _obtainRevealed(a, tier, idA);
        if (idB == 0) return;
        uint256 cost = _cost(tier);
        if (!_ensureCbr(a, cost)) return;

        uint256 sBefore = p.totalSupply();
        uint256 balBefore = address(p).balance;
        uint256 expectedChild = c.totalMinted() + 1;
        QueueExp memory e = _queueExpect(c.AUTO_REVEAL_PER_MINT());
        vm.prank(a);
        uint256 child = p.fuseCircuits(idA, idB);
        _queueCheck(e);

        address tba = c.tokenBoundAccount(child);
        assertEq(child, expectedChild);
        assertEq(c.ownerOf(child), a);
        assertEq(uint8(c.tierOf(child)), uint8(tier) + 1);
        assertEq(c.ownerOf(idA), tba, "parent A not in child TBA");
        assertEq(c.ownerOf(idB), tba, "parent B not in child TBA");
        assertEq(c.fusedInto(idA), child, "parent A not marked fused");
        assertEq(c.fusedInto(idB), child, "parent B not marked fused");
        assertEq(p.totalSupply(), sBefore - cost);
        assertEq(address(p).balance, balBefore);
        ghostFusions++;
        ghostBurned += cost;
        _ghostMinted[uint8(tier) + 1]++;
        calls["fuse"]++;
    }

    /// Fusion with invalid inputs (same id, cross-actor, unrevealed) always reverts and changes nothing.
    function badFuse(uint256 actorSeed, uint256 idSeed, uint256 idSeed2) public {
        uint256 n = c.totalMinted();
        if (n == 0) return;
        address a = _actor(actorSeed);
        uint256 x = bound(idSeed, 1, n);
        uint256 y = bound(idSeed2, 1, n + 1);
        bool valid;
        if (!p.paused() && x != y && y <= n && c.ownerOf(x) == a && c.ownerOf(y) == a) {
            (Tier tx_, bool rx,) = c.circuitInfo(x);
            (Tier ty, bool ry,) = c.circuitInfo(y);
            valid = rx && ry && tx_ == ty && tx_ != Tier.Singularity && p.balanceOf(a) >= _cost(tx_)
                && c.fusedInto(x) == 0 && c.fusedInto(y) == 0;
        }
        if (valid) return; // only probe invalid inputs here
        uint256 supply = p.totalSupply();
        uint256 minted = c.totalMinted();
        vm.prank(a);
        vm.expectRevert();
        p.fuseCircuits(x, y);
        assertEq(p.totalSupply(), supply);
        assertEq(c.totalMinted(), minted);
        calls["badFuse"]++;
    }

    /// Recycling attack (round-2 high): pull two fused parents back out of the child's account and
    /// try to fuse them again. Must always revert AlreadyFused and change nothing.
    function refuse(uint256 actorSeed, uint256 startSeed) public {
        if (p.paused()) return;
        uint256 n = c.totalMinted();
        if (n < 3) return;
        address a = _actor(actorSeed);
        uint256 x;
        uint256 y;
        uint256 start = bound(startSeed, 1, n);
        for (uint256 k; k < n && y == 0; ++k) {
            uint256 id = (start + k - 1) % n + 1;
            if (c.fusedInto(id) == 0) continue;
            if (x == 0) x = id;
            else if (c.tierOf(id) == c.tierOf(x)) y = id;
        }
        if (y == 0) return;
        // Pull both out of whatever account holds them (simulating the holder's execute).
        uint256[2] memory ids = [x, y];
        for (uint256 i; i < 2; ++i) {
            address holder = c.ownerOf(ids[i]);
            if (holder == a) continue;
            vm.prank(holder);
            c.transferFrom(holder, a, ids[i]);
        }
        if (!_ensureCbr(a, _cost(c.tierOf(x)))) return;
        uint256 supply = p.totalSupply();
        uint256 minted = c.totalMinted();
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyFused.selector, x));
        p.fuseCircuits(x, y);
        assertEq(p.totalSupply(), supply);
        assertEq(c.totalMinted(), minted);
        calls["refuse"]++;
    }

    /// An operator approved by a Circuit's TBA can never move Circuits out of that TBA.
    function operatorPull(uint256 idSeed, uint256 actorSeed) public {
        uint256 n = c.totalMinted();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        address holder = c.ownerOf(id);
        if (c.tokenOfAccount(holder) == 0) return;
        address op = _actor(actorSeed);
        vm.prank(holder);
        c.setApprovalForAll(op, true);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AccountOperatorTransfer.selector, id));
        c.transferFrom(holder, op, id);
        vm.prank(holder);
        c.setApprovalForAll(op, false);
        assertEq(c.ownerOf(id), holder);
        calls["operatorPull"]++;
    }

    // ------------------------------------------------------------ TBA nesting

    /// @dev Expected outcome of moving `tokenId` to `to`: 0 ok, 1 cycle, 2 too deep.
    function _expectedNest(address to, uint256 tokenId) internal view returns (uint256) {
        address cur = to;
        for (uint256 i; i < 16; ++i) {
            uint256 holder = c.tokenOfAccount(cur);
            if (holder == 0) return 0;
            if (holder == tokenId) return 1;
            cur = c.ownerOf(holder);
        }
        return 2;
    }

    /// An actor sends a Circuit it holds directly into some Circuit's TBA.
    function nest(uint256 idSeed, uint256 targetSeed) public {
        uint256 n = c.totalMinted();
        if (n < 2) return;
        uint256 id = bound(idSeed, 1, n);
        address from = c.ownerOf(id);
        if (c.tokenOfAccount(from) != 0) return; // held by a TBA: use unnest
        address to = c.tokenBoundAccount(bound(targetSeed, 1, n));
        uint256 expected = _expectedNest(to, id);
        vm.prank(from);
        if (expected == 1) vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, id));
        else if (expected == 2) vm.expectRevert(CerebrCircuit.NestingTooDeep.selector);
        c.transferFrom(from, to, id);
        if (expected == 0) assertEq(c.ownerOf(id), to);
        calls[expected == 0 ? bytes32("nestOk") : bytes32("nestBlocked")]++;
    }

    /// A TBA (simulated by prank) returns a Circuit it holds to an actor. Never blocked.
    function unnest(uint256 idSeed, uint256 actorSeed) public {
        uint256 n = c.totalMinted();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        address holder = c.ownerOf(id);
        if (c.tokenOfAccount(holder) == 0) return;
        address to = _actor(actorSeed);
        vm.prank(holder);
        c.transferFrom(holder, to, id);
        assertEq(c.ownerOf(id), to);
        calls["unnest"]++;
    }

    // ------------------------------------------------------------ admin

    function withdrawFees(uint256 toSeed) public {
        uint256 fees = p.protocolFees();
        if (fees == 0) return;
        address payable to = payable(_actor(toSeed));
        uint256 before = to.balance;
        uint256 pBal = address(p).balance;
        vm.prank(owner);
        p.withdrawFees(to);
        assertEq(to.balance - before, fees);
        assertEq(pBal - address(p).balance, fees, "owner took more than fees");
        assertEq(p.protocolFees(), 0);
        ghostFeesWithdrawn += fees;
        calls["withdrawFees"]++;
    }

    function togglePause(uint256 seed) public {
        // Rarely toggle, so most sequences run unpaused.
        if (seed % 10 != 0) return;
        bool paused = p.paused();
        vm.prank(owner);
        if (paused) p.unpause();
        else p.pause();
        calls["togglePause"]++;
    }

    /// Non-owner trying to withdraw must always fail.
    function attackerWithdraw(uint256 actorSeed) public {
        address a = _actor(actorSeed);
        vm.prank(a);
        vm.expectRevert();
        p.withdrawFees(payable(a));
    }

    function advance(uint256 blocks) public {
        vm.roll(block.number + bound(blocks, 1, 50));
    }
}

/// @dev Shared invariants. Concrete suites pick the launch parameters.
abstract contract CerebrInvariantBase is Test, ERC6551Fixture {
    CerebrProcessor internal p;
    CerebrCircuit internal c;
    Handler internal h;
    address internal owner = makeAddr("owner");

    function _deploy(uint256 launchBlocks, uint256 walletCap, uint256 blockCap) internal {
        p = new CerebrProcessor(
            1e12, 1e8, owner, launchBlocks, walletCap, blockCap, address(registry6551), address(accountImpl6551)
        );
        c = p.CIRCUIT();
        h = new Handler(p, owner);
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](19);
        sels[0] = Handler.buy.selector;
        sels[1] = Handler.sell.selector;
        sels[2] = Handler.roundTrip.selector;
        sels[3] = Handler.tapeOut.selector;
        sels[4] = Handler.withdrawFees.selector;
        sels[5] = Handler.togglePause.selector;
        sels[6] = Handler.attackerWithdraw.selector;
        sels[7] = Handler.tapeOutSingularity.selector;
        sels[8] = Handler.reveal.selector;
        sels[9] = Handler.fuse.selector;
        sels[10] = Handler.badFuse.selector;
        sels[11] = Handler.nest.selector;
        sels[12] = Handler.unnest.selector;
        sels[13] = Handler.capProbe.selector;
        sels[14] = Handler.advance.selector;
        sels[15] = Handler.fuse.selector; // weight fusion x2
        sels[16] = Handler.refuse.selector;
        sels[17] = Handler.operatorPull.selector;
        sels[18] = Handler.queuePoke.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    /// Reserve solvency: the reserve always covers buying back every CBR plus accrued fees.
    function invariant_Solvent() public view {
        assertGe(address(p).balance, p.reserveRequired() + p.protocolFees());
    }

    /// Accounting: balance == paid in - paid out - fees withdrawn (no leaks, no stray OKB).
    function invariant_BalanceAccounting() public view {
        assertEq(address(p).balance, h.ghostPaidIn() - h.ghostPaidOut() - h.ghostFeesWithdrawn());
    }

    /// Supply cap.
    function invariant_SupplyCap() public view {
        assertLe(p.totalSupply(), p.MAX_SUPPLY());
        assertLe(h.ghostMaxSupplySeen(), p.MAX_SUPPLY());
    }

    /// Sum of actor balances equals totalSupply (only actors ever hold CBR).
    function invariant_BalancesSumToSupply() public view {
        uint256 sum;
        for (uint256 i; i < h.actorCount(); ++i) {
            sum += p.balanceOf(h.actors(i));
        }
        assertEq(sum, p.totalSupply());
    }

    /// Spot price equals the curve formula and is >= base.
    function invariant_PriceConsistent() public view {
        assertEq(p.currentPrice(), p.BASE_PRICE() + p.SLOPE() * p.totalSupply() / 1e18);
        assertGe(p.currentPrice(), p.BASE_PRICE());
    }

    /// One NFT per tape-out or fusion.
    function invariant_CircuitCount() public view {
        assertEq(c.totalMinted(), h.ghostTapeOuts() + h.ghostFusions());
    }

    /// Burn counter equals the CBR destroyed by tape-outs and fusions (sells are not counted).
    function invariant_BurnCounter() public view {
        assertEq(p.totalCbrBurned(), h.ghostBurned());
    }

    /// Per-tier counters match the ghost, sum to totalMinted, and match stored tiers.
    function invariant_TierCounts() public view {
        uint256[4] memory scanned;
        uint256 n = c.totalMinted();
        for (uint256 id = 1; id <= n; ++id) {
            (Tier t,,) = c.circuitInfo(id);
            scanned[uint8(t)]++;
        }
        uint256 sum;
        for (uint256 t; t < 4; ++t) {
            uint256 m = c.mintedByTier(Tier(t));
            assertEq(m, h.ghostMinted(t), "mintedByTier != ghost");
            assertEq(m, scanned[t], "mintedByTier != stored tiers");
            sum += m;
        }
        assertEq(sum, n);
        // Every Singularity came from a fusion.
        assertLe(c.mintedByTier(Tier.Singularity), h.ghostFusions());
    }

    /// No Circuit 1..totalMinted is ever owned by address(0); ids 0 and totalMinted+1 are unminted.
    function invariant_NoZeroOwner() public view {
        uint256 n = c.totalMinted();
        for (uint256 id = 1; id <= n; ++id) {
            assertTrue(c.ownerOf(id) != address(0));
        }
        assertEq(c.balanceOf(address(this)), 0);
        try c.ownerOf(n + 1) returns (address) {
            assertTrue(false, "unminted id has owner");
        } catch {}
        try c.ownerOf(0) returns (address) {
            assertTrue(false, "id 0 has owner");
        } catch {}
    }

    /// Every Circuit's ownership chain through TBAs ends at a non-TBA address (no locked cycles),
    /// and the reverse TBA lookup is consistent.
    function invariant_NoOwnershipCycles() public view {
        uint256 n = c.totalMinted();
        for (uint256 id = 1; id <= n; ++id) {
            assertEq(c.tokenOfAccount(c.tokenBoundAccount(id)), id, "reverse lookup");
            address cur = c.ownerOf(id);
            uint256 steps;
            while (c.tokenOfAccount(cur) != 0) {
                uint256 holder = c.tokenOfAccount(cur);
                assertTrue(holder != id, "cycle");
                cur = c.ownerOf(holder);
                assertLe(++steps, n, "cycle (no root)");
            }
        }
    }

    /// Revealed <=> seed set; unrevealed Circuits expose only their tier.
    function invariant_RevealConsistency() public view {
        uint256 n = c.totalMinted();
        for (uint256 id = 1; id <= n; ++id) {
            (Tier t, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
            assertLe(commitBlock, block.number);
            if (revealed) {
                assertTrue(c.seedOf(id) != 0);
            } else {
                assertEq(c.seedOf(id), 0);
                CerebrCircuit.Traits memory tr = c.traits(id);
                assertFalse(tr.revealed);
                assertEq(uint8(tr.tier), uint8(t));
            }
        }
    }

    /// If anything was ever burned into a sink, surplus is positive (burned backing is locked forever).
    function invariant_SurplusFromSinks() public view {
        if (h.ghostBurned() > 0) assertGt(p.surplusReserve(), 0);
    }

    /// Every fusion marks exactly its two parents; a Circuit is a fusion parent at most once and
    /// always older than its child, which has the next tier.
    function invariant_FusedOnce() public view {
        uint256 n = c.totalMinted();
        uint256 fusedParents;
        for (uint256 id = 1; id <= n; ++id) {
            uint256 child = c.fusedInto(id);
            if (child == 0) continue;
            fusedParents++;
            assertGt(child, id, "child older than parent");
            assertLe(child, n);
            assertEq(uint8(c.tierOf(child)), uint8(c.tierOf(id)) + 1, "child tier");
        }
        assertEq(fusedParents, 2 * h.ghostFusions(), "parents fused more than once");
    }

    /// Reveal queue: every id below the head is revealed and the head never passes totalMinted + 1.
    function invariant_RevealQueue() public view {
        uint256 head = c.revealQueueHead();
        assertGe(head, 1);
        assertLe(head, c.totalMinted() + 1);
        for (uint256 id = 1; id < head; ++id) {
            (, bool revealed,) = c.circuitInfo(id);
            assertTrue(revealed, "sealed Circuit below the queue head");
        }
    }

    /// Fair-launch NET buy caps were never exceeded inside the window.
    function invariant_LaunchCaps() public view {
        if (p.LAUNCH_END_BLOCK() == 0) return;
        assertLe(h.ghostMaxLaunchBlockBought(), p.BLOCK_CAP() == 0 ? type(uint256).max : p.BLOCK_CAP());
        assertLe(
            h.ghostMaxLaunchWalletBought(), p.WALLET_CAP_PER_BLOCK() == 0 ? type(uint256).max : p.WALLET_CAP_PER_BLOCK()
        );
    }
}

/// forge-config: default.invariant.fail-on-revert = true
contract CerebrInvariantTest is CerebrInvariantBase {
    function setUp() public {
        _deploy(0, 0, 0);
    }
}

/// @dev Same handler and invariants with the fair-launch guard on (long window so it stays active).
/// forge-config: default.invariant.fail-on-revert = true
contract CerebrLaunchInvariantTest is CerebrInvariantBase {
    function setUp() public {
        _deploy(1_000_000, 30_000e18, 120_000e18);
    }
}

/// @dev Ongoing-activity handler for the auto-reveal liveness suite. Every call advances 1..MAX_GAP
///      blocks and then runs at least one queue-settling action (buy, tape-out or fusion); sells and
///      keeper reveals are mixed in but never relied on. Records each Circuit's mint block so any
///      re-commit (a re-roll) is detected.
contract LivenessHandler is Test {
    CerebrProcessor public immutable p;
    CerebrCircuit public immutable c;
    address[] public actors;

    uint256 public constant MAX_GAP = 64;

    mapping(uint256 id => uint256) public mintBlock;
    uint256 public ghostRecommits;
    uint256 public ghostMaxReadyAge; // max blocks a sealed Circuit stayed sealed after becoming ready
    mapping(bytes32 => uint256) public calls;

    constructor(CerebrProcessor _p) {
        p = _p;
        c = _p.CIRCUIT();
        for (uint256 i; i < 3; ++i) {
            actors.push(makeAddr(string.concat("live", vm.toString(i))));
        }
    }

    function _buy(address a, uint256 amount) internal {
        uint256 cost = p.quoteBuy(amount);
        vm.deal(a, a.balance + cost);
        vm.prank(a);
        p.buyTransistors{value: cost}(amount, cost);
    }

    function _record(uint256 id) internal {
        mintBlock[id] = block.number;
    }

    function _scan() internal {
        uint256 n = c.totalMinted();
        for (uint256 id = c.revealQueueHead(); id <= n; ++id) {
            (, bool revealed, uint64 cb) = c.circuitInfo(id);
            if (revealed) continue;
            if (cb != mintBlock[id]) ghostRecommits++;
            uint256 readyAt = uint256(cb) + 2;
            if (block.number > readyAt && block.number - readyAt > ghostMaxReadyAge) {
                ghostMaxReadyAge = block.number - readyAt;
            }
        }
    }

    function act(uint256 actorSeed, uint256 gap, uint256 kind, uint256 tierSeed) public {
        vm.roll(block.number + 1 + gap % MAX_GAP);
        address a = actors[actorSeed % actors.length];
        uint256 k = kind % 10;
        if (k < 3) {
            _buy(a, bound(tierSeed, 1, 50_000e18));
            calls["buy"]++;
        } else if (k < 8) {
            Tier tier = tierSeed % 4 == 0 ? Tier.Pro : Tier.Basic;
            uint256 cost = p.tapeOutCost(tier);
            if (p.balanceOf(a) < cost) _buy(a, cost - p.balanceOf(a));
            vm.prank(a);
            _record(p.tapeOutCircuitTier(tier));
            calls["tapeOut"]++;
        } else if (k == 8) {
            // Fusion if `a` holds a revealed, unfused same-tier pair; otherwise a buy.
            (uint256 x, uint256 y) = _pair(a);
            if (x == 0) {
                _buy(a, 1e18);
                calls["buy"]++;
            } else {
                uint256 cost = p.tapeOutCost(c.tierOf(x));
                if (p.balanceOf(a) < cost) _buy(a, cost - p.balanceOf(a));
                vm.prank(a);
                _record(p.fuseCircuits(x, y));
                calls["fuse"]++;
            }
        } else {
            // A sell (no queue work) followed by a buy in the same block.
            uint256 bal = p.balanceOf(a);
            if (bal != 0) {
                vm.prank(a);
                p.sellTransistors(bound(tierSeed, 1, bal), 0);
            }
            _buy(a, 1e18);
            calls["sellBuy"]++;
        }
        _scan();
    }

    function _pair(address a) internal view returns (uint256 x, uint256 y) {
        uint256 n = c.totalMinted();
        for (uint256 id = 1; id <= n; ++id) {
            if (c.ownerOf(id) != a || c.fusedInto(id) != 0) continue;
            (Tier t, bool revealed,) = c.circuitInfo(id);
            if (!revealed || t == Tier.Singularity) continue;
            if (x == 0) {
                x = id;
            } else if (c.tierOf(x) == t) {
                return (x, id);
            }
        }
        return (0, 0);
    }
}

/// @dev Auto-reveal liveness: with ongoing activity (a buy, tape-out or fusion at least every 64
///      blocks, which is far below the 256-block blockhash window) no Circuit ever expires or
///      re-commits, so nobody can re-roll traits by withholding a reveal and no keeper is needed.
/// forge-config: default.invariant.fail-on-revert = true
contract CerebrRevealLivenessInvariantTest is Test, ERC6551Fixture {
    CerebrProcessor internal p;
    CerebrCircuit internal c;
    LivenessHandler internal h;

    function setUp() public {
        p = new CerebrProcessor(1e12, 1e8, makeAddr("owner"), 0, 0, 0, address(registry6551), address(accountImpl6551));
        c = p.CIRCUIT();
        h = new LivenessHandler(p);
        targetContract(address(h));
    }

    /// No pending Circuit stays sealed beyond its reveal window while there is activity.
    function invariant_NoExpiryUnderActivity() public view {
        assertEq(h.ghostRecommits(), 0, "a Circuit re-committed (re-roll) despite ongoing activity");
        // A ready Circuit is settled within two actions (<= 2 * MAX_GAP blocks), well inside 256.
        assertLe(h.ghostMaxReadyAge(), 2 * h.MAX_GAP(), "sealed Circuit waited too long");
        uint256 n = c.totalMinted();
        for (uint256 id = c.revealQueueHead(); id <= n; ++id) {
            (, bool revealed, uint64 cb) = c.circuitInfo(id);
            if (!revealed) assertTrue(blockhash(uint256(cb) + 1) != bytes32(0) || block.number <= uint256(cb) + 1);
        }
    }

    /// Queue consistency holds here too.
    function invariant_LivenessQueueHead() public view {
        uint256 head = c.revealQueueHead();
        assertLe(head, c.totalMinted() + 1);
        for (uint256 id = 1; id < head; ++id) {
            (, bool revealed,) = c.circuitInfo(id);
            assertTrue(revealed);
        }
    }
}
