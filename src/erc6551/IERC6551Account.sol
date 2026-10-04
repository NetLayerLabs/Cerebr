// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title IERC6551Account
/// @dev ERC-165 interface id: 0x6faff5f1
interface IERC6551Account {
    /// @notice Allows the account to receive native value (OKB).
    receive() external payable;

    /// @notice The NFT that owns this account.
    function token() external view returns (uint256 chainId, address tokenContract, uint256 tokenId);

    /// @notice Changes every time the account's state may have changed (each execute).
    function state() external view returns (uint256);

    /// @notice Returns the magic value 0x523e3260 (this function's selector) if `signer` may act
    ///         for the account, else 0.
    function isValidSigner(address signer, bytes calldata context) external view returns (bytes4 magicValue);
}

/// @title IERC6551Executable
/// @dev ERC-165 interface id: 0x51945447
interface IERC6551Executable {
    /// @notice Executes `operation` (0 = CALL; others may be unsupported) against `to`.
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory);
}
