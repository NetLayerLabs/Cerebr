// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IArenaCircuits} from "../../src/arena/IArenaCircuits.sol";

/// @notice Solidity port of the SDK reference policy (sdk/src/neuro/arena.ts referencePolicy), written
///         independently of the circuit: win > block > safe threat > centre > corners > edges.
library ArenaPolicy {
    uint256 internal constant ORDER = 0x753186204; // 4,0,2,6,8,1,3,5,7 (nibbles from the lowest)
    uint256 internal constant LINES = 0x0054_0111_0124_0092_0049_01c0_0038_0007;

    function line(uint256 i) internal pure returns (uint16) {
        return uint16(LINES >> (16 * i));
    }

    function popcount(uint16 x) internal pure returns (uint256 n) {
        for (; x != 0; x &= x - 1) {
            ++n;
        }
    }

    function won(uint16 m) internal pure returns (bool) {
        for (uint256 i; i < 8; ++i) {
            if (m & line(i) == line(i)) return true;
        }
        return false;
    }

    /// @return cell The move, or 9 when the board is full.
    function move(uint16 bot, uint16 human) internal pure returns (uint256 cell) {
        uint16 occ = bot | human;
        for (uint256 p; p < 2; ++p) {
            uint16 mine = p == 0 ? bot : human;
            for (uint256 k; k < 9; ++k) {
                uint256 c = (ORDER >> (4 * k)) & 0xf;
                if ((occ >> c) & 1 != 0) continue;
                for (uint256 l; l < 8; ++l) {
                    uint16 ln = line(l);
                    if ((ln >> c) & 1 == 0) continue;
                    uint16 rest = ln & ~uint16(1 << c);
                    if (mine & rest == rest) return c;
                }
            }
        }
        for (uint256 k; k < 9; ++k) {
            uint256 c = (ORDER >> (4 * k)) & 0xf;
            if ((occ >> c) & 1 != 0) continue;
            for (uint256 l; l < 8; ++l) {
                uint16 ln = line(l);
                if ((ln >> c) & 1 == 0) continue;
                uint16 rest = ln & ~uint16(1 << c);
                // exactly one bot piece among the other two cells, the other one empty
                if (popcount(bot & rest) != 1 || occ & rest != bot & rest) continue;
                uint256 reply = _lowBit(rest & ~bot);
                if (!_fork(bot, human, reply)) return c;
            }
        }
        for (uint256 k; k < 9; ++k) {
            uint256 c = (ORDER >> (4 * k)) & 0xf;
            if ((occ >> c) & 1 == 0) return c;
        }
        return 9;
    }

    /// @dev Empty cell c where the human would get two or more open lines (one human piece + one empty).
    function _fork(uint16 bot, uint16 human, uint256 c) private pure returns (bool) {
        uint16 occ = bot | human;
        if ((occ >> c) & 1 != 0) return false;
        uint256 open;
        for (uint256 l; l < 8; ++l) {
            uint16 ln = line(l);
            if ((ln >> c) & 1 == 0) continue;
            uint16 rest = ln & ~uint16(1 << c);
            if (popcount(human & rest) == 1 && occ & rest == human & rest) ++open;
        }
        return open >= 2;
    }

    function _lowBit(uint16 x) private pure returns (uint256 i) {
        while ((x >> i) & 1 == 0) ++i;
    }

    function decodeInput(bytes calldata input) internal pure returns (uint16 bot, uint16 human) {
        uint256 v;
        for (uint256 i; i < input.length && i < 3; ++i) {
            v |= uint256(uint8(input[i])) << (8 * i);
        }
        for (uint256 i; i < 9; ++i) {
            bot |= uint16(((v >> (2 * i)) & 1) << i);
            human |= uint16(((v >> (2 * i + 1)) & 1) << i);
        }
    }

    function oneHot(uint256 cell) internal pure returns (bytes memory out) {
        out = new bytes(2);
        if (cell < 9) {
            uint256 v = 1 << cell;
            out[0] = bytes1(uint8(v));
            out[1] = bytes1(uint8(v >> 8));
        }
    }
}

/// @notice A circuits contract whose eval runs the reference policy, plus misbehaviour modes.
contract MockPolicyCircuits is IArenaCircuits {
    enum Mode {
        Policy,
        Revert,
        Burn, // loops until out of gas
        Empty, // returns bytes("")
        Long, // returns 3 bytes
        MultiHot,
        Zero,
        Occupied, // plays the first occupied cell
        Padding, // the right move plus a padding bit
        RawGarbage, // non-ABI return data
        ReturnBomb, // 1 MB of return data
        BadOffset
    }

    Mode public mode;
    uint32 public nIn = 18;
    uint32 public nOut = 9;
    uint32 public nState;
    uint32 public gateCount = 590;

    function setMode(Mode m) external {
        mode = m;
    }

    function setInfo(uint32 i, uint32 o, uint32 s, uint32 g) external {
        (nIn, nOut, nState, gateCount) = (i, o, s, g);
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        require(id == 1, "no circuit");
        return (nIn, nOut, nState, gateCount);
    }

    function eval(uint256 id, bytes calldata input) external view returns (bytes memory) {
        require(id == 1, "no circuit");
        (uint16 bot, uint16 human) = ArenaPolicy.decodeInput(input);
        Mode m = mode;
        if (m == Mode.Policy) return ArenaPolicy.oneHot(ArenaPolicy.move(bot, human));
        if (m == Mode.Revert) revert("broken");
        if (m == Mode.Burn) {
            uint256 x;
            while (true) {
                x = uint256(keccak256(abi.encode(x)));
            }
        }
        if (m == Mode.Empty) return "";
        if (m == Mode.Long) return hex"010000";
        if (m == Mode.MultiHot) return hex"1100";
        if (m == Mode.Zero) return hex"0000";
        if (m == Mode.Occupied) {
            uint16 occ = bot | human;
            uint256 c;
            while (c < 9 && (occ >> c) & 1 == 0) ++c;
            return ArenaPolicy.oneHot(c);
        }
        if (m == Mode.Padding) {
            bytes memory out = ArenaPolicy.oneHot(ArenaPolicy.move(bot, human));
            out[1] = bytes1(uint8(out[1]) | 0x80);
            return out;
        }
        if (m == Mode.RawGarbage) {
            assembly {
                mstore(0, 0xdeadbeef)
                return(0, 7)
            }
        }
        if (m == Mode.ReturnBomb) {
            assembly {
                return(0, 1000000)
            }
        }
        // BadOffset: a `bytes` with offset 0x40
        assembly {
            mstore(0, 0x40)
            mstore(0x20, 0)
            mstore(0x40, 2)
            mstore(0x60, shl(240, 0x1000))
            return(0, 0x80)
        }
    }
}

/// @notice A circuits contract that really runs a NAND-only TapeOut netlist (the taped-out bytes),
///         so the unit tests exercise the exact circuit without a fork.
contract MockNandCircuits is IArenaCircuits {
    bytes internal _netlist;
    uint32 internal _nIn;
    uint32 internal _nOut;
    uint32 internal _gates;

    constructor(bytes memory netlist_, uint32 nIn_, uint32 nOut_) {
        require(netlist_.length % 7 == 0, "NAND only");
        _netlist = netlist_;
        _nIn = nIn_;
        _nOut = nOut_;
        _gates = uint32(netlist_.length / 7);
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        require(id == 1, "no circuit");
        return (_nIn, _nOut, 0, _gates);
    }

    function eval(uint256 id, bytes calldata input) external view returns (bytes memory out) {
        require(id == 1, "no circuit");
        bytes memory nl = _netlist;
        uint256 nIn = _nIn;
        uint256 nOut = _nOut;
        uint256 n = 2 + nIn + nl.length / 7;
        bytes memory s = new bytes(n);
        s[1] = 0x01;
        for (uint256 i; i < nIn; ++i) {
            uint256 bit = i >> 3 < input.length ? (uint8(input[i >> 3]) >> (i & 7)) & 1 : 0;
            s[2 + i] = bytes1(uint8(bit));
        }
        uint256 p = 2 + nIn;
        for (uint256 q; q < nl.length; q += 7) {
            require(nl[q] == 0x00, "NAND only");
            uint256 a = (uint256(uint8(nl[q + 1])) << 16) | (uint256(uint8(nl[q + 2])) << 8) | uint8(nl[q + 3]);
            uint256 b = (uint256(uint8(nl[q + 4])) << 16) | (uint256(uint8(nl[q + 5])) << 8) | uint8(nl[q + 6]);
            require(a < p && b < p, "NAND: future signal");
            s[p++] = (s[a] & s[b]) != 0 ? bytes1(0) : bytes1(0x01);
        }
        out = new bytes((nOut + 7) / 8);
        for (uint256 i; i < nOut; ++i) {
            if (s[n - nOut + i] != 0) out[i >> 3] |= bytes1(uint8(1 << (i & 7)));
        }
    }
}
