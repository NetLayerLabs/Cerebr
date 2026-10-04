// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {CerebrProcessor} from "../src/CerebrProcessor.sol";
import {CerebrCircuit, Tier} from "../src/CerebrCircuit.sol";
import {ERC6551Registry} from "../src/erc6551/ERC6551Registry.sol";
import {IERC6551Registry} from "../src/erc6551/IERC6551Registry.sol";
import {CerebrAccount} from "../src/erc6551/CerebrAccount.sol";
import {IERC6551Account, IERC6551Executable} from "../src/erc6551/IERC6551Account.sol";

contract MockNFT is ERC721 {
    constructor() ERC721("Mock", "MOCK") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract MockMulti is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }

    function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts) external {
        _mintBatch(to, ids, amounts, "");
    }
}

contract Reverter {
    error Boom(uint256 code);

    function boom() external pure {
        revert Boom(42);
    }
}

/// @title ERC-6551 tests: vendored registry vs canonical bytecode, CerebrAccount control,
///        ownership following transfers, nested control after fusion, ERC-1271, asset receipt.
contract CerebrAccountTest is Test {
    address internal constant CANONICAL = 0x000000006551c19487814612e58FE06813775758;
    /// @dev Runtime bytecode of the canonical registry, fetched from X Layer mainnet (chain 196).
    bytes internal constant CANONICAL_CODE =
        hex"608060405234801561001057600080fd5b50600436106100365760003560e01c8063246a00211461003b5780638a54c52f1461006a575b600080fd5b61004e6100493660046101b7565b61007d565b6040516001600160a01b03909116815260200160405180910390f35b61004e6100783660046101b7565b6100e1565b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b60015284601552605560002060601b60601c60005260206000f35b600060806024608c376e5af43d82803e903d91602b57fd5bf3606c5285605d52733d60ad80600a3d3981f3363d3d373d3d3d363d7360495260ff60005360b76055206035523060601b600152846015526055600020803b61018b578560b760556000f580610157576320188a596000526004601cfd5b80606c52508284887f79f19b3655ee38b1ce526556b7731a20c8f218fbda4a3990b6cc4172fdf887226060606ca46020606cf35b8060601b60601c60005260206000f35b80356001600160a01b03811681146101b257600080fd5b919050565b600080600080600060a086880312156101cf57600080fd5b6101d88661019b565b945060208601359350604086013592506101f46060870161019b565b94979396509194608001359291505056fea2646970667358221220ea2fe53af507453c64dd7c1db05549fa47a298dfb825d6d11e1689856135f16764736f6c63430008110033";

    ERC6551Registry internal registry;
    CerebrAccount internal impl;
    CerebrProcessor internal p;
    CerebrCircuit internal c;

    address internal owner = makeAddr("owner");
    address internal alice;
    uint256 internal aliceKey;
    address internal bob;
    uint256 internal bobKey;

    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        registry = new ERC6551Registry();
        impl = new CerebrAccount();
        p = new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, address(registry), address(impl));
        c = p.CIRCUIT();
    }

    // ------------------------------------------------------------ helpers

    function _buy(address who, uint256 amount) internal {
        uint256 q = p.quoteBuy(amount);
        vm.deal(who, who.balance + q);
        vm.prank(who);
        p.buyTransistors{value: q}(amount, q);
    }

    function _tape(address who, Tier tier) internal returns (uint256 id) {
        _buy(who, p.tapeOutCost(tier));
        vm.prank(who);
        id = p.tapeOutCircuitTier(tier);
    }

    /// @dev Reveal `id` unless the on-chain auto-reveal queue already did.
    function _reveal(uint256 id) internal {
        (, bool revealed, uint64 commitBlock) = c.circuitInfo(id);
        if (revealed) return;
        if (block.number < commitBlock + 2) vm.roll(commitBlock + 2);
        vm.setBlockhash(commitBlock + 1, keccak256(abi.encode("bh", commitBlock + 1)));
        assertTrue(c.reveal(id));
    }

    function _activate(uint256 id) internal returns (CerebrAccount acct) {
        acct = CerebrAccount(payable(registry.createAccount(address(impl), bytes32(0), block.chainid, address(c), id)));
    }

    function _exec(address caller, CerebrAccount acct, address to, uint256 value, bytes memory data)
        internal
        returns (bytes memory)
    {
        vm.prank(caller);
        return acct.execute(to, value, data, 0);
    }

    /// @dev Basic+Basic -> Pro owned by alice; returns (child, parentA, parentB).
    function _fused() internal returns (uint256 child, uint256 a, uint256 b) {
        a = _tape(alice, Tier.Basic);
        b = _tape(alice, Tier.Basic);
        _reveal(a);
        _reveal(b);
        _buy(alice, 5_000e18);
        vm.prank(alice);
        child = p.fuseCircuits(a, b);
    }

    // ------------------------------------------------------------ registry

    struct RegResult {
        address predicted;
        address created;
        address again;
        bytes code;
        Vm.Log[] logs;
    }

    function _registryResults(address reg, bytes32 salt, uint256 chainId, address tc, uint256 id)
        internal
        returns (RegResult memory r)
    {
        r.predicted = IERC6551Registry(reg).account(address(impl), salt, chainId, tc, id);
        vm.recordLogs();
        r.created = IERC6551Registry(reg).createAccount(address(impl), salt, chainId, tc, id);
        r.logs = vm.getRecordedLogs();
        r.again = IERC6551Registry(reg).createAccount(address(impl), salt, chainId, tc, id);
        r.code = r.created.code;
    }

    /// @notice Differential test: the vendored registry behaves exactly like the canonical bytecode.
    function testFuzz_VendoredRegistryMatchesCanonical(bytes32 salt, uint256 chainId, address tc, uint256 id) public {
        bytes memory vendored = address(registry).code;
        uint256 snap = vm.snapshotState();
        vm.etch(CANONICAL, CANONICAL_CODE);
        RegResult memory r1 = _registryResults(CANONICAL, salt, chainId, tc, id);
        vm.revertToState(snap);
        vm.etch(CANONICAL, vendored);
        RegResult memory r2 = _registryResults(CANONICAL, salt, chainId, tc, id);

        assertEq(r1.predicted, r2.predicted, "account()");
        assertEq(r1.created, r2.created, "createAccount()");
        assertEq(r1.again, r2.again, "createAccount() again");
        assertEq(r1.predicted, r1.created);
        assertEq(r1.code, r2.code, "proxy code");
        assertEq(r1.code.length, 0xad);
        assertEq(r1.logs.length, 1);
        assertEq(r2.logs.length, 1);
        assertEq(r1.logs[0].topics, r2.logs[0].topics);
        assertEq(r1.logs[0].data, r2.logs[0].data);
        // The proxy footer encodes the token.
        (uint256 cid, address tcon, uint256 tid) = CerebrAccount(payable(r1.created)).token();
        assertEq(cid, chainId);
        assertEq(tcon, tc);
        assertEq(tid, id);
    }

    /// @notice Mainnet configuration: Circuit derives TBAs from the canonical registry bytecode.
    function test_WorksWithCanonicalRegistry() public {
        vm.etch(CANONICAL, CANONICAL_CODE);
        CerebrProcessor mp = new CerebrProcessor(1e12, 1e8, owner, 0, 0, 0, CANONICAL, address(impl));
        CerebrCircuit mc = mp.CIRCUIT();
        uint256 q = mp.quoteBuy(5_000e18);
        vm.deal(alice, q);
        vm.startPrank(alice);
        mp.buyTransistors{value: q}(5_000e18, q);
        uint256 id = mp.tapeOutCircuit();
        vm.stopPrank();
        address tba =
            IERC6551Registry(CANONICAL).createAccount(address(impl), bytes32(0), block.chainid, address(mc), id);
        assertEq(tba, mc.tokenBoundAccount(id));
        assertEq(mc.tokenOfAccount(tba), id);
        assertEq(CerebrAccount(payable(tba)).owner(), alice);
    }

    function test_CreateAccountEventAndIdempotent() public {
        uint256 id = _tape(alice, Tier.Basic);
        address predicted = c.tokenBoundAccount(id);
        assertEq(predicted.code.length, 0, "lazy: no wallet at mint");
        assertEq(c.tokenOfAccount(predicted), id);

        vm.expectEmit(address(registry));
        emit ERC6551AccountCreated(predicted, address(impl), bytes32(0), block.chainid, address(c), id);
        CerebrAccount acct = _activate(id);
        assertEq(address(acct), predicted);
        assertEq(address(acct).code.length, 0xad);

        vm.recordLogs();
        assertEq(address(_activate(id)), predicted);
        assertEq(vm.getRecordedLogs().length, 0, "no second event");

        (uint256 chainId, address tc, uint256 tid) = acct.token();
        assertEq(chainId, block.chainid);
        assertEq(tc, address(c));
        assertEq(tid, id);
        assertEq(acct.owner(), alice);
        assertEq(acct.state(), 0);
    }

    // ------------------------------------------------------------ execute

    function test_ExecuteOnlyByCircuitOwner() public {
        uint256 id = _tape(alice, Tier.Basic);
        CerebrAccount acct = _activate(id);
        vm.deal(address(acct), 2 ether);

        vm.prank(bob);
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        acct.execute(bob, 1 ether, "", 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrAccount.OperationNotSupported.selector, uint8(1)));
        acct.execute(bob, 1 ether, "", 1);

        _exec(alice, acct, bob, 1 ether, "");
        assertEq(bob.balance, 1 ether);
        assertEq(acct.state(), 1);

        // msg.value forwarded
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        acct.execute{value: 1 ether}(bob, 2 ether, "", 0);
        assertEq(bob.balance, 3 ether);
        assertEq(acct.state(), 2);

        // return data and revert bubbling
        bytes memory ret = _exec(alice, acct, address(c), 0, abi.encodeCall(c.ownerOf, (id)));
        assertEq(abi.decode(ret, (address)), alice);
        Reverter r = new Reverter();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Reverter.Boom.selector, 42));
        acct.execute(address(r), 0, abi.encodeCall(r.boom, ()), 0);
        assertEq(acct.state(), 3, "failed call does not bump state");
    }

    function testFuzz_ExecuteRejectsNonOwner(address caller) public {
        uint256 id = _tape(alice, Tier.Basic);
        vm.assume(caller != alice);
        CerebrAccount acct = _activate(id);
        vm.deal(address(acct), 1 ether);
        vm.prank(caller);
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        acct.execute(caller, 1 ether, "", 0);
        assertEq(acct.isValidSigner(caller, ""), bytes4(0));
    }

    function test_OwnershipFollowsTransfer() public {
        uint256 id = _tape(alice, Tier.Basic);
        CerebrAccount acct = _activate(id);
        vm.deal(address(acct), 1 ether);
        assertEq(acct.isValidSigner(alice, ""), IERC6551Account.isValidSigner.selector);

        vm.prank(alice);
        c.transferFrom(alice, bob, id);
        assertEq(acct.owner(), bob);
        assertEq(acct.isValidSigner(alice, ""), bytes4(0));
        assertEq(acct.isValidSigner(bob, ""), IERC6551Account.isValidSigner.selector);

        vm.prank(alice);
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        acct.execute(alice, 1 ether, "", 0);

        _exec(bob, acct, bob, 1 ether, "");
        assertEq(bob.balance, 1 ether);
    }

    function test_ImplementationAndWrongChainAreInert() public {
        (uint256 chainId, address tc, uint256 tid) = impl.token();
        assertEq(chainId, 0);
        assertEq(tc, address(0));
        assertEq(tid, 0);
        assertEq(impl.owner(), address(0));
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        impl.execute(alice, 0, "", 0);

        uint256 id = _tape(alice, Tier.Basic);
        CerebrAccount foreign = CerebrAccount(
            payable(registry.createAccount(address(impl), bytes32(0), block.chainid + 1, address(c), id))
        );
        assertEq(foreign.owner(), address(0));
        vm.prank(alice);
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        foreign.execute(alice, 0, "", 0);

        // Nonexistent token -> no owner.
        CerebrAccount ghost =
            CerebrAccount(payable(registry.createAccount(address(impl), bytes32(0), block.chainid, address(c), 999)));
        assertEq(ghost.owner(), address(0));
    }

    // ------------------------------------------------------------ assets

    function test_ReceivesAssets() public {
        uint256 id = _tape(alice, Tier.Basic);
        CerebrAccount acct = _activate(id);

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = address(acct).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(acct).balance, 1 ether);

        MockNFT nft = new MockNFT();
        nft.mint(bob, 7);
        vm.prank(bob);
        nft.safeTransferFrom(bob, address(acct), 7);
        assertEq(nft.ownerOf(7), address(acct));

        MockMulti multi = new MockMulti();
        multi.mint(address(acct), 1, 10);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory amts = new uint256[](2);
        ids[0] = 2;
        ids[1] = 3;
        amts[0] = 5;
        amts[1] = 6;
        multi.mintBatch(address(acct), ids, amts);
        assertEq(multi.balanceOf(address(acct), 1), 10);
        assertEq(multi.balanceOf(address(acct), 3), 6);

        // Another Circuit can be safe-transferred into the account, and moved out again.
        uint256 other = _tape(alice, Tier.Basic);
        vm.prank(alice);
        c.safeTransferFrom(alice, address(acct), other);
        assertEq(c.ownerOf(other), address(acct));
        _exec(alice, acct, address(c), 0, abi.encodeCall(c.transferFrom, (address(acct), bob, other)));
        assertEq(c.ownerOf(other), bob);

        // Owner moves the ERC-721 out.
        _exec(alice, acct, address(nft), 0, abi.encodeCall(nft.transferFrom, (address(acct), alice, 7)));
        assertEq(nft.ownerOf(7), alice);
    }

    function test_RejectsOwnTokenOnSafeTransfer() public {
        MockNFT nft = new MockNFT();
        nft.mint(alice, 1);
        address acct = registry.createAccount(address(impl), bytes32(0), block.chainid, address(nft), 1);
        vm.prank(alice);
        vm.expectRevert(CerebrAccount.OwnershipCycle.selector);
        nft.safeTransferFrom(alice, acct, 1);

        // Circuit level: plain transferFrom into its own (even undeployed) account is blocked too.
        uint256 id = _tape(alice, Tier.Basic);
        address tba = c.tokenBoundAccount(id);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, id));
        c.transferFrom(alice, tba, id);
    }

    function test_SupportsInterface() public view {
        assertEq(type(IERC6551Account).interfaceId, bytes4(0x6faff5f1));
        assertEq(type(IERC6551Executable).interfaceId, bytes4(0x51945447));
        assertTrue(impl.supportsInterface(0x6faff5f1));
        assertTrue(impl.supportsInterface(0x51945447));
        assertTrue(impl.supportsInterface(type(IERC165).interfaceId));
        assertTrue(impl.supportsInterface(type(IERC1271).interfaceId));
        assertTrue(impl.supportsInterface(type(IERC721Receiver).interfaceId));
        assertTrue(impl.supportsInterface(type(IERC1155Receiver).interfaceId));
        assertFalse(impl.supportsInterface(0xffffffff));
    }

    // ------------------------------------------------------------ ERC-1271

    function _sign(uint256 key, bytes32 h) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, h);
        return abi.encodePacked(r, s, v);
    }

    function test_ERC1271() public {
        uint256 id = _tape(alice, Tier.Basic);
        CerebrAccount acct = _activate(id);
        bytes32 h = keccak256("cerebr brain wallet");
        bytes memory aliceSig = _sign(aliceKey, h);
        bytes memory bobSig = _sign(bobKey, h);

        assertEq(acct.isValidSignature(h, aliceSig), IERC1271.isValidSignature.selector);
        assertEq(acct.isValidSignature(h, bobSig), bytes4(0xffffffff));
        assertEq(acct.isValidSignature(keccak256("other"), aliceSig), bytes4(0xffffffff));
        assertEq(acct.isValidSignature(h, hex"1234"), bytes4(0xffffffff));

        vm.prank(alice);
        c.transferFrom(alice, bob, id);
        assertEq(acct.isValidSignature(h, aliceSig), bytes4(0xffffffff));
        assertEq(acct.isValidSignature(h, bobSig), IERC1271.isValidSignature.selector);
    }

    // ------------------------------------------------------------ fusion nesting

    MockNFT internal nestedNft;

    /// @dev Alice fuses Basics a + b into a Pro; parent a's wallet held 3 OKB and NFT #5 beforehand.
    function _fuseLoadedParent() internal returns (uint256 child, uint256 a, uint256 b, CerebrAccount tbaA) {
        a = _tape(alice, Tier.Basic);
        b = _tape(alice, Tier.Basic);
        tbaA = _activate(a);
        vm.deal(address(tbaA), 3 ether);
        nestedNft = new MockNFT();
        nestedNft.mint(address(tbaA), 5);
        _reveal(a);
        _reveal(b);
        _buy(alice, 5_000e18);
        vm.prank(alice);
        child = p.fuseCircuits(a, b);
    }

    function test_NestedControlAfterFusion() public {
        (uint256 child, uint256 a,, CerebrAccount tbaA) = _fuseLoadedParent();
        assertEq(c.ownerOf(a), c.tokenBoundAccount(child));
        assertEq(c.tokenBoundAccount(child).code.length, 0, "child wallet still counterfactual");
        assertEq(tbaA.owner(), c.tokenBoundAccount(child));

        // Alice no longer controls parent A's wallet directly.
        vm.prank(alice);
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        tbaA.execute(alice, 1 ether, "", 0);

        // Activate the child's wallet and operate parent A's wallet through it.
        CerebrAccount tbaChild = _activate(child);
        assertEq(address(tbaChild), c.tokenBoundAccount(child));
        _exec(alice, tbaChild, address(tbaA), 0, _execData(alice, 1 ether, ""));
        assertEq(alice.balance, 1 ether);

        bytes memory nftOut = abi.encodeCall(nestedNft.transferFrom, (address(tbaA), alice, 5));
        _exec(alice, tbaChild, address(tbaA), 0, _execData(address(nestedNft), 0, nftOut));
        assertEq(nestedNft.ownerOf(5), alice);

        // Alice moves parent A out of the child's wallet; she controls A's wallet again.
        _exec(alice, tbaChild, address(c), 0, abi.encodeCall(c.transferFrom, (address(tbaChild), alice, a)));
        assertEq(c.ownerOf(a), alice);
        _exec(alice, tbaA, alice, 1 ether, "");
        assertEq(alice.balance, 2 ether);
    }

    function test_NestedERC1271() public {
        (,,, CerebrAccount tbaA) = _fuseLoadedParent();
        // parent A's wallet -> child wallet (counterfactual, no code) ... activate it for ERC-1271.
        bytes32 h = keccak256("nested");
        bytes memory aliceSig = _sign(aliceKey, h);
        // Child wallet not deployed: SignatureChecker sees no code -> ECDSA vs the child address fails.
        assertEq(tbaA.isValidSignature(h, aliceSig), bytes4(0xffffffff));
        _activate(c.totalMinted());
        assertEq(tbaA.isValidSignature(h, aliceSig), IERC1271.isValidSignature.selector);
        assertEq(tbaA.isValidSignature(h, _sign(bobKey, h)), bytes4(0xffffffff));
    }

    function _execData(address to, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(CerebrAccount.execute, (to, value, data, uint8(0)));
    }

    function test_NestedParentFollowsChildSale() public {
        (uint256 child,, uint256 b,) = _fuseLoadedParent();
        CerebrAccount tbaChild = _activate(child);
        address childTba = address(tbaChild);
        assertEq(c.ownerOf(b), childTba);

        vm.prank(alice);
        c.transferFrom(alice, bob, child);
        vm.prank(alice);
        vm.expectRevert(CerebrAccount.NotAuthorized.selector);
        tbaChild.execute(alice, 0, "", 0);
        _exec(bob, tbaChild, address(c), 0, abi.encodeCall(c.transferFrom, (childTba, bob, b)));
        assertEq(c.ownerOf(b), bob);
    }

    function test_NestedCycleBlocked() public {
        (uint256 child, uint256 a,) = _fused();
        // child -> TBA(a): TBA(a) is held by a, a is held by TBA(child) -> cycle.
        address tbaA = c.tokenBoundAccount(a);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, child));
        c.transferFrom(alice, tbaA, child);

        // From inside the child wallet: moving parent a into its own wallet is blocked too.
        CerebrAccount tbaChild = _activate(child);
        bytes memory selfNest =
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(tbaChild), tbaA, a);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.OwnershipCycle.selector, a));
        tbaChild.execute(address(c), 0, selfNest, 0);
    }

    function test_DeepNestingReachable() public {
        // Fuse chain: two Pros (each from 2 Basics) -> Quantum; parents nest 2 levels deep.
        (uint256 pro1,,) = _fused();
        (uint256 pro2,,) = _fused();
        _reveal(pro1);
        _reveal(pro2);
        _buy(alice, 20_000e18);
        vm.prank(alice);
        uint256 q = p.fuseCircuits(pro1, pro2);
        assertEq(uint8(c.tierOf(q)), uint8(Tier.Quantum));

        // Basic #1 sits in TBA(pro1), which sits in TBA(q). Alice pulls Basic #1 out via two hops.
        CerebrAccount tbaQ = _activate(q);
        CerebrAccount tbaPro1 = _activate(pro1);
        assertEq(c.ownerOf(1), address(tbaPro1));
        bytes memory inner = abi.encodeCall(c.transferFrom, (address(tbaPro1), alice, 1));
        _exec(alice, tbaQ, address(tbaPro1), 0, abi.encodeCall(tbaPro1.execute, (address(c), 0, inner, uint8(0))));
        assertEq(c.ownerOf(1), alice);
    }

    // ------------------------------------------------------------ round-2 audit regressions

    /// @notice Round-2 HIGH: parents pulled back out of the child's wallet (real CerebrAccount
    ///         execute) can never be fused again, so higher tiers cannot be farmed.
    function test_RecycledParentsCannotBeFusedAgain() public {
        (uint256 child, uint256 a, uint256 b) = _fused();
        CerebrAccount tbaChild = _activate(child);
        _exec(alice, tbaChild, address(c), 0, abi.encodeCall(c.transferFrom, (address(tbaChild), alice, a)));
        _exec(alice, tbaChild, address(c), 0, abi.encodeCall(c.transferFrom, (address(tbaChild), alice, b)));
        assertEq(c.ownerOf(a), alice);
        assertEq(c.ownerOf(b), alice);
        assertEq(c.fusedInto(a), child);
        assertEq(c.fusedInto(b), child);

        _buy(alice, 5_000e18);
        uint256 supply = p.totalSupply();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyFused.selector, a));
        p.fuseCircuits(a, b);
        // Mixing a used parent with a fresh Basic is rejected too.
        uint256 fresh = _tape(alice, Tier.Basic);
        _reveal(fresh);
        _buy(alice, 5_000e18);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AlreadyFused.selector, b));
        p.fuseCircuits(fresh, b);
        assertEq(p.totalSupply(), supply + 5_000e18);
        assertEq(c.totalMinted(), child + 1);
    }

    /// @notice Round-2 MEDIUM: an operator approval the seller set from the child's wallet cannot
    ///         be used to pull the parents out after the child is sold; only execute (which bumps
    ///         `state`) can move Circuits out of a Circuit wallet.
    function test_SellerApprovalFromWalletCannotDrainAfterSale() public {
        (uint256 child, uint256 a, uint256 b) = _fused();
        CerebrAccount tbaChild = _activate(child);
        _exec(alice, tbaChild, address(c), 0, abi.encodeCall(c.setApprovalForAll, (alice, true)));
        _exec(alice, tbaChild, address(c), 0, abi.encodeCall(c.approve, (alice, b)));
        uint256 stateAtListing = tbaChild.state();

        vm.prank(alice);
        c.transferFrom(alice, bob, child); // the sale
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AccountOperatorTransfer.selector, a));
        c.transferFrom(address(tbaChild), alice, a);
        vm.expectRevert(abi.encodeWithSelector(CerebrCircuit.AccountOperatorTransfer.selector, b));
        c.safeTransferFrom(address(tbaChild), alice, b);
        vm.stopPrank();
        assertEq(c.ownerOf(a), address(tbaChild));
        assertEq(c.ownerOf(b), address(tbaChild));
        assertEq(tbaChild.state(), stateAtListing, "state-bound order still valid");

        // The new owner can still move them through execute.
        _exec(bob, tbaChild, address(c), 0, abi.encodeCall(c.transferFrom, (address(tbaChild), bob, a)));
        assertEq(c.ownerOf(a), bob);
        assertEq(tbaChild.state(), stateAtListing + 1);
    }
}
