// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IERC6551Registry} from "./erc6551/IERC6551Registry.sol";

/// @notice Circuit tiers. Basic/Pro/Quantum can be taped out; Singularity is fusion-only.
enum Tier {
    Basic,
    Pro,
    Quantum,
    Singularity
}

/// @title CerebrCircuit
/// @notice Neural Circuit NFTs ("AI brains") minted only by the CerebrProcessor (tape-out or fusion).
///         Traits use commit-reveal: a mint commits to its block; anyone can later `reveal` it with
///         the hash of the NEXT block, which nobody knows at mint time. Art and metadata are on-chain.
///         Every Circuit has an ERC-6551 token-bound account ("brain wallet") at a counterfactual
///         address. Fusion moves the two parents into the child's account.
/// @dev Residual randomness risks (documented, accepted for cosmetic traits):
///      - The X Layer sequencer produces block hashes and could bias the hash of commitBlock + 1.
///      - The owner can see the result once commitBlock + 1 is mined. If nobody reveals it within
///        256 blocks the hash expires and the Circuit re-commits (a re-roll that costs time).
///        On-chain auto-reveal closes this window while the protocol is in use: every sealed
///        Circuit joins a FIFO reveal queue (ids are sequential, so the queue is just a cursor),
///        and every tape-out and fusion settles up to AUTO_REVEAL_PER_MINT ready Circuits from
///        its head (buys settle up to 1). `reveal(id)` stays permissionless, so an off-chain
///        keeper is an optional backup for quiet periods (no buys, mints or fusions for 256 blocks).
///      - If blockhash returns zero (expired or a chain quirk), reveal re-commits and never uses a
///        zero hash.
///      Fusion: each Circuit can be used as a fusion parent at most once (`fusedInto`), so parents
///      pulled back out of a child's account cannot be fused again.
///      Circuits held by a canonical Circuit token-bound account can only be moved by that account
///      itself (i.e. through `execute`, which bumps the account's `state`), never by an operator the
///      account approved earlier. This keeps state-bound marketplace orders for a Circuit safe.
contract CerebrCircuit is ERC721 {
    using Strings for uint256;

    /// @notice Per-Circuit state, packed in one slot.
    struct CircuitInfo {
        Tier tier;
        bool revealed;
        uint64 commitBlock; // seed comes from blockhash(commitBlock + 1)
    }

    /// @notice Decoded traits of a Circuit. If `revealed` is false only `tier` is set.
    struct Traits {
        Tier tier;
        bool revealed;
        string architecture;
        uint256 cores;
        uint256 clockTenthsGHz; // e.g. 37 => 3.7 GHz
        uint256 nodeNm;
        string rarity;
    }

    /// @notice Max number of token-bound-account hops checked when a Circuit is sent into a TBA.
    uint256 public constant MAX_NESTING_DEPTH = 16;

    /// @notice The only address allowed to mint and fuse (the CerebrProcessor).
    address public immutable PROCESSOR;
    /// @notice ERC-6551 registry used to derive each Circuit's token-bound account.
    IERC6551Registry public immutable ERC6551_REGISTRY;
    /// @notice ERC-6551 account implementation for the token-bound accounts.
    address public immutable ACCOUNT_IMPLEMENTATION;

    /// @notice Max sealed Circuits settled (revealed, or re-committed if expired) from the reveal
    ///         queue by each processor mint or fusion.
    uint256 public constant AUTO_REVEAL_PER_MINT = 2;
    /// @notice Max already-revealed ids (revealed manually via `reveal`) the queue steps over per call,
    ///         on top of the settle budget. Keeps every queue call strictly bounded.
    uint256 public constant AUTO_REVEAL_MAX_SKIPS = 4;

    /// @dev Number of Circuits minted so far (ids are 1..n). Packed with the reveal-queue cursor so a
    ///      mint reads and writes both in one slot. uint128 cannot overflow (one mint burns >= 5k CBR).
    uint128 private _totalMinted;
    /// @dev Reveal-queue cursor: every id <= _revealedPrefix is revealed. The queue head is +1.
    uint128 private _revealedPrefix;

    /// @dev Minted count per tier, packed in one slot.
    uint64[4] private _mintedByTier;

    /// @notice Tier, reveal status and commit block of each Circuit.
    mapping(uint256 tokenId => CircuitInfo) public circuitInfo;

    /// @notice Trait seed of each Circuit (0 until revealed).
    mapping(uint256 tokenId => uint256) public seedOf;

    /// @notice Reverse lookup: canonical token-bound account => Circuit id (0 = not a Circuit TBA).
    mapping(address account => uint256 tokenId) public tokenOfAccount;

    /// @notice Child Circuit a Circuit was fused into (0 = never used as a fusion parent).
    ///         A Circuit can be a fusion parent only once.
    mapping(uint256 tokenId => uint256 childId) public fusedInto;

    /// @notice A Circuit's commit-block hash expired (or was zero), so it re-committed to `commitBlock`.
    event Recommitted(uint256 indexed tokenId, uint256 commitBlock);
    /// @notice Circuit `tokenId` of `tier` revealed its trait `seed`.
    event CircuitRevealed(uint256 indexed tokenId, Tier tier, uint256 seed);

    error OnlyProcessor();
    error InvalidERC6551Config();
    error AlreadyRevealed(uint256 tokenId);
    error RevealTooEarly(uint256 readyBlock);
    error SameCircuit();
    error NotCircuitOwner(uint256 tokenId);
    error CircuitNotRevealed(uint256 tokenId);
    error TierMismatch();
    error MaxTierReached();
    error OwnershipCycle(uint256 tokenId);
    error NestingTooDeep();
    error AlreadyFused(uint256 tokenId);
    error AccountOperatorTransfer(uint256 tokenId);

    modifier onlyProcessor() {
        if (msg.sender != PROCESSOR) revert OnlyProcessor();
        _;
    }

    /// @param processor The CerebrProcessor that deploys this collection.
    /// @param registry ERC-6551 registry (must have code).
    /// @param accountImplementation ERC-6551 account implementation (must have code).
    constructor(address processor, address registry, address accountImplementation)
        ERC721("Cerebr Neural Circuit", "CIRCUIT")
    {
        if (registry.code.length == 0 || accountImplementation.code.length == 0) revert InvalidERC6551Config();
        PROCESSOR = processor;
        ERC6551_REGISTRY = IERC6551Registry(registry);
        ACCOUNT_IMPLEMENTATION = accountImplementation;
    }

    // ------------------------------------------------------------------
    // Processor-only
    // ------------------------------------------------------------------

    /// @notice Mint an unrevealed Circuit of `tier` to `to`. Callable only by the processor.
    ///         First settles up to AUTO_REVEAL_PER_MINT ready Circuits from the reveal queue.
    /// @return id New token id (starts at 1).
    function mint(address to, Tier tier) external onlyProcessor returns (uint256 id) {
        _settleQueue(AUTO_REVEAL_PER_MINT);
        (id,) = _mintCircuit(to, tier);
    }

    /// @notice Fuse two revealed same-tier Circuits owned by `owner` into one Circuit of the next
    ///         tier. The parents are moved (not burned) into the child's token-bound account and
    ///         marked as fused, so they can never be fused again (even if moved back out).
    ///         Callable only by the processor, which burns the CBR. First settles up to
    ///         AUTO_REVEAL_PER_MINT ready Circuits from the reveal queue (this can reveal a parent).
    /// @return childId New Circuit id.
    /// @return inputTier Tier of the parents.
    function fuse(address owner, uint256 idA, uint256 idB)
        external
        onlyProcessor
        returns (uint256 childId, Tier inputTier)
    {
        _settleQueue(AUTO_REVEAL_PER_MINT);
        if (idA == idB) revert SameCircuit();
        if (_ownerOf(idA) != owner) revert NotCircuitOwner(idA);
        if (_ownerOf(idB) != owner) revert NotCircuitOwner(idB);
        CircuitInfo memory a = circuitInfo[idA];
        CircuitInfo memory b = circuitInfo[idB];
        if (!a.revealed) revert CircuitNotRevealed(idA);
        if (!b.revealed) revert CircuitNotRevealed(idB);
        if (a.tier != b.tier) revert TierMismatch();
        if (a.tier == Tier.Singularity) revert MaxTierReached();
        if (fusedInto[idA] != 0) revert AlreadyFused(idA);
        if (fusedInto[idB] != 0) revert AlreadyFused(idB);
        inputTier = a.tier;

        address childAccount;
        (childId, childAccount) = _mintCircuit(owner, Tier(uint8(inputTier) + 1));
        fusedInto[idA] = childId;
        fusedInto[idB] = childId;
        // _transfer: no receiver callback, so no external code runs (the TBA may not exist yet).
        _transfer(owner, childAccount, idA);
        _transfer(owner, childAccount, idB);
    }

    // ------------------------------------------------------------------
    // Reveal (permissionless)
    // ------------------------------------------------------------------

    /// @notice Reveal Circuit `id`'s traits. Anyone may call once block.number > commitBlock + 1.
    ///         If the hash of commitBlock + 1 is no longer available (256-block window passed),
    ///         the Circuit re-commits to the current block instead and must be revealed again.
    /// @return revealed True if traits were revealed, false if the Circuit re-committed.
    function reveal(uint256 id) external returns (bool revealed) {
        _requireOwned(id);
        CircuitInfo storage info = circuitInfo[id];
        if (info.revealed) revert AlreadyRevealed(id);
        uint256 target = uint256(info.commitBlock) + 1;
        if (block.number <= target) revert RevealTooEarly(target + 1);
        return _settle(id, info, target);
    }

    /// @notice Settle up to `maxSettles` sealed Circuits from the head of the FIFO reveal queue.
    ///         Anyone may call it (the processor's buys do, with 1). Same rules as `reveal`:
    ///         ready Circuits are revealed, expired ones re-commit. Stops at the first Circuit that
    ///         is not ready yet; steps over at most AUTO_REVEAL_MAX_SKIPS already-revealed ids.
    ///         Never reverts.
    /// @return settled Number of Circuits revealed or re-committed.
    function processRevealQueue(uint256 maxSettles) external returns (uint256 settled) {
        return _settleQueue(maxSettles);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Number of Circuits minted so far (ids are 1..totalMinted). Circuits are never burned.
    function totalMinted() external view returns (uint256) {
        return _totalMinted;
    }

    /// @notice Head of the FIFO reveal queue: every id below it is revealed. Ids from here to
    ///         totalMinted may still be sealed (some may have been revealed manually).
    function revealQueueHead() external view returns (uint256) {
        return uint256(_revealedPrefix) + 1;
    }

    /// @notice Tier of Circuit `id`. Reverts if it does not exist.
    function tierOf(uint256 id) external view returns (Tier) {
        _requireOwned(id);
        return circuitInfo[id].tier;
    }

    /// @notice First block at which `reveal(id)` can succeed (if not yet revealed).
    function revealReadyBlock(uint256 id) external view returns (uint256) {
        _requireOwned(id);
        return uint256(circuitInfo[id].commitBlock) + 2;
    }

    /// @notice Number of Circuits ever minted at `tier` (fused parents still count; nothing is burned).
    function mintedByTier(Tier tier) external view returns (uint256) {
        return _mintedByTier[uint8(tier)];
    }

    /// @notice Counterfactual ERC-6551 token-bound account of Circuit `id` (salt 0, this chain).
    ///         The account may not be deployed yet; the registry's createAccount deploys it.
    function tokenBoundAccount(uint256 id) public view returns (address) {
        return ERC6551_REGISTRY.account(ACCOUNT_IMPLEMENTATION, bytes32(0), block.chainid, address(this), id);
    }

    /// @notice Decoded traits of Circuit `id`. Reverts if it does not exist.
    ///         Unrevealed Circuits return only `tier` with `revealed = false`.
    function traits(uint256 id) public view returns (Traits memory t) {
        _requireOwned(id);
        CircuitInfo memory info = circuitInfo[id];
        if (!info.revealed) {
            t.tier = info.tier;
            return t;
        }
        t = computeTraits(seedOf[id], info.tier);
    }

    /// @notice Pure trait derivation from a seed and tier (exposed for front-ends and tests).
    /// @dev Higher tiers get better rarity odds and better trait ranges:
    ///      rarity (Common/Rare/Epic/Legendary %): Basic 60/25/12/3, Pro 35/35/22/8,
    ///      Quantum 10/35/38/17, Singularity 0/15/45/40.
    ///      cores: Basic 8-128, Pro 32-256, Quantum 128-512, Singularity 512-1024.
    ///      clock: Basic 1.0-5.9, Pro 2.0-6.9, Quantum 3.0-7.9, Singularity 5.0-9.9 GHz.
    ///      node (nm): Basic {14,7,5,3}, Pro {7,5,3,2}, Quantum {5,3,2,1}, Singularity {3,2,1,1}.
    function computeTraits(uint256 seed, Tier tier) public pure returns (Traits memory t) {
        uint256 ti = uint8(tier);
        t.tier = tier;
        t.revealed = true;
        // Independent 16-bit lanes of the seed per trait (bias from % on 2^16 is negligible).
        t.rarity = _rarity(ti, (seed & 0xffff) % 100);
        t.architecture = _architecture(((seed >> 16) & 0xffff) % 5);
        uint256 lane = (seed >> 32) & 0xffff;
        if (ti == 0) t.cores = 8 + lane % 121;
        else if (ti == 1) t.cores = 32 + lane % 225;
        else if (ti == 2) t.cores = 128 + lane % 385;
        else t.cores = 512 + lane % 513;
        t.clockTenthsGHz = (ti == 3 ? 50 : 10 + 10 * ti) + ((seed >> 48) & 0xffff) % 50;
        uint256 n = ti + ((seed >> 64) & 0xffff) % 4; // 0..6
        // Node table [14,7,5,3,2,1,1], one byte each.
        t.nodeNm = uint8(bytes7(0x0e070503020101)[n]);
    }

    /// @notice Fully on-chain ERC-721 metadata (base64 JSON with embedded base64 SVG).
    ///         Unrevealed Circuits render as a sealed wafer showing only the tier.
    function tokenURI(uint256 id) public view override returns (string memory) {
        Traits memory t = traits(id);
        string memory tierName = _tierName(t.tier);
        string memory json;
        if (!t.revealed) {
            json = string.concat(
                '{"name":"Neural Circuit #',
                id.toString(),
                ' (sealed)","description":"A sealed Cerebr Neural Circuit wafer. Call reveal() to expose its traits.",'
                '"image":"data:image/svg+xml;base64,',
                Base64.encode(bytes(_sealedSvg(id, tierName))),
                '","attributes":[{"trait_type":"Tier","value":"',
                tierName,
                '"},{"trait_type":"Status","value":"Sealed"}]}'
            );
        } else {
            string memory clock =
                string.concat((t.clockTenthsGHz / 10).toString(), ".", (t.clockTenthsGHz % 10).toString());
            json = string.concat(
                '{"name":"Neural Circuit #',
                id.toString(),
                '","description":"A Cerebr Neural Circuit manufactured on X Layer by burning Transistors ($CBR).",'
                '"image":"data:image/svg+xml;base64,',
                Base64.encode(bytes(_svg(id, t, clock, tierName))),
                '","attributes":',
                _attributes(t, clock, tierName, fusedInto[id]),
                "}"
            );
        }
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice Collection-level metadata for marketplaces (base64 JSON with on-chain SVG logo).
    function contractURI() external pure returns (string memory) {
        string memory logo = Base64.encode(
            bytes(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><rect width="320" height="320" fill="#0b0f17"/>'
                '<rect x="90" y="90" width="140" height="140" rx="12" fill="#141b2b" stroke="#3ddc97" stroke-width="3"/>'
                '<rect x="125" y="125" width="70" height="70" rx="6" fill="#3ddc97" opacity=".85"/></svg>'
            )
        );
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(
                bytes(
                    string.concat(
                        '{"name":"Cerebr Neural Circuits","description":"AI-brain NFTs taped out on X Layer by burning '
                        "Transistors ($CBR), in four tiers: Basic, Pro, Quantum and fusion-only Singularity. Every burn "
                        'permanently over-collateralises the $CBR bonding curve. Metadata and art are fully on-chain.",'
                        '"image":"data:image/svg+xml;base64,',
                        logo,
                        '"}'
                    )
                )
            )
        );
    }

    // ------------------------------------------------------------------
    // Internal: mint + transfer guard
    // ------------------------------------------------------------------

    function _mintCircuit(address to, Tier tier) private returns (uint256 id, address account) {
        id = ++_totalMinted;
        circuitInfo[id] = CircuitInfo({tier: tier, revealed: false, commitBlock: uint64(block.number)});
        unchecked {
            ++_mintedByTier[uint8(tier)]; // < 2^64 mints is unreachable
        }
        account = tokenBoundAccount(id);
        tokenOfAccount[account] = id;
        _mint(to, id);
    }

    /// @dev Reveal (seed from blockhash(target)) or, if that hash is unavailable, re-commit to the
    ///      current block. Caller checked: sealed and block.number > target.
    function _settle(uint256 id, CircuitInfo storage info, uint256 target) private returns (bool) {
        bytes32 bh = blockhash(target);
        if (bh == bytes32(0)) {
            info.commitBlock = uint64(block.number);
            emit Recommitted(id, block.number);
            return false;
        }
        uint256 seed = uint256(keccak256(abi.encode(bh, id, block.chainid, address(this))));
        info.revealed = true;
        seedOf[id] = seed;
        emit CircuitRevealed(id, info.tier, seed);
        return true;
    }

    /// @dev FIFO auto-reveal. Walks ids from the queue head: steps over revealed ids, settles ready
    ///      sealed ones (reveal, or re-commit if expired), and stops at the first sealed id that is
    ///      not ready, so no ready Circuit is ever skipped. At most `maxSettles` settles and
    ///      `maxSettles + AUTO_REVEAL_MAX_SKIPS` ids per call. The cursor only advances over a
    ///      contiguous revealed run, so a re-committed id stays at the head until it is revealed.
    ///      No revert paths: pure storage writes and events, no external calls.
    function _settleQueue(uint256 maxSettles) private returns (uint256 settled) {
        uint256 prefix = _revealedPrefix;
        uint256 minted = _totalMinted;
        if (prefix >= minted) return 0; // queue empty
        uint256 pending = minted - prefix;
        if (maxSettles > pending) maxSettles = pending; // also keeps the step sum overflow-free
        uint256 steps = maxSettles + AUTO_REVEAL_MAX_SKIPS;
        uint256 id = prefix + 1;
        uint256 newPrefix = prefix;
        bool contiguous = true;
        while (id <= minted && settled < maxSettles && steps != 0) {
            unchecked {
                --steps;
            }
            CircuitInfo storage info = circuitInfo[id];
            if (!info.revealed) {
                uint256 target = uint256(info.commitBlock) + 1;
                if (block.number <= target) break; // not ready: FIFO stops here
                if (!_settle(id, info, target)) contiguous = false; // re-committed: head stays
                unchecked {
                    ++settled;
                }
            }
            if (contiguous) newPrefix = id;
            unchecked {
                ++id;
            }
        }
        // casting to 'uint128' is safe because newPrefix <= minted <= type(uint128).max
        // forge-lint: disable-next-line(unsafe-typecast)
        if (newPrefix != prefix) _revealedPrefix = uint128(newPrefix);
    }

    /// @dev Transfer guards (mints skip both):
    ///      1. A Circuit held by a canonical Circuit TBA can only be moved by that TBA itself
    ///         (auth == from). Approvals/operators the TBA set earlier cannot move it, so after the
    ///         bound Circuit is sold the seller cannot pull Circuits out without going through
    ///         `execute` (which bumps `state`). Internal moves (fusion) pass auth = 0.
    ///      2. Blocks ownership cycles among canonical Circuit TBAs (e.g. sending Circuit X into the
    ///         account of a Circuit that X's account already holds). A cycle would lock every asset
    ///         in it forever, because no EOA would control any of the accounts.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0)) {
            if (auth != address(0) && auth != from && tokenOfAccount[from] != 0) {
                revert AccountOperatorTransfer(tokenId);
            }
            if (to != address(0)) _checkNoCycle(to, tokenId);
        }
        return super._update(to, tokenId, auth);
    }

    function _checkNoCycle(address to, uint256 tokenId) private view {
        address cur = to;
        for (uint256 i; i < MAX_NESTING_DEPTH; ++i) {
            uint256 holder = tokenOfAccount[cur];
            if (holder == 0) return;
            if (holder == tokenId) revert OwnershipCycle(tokenId);
            cur = _ownerOf(holder);
        }
        revert NestingTooDeep();
    }

    // ------------------------------------------------------------------
    // Internal rendering
    // ------------------------------------------------------------------

    function _tierName(Tier tier) private pure returns (string memory) {
        if (tier == Tier.Basic) return "Basic";
        if (tier == Tier.Pro) return "Pro";
        if (tier == Tier.Quantum) return "Quantum";
        return "Singularity";
    }

    function _architecture(uint256 i) private pure returns (string memory) {
        if (i == 0) return "Transformer";
        if (i == 1) return "Spiking";
        if (i == 2) return "Recurrent";
        if (i == 3) return "Convolutional";
        return "Liquid";
    }

    /// @dev Cumulative thresholds per tier (Common < c, Rare < r, Epic < e, else Legendary).
    function _rarity(uint256 tier, uint256 roll) private pure returns (string memory) {
        uint256 c;
        uint256 r;
        uint256 e;
        if (tier == 0) (c, r, e) = (60, 85, 97);
        else if (tier == 1) (c, r, e) = (35, 70, 92);
        else if (tier == 2) (c, r, e) = (10, 45, 83);
        else (c, r, e) = (0, 15, 60);
        if (roll < c) return "Common";
        if (roll < r) return "Rare";
        if (roll < e) return "Epic";
        return "Legendary";
    }

    function _accent(string memory rarity) private pure returns (string memory) {
        bytes32 h = keccak256(bytes(rarity));
        if (h == keccak256("Legendary")) return "#ffb000";
        if (h == keccak256("Epic")) return "#b26bff";
        if (h == keccak256("Rare")) return "#2bb3ff";
        return "#3ddc97";
    }

    function _attributes(Traits memory t, string memory clock, string memory tierName, uint256 fusedChild)
        private
        pure
        returns (string memory)
    {
        string memory fused = fusedChild == 0
            ? ""
            : string.concat(',{"trait_type":"Fused Into","value":"#', fusedChild.toString(), '"}');
        return string.concat(
            '[{"trait_type":"Tier","value":"',
            tierName,
            '"},{"trait_type":"Architecture","value":"',
            t.architecture,
            '"},{"trait_type":"Cores","display_type":"number","value":',
            t.cores.toString(),
            '},{"trait_type":"Clock (GHz)","value":"',
            clock,
            '"},{"trait_type":"Node (nm)","display_type":"number","value":',
            t.nodeNm.toString(),
            '},{"trait_type":"Rarity","value":"',
            t.rarity,
            '"}',
            fused,
            "]"
        );
    }

    /// @dev Sealed wafer: disc with die grid, tier and id.
    function _sealedSvg(uint256 id, string memory tierName) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">'
            '<rect width="320" height="320" fill="#0b0f17"/>'
            '<circle cx="160" cy="160" r="110" fill="#141b2b" stroke="#8b98a9" stroke-width="3"/>'
            '<path d="M80 120H240M66 160H254M80 200H240M120 80V240M160 66V254M200 80V240" stroke="#2a3446" stroke-width="2"/>'
            '<g font-family="monospace" fill="#e6edf3" text-anchor="middle">'
            '<text x="160" y="30" font-size="16">CEREBR #',
            id.toString(),
            '</text><text x="160" y="290" font-size="13">SEALED WAFER</text>'
            '<text x="160" y="308" font-size="11" fill="#8b98a9">',
            tierName,
            "</text></g></svg>"
        );
    }

    /// @dev Compact chip: die with pins, seed-hued core, neural traces, label text.
    function _svg(uint256 id, Traits memory t, string memory clock, string memory tierName)
        private
        view
        returns (string memory)
    {
        string memory c = _accent(t.rarity);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">'
            '<rect width="320" height="320" fill="#0b0f17"/>',
            _chip(c, ((seedOf[id] >> 80) % 360).toString()),
            _labels(id, t, clock, c, tierName),
            "</svg>"
        );
    }

    function _chip(string memory c, string memory hue) private pure returns (string memory) {
        return string.concat(
            '<g stroke="',
            c,
            '" stroke-width="3" opacity=".7">'
            '<path d="M60 100H90M60 140H90M60 180H90M60 220H90M230 100H260M230 140H260M230 180H260M230 220H260'
            'M100 60V90M140 60V90M180 60V90M220 60V90M100 230V260M140 230V260M180 230V260M220 230V260"/></g>'
            '<rect x="90" y="90" width="140" height="140" rx="12" fill="#141b2b" stroke="',
            c,
            '" stroke-width="3"/>' '<rect x="125" y="125" width="70" height="70" rx="6" fill="hsl(',
            hue,
            ',80%,55%)" opacity=".85"/>'
            '<path d="M125 160H105M195 160H215M160 125V105M160 195V215" stroke="#fff" stroke-width="2"/>'
        );
    }

    function _labels(uint256 id, Traits memory t, string memory clock, string memory c, string memory tierName)
        private
        pure
        returns (string memory)
    {
        string memory spec = string.concat(
            t.architecture, " | ", t.cores.toString(), "C | ", clock, "GHz | ", t.nodeNm.toString(), "nm"
        );
        return string.concat(
            '<g font-family="monospace" fill="#e6edf3" text-anchor="middle">'
            '<text x="160" y="30" font-size="16">CEREBR #',
            id.toString(),
            '</text><text x="160" y="290" font-size="12">',
            spec,
            '</text><text x="160" y="308" font-size="11" fill="',
            c,
            '">',
            tierName,
            " | ",
            t.rarity,
            "</text></g>"
        );
    }
}
