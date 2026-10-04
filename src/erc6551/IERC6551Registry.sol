// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @title IERC6551Registry
/// @notice Minimal interface of the canonical ERC-6551 registry
///         (0x000000006551c19487814612E58FE06813775758 on chains where it is deployed).
interface IERC6551Registry {
    /// @notice The registry MUST emit this event when an account is successfully created.
    event ERC6551AccountCreated(
        address account,
        address indexed implementation,
        bytes32 salt,
        uint256 chainId,
        address indexed tokenContract,
        uint256 indexed tokenId
    );

    /// @notice The registry MUST revert with this error if the create2 operation fails.
    error AccountCreationFailed();

    /// @notice Creates (or returns the existing) token bound account for a non-fungible token.
    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address account);

    /// @notice Returns the deterministic (counterfactual) token bound account address.
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        external
        view
        returns (address account);
}
