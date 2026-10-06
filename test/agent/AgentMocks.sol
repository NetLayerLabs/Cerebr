// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAgentCircuits, IAgentOpener} from "../../src/agent/ICerebrAgent.sol";

/// @notice Reference Go/No-Go neuron, written independently of any circuit: y = [e0+e1+e2-i0-i1 >= 2].
library GoNoGo {
    function fire(uint8 x) internal pure returns (uint8) {
        int256 sum = int256(uint256(x & 1)) + int256(uint256((x >> 1) & 1)) + int256(uint256((x >> 2) & 1))
            - int256(uint256((x >> 3) & 1)) - int256(uint256((x >> 4) & 1));
        return sum >= 2 ? 1 : 0;
    }
}

/// @notice A TapeOut-like circuits contract holding one 5-in/1-out policy (id 8) that can be told to misbehave.
contract MockAgentCircuits is IAgentCircuits {
    enum Mode {
        Neuron, // the Go/No-Go neuron
        Revert,
        BurnGas, // spin until out of gas
        WrongLength, // returns 2 bytes
        BadOutput, // returns 0x02
        BadOffset, // malformed ABI offset
        ShortReturn, // fewer than 0x60 bytes
        ReturnBomb, // a huge, well-formed-looking return
        Constant1, // always fires
        DirtyPadding // 1-byte bytes with nonzero padding
    }

    Mode public mode;
    uint32 public nIn = 5;
    uint32 public nOut = 1;
    uint32 public nState;
    uint32 public gates = 19;
    bool public infoReverts;

    function setMode(Mode m) external {
        mode = m;
    }

    function setInfo(uint32 i, uint32 o, uint32 s, uint32 g) external {
        (nIn, nOut, nState, gates) = (i, o, s, g);
    }

    function setInfoReverts(bool r) external {
        infoReverts = r;
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        require(!infoReverts && id == 8, "no circuit");
        return (nIn, nOut, nState, gates);
    }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory out) {
        require(id == 8, "no circuit");
        Mode m = mode;
        if (m == Mode.Revert) revert("broken");
        if (m == Mode.BurnGas) {
            uint256 x;
            while (true) {
                x = uint256(keccak256(abi.encode(x)));
            }
        }
        if (m == Mode.WrongLength) return hex"0100";
        if (m == Mode.BadOutput) return hex"02";
        if (m == Mode.BadOffset) {
            assembly {
                mstore(0, 0x40)
                mstore(0x20, 1)
                mstore(0x40, 0)
                return(0, 0x60)
            }
        }
        if (m == Mode.ShortReturn) {
            assembly {
                mstore(0, 0x20)
                mstore(0x20, 1)
                return(0, 0x40)
            }
        }
        if (m == Mode.ReturnBomb) {
            assembly {
                mstore(0, 0x20)
                mstore(0x20, 1)
                return(0, 200000)
            }
        }
        if (m == Mode.Constant1) return hex"01";
        if (m == Mode.DirtyPadding) {
            assembly {
                mstore(0, 0x20)
                mstore(0x20, 1)
                mstore(0x40, 0x0001000000000000000000000000000000000000000000000000000000000000)
                return(0, 0x60)
            }
        }
        require(inputs.length == 1, "bad input length");
        out = new bytes(1);
        out[0] = bytes1(GoNoGo.fire(uint8(inputs[0]) & 31));
    }
}

contract MockOpener is IAgentOpener {
    address public account;

    constructor(address a) {
        account = a;
    }

    function accountOf(address, uint256) external view returns (address) {
        return account;
    }
}

/// @notice Stand-in for a TapeOut ERC-6551 account: its owner can make it call anything.
contract MockBrainAccount {
    address public owner;

    constructor(address o) {
        owner = o;
    }

    function execute(address to, uint256 value, bytes calldata data, uint8) external payable returns (bytes memory) {
        require(msg.sender == owner, "NotOwner");
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        return ret;
    }
}
