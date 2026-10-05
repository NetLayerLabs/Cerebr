// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Append-only byte buffer for building long strings (SVG, JSON) in linear time.
/// @dev Repeated abi.encodePacked(acc, piece) copies the whole accumulator every time, which is
///      quadratic. Here pieces are copied once into preallocated memory that doubles when full.
library LibBuffer {
    struct Buffer {
        bytes data; // data.length is the used length
        uint256 capacity;
    }

    function init(uint256 capacity) internal pure returns (Buffer memory b) {
        bytes memory d = new bytes(capacity);
        assembly ("memory-safe") {
            mstore(d, 0)
        }
        b.data = d;
        b.capacity = capacity;
    }

    function appendBytes(Buffer memory b, bytes memory s) internal pure {
        uint256 len = b.data.length;
        uint256 n = s.length;
        if (len + n > b.capacity) _grow(b, (len + n) * 2);
        bytes memory d = b.data;
        assembly ("memory-safe") {
            mcopy(add(add(d, 0x20), len), add(s, 0x20), n)
            mstore(d, add(len, n))
        }
    }

    function append(Buffer memory b, string memory s) internal pure {
        appendBytes(b, bytes(s));
    }

    function toString(Buffer memory b) internal pure returns (string memory) {
        return string(b.data);
    }

    function _grow(Buffer memory b, uint256 capacity) private pure {
        bytes memory old = b.data;
        bytes memory d = new bytes(capacity);
        assembly ("memory-safe") {
            let len := mload(old)
            mcopy(add(d, 0x20), add(old, 0x20), len)
            mstore(d, len)
        }
        b.data = d;
        b.capacity = capacity;
    }
}
