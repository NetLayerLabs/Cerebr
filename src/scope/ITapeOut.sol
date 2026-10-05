// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal interfaces for TapeOut on X Layer, as verified on a mainnet fork (see TAPEOUT.md).
/// @dev TapeOut's contracts are upgradeable and unaudited; only the functions Cerebr uses are declared.

/// @notice TapeOut factory (EIP-1967 proxy). One CPU = one transistors (ERC-1155) + one circuits (ERC-721).
interface ITapeOutFactory {
    event CPUCreated(
        address indexed circuits,
        address indexed transistors,
        address indexed creator,
        string name,
        uint256 supply,
        uint256 mintPrice
    );

    function createCPU(
        string calldata name,
        string calldata symbol,
        string calldata story,
        uint256 transistorSupply,
        uint256 mintPrice
    ) external payable returns (address transistors, address circuits);

    function deployFee() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function cpuCount() external view returns (uint256);
    /// @dev Returns the circuits address of CPU `i`.
    function cpus(uint256 i) external view returns (address);
    /// @dev Keyed by the circuits address.
    function isCPU(address circuits) external view returns (bool);
}

/// @notice A CPU's transistor supply (ERC-1155; NAND = 0, LATCH = 1, shared supply cap).
interface ITapeOutTransistors {
    function NAND() external view returns (uint256);
    function LATCH() external view returns (uint256);
    function mint(uint256 id, uint256 amount) external payable;
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
    function creator() external view returns (address);
    function circuits() external view returns (address);
    function cpuName() external view returns (string memory);
    function cpuSymbol() external view returns (string memory);
    function story() external view returns (string memory);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function owed(address account) external view returns (uint256);
    function withdraw() external;
}

/// @notice A CPU's taped-out circuits (ERC-721, ids start at 1).
interface ITapeOutCircuits {
    event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState);

    function tapeout(bytes calldata nl, uint32 nIn, uint32 nOut) external payable returns (uint256);
    function TAPEOUT_FEE() external view returns (uint256);
    /// @dev gateCount and nState are flattened through REFs. Reverts "no circuit" for unknown ids.
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    /// @dev Bit-packed LSB-first. Reverts "has latch: use step" for sequential circuits.
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function step(uint256 id, bytes calldata state, bytes calldata inputs)
        external
        view
        returns (bytes memory newState, bytes memory outputs);
    /// @dev Last assigned id (= circuit count), not the next one.
    function nextId() external view returns (uint256);
    function ownerOf(uint256 id) external view returns (address);
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function transistors() external view returns (address);
    function transferFrom(address from, address to, uint256 id) external;
}

/// @notice TapeOut's native ERC-6551 circuit accounts ("brain wallets").
interface ITapeOutOpener {
    function FEE() external view returns (uint256);
    function open(address circuits, uint256 tokenId) external payable returns (address);
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
    function isOpened(address circuits, uint256 tokenId) external view returns (bool);
}
