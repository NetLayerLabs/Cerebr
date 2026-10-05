// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {CerebrScope} from "../../src/scope/CerebrScope.sol";
import {ITapeOutCircuits, ITapeOutFactory, ITapeOutOpener, ITapeOutTransistors} from "../../src/scope/ITapeOut.sol";

/// @notice Fork tests against the real TapeOut contracts on an X Layer mainnet fork.
///         Start a fork first:  anvil --fork-url https://rpc.xlayer.tech --port 8545
///         Then:  SCOPE_FORK_RPC=http://127.0.0.1:8545 forge test --match-path 'test/scope/*'
///         Without SCOPE_FORK_RPC the whole suite is skipped (CI runs only the non-fork tests).
///         Nothing is broadcast: the CPU, mints and tapeouts happen inside the forked EVM only.
contract CerebrScopeForkTest is Test {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    ITapeOutOpener constant OPENER = ITapeOutOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);

    uint256 constant SUPPLY = 100_000;
    uint256 constant PRICE = 0.000066 ether;

    // Netlists from the Cerebr neural compiler (sdk/src/neuro, 'direct' mode).
    // XOR: s4 = nand(a,b), s5 = nand(a,s4), s6 = nand(b,s4), out = nand(s5,s6).
    bytes constant XOR = hex"00000002000003000000020000040000000300000400000005000006";
    bytes constant MAJORITY3 =
        hex"000000020000030000000200000500000003000005000000060000070000000800000400000005000009";
    bytes constant LINE_DETECTOR =
        hex"000000040000030000000b00000b0000000c000002000000070000060000000e00000e0000000f0000050000000a0000090000001100001100000012000008000000130000130000000800000500000015000015000000160000020000000900000600000018000018000000190000030000000a0000070000001b00001b0000001c0000040000001d00001d0000000a0000060000001f00001f000000200000020000000800000600000022000022000000230000040000002400002400000014000010000000260000100000002700000d0000001e00001a0000002900001a0000002a000017000000250000210000002800000d0000002b0000170000002c000021";
    bytes constant SPIKING =
        hex"010000110100001500000003000003000000020000060000000700000700000008000005000000060000090000000a00000a000000040000020000000400000c0000000200000c0000000d00000e0000000b00000f00000010000010000000050000050000001200000c0000000b0000130000001400001400000009000009";

    CerebrScope scope;
    ITapeOutCircuits circuits;
    ITapeOutTransistors transistors;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 xorId;
    uint256 majId;
    uint256 lineId;
    uint256 spikeId;
    uint256 xor3Id;

    function setUp() public {
        string memory rpc = vm.envOr("SCOPE_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        scope = new CerebrScope(FACTORY, OPENER);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        vm.startPrank(alice);
        (address t, address c) = FACTORY.createCPU{value: FACTORY.deployFee()}(
            "Cerebr", "CBR", "A neural processor built on TapeOut.", SUPPLY, PRICE
        );
        transistors = ITapeOutTransistors(t);
        circuits = ITapeOutCircuits(c);
        uint256 fee = transistors.protocolFee();
        transistors.mint{value: 1000 * PRICE + fee}(0, 1000); // NAND
        transistors.mint{value: 10 * PRICE + fee}(1, 10); // LATCH

        xorId = _tapeout(XOR, 2, 1);
        majId = _tapeout(MAJORITY3, 3, 1);
        lineId = _tapeout(LINE_DETECTOR, 9, 3);
        spikeId = _tapeout(SPIKING, 2, 1);
        // XOR3 = XOR(XOR(a,b), c) composed by REF: s5 = REF xor(s2,s3), out = REF xor(s5,s4).
        xor3Id = _tapeout(abi.encodePacked(_ref(xorId, 2, 3), _ref(xorId, 5, 4)), 3, 1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ parsing

    function test_statsFromNetlist() public view {
        _assertStats(xorId, 4, 0, 0);
        _assertStats(majId, 6, 0, 0);
        _assertStats(lineId, 37, 0, 0);
        _assertStats(spikeId, 17, 2, 0);
        _assertStats(xor3Id, 0, 0, 2);
    }

    function test_scanMalformed() public view {
        (CerebrScope.NetlistStats memory s,) = scope.scan(hex"00000002000003000000", 0); // NAND + truncated NAND
        assertEq(s.nand, 1);
        assertFalse(s.wellFormed);
        (s,) = scope.scan(hex"0100000207", 0); // LATCH + unknown opcode 7
        assertEq(s.latch, 1);
        assertEq(s.elements, 1);
        assertFalse(s.wellFormed);
        (s,) = scope.scan(hex"02", 0); // truncated REF header
        assertEq(s.elements, 0);
        assertFalse(s.wellFormed);
        bytes memory ops;
        (s, ops) = scope.scan(SPIKING, 4);
        assertTrue(s.wellFormed);
        assertEq(ops, hex"01010000");
    }

    // ------------------------------------------------------------ batch views

    function test_circuitsOf() public {
        uint256[] memory ids = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (lineId, xor3Id, 999);
        CerebrScope.CircuitView[] memory v = scope.circuitsOf(address(circuits), ids);
        assertTrue(v[0].exists);
        assertEq(v[0].nIn, 9);
        assertEq(v[0].nOut, 3);
        assertEq(v[0].gateCount, 37);
        assertEq(v[0].netlistBytes, LINE_DETECTOR.length);
        assertEq(v[0].owner, alice);
        assertEq(v[0].account, OPENER.accountOf(address(circuits), lineId));
        assertFalse(v[0].opened);
        assertEq(v[1].gateCount, 8); // flattened through REFs
        assertEq(v[1].stats.ref, 2);
        assertFalse(v[2].exists);

        vm.prank(bob); // anyone may pay to open
        OPENER.open{value: OPENER.FEE()}(address(circuits), lineId);
        assertTrue(scope.circuitsOf(address(circuits), ids)[0].opened);
    }

    function test_page() public view {
        assertEq(scope.page(address(circuits), 0, 100).length, 5);
        CerebrScope.CircuitView[] memory v = scope.page(address(circuits), 4, 10);
        assertEq(v.length, 2);
        assertEq(v[0].id, spikeId);
        assertEq(v[0].nState, 2);
        assertEq(scope.page(address(circuits), 6, 10).length, 0);
        assertEq(scope.page(address(circuits), 2, 1).length, 1);
    }

    function test_pageTooLarge() public {
        vm.expectRevert(CerebrScope.PageTooLarge.selector);
        scope.page(address(circuits), 1, 101);
    }

    function test_processor() public view {
        CerebrScope.ProcessorView memory p = scope.processor(address(circuits));
        assertEq(p.transistors, address(transistors));
        assertEq(p.name, "Cerebr");
        assertEq(p.symbol, "CBR");
        assertEq(p.creator, alice);
        assertEq(p.supplyCap, SUPPLY);
        assertEq(p.minted, 1010);
        assertEq(p.mintPrice, PRICE);
        assertEq(p.tapeoutFee, circuits.TAPEOUT_FEE());
        assertEq(p.circuitCount, 5);
    }

    function test_notCPU() public {
        vm.expectRevert(abi.encodeWithSelector(CerebrScope.NotCPU.selector, address(transistors)));
        scope.processor(address(transistors));
    }

    // ------------------------------------------------------------ evaluation

    function test_truthTables() public view {
        bytes[] memory t = scope.truthTable(address(circuits), xorId);
        assertEq(t.length, 4);
        assertEq(abi.encode(t[0], t[1], t[2], t[3]), abi.encode(hex"00", hex"01", hex"01", hex"00"));
        t = scope.truthTable(address(circuits), majId);
        for (uint256 x; x < 8; ++x) {
            uint256 ones = (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1);
            assertEq(uint8(t[x][0]) & 1, ones >= 2 ? 1 : 0);
        }
        t = scope.truthTable(address(circuits), xor3Id);
        for (uint256 x; x < 8; ++x) {
            assertEq(uint8(t[x][0]) & 1, (x ^ (x >> 1) ^ (x >> 2)) & 1);
        }
    }

    function test_truthTableRejectsSequential() public {
        vm.expectRevert(CerebrScope.Sequential.selector);
        scope.truthTable(address(circuits), spikeId);
    }

    function test_evalBatchLineDetector() public view {
        bytes[] memory ins = new bytes[](4);
        ins[0] = hex"0000"; // empty grid
        ins[1] = hex"0700"; // top row -> horizontal
        ins[2] = hex"4900"; // left column (bits 0,3,6) -> vertical
        ins[3] = hex"1101"; // main diagonal (bits 0,4,8) -> diagonal
        bytes[] memory out = scope.evalBatch(address(circuits), lineId, ins);
        assertEq(uint8(out[0][0]) & 7, 0);
        assertEq(uint8(out[1][0]) & 7, 1);
        assertEq(uint8(out[2][0]) & 7, 2);
        assertEq(uint8(out[3][0]) & 7, 4);
    }

    function test_runSpikingNeuron() public view {
        bytes[] memory ins = new bytes[](7);
        for (uint256 i; i < 6; ++i) {
            ins[i] = hex"01"; // spike
        }
        ins[6] = hex"03"; // spike + inhibit
        (bytes[] memory out, bytes memory state) = scope.run(address(circuits), spikeId, "", ins);
        uint8[7] memory want = [0, 0, 1, 0, 0, 1, 0]; // fires on every 3rd spike
        for (uint256 i; i < 7; ++i) {
            assertEq(uint8(out[i][0]) & 1, want[i]);
        }
        assertEq(uint8(state[0]) & 3, 0);
    }

    // ------------------------------------------------------------ rendering

    function test_tokenURIAndSvg() public view {
        string memory json = scope.metadataJSON(address(circuits), lineId);
        string memory svg = scope.svgOf(address(circuits), lineId);
        assertEq(
            scope.tokenURI(address(circuits), lineId),
            string.concat("data:application/json;base64,", Base64.encode(bytes(json)))
        );
        // Valid JSON with the expected fields.
        assertEq(vm.parseJsonString(json, ".name"), "Cerebr circuit #3");
        assertEq(
            vm.parseJsonString(json, ".image"), string.concat("data:image/svg+xml;base64,", Base64.encode(bytes(svg)))
        );
        assertEq(vm.parseJsonUint(json, ".attributes[4].value"), 37); // Gates
        assertEq(vm.parseJsonUint(json, ".attributes[5].value"), 37); // NAND
        assertEq(vm.parseJsonString(json, ".attributes[1].value"), "Combinational");
        assertEq(vm.parseJsonAddress(json, ".properties.account"), OPENER.accountOf(address(circuits), lineId));
        // SVG drawn from the actual netlist: 37 NAND cells, 9 + 3 pins.
        assertTrue(_startsWith(svg, '<svg xmlns="http://www.w3.org/2000/svg"'));
        assertTrue(_endsWith(svg, "</svg>"));
        assertEq(_count(svg, 'class="n"/>'), 37);
        assertEq(_count(svg, 'class="p"/>'), 12);

        string memory spike = scope.svgOf(address(circuits), spikeId);
        assertEq(_count(spike, 'class="l"/>'), 2);
        assertEq(_count(spike, 'class="n"/>'), 17);
        assertEq(_count(scope.svgOf(address(circuits), xor3Id), 'class="r"/>'), 2);
        assertEq(
            vm.parseJsonString(scope.metadataJSON(address(circuits), spikeId), ".attributes[1].value"), "Sequential"
        );

        uint256 g = gasleft();
        scope.tokenURI(address(circuits), lineId);
        console2.log("gas tokenURI line-detector (37 gates)", g - gasleft());
        g = gasleft();
        scope.svgOf(address(circuits), xorId);
        console2.log("gas svgOf xor (4 gates)", g - gasleft());
        console2.log("svg bytes line-detector", bytes(svg).length);
    }

    function test_renderCapsLargeCircuits() public {
        // 300-NAND chain: s(k+1) = nand(s_k, s_k).
        bytes memory nl;
        for (uint256 i; i < 300; ++i) {
            uint24 s = uint24(2 + i);
            nl = abi.encodePacked(nl, uint8(0), s, s);
        }
        vm.startPrank(alice);
        uint256 id = _tapeout(nl, 1, 1);
        vm.stopPrank();
        uint256 g = gasleft();
        string memory svg = scope.svgOf(address(circuits), id);
        console2.log("gas svgOf 300 gates (256 drawn)", g - gasleft());
        assertEq(_count(svg, 'class="n"/>'), 256);
        assertTrue(_contains(svg, "300 NAND / 0 LATCH / 0 REF (44 not drawn)"));
        g = gasleft();
        scope.tokenURI(address(circuits), id);
        console2.log("gas tokenURI 300 gates", g - gasleft());
        uint256[] memory ids = new uint256[](6);
        for (uint256 i; i < 6; ++i) {
            ids[i] = i + 1;
        }
        g = gasleft();
        scope.circuitsOf(address(circuits), ids);
        console2.log("gas circuitsOf 6 circuits", g - gasleft());
    }

    // ------------------------------------------------------------ labels

    function test_labelAccessControlAndEscaping() public {
        CerebrScope.Label memory l = _label('XOR <script>"&', "Solves XOR, which one neuron cannot.", 2, 1);

        vm.prank(bob);
        vm.expectRevert(CerebrScope.NotCircuitOwner.selector);
        scope.setLabel(address(circuits), xorId, l);

        vm.prank(alice);
        scope.setLabel(address(circuits), xorId, l);
        assertEq(scope.labelOf(address(circuits), xorId).inputs[1], "in1");

        string memory json = scope.metadataJSON(address(circuits), xorId);
        assertEq(vm.parseJsonString(json, ".name"), 'XOR <script>"&');
        assertEq(vm.parseJsonString(json, ".description"), "Solves XOR, which one neuron cannot.");
        assertEq(vm.parseJsonString(json, ".properties.outputs[0]"), "out0");
        string memory svg = scope.svgOf(address(circuits), xorId);
        assertTrue(_contains(svg, "XOR &lt;script&gt;&quot;&amp;"));
        assertFalse(_contains(svg, "<script"));

        // Ownership follows the NFT.
        vm.prank(alice);
        circuits.transferFrom(alice, bob, xorId);
        vm.prank(alice);
        vm.expectRevert(CerebrScope.NotCircuitOwner.selector);
        scope.setLabel(address(circuits), xorId, l);
        vm.prank(bob);
        scope.clearLabel(address(circuits), xorId);
        assertEq(scope.labelOf(address(circuits), xorId).name, "");
        assertEq(vm.parseJsonString(scope.metadataJSON(address(circuits), xorId), ".name"), "Cerebr circuit #1");
    }

    function test_labelLimits() public {
        vm.startPrank(alice);
        vm.expectRevert(CerebrScope.TooManyPinLabels.selector);
        scope.setLabel(address(circuits), xorId, _label("x", "", 3, 1)); // XOR has 2 inputs
        vm.expectRevert(CerebrScope.TooManyPinLabels.selector);
        scope.setLabel(address(circuits), xorId, _label("x", "", 2, 2));
        vm.expectRevert(CerebrScope.LabelTooLong.selector);
        scope.setLabel(address(circuits), xorId, _label(string(new bytes(65)), "", 0, 0));
        CerebrScope.Label memory l = _label("x", "", 1, 0);
        l.inputs[0] = string(new bytes(33));
        vm.expectRevert(CerebrScope.LabelTooLong.selector);
        scope.setLabel(address(circuits), xorId, l);
        vm.expectRevert(abi.encodeWithSelector(CerebrScope.NotCPU.selector, address(transistors)));
        scope.setLabel(address(transistors), xorId, l);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ helpers

    function _tapeout(bytes memory nl, uint32 nIn, uint32 nOut) internal returns (uint256) {
        return circuits.tapeout{value: circuits.TAPEOUT_FEE()}(nl, nIn, nOut);
    }

    function _ref(uint256 id, uint24 a, uint24 b) internal view returns (bytes memory) {
        return abi.encodePacked(uint8(2), address(circuits), uint64(id), uint8(2), uint8(1), a, b);
    }

    function _assertStats(uint256 id, uint32 nand, uint32 latch, uint32 ref) internal view {
        CerebrScope.NetlistStats memory s = scope.statsOf(address(circuits), id);
        assertEq(s.nand, nand);
        assertEq(s.latch, latch);
        assertEq(s.ref, ref);
        assertEq(s.elements, nand + latch + ref);
        assertTrue(s.wellFormed);
    }

    function _label(string memory name, string memory desc, uint256 nIn, uint256 nOut)
        internal
        pure
        returns (CerebrScope.Label memory l)
    {
        l.name = name;
        l.description = desc;
        l.inputs = new string[](nIn);
        l.outputs = new string[](nOut);
        for (uint256 i; i < nIn; ++i) {
            l.inputs[i] = string.concat("in", vm.toString(i));
        }
        for (uint256 i; i < nOut; ++i) {
            l.outputs[i] = string.concat("out", vm.toString(i));
        }
    }

    function _count(string memory s, string memory needle) internal pure returns (uint256 n) {
        bytes memory h = bytes(s);
        bytes memory k = bytes(needle);
        for (uint256 i; i + k.length <= h.length; ++i) {
            if (_matchAt(h, k, i)) ++n;
        }
    }

    function _contains(string memory s, string memory needle) internal pure returns (bool) {
        return _count(s, needle) != 0;
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        return bytes(s).length >= bytes(p).length && _matchAt(bytes(s), bytes(p), 0);
    }

    function _endsWith(string memory s, string memory p) internal pure returns (bool) {
        return bytes(s).length >= bytes(p).length && _matchAt(bytes(s), bytes(p), bytes(s).length - bytes(p).length);
    }

    function _matchAt(bytes memory h, bytes memory k, uint256 at) internal pure returns (bool) {
        for (uint256 j; j < k.length; ++j) {
            if (h[at + j] != k[j]) return false;
        }
        return true;
    }
}
