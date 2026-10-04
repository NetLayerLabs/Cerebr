// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC6551Registry} from "../../src/erc6551/IERC6551Registry.sol";

/// @dev Test-only ERC-6551 registry. Derives the same create2 address as the canonical
///      reference registry (ERC-1167 proxy + footer of salt, chainId, tokenContract, tokenId).
contract MockERC6551Registry is IERC6551Registry {
    function _bytecode(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            abi.encode(salt, chainId, tokenContract, tokenId)
        );
    }

    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId)
        public
        view
        returns (address)
    {
        bytes32 h = keccak256(_bytecode(implementation, salt, chainId, tokenContract, tokenId));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, h)))));
    }

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address acct) {
        acct = account(implementation, salt, chainId, tokenContract, tokenId);
        if (acct.code.length != 0) return acct;
        bytes memory code = _bytecode(implementation, salt, chainId, tokenContract, tokenId);
        address deployed;
        assembly {
            deployed := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (deployed == address(0) || deployed != acct) revert AccountCreationFailed();
        emit ERC6551AccountCreated(acct, implementation, salt, chainId, tokenContract, tokenId);
    }
}

/// @dev Placeholder account implementation (only needs code for the Circuit constructor check).
contract DummyAccountImpl {
    receive() external payable {}
}

/// @dev Deploys the ERC-6551 test fixtures. Inherit in tests.
abstract contract ERC6551Fixture {
    MockERC6551Registry internal registry6551 = new MockERC6551Registry();
    DummyAccountImpl internal accountImpl6551 = new DummyAccountImpl();
}
