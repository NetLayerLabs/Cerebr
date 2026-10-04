// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC6551Account, IERC6551Executable} from "./IERC6551Account.sol";

/// @title CerebrAccount
/// @notice Minimal ERC-6551 token-bound account ("brain wallet") for Cerebr Neural Circuits.
///         Whoever owns the NFT controls the account: it can CALL any contract with the account's
///         assets, receive OKB / ERC-721 / ERC-1155, and sign via ERC-1271 (the NFT owner's signature
///         is the account's signature). Accounts can nest: a Circuit held by another Circuit's account
///         is controlled by that account, so the top-level owner reaches it via nested `execute`.
/// @dev Deployed once as the implementation; each account is an ERC-1167 proxy created by the
///      ERC-6551 registry, with abi.encode(salt, chainId, tokenContract, tokenId) appended to its code.
///      Security notes:
///      - Only operation 0 (CALL). No DELEGATECALL / CREATE, so the proxy's code and footer (and so
///        its owner) can never change, and the account has no storage besides `state`.
///      - `owner()` is address(0) on the wrong chain, for a burned/missing token, or when called on
///        the implementation itself, so nobody can act through those.
///      - `state` increments on every execute. Buyers of a Circuit (e.g. on a marketplace) should
///        bind the order to `state` so the seller cannot drain the account right before the sale.
///      - ERC-1271: a signature valid for the owner is valid for every account that owner controls.
///        Signed messages should name the account they are meant for (or use EIP-712 domains).
///      - Ownership cycles: receiving its own NFT via safeTransfer reverts here; CerebrCircuit also
///        blocks every cycle among canonical Circuit accounts (including plain transferFrom).
contract CerebrAccount is IERC165, IERC1271, IERC6551Account, IERC6551Executable, IERC721Receiver, IERC1155Receiver {
    /// @dev Address of the implementation itself (proxies see a different address(this)).
    address private immutable _SELF = address(this);

    /// @inheritdoc IERC6551Account
    uint256 public state;

    /// @notice Caller is not the current owner of the account's NFT.
    error NotAuthorized();
    /// @notice Only operation 0 (CALL) is supported.
    error OperationNotSupported(uint8 operation);
    /// @notice The account cannot receive the NFT that owns it.
    error OwnershipCycle();

    /// @inheritdoc IERC6551Account
    receive() external payable {}

    /// @inheritdoc IERC6551Executable
    /// @dev Bubbles up the callee's revert data unchanged.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (!_isValidSigner(msg.sender)) revert NotAuthorized();
        if (operation != 0) revert OperationNotSupported(operation);
        unchecked {
            ++state; // 2^256 executions are unreachable
        }
        bool success;
        (success, result) = to.call{value: value}(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    /// @inheritdoc IERC6551Account
    /// @dev Reads the footer the registry appended to this proxy's code. Zeros on the implementation.
    function token() public view returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        if (address(this) == _SELF) return (0, address(0), 0);
        bytes memory footer = new bytes(0x60);
        assembly ("memory-safe") {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @notice Current owner of the bound NFT; address(0) if it is on another chain or does not exist.
    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid || tokenContract.code.length == 0) return address(0);
        try IERC721(tokenContract).ownerOf(tokenId) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }

    /// @inheritdoc IERC6551Account
    function isValidSigner(address signer, bytes calldata) external view returns (bytes4) {
        return _isValidSigner(signer) ? IERC6551Account.isValidSigner.selector : bytes4(0);
    }

    /// @inheritdoc IERC1271
    /// @dev Valid iff `signature` is valid for the NFT owner (ECDSA for an EOA, ERC-1271 for a
    ///      contract owner, e.g. a parent account when nested).
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        address o = owner();
        if (o != address(0) && SignatureChecker.isValidSignatureNow(o, hash, signature)) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }

    /// @inheritdoc IERC721Receiver
    /// @dev Rejects the account's own NFT (it would be locked forever).
    function onERC721Received(address, address, uint256 receivedId, bytes calldata) external view returns (bytes4) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId == block.chainid && msg.sender == tokenContract && receivedId == tokenId) revert OwnershipCycle();
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @inheritdoc IERC1155Receiver
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    /// @inheritdoc IERC1155Receiver
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId || interfaceId == type(IERC1271).interfaceId
            || interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function _isValidSigner(address signer) private view returns (bool) {
        address o = owner();
        return o != address(0) && signer == o;
    }
}
