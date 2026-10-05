// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CerebrScope} from "../../src/scope/CerebrScope.sol";
import {ITapeOutFactory, ITapeOutOpener} from "../../src/scope/ITapeOut.sol";

/// @dev A factory that knows no CPU, so every circuits address is rejected.
contract NoCPUFactory {
    function isCPU(address) external pure returns (bool) {
        return false;
    }
}

/// @notice Tests that need no fork (they run in CI). The fork suite is CerebrScope.t.sol.
contract CerebrScopeUnitTest is Test {
    // XOR, 4 NAND (sdk/src/neuro, 'direct' mode).
    bytes constant XOR = hex"00000002000003000000020000040000000300000400000005000006";

    CerebrScope scope;

    function setUp() public {
        scope = new CerebrScope(ITapeOutFactory(address(new NoCPUFactory())), ITapeOutOpener(address(0xBEEF)));
    }

    function test_scanWellFormed() public view {
        (CerebrScope.NetlistStats memory s, bytes memory ops) = scope.scan(XOR, 10);
        assertEq(s.nand, 4);
        assertEq(s.elements, 4);
        assertTrue(s.wellFormed);
        assertEq(ops, hex"00000000");
    }

    function test_scanRef() public view {
        // REF header: op(1) + circuits(20) + id(8) + nIns(1) + nOut(1), then nIns x u24 inputs.
        bytes memory nl =
            abi.encodePacked(uint8(2), address(0x1234), uint64(7), uint8(2), uint8(1), uint24(2), uint24(3), XOR);
        (CerebrScope.NetlistStats memory s, bytes memory ops) = scope.scan(nl, 2);
        assertEq(s.ref, 1);
        assertEq(s.nand, 4);
        assertEq(s.elements, 5);
        assertTrue(s.wellFormed);
        assertEq(ops, hex"0200");
    }

    function test_scanMalformed() public view {
        (CerebrScope.NetlistStats memory s,) = scope.scan(hex"00000002000003000000", 0);
        assertEq(s.nand, 1);
        assertFalse(s.wellFormed);
        (s,) = scope.scan(hex"0100000207", 0);
        assertEq(s.latch, 1);
        assertFalse(s.wellFormed);
        (s,) = scope.scan(hex"02", 0);
        assertEq(s.elements, 0);
        assertFalse(s.wellFormed);
        (s,) = scope.scan("", 0);
        assertEq(s.elements, 0);
        assertTrue(s.wellFormed);
    }

    /// Parsing arbitrary bytes never reverts and never reports more elements than bytes allow.
    function testFuzz_scanNeverReverts(bytes calldata nl, uint8 maxOps) public view {
        (CerebrScope.NetlistStats memory s, bytes memory ops) = scope.scan(nl, maxOps);
        assertLe(uint256(s.elements) * 4, nl.length);
        assertEq(uint256(s.nand) + s.latch + s.ref, s.elements);
        assertEq(ops.length, s.elements < maxOps ? s.elements : maxOps);
    }

    function test_unknownCircuitsAreRejected() public {
        address fake = address(0xC0FFEE);
        vm.expectRevert(abi.encodeWithSelector(CerebrScope.NotCPU.selector, fake));
        scope.processor(fake);

        CerebrScope.Label memory label;
        label.name = "spoof";
        vm.expectRevert(abi.encodeWithSelector(CerebrScope.NotCPU.selector, fake));
        scope.setLabel(fake, 1, label);
    }

    function test_immutables() public view {
        assertEq(address(scope.OPENER()), address(0xBEEF));
        assertTrue(address(scope.FACTORY()) != address(0));
    }
}
