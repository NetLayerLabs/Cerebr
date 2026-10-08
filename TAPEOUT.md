# TapeOut on X Layer: verified integration spec

All of this was verified on an anvil fork of X Layer mainnet at block 72,375,308 on 2026-10-04:
`anvil --fork-url https://rpc.xlayer.tech --port 8561 --auto-impersonate --chain-id 196`.
The tests used synthetic, impersonated addresses. Nothing was broadcast to a public chain.
Evidence for each fact comes from `cast selectors` on the live bytecode, `cast call`/`cast estimate` reverts, and fork receipts. The hints extracted from the TapeOut client bundle (`sdk/reference/*`) are marked **CORRECTED** wherever the chain disagrees with them.

The SDK lives in `sdk/src/tapeout/` (import from `sdk/src/tapeout/index.ts`). To run the end-to-end check, start the anvil fork above and then run `cd sdk && FORK_RPC=http://127.0.0.1:8561 node scripts/fork-smoke.ts`. All 18 checks print PASS.

TapeOut warns that its X Layer contracts are test-phase, upgradeable (UUPS and beacons, owner `0xB3D8…3138`, `isSealed() = false`) and unaudited. Every fee below can be changed by the owner, so read the fees live with `readFees()` before quoting a price.

## 1. Addresses (chainId 196)

| What | Address | Notes |
|---|---|---|
| Factory (proxy) | `0x1f09daefa827f02cbb40967cc91b259763760761` | EIP-1967 UUPS; impl `0x74956236ab64ed143933040b4137e8a352e4d17b` |
| Transistor beacon | `0x1059Ad62cAbB6a6925bb65aA617300556c60A51B` | impl `0x265bf10faB9ddEC0eE0A649C6B9DB845f1b9a06b` |
| Circuit beacon | `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` | impl `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2` |
| Factory protocolWallet | `0x571d447f4f24688eC35Ccf07f1D6993655F6aF15` | receives deploy and mint protocol fees (pull, `owed`/`withdraw`) |
| Circuits TREASURY | `0xEBeceDeA36e598b64E17f8d519EB77441C539F76` | receives TAPEOUT_FEE (push) |
| Opener | `0x536add8f30f03b69f6fbf29d425a816a0dc50106` | not a proxy |
| Account impl (ERC-6551) | `0xac4f791353ee9f06e2c50ae4c34680d28ea52a57` | itself a beacon proxy: beacon `0x9b135f586F7850A3Fa92210c298F732b20bC8f44` (an immutable in the proxy's bytecode, no EIP-1967 slot) to impl `0x6B6fDa1483367e939314070a4f233c1DFD35996B` (pinned in `launch/config.json` as `accountBeaconImpl`) |
| ERC-6551 registry | `0x000000006551c19487814612e58fe06813775758` | salt `0x0` |
| Opener treasury | `0xE2f77062c6060503e0289c6638D1B0A7C76cBB9d` | receives open, EXEC and BATCH fees (push) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | present |
| BEM token | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` | not needed for our flows |

At the fork block there were 275 CPUs. CPU #0 is TapeOut's own `OnlyTestXLayer` (circuits `0x839bdD6f…574e`, 102 circuits at that block; 103 by 2026-10-06).

## 2. Factory

* `createCPU(string name, string symbol, string story, uint256 transistorSupply, uint256 mintPrice) payable returns (address transistors, address circuits)` (selector `0x47f9b5fd`). msg.value must be **>= deployFee() = 0.0066 OKB** (otherwise it reverts `"deploy fee"`). **Any excess is kept, not refunded**: sending 0.01 OKB cost exactly 0.01 OKB. Gas: about 715k.
  The factory checks no bounds: supply 0, mintPrice 0 and empty strings are all accepted. The TapeOut app only *lists* an X Layer CPU when `supplyCap >= 10000` and `minted >= 1`.
* `event CPUCreated(address indexed circuits, address indexed transistors, address indexed creator, string name, uint256 supply, uint256 mintPrice)`: topic0 `0x2e8868f1…2290`. It is emitted by the factory.
* Views: `deployFee()`, `protocolFee()` (0.00066 OKB, copied into each new CPU), `cpuCount()`, `isCPU(address)`, `owner()`, `protocolWallet()`, `isSealed()`, `transistorBeacon()`, `circuitBeacon()`.
* `cpuAt(i)` and `cpus(i)` both exist and return the same **circuits** address (verified on mainnet: `cpuAt(275)` = `cpus(275)` = Cerebr); the SDK uses `cpus`. `isCPU` is keyed by the **circuits** address: `isCPU(transistors)` returns false.

## 3. Transistors (ERC-1155, one per CPU)

* Token ids are verified onchain: `NAND() = 0` and `LATCH() = 1`. `mint` with any other id reverts `"bad id"`, and an amount of 0 reverts `"zero"`.
* `mint(uint256 id, uint256 amount) payable`: requires `msg.value >= amount*mintPrice + protocolFee`, otherwise it reverts `"insufficient"`. The **protocolFee is a flat 0.00066 OKB per mint call, not per transistor.** Payment is pull-based: `owed(creator) += amount*mintPrice` and `owed(protocolWallet) += protocolFee`. **Any excess is stranded in the contract** (owed to nobody). The creator collects with `withdraw()`, which was verified to pay out exactly `owed`.
  `event Minted(address indexed to, uint256 indexed id, uint256 amount, uint256 paid)`, where `paid` is the full msg.value. Gas: 180k for the first mint on a CPU and about 69k afterwards (a 40,000-transistor mint costs the same as a 4-transistor one).
* `supplyCap` is **shared by NAND and LATCH**, and `minted()` counts both. Going over the cap reverts `"supply cap"`. Burns do not reduce `minted`.
* Views: `mintPrice, protocolFee, supplyCap, minted, creator, circuits, owed(addr), protocolWallet`, plus **`cpuName()`, `cpuSymbol()`, `story()`. CORRECTED: these three live on the transistors contract, not on circuits.** The ERC-1155 standard functions are present (`balanceOfBatch`, `safeTransferFrom`, `safeBatchTransferFrom`, approvals). `uri(id)` returns `""`.
* There is also `burnFrom(address,uint256,uint256)`, which only the circuits contract may call.

## 4. Circuits (ERC-721, one per CPU)

* `tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256 id)`: **msg.value must equal TAPEOUT_FEE() = 0.0013 OKB exactly.** Both underpaying and overpaying revert `"tapeout fee"`. The fee is pushed straight to TREASURY.
  It burns **1 NAND per NAND element and 1 LATCH per LATCH element** from msg.sender (emitted as TransferSingle to 0x0). With too few transistors it reverts `ERC1155InsufficientBalance` (`0x03dee4c5`). **A REF burns nothing**, at any depth.
  It emits `Transfer(0, author, id)` and then `TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)`.
* **No `commitDesign` is needed.** The circuits contract has no commit functions; `commitDesign`, `designCommits` and the rest belong to BSC-only mining and market contracts. A plain `tapeout()` works.
* Ids start at **1**. **CORRECTED:** `nextId()` returns the **last assigned id**, which equals the circuit count, not the next id. A fresh CPU returns 0, and returns 1 after the first tapeout.
* `circuitInfo(id) returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)`. `gateCount` and `nState` are **flattened through REFs**. For example, a circuit with 2 REFs to a 4-gate XOR reports gateCount 8. A non-existent id reverts `"no circuit"`.
* `netlist(id)` returns the bytes exactly as submitted. `ownerOf`, `balanceOf`, `transferFrom`, `safeTransferFrom` and approvals work. ERC-721 and Metadata are supported; Enumerable is not.
  **`tokenURI(id)` returns `""`.** TapeOut has no onchain metadata on X Layer, and CerebrScope fills that gap.
* Views: `TAPEOUT_FEE()`, `TREASURY()`, `transistors()`, `transistorsContract()`, `factory()`, `name()`, `symbol()` (= cpuName/cpuSymbol), plus `sweepFees()`.

### 4.1 Netlist rules (all verified with reverting tapeouts)

The wire format matches `sdk/reference/tapeout-netlist-src.js`:
* NAND is `00 a:u24 b:u24`.
* LATCH is `01 d:u24`.
* REF is `02 cpu:20B id:u64 nIns:u8 nOut:u8 ins:u24*nIns`.

Signals are numbered as follows: 0 is const0, 1 is const1, inputs occupy 2..1+nIn, and then each element appends its output signals (a REF appends nOut of them).

* A NAND or REF input must point to a signal strictly before the element's own outputs. Otherwise a NAND reverts `"NAND: future signal"` and a REF reverts `"REF: future signal"`; that includes a NAND reading its own output and a REF input equal to one of its own outputs. (TapeOut's client decoder in `sdk/reference/tapeout-netlist-src.js` accepts those two self-references; the SDK's `decode` and `scanNetlist` follow the contract.)
* A LATCH `d` may point forward, which is how feedback works, but it must be below the total signal count (`2 + nIn` + every element's outputs), otherwise the tapeout reverts `"LATCH d out of range"`.
  All three rules were re-checked on a fork on 2026-10-06 with `eth_call` tapeouts against the Cerebr processor.
* **Outputs are the last nOut signals produced by elements. The NOT-NOT buffer is NOT required**: the TapeOut XOR #1 is 4 bare NANDs with its output on the last signal. The output signals can never be inputs or constants. If there are fewer than nOut element signals, the tapeout reverts `"too few signals for outputs"`; a 0-gate identity circuit and `nIn=2, nOut=2` with 1 gate were both rejected. `nOut = 0` reverts `"no outputs"`.
  To expose an input or an earlier signal, either reorder the gates or append a NOT-NOT pair (2 NAND).
* REF target `cpu` must be the **circuits** address of a registered CPU, otherwise it reverts `"REF: target not a registered CPU"`. The pin counts must match the target's `circuitInfo`, otherwise it reverts `"REF: pin mismatch"`. A missing id reverts `"no circuit"`.
  **A circuit can REF circuits on the same CPU or on any other CPU, and those circuits may be owned by anyone.** There is no royalty and no fee.
  REFs to sequential circuits work, and their state is concatenated into the parent's `nState`.
  Nesting depth: 40 levels were tested without hitting a limit. Each level costs a constant ~211k gas to tape out, and eval gas grows (3.0M at depth 40).
* There is no hard gate limit up to the block gas limit (210M). Tapeouts of 2 to 30,000 gates were tested.

### 4.2 eval / step (bit packing verified)

* Inputs, outputs and state are **bit-packed LSB-first per byte**: bit i is `(byte[i>>3] >> (i&7)) & 1`. Missing input bytes read as 0, and extra bytes are ignored.
  Example: on the half adder (nIn 2, nOut 2), `eval(0x03)` returns `0x02` (sum 0, carry 1). On the 9-latch register, `step(state 0x0300, in 0x0100)` returns `newState 0x0100` and `out 0xfc01`.
* `eval(id, inputs)` works only for combinational circuits. If `nState > 0` it reverts `"has latch: use step"`.
* `step(id, state, inputs) returns (newState, outputs)`. Each LATCH outputs its **current** state bit, the outputs are computed from that state, and then every latch samples `d` into newState. An empty `state` (`0x`) means all zeros.

## 5. Native circuit accounts (brain wallets)

* `opener.accountOf(circuits, id)` returns the deterministic ERC-6551 address from `registry.account(accountImpl, salt 0, 196, circuits, id)`, both **before** and after `open()`. The address can receive funds before it is opened.
* `opener.open(circuits, id) payable returns (address)`:
  * msg.value must be **>= FEE() = 0.08 OKB**. Below that it reverts `FeeTooLow(sent, need)` (`0xf04f3db2`). **Any excess is refunded.** The fee is pushed to the opener treasury.
  * **Anyone may pay to open any circuit**, not only its owner.
  * It reverts `AlreadyOpened()` (`0x1da42b26`), `NotRegisteredCPU()` (`0x5c69a867`) or `ERC721NonexistentToken`.
  * Gas is about 174k. The call creates the account through the registry and calls `payments.paid(account)`. It emits `Opened(address indexed circuits, uint256 indexed tokenId, address indexed account, address payer)`.
  * Afterwards `isOpened` and `isDeployed` are both true.
* Account interface (selectors verified):
  * `token() returns (uint256 chainId, address tokenContract, uint256 tokenId)`.
  * `owner()` follows the circuit NFT owner (verified after a transfer).
  * `state()` is a nonce that increments on each execute.
  * `execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)`. **msg.value pays EXEC_FEE = 0.0013 OKB (excess refunded); `value` is spent from the account's own balance.** A non-owner gets `NotOwner()` (`0x30cd7471`), an operation other than 0 gets `OnlyCall()` (`0x90afeb14`), and no fee gets `ProtocolFeeTooLow`. Gas is about 108k.
  * `executeBatch(address[] to, uint256[] value, bytes[] data)` costs BATCH_FEE = 0.0033 OKB.
  * Also `isValidSigner`, `isValidSignature` (ERC-1271), and the ERC-721/1155 receivers. The account can hold transistors and move them through `execute`, which was verified.
* Caveat: transferring a circuit NFT into its own account is not blocked at the ERC-721 level, and doing so locks the account. The dApp should guard against this.

## 6. Cost calculator (wei; X Layer gas price ~0.02 gwei)

```
createCPU   value = deployFee                                   (0.0066 OKB; excess lost)          gas ~715k
mint        value = amount*mintPrice + protocolFee              (0.00066 per call; excess stranded) gas 180k first / ~70k
tapeout     value = TAPEOUT_FEE exactly                         (0.0013)                           gas ~210k (+40k first) + 2.9k*(NAND+LATCH) + 20k*REF
            burns  NAND = #NAND elements, LATCH = #LATCH elements, REF free
eval/step   free view; gas ~50k + 2.5k * flattened gateCount
open        value = FEE                                         (0.08; excess refunded)            gas ~175k
execute     value = EXEC_FEE (0.0013) / executeBatch BATCH_FEE (0.0033)                             gas ~110k
creator revenue = sum(amount*mintPrice), pulled via transistors.withdraw()
```

Measured tapeout gas: 4 gates took 247k (the first tapeout on a CPU), 100 gates 490k, 1,000 gates 3.06M, 10,000 gates 29.0M and 30,000 gates 87.7M.
Measured eval gas: 100 gates took 274k, 1,000 gates 2.33M and 10,000 gates 23.2M.
At 0.02 gwei even a 10,000-gate tapeout costs under 0.0006 OKB in gas, so the protocol fees dominate.

Example launch with Cerebr's terms, a 1,000,000 supply at 0.00001 OKB:
* deploy: 0.0066
* the creator's own mint of 1,000 NAND: 0.01 + 0.00066, of which 0.01 comes back through withdraw
* 10 tapeouts: 0.013
* 1 opened account: 0.08

The gross total is about 0.110 OKB; net of the creator refund it is about 0.100 OKB. Opening an account for every showcase circuit is the expensive part, at 0.08 each.

`sdk/src/tapeout/encode.ts` implements this as `mintValue`, `quoteTapeout`, `quoteLaunch`, `tapeoutGas`, `evalGas` and `OBSERVED_FEES`.

## 7. Error and revert strings seen

* `"deploy fee"`, `"insufficient"`, `"bad id"`, `"zero"`, `"supply cap"`
* `"tapeout fee"`, `"no circuit"`, `"no outputs"`, `"too few signals for outputs"`, `"NAND: future signal"`, `"REF: future signal"`, `"LATCH d out of range"`
* `"REF: pin mismatch"`, `"REF: target not a registered CPU"`, `"has latch: use step"`
* `ERC1155InsufficientBalance 0x03dee4c5`, `ERC721NonexistentToken 0x7e273289`, `FeeTooLow 0xf04f3db2`, `AlreadyOpened 0x1da42b26`
* `NotRegisteredCPU 0x5c69a867`, `NotOwner 0x30cd7471`, `OnlyCall 0x90afeb14`, `ProtocolFeeTooLow 0xafd49700`

## 8. Mainnet launch checklist (only the user signs)

1. Rehearse on the fork with `node scripts/fork-smoke.ts`, then rehearse the real script with the real parameters.
2. Run `createCPU("Cerebr", <symbol>, <story>, supply >= 10000, mintPrice)` with value = deployFee. Record the transistors and circuits addresses from `CPUCreated`.
3. Mint at least 1 transistor so the CPU meets `minted >= 1` and the app lists it. Mint enough NAND for the showcase circuits.
4. Tape out the neuron circuits, leaf circuits first, then the REF-composed networks. Verify each one with `truthTable` or `eval`.
5. Optionally `open()` the flagship circuit's account (0.08 OKB).

## 9. Marketplace (circuit NFTs)

Verified on 2026-10-06 against mainnet with read-only `cast` calls to `https://rpc.xlayer.tech` and on an anvil fork at block 72,514,523 (`anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8602`). To rerun: `cd sdk && FORK_RPC=http://127.0.0.1:8602 node scripts/fork-market.ts` (39 checks print PASS, plus one INFO line; the script reverts the fork afterwards). SDK: `sdk/src/tapeout/market.ts`.

### 9.1 What exists on X Layer

| What | Address | Evidence |
|---|---|---|
| Circuit market (UUPS proxy) | `0xd89f358c48a7B632c9845af2a02A32eB90DD75DB` | 130-byte EIP-1967 proxy; `factory()` = TapeOut factory; owner `0xB3D8…3138`; `isSealed() = false` |
| Circuit market impl | `0x38d688F4793a9Bf270c2c99492c9a1e45163dB6E` | EIP-1967 slot; 27 selectors, all matching the BSC circuit-market ABI |
| Transistor order book (asks/bids) | **none** | see below |

* **The TapeOut client does not know about the X Layer market.** In `main.js` the chain-56 config has `market`, `askMarket`, `circuitMarket`, but the chain-196 config is `features: { containers: true }` only, and every market module is hard-wired to chain 56 (`jt = 56`, `Ht = 56`). So listings on X Layer will not show in TapeOut's own UI today; Cerebr must render them.
* How it was found: the factory was created in block 70,995,047 by `0x571d…aF15` (the protocolWallet). Enumerating that deployer's CREATE addresses (nonce 0 to 66) gives the transistor and circuit impls (0, 1), the factory impl and proxy (2, 3), **the circuit market impl and proxy (4, 5, proxy code from block 70,995,076)**, payments, the account beacon and impl, the opener, containers and the BEM OFT/rigs. None of them exposes `placeAsk`/`placeBid`/`asks`/`bids`. The BSC market addresses (`0x6feE…B46f`, `0xA6a8…16E4`) have no code on X Layer. **There is no TapeOut transistor market on X Layer**, so transistors can only be traded peer to peer (ERC-1155 transfers) or by minting.
* Unused so far: `nextListingId()` was 0 on mainnet. The same proxy address also has code on Base.

### 9.2 Interface (fork-verified)

* `list(circuits, tokenId, uint96 price) returns (uint256 id)`. **Approval-based, not escrow**: the NFT stays in the seller's wallet. Requires `approve(market, id)` or `setApprovalForAll(market, true)`, otherwise it reverts `"not approved"`. Non-owner: `"not owner"`. Zero price: `"zero price"`. Ids start at 1. Listing the same NFT again replaces the earlier listing (the old id is cleared).
* `listingFor(circuits, tokenId) -> (id, seller, price, valid)`, `listingOf(circuits, tokenId) -> id`, `listingView(id) -> (seller, circuits, tokenId, price, feeBps, valid)`, `listings(id)`, `nextListingId()`. A cleared listing reads as all zeros.
* `valid` is true only while the seller still owns the NFT **and** the market is still approved. After a transfer or `setApprovalForAll(market,false)` it is false. **If the NFT comes back to the seller, the old listing becomes valid again at the old price**, so sellers should cancel explicitly.
* `buy(id, uint96 expectedPrice) payable`: msg.value must equal the price exactly (`"wrong value"` for under- or overpayment), and `expectedPrice` must equal the current price (`"price changed"`), which guards against a `setPrice` front-run. **The seller cannot buy their own listing (`"own listing"`).** A stale listing reverts `ERC721InsufficientApproval` (`0x177e802f`). A sold or delisted id reverts.
* `setPrice(id, price)`: seller only (`"not your listing"`); emits `PriceChanged`.
* `delist(id)`: seller only. `delistStale(id)`: **anyone**, only for an invalid listing. Both emit `Delisted(id, by, stale)`.
* Fees: `feeBps() = 100` (1%), `MAX_FEE_BPS() = 300`, owner-settable via `setFeeBps`. **The fee is snapshotted into each listing** (the fork raised the global fee to 300 after listing, and the sale still charged 100). On `buy`, the seller is **paid in the same transaction** (`price - floor(price*feeBps/10000)`), and the fee stays in the market as `owed(protocolWallet)` (pulled with `withdraw()`). There is no `feeRecipient()` (it reverts).
* Events: `Listed 0x723f7333…`, `Sold 0x2938a0a3…` (`paidToSeller`, `fee`), `PriceChanged 0x8aa4fa52…`, `Delisted 0xd42ab404…`. The X Layer RPC caps `eth_getLogs` at 100 blocks, so read listings by NFT (`listingFor` via multicall) instead of scanning.

### 9.3 Fork evidence (circuit #15 of Cerebr, `0xB04E…93FF`)

* The creator `0xc742…960C` approved and listed #15 at 0.01 OKB (listing id 1), repriced it to 0.012, and a separate synthetic buyer bought it with `expectedPrice = 0.012`. Before that, buying at the old 0.01 reverted `"price changed"`. `ownerOf(15)` became the buyer. The seller balance rose by exactly 0.01188 OKB, and `owed(protocolWallet)` and the market balance rose by 0.00012 OKB.
* Brain wallet `0xd8cA…9E23` (opened on the fork only): `owner()` was the creator before the sale and the buyer after it. **The native account and everything in it go to the buyer.**
* The buyer relisted (with `setApprovalForAll`), delisted, listed twice (the first id was cleared), transferred the NFT away (listing `valid=false`, buy reverted), transferred it back (valid again), transferred it away again, and a third party cleared it with `delistStale`. Revoking approval also invalidated a listing.
* Gas: `approve` 56,340; `setApprovalForAll` 54,375; `list` 219,914 (first listing ever) / 198,756; `setPrice` 37,755; `buy` 118,315; `delist` 47,108; `delistStale` 58,170. At about 0.02 gwei each costs well under 0.00001 OKB.

### 9.4 Cerebr policy: no self-trading

The hackathon voids self-trading (wash trading). **Cerebr will never trade with itself**: the creator wallet and any Cerebr-controlled wallet must never buy Cerebr listings, fund buyers, or relist to inflate volume. The contract already rejects `buy` from the listing's seller (`"own listing"`), but a second wallet would get through, so this is a policy, not just a guard. The UI must:
* hide or disable Buy when the connected wallet is the seller (`buyBlockReason(...) === 'own-listing'`, also enforced in `buyListing`);
* hide Buy on stale listings and offer `delistStale` instead;
* always pass the displayed price as `expectedPrice`, and on `"price changed"` re-read and re-confirm;
* warn before a sale that the circuit's brain wallet and its balance go to the buyer, and suggest the seller empty it first;
* warn sellers that listings survive transfers and re-activate if the NFT comes back, and offer Cancel.

## 10. Drops (transistor airdrops, Genesis Drop)

Verified on 2026-10-06 against mainnet reads, TapeOut's live client, and an anvil fork at block 72,514,975 (`anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8601`). Nothing was broadcast.

### 10.1 TapeOut has no shared drops contract on X Layer

* TapeOut's drops contract (the "Airdrop" or 空投 pool) exists **only on BNB Chain**: `0x7Fd055496b638aD81f58B33Fd04d6e90bbC2a672` (chainId 56, `factory()` = `0x68224F…F7e2`, `nextDropId()` = 131 on 2026-10-06). It is not a proxy: all three EIP-1967 slots are zero. TapeOut describes it as having no owner, no upgrade path, no pause and no fee.
* Evidence that X Layer has none:
  1. In the client bundle (`tapeout.net` → `index-BUCYPwtS.js`, identical to our saved `main.js`), only the BSC chain config has an `airdrop:` address. The X Layer config (`id:196`) has `features:{containers:!0}` and no `airdrop`. The drops page hardcodes chain 56 (`const _r=56 … Kx=()=>Te(_r)`, then `Kx().airdrop`).
  2. The newer `/app` bundle (`/assets/index-BN6fIJi7.js`, with chunks `Airdrop-*.js` and `chain-*.js`) also sets `airdrop` only on the BSC `DEPLOYMENT`.
  3. `cast code 0x7Fd0…a672 --rpc-url https://rpc.xlayer.tech` returns `0x`.
  4. A `DropCreated` topic scan (`0x75fa255e…c3f8`) over all of X Layer from the factory block 70,995,047 to 72,514,406 matched 0 logs from any contract. It used TapeOut's `/rpc-xlayer` log node with 10k-block ranges, and the same scan found 298 `CPUCreated` logs, which shows the scan works.
* TapeOut publishes the contract's creation code in its client (`/assets/artifacts-BZhnQij0.js`, `Airdrop.{abi,bytecode}`, used by its "DeployAirdrop" page). Its only constructor argument is the factory. **When deployed on the fork with the BSC factory as the argument, it reproduced the BSC runtime byte for byte**, so it is the same contract. Deployed with the X Layer factory `0x1f09…0761`, it works unchanged against X Layer CPUs. The runtime codehash is `0xcda21775…229d` for the X Layer instance and `0x5d887615…454a` for BSC. The creation code hash is `0xe461553c…6c04`.
* **To run a Genesis Drop on X Layer, Cerebr had to deploy this exact contract once** (`deployDrops()`, 1,346,828 gas), because no shared instance exists. It did so on 2026-10-06: the Cerebr creator deployed the ownerless instance [`0xf037a5543f19619a2291009ae1542b71d50ff9b9`](https://www.okx.com/web3/explorer/xlayer/address/0xf037a5543f19619a2291009ae1542b71d50ff9b9) (tx [0xd0f4…8e02](https://www.okx.com/web3/explorer/xlayer/tx/0xd0f4367fc525a3500658953c334adafbe490b16040e71cdbab6f8ad3bfcb8e02), block 72,516,039, 1,346,828 gas, `factory()` = `0x1f09…0761`, runtime codehash `0xcda21775…229d`). The topic scan above predates it. TapeOut's own UI will not show X Layer drops, since its drops page reads chain 56 only. Cerebr's app lists them with `listDrops()`.

### 10.2 Interface (selectors match `cast selectors` on the BSC bytecode)

* `create(address transistors, uint8 tokenId, uint256 amount, uint96 perClaim) returns (uint256 dropId)`
  * Pulls `amount` from msg.sender with ERC-1155 `safeTransferFrom`, so **`setApprovalForAll(drops, true)` on the transistors contract is required first**. Without it the call reverts `ERC1155MissingApprovalForAll` (`0xe237d922`).
  * Reverts: `"perClaim = 0"`, `"amount < perClaim"`, `"bad tokenId"` (only 0 = NAND and 1 = LATCH are accepted), and `ERC1155InsufficientBalance`. A non-transistors address (no code, a circuits contract, or the factory) reverts without data.
  * `amount` does not have to be a multiple of `perClaim`. The remainder is dust that only `cancel` returns.
  * Gas: 196,300 for the first drop on a contract and 179,188 afterwards. Approval costs 54,395 and revoking it costs 32,483.
* `claim(uint256 dropId)`
  * **Any address, once per drop**, receives exactly `perClaim`. Gas: 101,583.
  * There is **no allowlist, signature, captcha, cooldown, or fee.** The only limit is one claim per address per drop, so the drop is sybil-able.
  * Reverts: `"no drop"`, `"cancelled"`, `"already claimed"`, and `"drained"` (when `remaining < perClaim`).
  * Contract claimers without `onERC1155Received` revert `ERC1155InvalidReceiver` (`0x57f447ce`). ERC-6551 brain wallets do implement the receiver.
  * The creator can claim their own drop.
* `cancel(uint256 dropId)` and `cancelTo(uint256 dropId, address to)`
  * Creator only (`"not creator"`) and only once (`"already cancelled"`).
  * Refunds all of `remaining`, dust included, to the creator or to `to`. Gas: 59,296.
  * Nothing else can withdraw funds from the contract.
* Views:
  * `drops(id) → (creator, perClaim, transistors, tokenId, cancelled, remaining, claimedCount)`
  * `nextDropId()`: **the last assigned id** (= the drop count). Ids start at 1.
  * `getDrops(from, count) → (ids, Drop[])`: clamps to the existing range. TapeOut pages it 100 at a time.
  * `claimed(id, who)`
  * `claimedBy(who, ids[]) → bool[]`
  * `factory()`
* Events:
  * `DropCreated(uint256 indexed dropId, address indexed creator, address indexed transistors, uint8 tokenId, uint256 amount, uint96 perClaim)`
  * `Claimed(uint256 indexed dropId, address indexed who, uint256 amount)`
  * `DropCancelled(uint256 indexed dropId, uint256 refunded)`
* Direct ERC-1155 transfers into the contract revert `"direct transfer not accepted"`.

### 10.3 Fork evidence (`cd sdk && FORK_RPC=http://127.0.0.1:8601 node scripts/fork-drop.ts`: 35 checks, all PASS)

1. Deploy (1,346,828 gas, `verifyDrops` ok).
2. The impersonated Cerebr creator `0xc742…960C` (994 NAND) approves and creates **400 NAND at 16 per claim** (dropId 1, 25 shares).
3. Three fresh addresses claim 16 each. A double claim, a cancel by a stranger, an unknown id, a contract claimer and a direct transfer all revert as listed above.
4. A claimer holding only the 16 claimed NAND tapes out the **Genesis Neuron**, `y = [e0+e1+e2 − 2·inhibit ≥ 1]`. It is `thresholdNeuronCircuit([-2,1,1,1], 1)`: exactly 16 NAND, with all 16 cases verified locally. It became Cerebr circuit #16 on the fork, with 264,291 gas and the claimer's NAND balance back to 0. The claimer paid exactly `TAPEOUT_FEE` (0.0013 OKB) plus gas. The onchain truth table matched.
5. The creator cancels and gets back 352. A claim after the cancel reverts `"cancelled"`.
6. A 20/16 drop leaves dust of 4. The second claim reverts `"drained"`, and `cancelTo` returns the 4. With `revokeApproval: true` the approval is cleared.

### 10.4 SDK (`sdk/src/tapeout/drops.ts`)

* Constants:
  * `XLAYER_DROPS` (set to `0xf037…f9b9` since the 2026-10-06 mainnet deploy) and `BSC_DROPS`
  * the codehashes, `DROPS_CREATION_CODE`
  * `dropsAbi` and `erc1155ApprovalAbi` (typed `as const`)
  * `DROP_ERRORS`
* Pure helpers: `dropShares`, `planDrop`, `toDrop`, `dropsDeployData`, `explainDropError`, `requireDrops`.
* Reads:
  * `dropCount`
  * `readDrop`
  * `listDrops({ transistors, creator, liveOnly, limit })`: uses `nextDropId` and `getDrops`, with no `eth_getLogs`
  * `hasClaimed`, `claimedBy`
  * `verifyDrops`: checks code, `factory()` and the codehash
* Writes:
  * `deployDrops`
  * `createDrop`: approves if needed, with optional `revokeApproval`
  * `claimDrop`
  * `cancelDrop({ to })`: uses `cancelTo` when `to` is given

### 10.5 Costs (X Layer gas ~0.02 gwei)

| Who | What | Cost |
|---|---|---|
| Cerebr, once | deploy drops | 1.35M gas ≈ 0.000027 OKB |
| Creator, per drop | approve (first time) + create | 0.25M gas ≈ 0.000005 OKB |
| New user | claim | 0.10M gas ≈ 0.000002 OKB |
| New user | tape out a 16-NAND neuron | 0.0013 OKB fee + ~0.26M gas ≈ 0.0013053 OKB |

There are no drop fees. The only cost to the creator is the NAND given away, worth `mintPrice` = 0.00001 OKB each. Because `mintPrice` is paid to the creator through `withdraw()`, the creator can re-mint NAND for just the 0.00066 OKB protocol fee per mint call.

### 10.6 Genesis Drop: mainnet steps (executed 2026-10-06; only the user signs)

Done on mainnet by the creator: deploy [0xd0f4…8e02](https://www.okx.com/web3/explorer/xlayer/tx/0xd0f4367fc525a3500658953c334adafbe490b16040e71cdbab6f8ad3bfcb8e02) (block 72,516,039), approval [0x2fba…1eaf](https://www.okx.com/web3/explorer/xlayer/tx/0x2fbaaaec60be0aef742d758e1b51d1cb5212d9d83c09639f6a1afae5c0791eaf) (block 72,516,045), `create(0x84b5…2D2D, 0, 400, 16)` [0x2d7c…8f20](https://www.okx.com/web3/explorer/xlayer/tx/0x2d7c052914b7e7a441b721ed025ce7e9bf832fb9804b85b885e6160ab1598f20) (block 72,516,049, dropId 1, 196,300 gas) and approval revoked [0x4242…f708](https://www.okx.com/web3/explorer/xlayer/tx/0x42424e51b9044008a39f98c4506241e746fad4853a7a9100fb05aec5d851f708) (block 72,516,053). The first claim is a Cerebr team test wallet, `0xcd0a…3c02` ([0x4d18…2db6](https://www.okx.com/web3/explorer/xlayer/tx/0x4d186077dfab5eb3f5c25e0876d549ef9367ac1ac385105939928cde91ec2db6), block 72,527,608); a second team test claim followed from a teammate's wallet `0xebb9…c426` ([0x55e0…8a7a](https://www.okx.com/web3/explorer/xlayer/tx/0x55e03413c3dd05cbeff2b17aa0104acbd9030f531fe70e0544ec6e36078d8a7a)); at time of writing drop #1 has 2 claims and 368 NAND remaining. The steps as planned:

1. Rehearse with `scripts/fork-drop.ts`.
2. Deploy: send a transaction with data `dropsDeployData(XLAYER.factory)`, value 0 and about 1.35M gas, from any key (the contract has no owner). Check the deployment with `verifyDrops(pc, addr)` (codehash `0xcda21775…229d`). Then set `XLAYER_DROPS` in `drops.ts`.
3. From the creator `0xc742…960C`, call `transistors(0x84b5…2D2D).setApprovalForAll(drops, true)` (54k gas).
4. From the creator, call `drops.create(0x84b5…2D2D, 0, 400, 16)` (196k gas). The result is dropId 1 with 25 claims.
5. Optionally, call `setApprovalForAll(drops, false)` (32k gas). With `createDrop` this is `revokeApproval: true`.
6. Monitor with `readDrop`. Use `cancelDrop` to reclaim the rest, then create the next tranche.
