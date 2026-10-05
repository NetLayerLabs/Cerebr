// TapeOut ABIs, restricted to what is deployed on X Layer. Every selector below was checked
// against the live bytecode (cast selectors) and exercised on a fork; see TAPEOUT.md.
// Note: the factory's cpuAt(i) and cpus(i) are equivalent (the SDK uses cpus(i)), the circuits contract has NO cpuName/cpuSymbol/
// story/commitDesign (those strings live on the transistors contract), and tokenURI/uri return "".

import { parseAbi } from 'viem';

const errors = [
  'error FeeTooLow(uint256 sent, uint256 need)',
  'error ProtocolFeeTooLow(uint256 sent, uint256 need)',
  'error AlreadyOpened()',
  'error NotRegisteredCPU()',
  'error NotOwner()',
  'error OnlyCall()',
  'error ERC1155InsufficientBalance(address sender, uint256 balance, uint256 needed, uint256 tokenId)',
  'error ERC721NonexistentToken(uint256 tokenId)',
  'error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner)',
  'error ERC721InsufficientApproval(address operator, uint256 tokenId)',
] as const;

export const factoryAbiHuman = [
  'function createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address transistors, address circuits)',
  'function deployFee() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function cpuCount() view returns (uint256)',
  'function cpus(uint256 index) view returns (address circuits)',
  'function isCPU(address circuits) view returns (bool)',
  'function owner() view returns (address)',
  'function protocolWallet() view returns (address)',
  'function isSealed() view returns (bool)',
  'function transistorBeacon() view returns (address)',
  'function circuitBeacon() view returns (address)',
  'event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)',
  ...errors,
] as const;

export const transistorsAbiHuman = [
  'function mint(uint256 id, uint256 amount) payable',
  'function mintPrice() view returns (uint256)',
  'function protocolFee() view returns (uint256)',
  'function supplyCap() view returns (uint256)',
  'function minted() view returns (uint256)',
  'function creator() view returns (address)',
  'function circuits() view returns (address)',
  'function cpuName() view returns (string)',
  'function cpuSymbol() view returns (string)',
  'function story() view returns (string)',
  'function NAND() pure returns (uint256)',
  'function LATCH() pure returns (uint256)',
  'function owed(address account) view returns (uint256)',
  'function withdraw()',
  'function protocolWallet() view returns (address)',
  'function uri(uint256 id) view returns (string)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'event Minted(address indexed to, uint256 indexed id, uint256 amount, uint256 paid)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
  ...errors,
] as const;

export const circuitsAbiHuman = [
  'function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)',
  'function TAPEOUT_FEE() pure returns (uint256)',
  'function TREASURY() pure returns (address)',
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function netlist(uint256 id) view returns (bytes)',
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)',
  'function nextId() view returns (uint256)',
  'function transistors() view returns (address)',
  'function factory() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ...errors,
] as const;

export const openerAbiHuman = [
  'function open(address circuits, uint256 tokenId) payable returns (address)',
  'function accountOf(address circuits, uint256 tokenId) view returns (address)',
  'function isOpened(address circuits, uint256 tokenId) view returns (bool)',
  'function isDeployed(address circuits, uint256 tokenId) view returns (bool)',
  'function FEE() pure returns (uint256)',
  'function implementation() pure returns (address)',
  'function registry() pure returns (address)',
  'function treasury() pure returns (address)',
  'function payments() pure returns (address)',
  'function factory() pure returns (address)',
  'function SALT() pure returns (bytes32)',
  'event Opened(address indexed circuits, uint256 indexed tokenId, address indexed account, address payer)',
  ...errors,
] as const;

export const accountAbiHuman = [
  'function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)',
  'function owner() view returns (address)',
  'function state() view returns (uint256)',
  'function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)',
  'function executeBatch(address[] to, uint256[] value, bytes[] data) payable returns (bytes[])',
  'function EXEC_FEE() pure returns (uint256)',
  'function BATCH_FEE() pure returns (uint256)',
  'function isValidSigner(address signer, bytes context) view returns (bytes4)',
  'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  ...errors,
] as const;

export const factoryAbi = parseAbi(factoryAbiHuman);
export const transistorsAbi = parseAbi(transistorsAbiHuman);
export const circuitsAbi = parseAbi(circuitsAbiHuman);
export const openerAbi = parseAbi(openerAbiHuman);
export const accountAbi = parseAbi(accountAbiHuman);
