// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The two TapeOut circuits functions NeuralArena needs (see TAPEOUT.md section 4).
interface IArenaCircuits {
    /// @dev Bit-packed LSB-first. Reverts "has latch: use step" for sequential circuits.
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    /// @dev gateCount and nState are flattened through REFs. Reverts "no circuit" for unknown ids.
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
}
