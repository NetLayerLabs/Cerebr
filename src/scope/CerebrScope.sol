// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ITapeOutCircuits, ITapeOutFactory, ITapeOutOpener, ITapeOutTransistors} from "./ITapeOut.sol";
import {LibBuffer} from "./LibBuffer.sol";

/// @title CerebrScope
/// @notice Read-only lens over any TapeOut processor on X Layer, plus an optional label registry.
///         - Batch views: circuit info, netlist gate mix (NAND / LATCH / REF parsed from the actual bytes),
///           owner, native circuit account (brain wallet) and whether it is opened.
///         - Batch evaluation: many eval() inputs at once, full truth tables, multi-step runs of sequential circuits.
///         - On-chain "die shot": an SVG drawn from the circuit's real netlist, and ERC-721 style JSON metadata
///           (TapeOut's own tokenURI returns "" on X Layer).
///         - Labels: what a circuit computes (name, pin names, description), writable only by the circuit's owner.
/// @dev Holds no funds. The only state is the label registry. Views make no external writes; netlist parsing is
///      linear and the drawing is capped at MAX_DRAWN_GATES cells. Heavy views are meant for eth_call.
contract CerebrScope {
    using LibBuffer for LibBuffer.Buffer;
    using Strings for uint256;

    // ---------------------------------------------------------------- constants

    uint8 internal constant OP_NAND = 0;
    uint8 internal constant OP_LATCH = 1;
    uint8 internal constant OP_REF = 2;
    /// @dev REF header: op (1) + cpu (20) + circuitId (8) + nIns (1) + nOut (1).
    uint256 internal constant REF_HEADER = 31;

    /// @notice Max gate cells drawn in a die shot (the counts in the text are always exact).
    uint256 public constant MAX_DRAWN_GATES = 256;
    /// @notice Max pins drawn on each side of the die.
    uint256 public constant MAX_DRAWN_PINS = 32;
    /// @notice Max inputs for truthTable (2^10 = 1024 evals).
    uint256 public constant MAX_TRUTH_TABLE_INPUTS = 10;
    /// @notice Max circuits per page() call.
    uint256 public constant MAX_PAGE = 100;

    uint256 public constant MAX_LABEL_NAME = 64;
    uint256 public constant MAX_PIN_LABEL = 32;
    uint256 public constant MAX_DESCRIPTION = 512;

    ITapeOutFactory public immutable FACTORY;
    ITapeOutOpener public immutable OPENER;

    // ---------------------------------------------------------------- types

    /// @notice Gate mix of a netlist, parsed from its bytes. REF elements are counted, not expanded
    ///         (circuitInfo's gateCount is the flattened total).
    struct NetlistStats {
        uint32 nand;
        uint32 latch;
        uint32 ref;
        uint32 elements;
        bool wellFormed; // false if the bytes hold an unknown opcode or are truncated
    }

    struct CircuitView {
        uint256 id;
        bool exists;
        uint32 nIn;
        uint32 nOut;
        uint32 nState;
        uint32 gateCount; // flattened through REFs
        NetlistStats stats; // top-level elements only
        uint256 netlistBytes;
        address owner;
        address account; // native TapeOut circuit account (deterministic, valid before open)
        bool opened;
        string label; // label name, "" if none
    }

    struct ProcessorView {
        address circuits;
        address transistors;
        string name;
        string symbol;
        string story;
        address creator;
        uint256 supplyCap;
        uint256 minted;
        uint256 mintPrice;
        uint256 mintProtocolFee; // flat, per mint call
        uint256 tapeoutFee;
        uint256 circuitCount;
    }

    /// @notice What a circuit computes. Pin labels follow the bit order of eval inputs / outputs (LSB-first).
    struct Label {
        string name;
        string description;
        string[] inputs;
        string[] outputs;
    }

    // ---------------------------------------------------------------- state / events / errors

    mapping(address circuits => mapping(uint256 id => Label)) internal _labels;

    event LabelSet(address indexed circuits, uint256 indexed id, address indexed by);

    error NotCPU(address circuits);
    error NotCircuitOwner();
    error LabelTooLong();
    error TooManyPinLabels();
    error TooManyInputs();
    error Sequential();
    error PageTooLarge();

    constructor(ITapeOutFactory factory, ITapeOutOpener opener) {
        FACTORY = factory;
        OPENER = opener;
    }

    // ---------------------------------------------------------------- label registry

    /// @notice Set (or overwrite) the label of a circuit. Only the circuit NFT's current owner may call.
    /// @dev Labels describe immutable logic, so they persist across NFT transfers; the new owner may overwrite.
    function setLabel(address circuits, uint256 id, Label calldata label) external {
        _requireCPU(circuits);
        if (ITapeOutCircuits(circuits).ownerOf(id) != msg.sender) revert NotCircuitOwner();
        (uint32 nIn, uint32 nOut,,) = ITapeOutCircuits(circuits).circuitInfo(id);
        if (bytes(label.name).length > MAX_LABEL_NAME || bytes(label.description).length > MAX_DESCRIPTION) {
            revert LabelTooLong();
        }
        if (label.inputs.length > nIn || label.outputs.length > nOut) revert TooManyPinLabels();
        _checkPins(label.inputs);
        _checkPins(label.outputs);
        _labels[circuits][id] = label;
        emit LabelSet(circuits, id, msg.sender);
    }

    /// @notice Remove a circuit's label. Owner only.
    function clearLabel(address circuits, uint256 id) external {
        if (ITapeOutCircuits(circuits).ownerOf(id) != msg.sender) revert NotCircuitOwner();
        delete _labels[circuits][id];
        emit LabelSet(circuits, id, msg.sender);
    }

    function labelOf(address circuits, uint256 id) external view returns (Label memory) {
        return _labels[circuits][id];
    }

    // ---------------------------------------------------------------- batch views

    function processor(address circuits) external view returns (ProcessorView memory p) {
        _requireCPU(circuits);
        ITapeOutCircuits c = ITapeOutCircuits(circuits);
        ITapeOutTransistors t = ITapeOutTransistors(c.transistors());
        p.circuits = circuits;
        p.transistors = address(t);
        p.name = t.cpuName();
        p.symbol = t.cpuSymbol();
        p.story = t.story();
        p.creator = t.creator();
        p.supplyCap = t.supplyCap();
        p.minted = t.minted();
        p.mintPrice = t.mintPrice();
        p.mintProtocolFee = t.protocolFee();
        p.tapeoutFee = c.TAPEOUT_FEE();
        p.circuitCount = c.nextId();
    }

    /// @notice Info for a list of circuit ids. Unknown ids come back with exists = false instead of reverting.
    function circuitsOf(address circuits, uint256[] calldata ids) external view returns (CircuitView[] memory out) {
        out = new CircuitView[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            out[i] = _circuitView(circuits, ids[i]);
        }
    }

    /// @notice Circuits [fromId, fromId + count) clipped to the existing range (ids start at 1).
    function page(address circuits, uint256 fromId, uint256 count) external view returns (CircuitView[] memory out) {
        if (count > MAX_PAGE) revert PageTooLarge();
        uint256 last = ITapeOutCircuits(circuits).nextId(); // last assigned id
        if (fromId == 0) fromId = 1;
        uint256 n = fromId > last ? 0 : last - fromId + 1;
        if (n > count) n = count;
        out = new CircuitView[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = _circuitView(circuits, fromId + i);
        }
    }

    /// @notice Gate mix of a stored circuit's top-level netlist.
    function statsOf(address circuits, uint256 id) external view returns (NetlistStats memory s) {
        (s,) = scan(ITapeOutCircuits(circuits).netlist(id), 0);
    }

    // ---------------------------------------------------------------- batch evaluation

    /// @notice eval() for many packed inputs at once.
    function evalBatch(address circuits, uint256 id, bytes[] calldata inputs)
        external
        view
        returns (bytes[] memory out)
    {
        ITapeOutCircuits c = ITapeOutCircuits(circuits);
        out = new bytes[](inputs.length);
        for (uint256 i; i < inputs.length; ++i) {
            out[i] = c.eval(id, inputs[i]);
        }
    }

    /// @notice Outputs for every input combination of a combinational circuit; out[x] = eval(x) where x is the
    ///         input word (bit i = input pin i).
    function truthTable(address circuits, uint256 id) external view returns (bytes[] memory out) {
        ITapeOutCircuits c = ITapeOutCircuits(circuits);
        (uint32 nIn,, uint32 nState,) = c.circuitInfo(id);
        if (nState != 0) revert Sequential();
        if (nIn > MAX_TRUTH_TABLE_INPUTS) revert TooManyInputs();
        // forge-lint: disable-next-line(incorrect-shift)
        uint256 rows = 1 << nIn;
        uint256 width = (uint256(nIn) + 7) / 8;
        out = new bytes[](rows);
        for (uint256 x; x < rows; ++x) {
            bytes memory input = new bytes(width);
            for (uint256 k; k < width; ++k) {
                // forge-lint: disable-next-line(unsafe-typecast)
                input[k] = bytes1(uint8(x >> (8 * k)));
            }
            out[x] = c.eval(id, input);
        }
    }

    /// @notice Run a sequential circuit over a sequence of inputs, threading the state through step().
    function run(address circuits, uint256 id, bytes calldata state, bytes[] calldata inputs)
        external
        view
        returns (bytes[] memory outputs, bytes memory finalState)
    {
        ITapeOutCircuits c = ITapeOutCircuits(circuits);
        outputs = new bytes[](inputs.length);
        finalState = state;
        for (uint256 i; i < inputs.length; ++i) {
            (finalState, outputs[i]) = c.step(id, finalState, inputs[i]);
        }
    }

    // ---------------------------------------------------------------- metadata / die shot

    /// @notice ERC-721 style metadata: data:application/json;base64 with the die shot embedded as an SVG data URI.
    function tokenURI(address circuits, uint256 id) external view returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(metadataJSON(circuits, id))));
    }

    /// @notice Plain JSON metadata (what tokenURI base64-encodes).
    function metadataJSON(address circuits, uint256 id) public view returns (string memory) {
        Render memory r = _load(circuits, id);
        LibBuffer.Buffer memory b = LibBuffer.init(2048);
        b.append(string.concat('{"name":"', Strings.escapeJSON(r.title), '","description":"'));
        b.append(Strings.escapeJSON(_description(r)));
        b.append('","image":"data:image/svg+xml;base64,');
        b.append(Base64.encode(bytes(_svg(r))));
        b.append('","attributes":[');
        b.append(_trait("Processor", string.concat('"', Strings.escapeJSON(r.cpuName), '"'), false));
        b.append(_trait("Kind", r.nState == 0 ? '"Combinational"' : '"Sequential"', false));
        b.append(_trait("Inputs", uint256(r.nIn).toString(), false));
        b.append(_trait("Outputs", uint256(r.nOut).toString(), false));
        b.append(_trait("Gates", uint256(r.gateCount).toString(), false));
        b.append(_trait("NAND", uint256(r.stats.nand).toString(), false));
        b.append(_trait("LATCH", uint256(r.stats.latch).toString(), false));
        b.append(_trait("REF", uint256(r.stats.ref).toString(), false));
        b.append(_trait("State bits", uint256(r.nState).toString(), true));
        b.append('],"properties":{"circuits":"');
        b.append(Strings.toHexString(circuits));
        b.append(string.concat('","id":', id.toString(), ',"account":"'));
        b.append(Strings.toHexString(OPENER.accountOf(circuits, id)));
        b.append('","inputs":');
        b.append(_jsonArray(r.label.inputs));
        b.append(',"outputs":');
        b.append(_jsonArray(r.label.outputs));
        b.append("}}");
        return b.toString();
    }

    /// @notice The die shot: an SVG drawn from the circuit's actual netlist. Each element is one cell in
    ///         netlist order (NAND teal, LATCH amber, REF violet); pads on the left/right are the input/output pins.
    function svgOf(address circuits, uint256 id) external view returns (string memory) {
        return _svg(_load(circuits, id));
    }

    // ---------------------------------------------------------------- netlist parsing

    /// @notice Parse a TapeOut netlist: count elements by opcode and return the opcodes of the first
    ///         `maxOps` elements. Wire format: NAND 00 a:u24 b:u24 | LATCH 01 d:u24 |
    ///         REF 02 cpu:20B id:u64 nIns:u8 nOut:u8 ins:u24*nIns. Stops at the first malformed element.
    function scan(bytes memory nl, uint256 maxOps) public pure returns (NetlistStats memory s, bytes memory ops) {
        ops = new bytes(maxOps);
        uint256 len = nl.length;
        uint256 p;
        uint256 n;
        while (p < len) {
            uint8 op = uint8(nl[p]);
            uint256 size;
            if (op == OP_NAND) {
                size = 7;
            } else if (op == OP_LATCH) {
                size = 4;
            } else if (op == OP_REF) {
                if (p + REF_HEADER > len) break;
                size = REF_HEADER + 3 * uint256(uint8(nl[p + 29]));
            } else {
                break;
            }
            if (p + size > len) break;
            if (op == OP_NAND) ++s.nand;
            else if (op == OP_LATCH) ++s.latch;
            else ++s.ref;
            if (n < maxOps) ops[n] = bytes1(op);
            ++n;
            p += size;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        s.elements = uint32(n); // n <= nl.length / 4
        s.wellFormed = p == len;
        if (n < maxOps) {
            assembly ("memory-safe") {
                mstore(ops, n)
            }
        }
    }

    // ---------------------------------------------------------------- internals

    struct Render {
        uint256 id;
        uint32 nIn;
        uint32 nOut;
        uint32 nState;
        uint32 gateCount;
        NetlistStats stats;
        bytes ops; // opcodes of the first MAX_DRAWN_GATES elements
        string cpuName;
        string title;
        Label label;
    }

    function _requireCPU(address circuits) internal view {
        if (!FACTORY.isCPU(circuits)) revert NotCPU(circuits);
    }

    function _checkPins(string[] calldata pins) internal pure {
        for (uint256 i; i < pins.length; ++i) {
            if (bytes(pins[i]).length > MAX_PIN_LABEL) revert LabelTooLong();
        }
    }

    function _circuitView(address circuits, uint256 id) internal view returns (CircuitView memory v) {
        ITapeOutCircuits c = ITapeOutCircuits(circuits);
        v.id = id;
        try c.circuitInfo(id) returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount) {
            (v.exists, v.nIn, v.nOut, v.nState, v.gateCount) = (true, nIn, nOut, nState, gateCount);
        } catch {
            return v;
        }
        bytes memory nl = c.netlist(id);
        v.netlistBytes = nl.length;
        (v.stats,) = scan(nl, 0);
        v.owner = c.ownerOf(id);
        try OPENER.accountOf(circuits, id) returns (address a) {
            v.account = a;
            v.opened = OPENER.isOpened(circuits, id);
        } catch {}
        v.label = _labels[circuits][id].name;
    }

    function _load(address circuits, uint256 id) internal view returns (Render memory r) {
        ITapeOutCircuits c = ITapeOutCircuits(circuits);
        r.id = id;
        (r.nIn, r.nOut, r.nState, r.gateCount) = c.circuitInfo(id);
        (r.stats, r.ops) = scan(c.netlist(id), MAX_DRAWN_GATES);
        try c.name() returns (string memory n) {
            r.cpuName = n;
        } catch {}
        r.label = _labels[circuits][id];
        r.title = bytes(r.label.name).length != 0
            ? r.label.name
            : string.concat(bytes(r.cpuName).length != 0 ? r.cpuName : "TapeOut", " circuit #", id.toString());
    }

    function _description(Render memory r) internal pure returns (string memory) {
        if (bytes(r.label.description).length != 0) return r.label.description;
        return string.concat(
            "A circuit taped out on the ",
            r.cpuName,
            " TapeOut processor on X Layer: ",
            uint256(r.gateCount).toString(),
            " gates, ",
            uint256(r.nIn).toString(),
            " inputs, ",
            uint256(r.nOut).toString(),
            " outputs. Evaluate it on-chain with eval()."
        );
    }

    function _trait(string memory key, string memory jsonValue, bool last) internal pure returns (string memory) {
        return string.concat('{"trait_type":"', key, '","value":', jsonValue, last ? "}" : "},");
    }

    function _jsonArray(string[] memory items) internal pure returns (string memory s) {
        s = "[";
        for (uint256 i; i < items.length; ++i) {
            s = string.concat(s, i == 0 ? '"' : ',"', Strings.escapeJSON(items[i]), '"');
        }
        s = string.concat(s, "]");
    }

    // Die geometry (viewBox 0 0 400 440): die body 70..330, gate field 80..320.
    uint256 internal constant DIE = 70;
    uint256 internal constant DIE_SIZE = 260;
    uint256 internal constant FIELD = 80;
    uint256 internal constant FIELD_SIZE = 240;

    function _svg(Render memory r) internal pure returns (string memory) {
        LibBuffer.Buffer memory b = LibBuffer.init(1024 + r.ops.length * 72);
        b.append(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 440" font-family="monospace">'
            "<style>.n{fill:#2dd4bf}.l{fill:#f59e0b}.r{fill:#a78bfa}.p{fill:#d4af37}"
            ".t{fill:#e6edf3;font-size:16px}.s{fill:#8b98a5;font-size:12px}</style>"
            '<rect width="400" height="440" fill="#0b0f14"/>'
            '<rect x="70" y="70" width="260" height="260" rx="6" fill="#111a22" stroke="#2b3a48" stroke-width="2"/>'
        );
        b.append(
            string.concat('<text x="200" y="40" text-anchor="middle" class="t">', _xml(_clip(r.title, 40)), "</text>")
        );
        _pins(b, r.nIn, 52);
        _pins(b, r.nOut, 330);
        _gates(b, r.ops);
        b.append(
            string.concat(
                '<text x="200" y="362" text-anchor="middle" class="s">',
                uint256(r.nIn).toString(),
                " in / ",
                uint256(r.nOut).toString(),
                " out / ",
                uint256(r.gateCount).toString(),
                r.nState == 0 ? " gates" : string.concat(" gates / ", uint256(r.nState).toString(), " state"),
                "</text>"
            )
        );
        b.append(
            string.concat(
                '<text x="200" y="384" text-anchor="middle" class="s">',
                uint256(r.stats.nand).toString(),
                " NAND / ",
                uint256(r.stats.latch).toString(),
                " LATCH / ",
                uint256(r.stats.ref).toString(),
                " REF",
                r.stats.elements > r.ops.length
                    ? string.concat(" (", (r.stats.elements - r.ops.length).toString(), " not drawn)")
                    : "",
                "</text>"
            )
        );
        b.append(
            string.concat(
                '<text x="200" y="414" text-anchor="middle" class="s">',
                _xml(_clip(r.cpuName, 32)),
                " #",
                r.id.toString(),
                "</text></svg>"
            )
        );
        return b.toString();
    }

    /// @dev Pads along one edge of the die, evenly spaced; at most MAX_DRAWN_PINS.
    function _pins(LibBuffer.Buffer memory b, uint256 count, uint256 x) internal pure {
        if (count > MAX_DRAWN_PINS) count = MAX_DRAWN_PINS;
        for (uint256 i; i < count; ++i) {
            uint256 y = DIE + (DIE_SIZE * (2 * i + 1)) / (2 * count) - 2;
            b.append(
                string.concat('<rect x="', x.toString(), '" y="', y.toString(), '" width="18" height="4" class="p"/>')
            );
        }
    }

    /// @dev One square cell per element in netlist order, on a ceil(sqrt(n)) grid centred in the gate field.
    function _gates(LibBuffer.Buffer memory b, bytes memory ops) internal pure {
        uint256 n = ops.length;
        if (n == 0) return;
        uint256 cols = 1;
        while (cols * cols < n) ++cols;
        uint256 rows = (n + cols - 1) / cols;
        uint256 cell = FIELD_SIZE / cols;
        uint256 gap = cell >= 6 ? 1 : 0;
        string memory size = (cell - 2 * gap).toString();
        uint256 x0 = FIELD + (FIELD_SIZE - cols * cell) / 2;
        uint256 y0 = FIELD + (FIELD_SIZE - rows * cell) / 2;
        for (uint256 i; i < n; ++i) {
            uint8 op = uint8(ops[i]);
            b.append(
                string.concat(
                    '<rect x="',
                    (x0 + (i % cols) * cell + gap).toString(),
                    '" y="',
                    (y0 + (i / cols) * cell + gap).toString(),
                    '" width="',
                    size,
                    '" height="',
                    size,
                    op == OP_NAND ? '" class="n"/>' : op == OP_LATCH ? '" class="l"/>' : '" class="r"/>'
                )
            );
        }
    }

    /// @dev XML-escape untrusted text for SVG; drops control characters.
    function _xml(string memory s) internal pure returns (string memory) {
        bytes memory src = bytes(s);
        LibBuffer.Buffer memory b = LibBuffer.init(src.length + 16);
        for (uint256 i; i < src.length; ++i) {
            bytes1 ch = src[i];
            if (ch == "&") b.append("&amp;");
            else if (ch == "<") b.append("&lt;");
            else if (ch == ">") b.append("&gt;");
            else if (ch == '"') b.append("&quot;");
            else if (ch == "'") b.append("&#39;");
            else if (uint8(ch) >= 0x20 && uint8(ch) != 0x7f) b.appendBytes(abi.encodePacked(ch));
        }
        return b.toString();
    }

    /// @dev Cut to at most `max` bytes without splitting a UTF-8 sequence; appends "..." when cut.
    function _clip(string memory s, uint256 max) internal pure returns (string memory) {
        bytes memory src = bytes(s);
        if (src.length <= max) return s;
        uint256 n = max;
        while (n > 0 && (uint8(src[n]) & 0xC0) == 0x80) --n; // src[n] is the first dropped byte
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; ++i) {
            out[i] = src[i];
        }
        return string.concat(string(out), "...");
    }
}
