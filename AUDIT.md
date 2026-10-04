# Cerebr Security Review

This is an internal review for the IGNIX X Layer TapeOut hackathon. It was done by independent AI review agents plus automated testing. **It is not a professional third-party audit.** Read the [known risks and trust assumptions](#known-risks-and-trust-assumptions) before you put real value into the contracts.

## Scope

| File | Purpose | Runtime size |
|---|---|---|
| `src/CerebrProcessor.sol` | $CBR ERC-20, linear bonding curve (buy/sell), tape-out and fusion sinks, fair-launch guard, fees | 9,318 B |
| `src/CerebrCircuit.sol` | Circuit ERC-721: tiers, commit-reveal traits, FIFO auto-reveal queue, on-chain SVG/JSON, fusion, TBA cycle and operator guards | 15,395 B |
| `src/erc6551/CerebrAccount.sol` | ERC-6551 token-bound account implementation ("brain wallet") | 3,167 B |
| `src/erc6551/ERC6551Registry.sol` | Vendored reference ERC-6551 registry (testnet and local only; mainnet uses the canonical one) | 551 B |
| `src/erc6551/IERC6551*.sol` | Interfaces | — |
| `src/CerebrLens.sol` | Read-only helper for the dApp (quotes, snapshots, curve points) | 10,975 B |

Toolchain: solc 0.8.28, `evm_version = cancun`, optimizer with 200 runs, OpenZeppelin Contracts v5.7.0, forge-std v1.17.0, Foundry 1.7.1.

Out of scope: `script/`, `app/`, `indexer/`, and the X Layer chain and sequencer themselves.

## Methodology

1. **Independent multi-agent reviews.** Each round, several agents reviewed the code on their own, each with a different focus:
   - Round 1: security, curve math, spec and gas.
   - Round 2: security (including ERC-6551) and economics and gas.
   
   Every finding came with a concrete exploit scenario, and most were reproduced in throwaway scratch tests (since deleted). An integrator then checked each finding against the code, fixed it or rejected it with reasons, and added a regression test for every fix.
2. **Unit tests** for every function, revert path, event and boundary.
3. **Fuzz tests**, 1,000 runs each:
   - curve math against a reference model
   - rounding direction
   - `quoteBuyExactOKB` optimality on random curves
   - trait ranges per tier
   - the launch-cap reference model, including sells
   - the vendored registry checked against the canonical registry bytecode fetched from X Layer mainnet
4. **Stateful invariant testing.** Two suites (fair launch off, and fair launch on) each run 256 runs × depth 50, which is 12,800 calls per invariant, with `fail-on-revert = true`. The handler mixes these actions:
   - buys, sells and round trips
   - tiered tape-outs and Singularity attempts
   - reveals, including expiry and re-commit
   - permissionless reveal-queue pokes; **every** buy, sell, tape-out, fusion and poke is checked against an independent FIFO model of the auto-reveal queue (exact ids revealed / re-committed, seeds, head)
   - fusions, invalid fusions and **recycled-parent fusions**
   - nesting into token-bound accounts (TBAs), un-nesting, and **operator pulls from TBAs**
   - fee withdrawals, pause toggles, attacker withdrawals and block advances

   A third suite (`CerebrRevealLivenessInvariantTest`) drives ongoing activity only (a buy, tape-out or fusion at least every 64 blocks, with sells mixed in) and checks that no Circuit ever expires or re-commits.
5. **Live-chain checks (read-only RPC only; nothing was ever broadcast to a public chain):**
   - Cancun opcodes (`MCOPY`, `TSTORE`/`TLOAD`) work on X Layer 196 and 1952.
   - `blockhash(n-1)` and `blockhash(n-2)` are non-zero on both chains.
   - The canonical ERC-6551 registry is deployed on 196 and is missing on 1952.
   - Blocks are about 1.0 s apart (1,000 blocks took 1,000 s on both chains).
6. **End-to-end run on local anvil:**
   - `script/LocalDemo.s.sol` deploys the contracts and seeds activity.
   - `app/scripts/smoke.ts` runs 33 checks through the dApp's own ABIs and config.
   - `app/scripts/keeper.ts` reveals every ready Circuit (now an optional backup; see 2-6).

## Core invariant

`address(processor).balance >= reserveRequired() + protocolFees` holds after every operation.

- Buys round each of the two curve terms **up**. Sells round each term **down**.
- `ceil` is superadditive and `floor(X−Y) ≤ ceil(X) − ceil(Y)`, so no sequence of buys and sells can leave the curve under-collateralised.
- Sink burns (tape-out and fusion) only increase the surplus.
- The owner can withdraw `protocolFees` and nothing else.

## Round 1 findings (base protocol)

| # | Severity | Finding | Status |
|---|---|---|---|
| 1-1 | Low | Tape-out rarity could be gamed by reverting a bad result and retrying, or by grinding addresses. | **Fixed in round 2.** Traits now use commit-reveal: the seed comes from the hash of the block after the mint, so it is unknown when the mint transaction runs. |
| 1-2 | Low/Med | `renounceOwnership` could strand fees and freeze the pause state. | **Fixed.** It always reverts with `RenounceDisabled`. |
| 1-3 | Low | Slippage limits can't stop a sandwich, and there is no deadline parameter. | **Accepted.** Trades are bounded by `maxCost`/`minRefund` and the 1% fee, and X Layer has a single sequencer. The dApp sets tight bounds from the quotes. |
| 1-4 | Info | `surplusReserve()` reads high if called during the buy-refund callback (read-only reentrancy). | **Documented** in NatSpec. No consumer is affected. |
| 1-5 | Info | OKB force-sent to the processor inflates `surplusReserve`. | **Documented.** |
| 1-6 | Info | `MAX_SUPPLY` caps circulating supply, not lifetime minted supply. | **Documented** as "max circulating supply". |
| 1-7 | Info | Constructor curve parameters have no upper bound. | **Fixed in round 2.** `basePrice` and `slope` must each be ≤ `MAX_CURVE_PARAM` (1e36). |
| 1-8 | Info | `_mint` is used instead of `_safeMint`. | **Kept on purpose.** Skipping the receiver callback leaves no reentrancy or reroll surface. |
| 1-9..12 | Info | Curve integral, units, overflow bounds and dust-sell rounding. | Verified correct. Dust sells favour the reserve. |
| 1-13 | Medium | `evm_version = cancun` emits `MCOPY`. | **Resolved.** Live probes confirm Cancun support on both X Layer chains. |
| 1-14..17 | Low | NatSpec format, a duplicate external call, events missing `newSupply`, a redundant balance pre-check. | Fixed, or kept on purpose with a comment in the code. |
| 1-18 | Info | Use `ReentrancyGuardTransient`. | **Done in round 2**, after TSTORE was confirmed on X Layer. |
| 1-19..21 | Info | Error and event NatSpec, missing `contractURI`, numeric traits, tokenomics wording. | **Fixed.** |

## Round 2 findings (tiers, fusion, commit-reveal, fair launch, ERC-6551, Lens)

Duplicate reports from the two review agents are merged into one row.

| # | Severity | Finding | Status |
|---|---|---|---|
| 2-1 | **High** | **Fusion recycling.** The child's owner could pull both parents back out of the child's TBA and fuse them again, any number of times. One pair of Basics produced a new Pro for 5k CBR each time (a direct Pro costs 20k), and Singularity supply had no limit. | **Fixed.** `CerebrCircuit.fusedInto[id]` records the child a Circuit was fused into, and `fuse` reverts `AlreadyFused(id)` for any used parent. Parents still go into the child's TBA and can be withdrawn from it (so the spec's recoverability holds), but they can never be fused again. The fused state is shown in `tokenURI` ("Fused Into #N"), in `CerebrLens.CircuitView.fusedInto`, in the subgraph and in the dApp. Tests: `test_RecycledParentsCannotBeFusedAgain` (real `CerebrAccount`), `test_FusedParentsRecoverableByChildTba`, `test_FusedIntoMarksParentsAndMetadata`, the invariant handler `refuse` and the invariant `invariant_FusedOnce`. |
| 2-2 | Medium | **Approvals made by a TBA outlive a sale.** A seller could `setApprovalForAll` from the child's TBA, sell the child, then pull the parents out as an operator. The TBA's `state` would not change, so an order bound to `state` gave the buyer no protection. | **Fixed for Circuits.** `CerebrCircuit._update` reverts `AccountOperatorTransfer` when a Circuit held by a canonical Circuit TBA is moved by anyone other than that TBA (`auth != from`). Any move out of a TBA must therefore go through `execute`, which bumps `state`. Internal fusion moves pass `auth = 0`. ERC-20 and ERC-1155 approvals made by a TBA still survive a sale; this is documented below and in the dApp README. Tests: `test_SellerApprovalFromWalletCannotDrainAfterSale`, `test_TbaApprovedOperatorCannotMoveCircuits`, invariant handler `operatorPull`. |
| 2-3 | Medium | **Sell, burn, rebuy.** A holder can sell x CBR, tape out, then buy x back. The burn then happens at a lower point on the curve, so the holder recovers about `SLOPE·T·x/1e36` of the surplus, minus the 1% fee. | **Accepted and documented.** The surplus is OKB that no one can ever claim. Recovering part of it takes nothing from any other holder: the sell price depends only on supply, solvency still holds, and the end state is the same apart from the dead surplus. NatSpec and TOKENOMICS now say the surplus a burn adds is a lower bound, set at the supply when the burn runs. A structural fix (pricing on cumulative minted supply) would change the economic model. |
| 2-4 | Medium | **Fusion is cheaper than a direct tape-out.** A Pro by fusion costs 15k CBR against 20k direct; a Quantum costs 50k against 100k. | **Open decision for the owner.** Both prices are in the agreed spec. Direct tape-out is currently a convenience premium: no reveal wait, and no parents locked in a wallet. See the open decisions in README. |
| 2-5 | Low | **Launch-cap griefing.** An atomic buy then sell from 4 wallets could fill the global block cap for about 0.002–0.006 OKB per block, locking out every other buyer. The defaults also let the window absorb 18× `MAX_SUPPLY`. | **Fixed.** The caps now count **net** buys: during the window, a sell gives back the seller's and the block's same-block usage. The release saturates at zero and never reverts, so sells are still never blocked. Default parameters are re-chosen against measured 1 s blocks (see DEPLOY.md): the window can absorb at most 90% of supply, and the cheapest 10% needs at least 400 blocks. Tests: `test_LaunchAtomicRoundTripCannotFillBlockCap`, `test_LaunchSellsAndTapeOutsUncappedAndSellsNetCap`, the fuzz reference model (now with sells), and the handler `roundTrip` assertion. |
| 2-6 | Low | **Reveal grinding.** An owner can wait out the 256-block blockhash window (about 4.3 minutes at 1 s blocks) to force a re-commit, which re-rolls the traits. | **Fixed on-chain (round 3).** A FIFO auto-reveal queue in `CerebrCircuit`: every tape-out and fusion settles up to 2 ready sealed Circuits, every buy up to 1, so while the protocol is in use no Circuit can outlive its window. `reveal` stays permissionless; `app/scripts/keeper.ts` and the dApp's "Reveal all ready" button are now an optional backup for quiet periods. Details in [Auto-reveal queue](#auto-reveal-queue-round-3-fix-for-2-6). Tests: `test/CerebrAutoReveal.t.sol` (19, including a reference-model fuzz and a liveness fuzz), the handler's FIFO model check on every action, `invariant_RevealQueue` and the liveness suite. |
| 2-7 | Low | **ERC-1271 replay.** The TBA accepts any valid owner signature, so signatures that don't name the owner (for example Permit2 `PermitSingle`) can be replayed against the TBA if it approved Permit2. | **Documented.** TBAs should not approve Permit2. A nested EIP-712 wrapper (ERC-7739) would break naive verifiers. |
| 2-8 | Low | **Lens overflow.** `quoteBuyExactOKB` overflowed for curve parameters the processor accepted (slope > 1.45e40). | **Fixed.** The processor constructor now rejects `basePrice` or `slope` above 1e36, and the Lens NatSpec states that limit. Test: `test_CurveParamsUpperBound`. |
| 2-9 | Info | **Non-canonical cycles.** Cycle protection covers only canonical TBAs (salt 0, Cerebr implementation). An owner can lock their own Circuits through a TBA with a different salt or implementation. | **Documented.** Only the owner of both tokens can do this, and only to themselves. The dApp uses only canonical TBAs. |
| 2-10 | Info | Gas figures and optional storage packing (seed inside `CircuitInfo`, redundant `totalMinted`). | **Not applied.** Under the security > simplicity > gas order the gain was too small. |
| 2-11 | Info | Clean areas: solvency, reentrancy, access control, pause scope, fusion authorization, account `execute`, commit-reveal source. Spec conformance checked. | No action needed. |

No `testBUG_` tests remained after the fixes.

## Auto-reveal queue (round 3, fix for 2-6)

**Design.** Circuit ids are minted in order, so the queue of sealed Circuits needs no array: one cursor, `_revealedPrefix`, packed with `totalMinted` in a single slot (every id at or below it is revealed; `revealQueueHead()` is the next id). `_settleQueue(k)` walks from the head:

- an id that is already revealed (someone called `reveal`) is stepped over, at most `AUTO_REVEAL_MAX_SKIPS` (4) per call;
- a sealed id whose hash is available is revealed exactly as `reveal(id)` would (same seed formula, same `CircuitRevealed` event);
- a sealed id whose hash expired (or is zero) re-commits exactly as `reveal(id)` would (`Recommitted`), and the walk continues so ready Circuits behind it are not skipped; the cursor stays on the re-committed id until it is revealed;
- the walk **stops at the first sealed id that is not ready yet** (FIFO, nothing ready is ever skipped), and after `k` settles or `k + 4` ids.

| Caller | Settles (`k`) | Why |
|---|---|---|
| `tapeOutCircuit`, `tapeOutCircuitTier` (inside `CerebrCircuit.mint`) | 2 | Each mint adds one Circuit and can clear two, so mints alone keep up with mints. |
| `fuseCircuits` (inside `CerebrCircuit.fuse`, before the parent checks) | 2 | Same; it can also reveal ready parents just in time for the fusion. |
| `buyTransistors` | 1 | Keeps the queue moving during trade-only periods. Cost on an empty queue is ~5.4k gas (one cold call + one cold slot); the reveal itself is the ~31k someone had to pay anyway. |
| `sellTransistors` | 0 | The exit path stays exactly as audited: it never calls the Circuit contract, so no new code can affect a sell. |
| `processRevealQueue(k)` (anyone) | `k` | Batch entry point for keepers; `k` is clamped to the queue length. |

**Safety.** `_settleQueue` makes no external calls and has no revert paths (only storage writes, events and bounded checked arithmetic, with `k` clamped before `k + 4`), so it can never make a tape-out, fusion or buy revert; gas is strictly bounded by `k` reveals plus 4 cold reads. A new Circuit can never be revealed in its own mint (its hash is two blocks away). Settling in someone else's transaction reveals nothing the owner can exploit: the seed was fixed at `commitBlock + 1`, and reverting the outer transaction does not change it. `reveal(id)` is unchanged and idempotent with the queue: the queue steps over ids revealed manually and `reveal` keeps reverting `AlreadyRevealed` for ids the queue revealed. No public function, event or error was removed or changed; `totalMinted()` keeps its signature.

**Residual risk.** A re-roll is now possible only if no buy, tape-out or fusion happens for the whole window (256 blocks, about 4.3 minutes) while the Circuit is ready, or while the protocol is paused (then mints and buys stop; `reveal` and `processRevealQueue` stay open). A burst of N mints in one block needs about N/2 later actions to drain. Running the keeper during quiet periods or pauses still closes that gap.

**Gas estimation (found during integration).** Queue cost depends on how many Circuits are ready in the *inclusion* block. A gas estimate runs against the current block, and the transaction lands at least one block later, when another Circuit may have become ready. An unpadded estimate can therefore run out of gas. This reproduces even on a quiet local chain. Clients must pad the gas limit for `buyTransistors`, `tapeOutCircuit`, `tapeOutCircuitTier`, `fuseCircuits` and `processRevealQueue` by at least the bounded worst case: **+80,000 gas** covers 2 reveals plus 4 skips (about 72k). The dApp (`app/src/hooks/useTx.ts`), the smoke test and the local demo script all do this. Integrators calling the contracts directly must do the same.

## Invariants (stateful, 256 runs × 50 depth, `fail-on-revert`)

All 15 invariants pass in both suites: `CerebrInvariantTest` (launch guard off) and `CerebrLaunchInvariantTest` (1,000,000-block window, 30k wallet cap, 120k block cap). Both invariants of the liveness suite `CerebrRevealLivenessInvariantTest` pass too. Each invariant ran 12,800 calls with 0 reverts.

| Invariant | Property |
|---|---|
| `Solvent` | `balance ≥ reserveRequired() + protocolFees` |
| `BalanceAccounting` | Processor OKB balance equals paid-in − paid-out − fees withdrawn, exactly |
| `SupplyCap` | `totalSupply ≤ MAX_SUPPLY` |
| `BalancesSumToSupply` | The sum of actor balances equals `totalSupply` |
| `PriceConsistent` | `currentPrice == BASE_PRICE + SLOPE·supply/1e18` |
| `CircuitCount` | `totalMinted` equals tape-outs + fusions |
| `BurnCounter` | `totalCbrBurned` equals the CBR burned by tape-outs and fusions; sells are excluded |
| `TierCounts` | `mintedByTier` matches the ghost counts and the stored tiers, and sums to `totalMinted`; every Singularity came from a fusion |
| `NoZeroOwner` | Ids 1..n are owned; ids 0 and n+1 are not |
| `NoOwnershipCycles` | Every TBA ownership chain ends at a plain address, and the reverse TBA lookup is consistent |
| `RevealConsistency` | Revealed ⇔ seed ≠ 0; sealed Circuits expose only their tier |
| `SurplusFromSinks` | After any sink burn, surplus > 0 |
| `FusedOnce` *(new)* | Fused parents = 2 × fusions; each parent is older than its child, and the child is exactly one tier higher |
| `LaunchCaps` | Net same-block buys never exceed the wallet or block cap |
| `RevealQueue` *(new)* | Every id below `revealQueueHead()` is revealed, and the head never passes `totalMinted + 1` |
| `NoExpiryUnderActivity` *(liveness suite)* | With a buy, tape-out or fusion at least every 64 blocks, no Circuit ever re-commits, no sealed Circuit's hash expires, and no ready Circuit waits more than 128 blocks |
| `LivenessQueueHead` *(liveness suite)* | Same head consistency as `RevealQueue` |

The handler also asserts these properties inline on every call:

- No round-trip arbitrage.
- The excess payment is refunded.
- Price moves the right way on every buy and sell.
- The owner can take fees only.
- A buy of the remaining launch cap + 1 always reverts with the exact error.
- Recycled parents always revert `AlreadyFused` and change nothing.
- Operator pulls out of a TBA always revert `AccountOperatorTransfer`.
- Nesting outcomes (ok / cycle / too deep) match an independent model.
- Every buy, sell, tape-out, fusion and queue poke settles exactly the Circuits an independent FIFO model predicts (reveal vs re-commit, seed, untouched ids, new head). Sells settle nothing.

## Test results

`forge test`: **219 passed, 0 failed** across 9 suites.

| Suite | Tests |
|---|---|
| `CerebrProcessor.t.sol` (unit) | 54 |
| `CerebrFuzz.t.sol` | 21 |
| `CerebrFeatures.t.sol` (tiers, fusion, reveal, launch, counters, nesting) | 64 |
| `CerebrAccount.t.sol` (ERC-6551) | 18 |
| `CerebrLens.t.sol` | 11 |
| `CerebrAutoReveal.t.sol` (queue: FIFO, bounds, expiry, manual-reveal interplay, model fuzz, liveness fuzz, gas bound) | 19 |
| `CerebrInvariant.t.sol` (2 suites × 15, plus the 2-invariant liveness suite) | 32 |

## Coverage (`forge coverage --report summary`, src only)

| File | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| `CerebrProcessor.sol` | 100% (130/130) | 100% (176/176) | 100% (26/26) | 100% (26/26) |
| `CerebrCircuit.sol` | 100% (183/183) | 99.6% (238/239) | 98.1% (53/54) | 100% (30/30) |
| `CerebrAccount.sol` | 100% (42/42) | 100% (63/63) | 100% (9/9) | 100% (10/10) |
| `CerebrLens.sol` | 97.1% (100/103) | 96.8% (152/157) | 100% (6/6) | 100% (9/9) |
| `ERC6551Registry.sol` | 82.9% (29/35) | 81.8% (27/33) | 0% (0/2) | 100% (2/2) |
| **Total** | **98.2%** | **98.2%** | **96.9%** | **100%** |

The registry's uncovered branches are in the reference assembly (the create2-failure path). Its behaviour is checked by a differential fuzz test against the canonical mainnet bytecode.

## Gas (`forge test --gas-report`, excluding invariant suites)

Figures include the 21k transaction base (they match anvil receipts, e.g. `reveal` = 53,667). Min values come from reverting test calls. Medians now include auto-reveal work: in the test suites most tape-outs find one ready Circuit to reveal.

| Function | Median | Max | Notes |
|---|---|---|---|
| `buyTransistors` | 80.4k | 133.8k | Max is the first buy inside the launch window (new usage slots); includes up to 1 auto-reveal |
| `sellTransistors` | 47.0k | 80.2k | Unchanged: sells never touch the queue |
| `tapeOutCircuit` (Basic) | 168.7k | 208.3k | Includes up to 2 auto-reveals |
| `tapeOutCircuitTier` | 196.5k | 206.9k | |
| `fuseCircuits` | 225.9k | 297.0k | Max settles 2 queued Circuits |
| `reveal` | 53.7k | 53.7k | +60 gas from the shared internal `_settle` |
| `processRevealQueue` | 24.1k | 122.2k | Permissionless batch reveal; ~31k per Circuit after the first |
| `withdrawFees` | 60.7k | 60.7k | |
| `ERC6551Registry.createAccount` | 94.9k | 94.9k | "Activate brain wallet" |
| `CerebrAccount.execute` | 7.2k + callee | 83.6k | |
| `CerebrLens.quoteBuyExactOKB` (view) | 63.8k | 194.6k | |
| `CerebrLens.protocolState` (view) | 44.1k | 44.1k | |

**Auto-reveal overhead, before vs after** (controlled scenarios, one transaction each, state built in earlier transactions; transaction gas including the 21k base and calldata):

| Scenario | `tapeOutCircuit` | `tapeOutCircuitTier(Pro)` | `fuseCircuits` | `buyTransistors` | `sellTransistors` |
|---|---|---|---|---|---|
| Before (no queue) | 137,551 | 137,977 | 238,502 | 48,395 | 68,899 |
| After, queue empty | 138,038 (+487) | 138,464 (+487) | 238,978 (+476) | 53,818 (+5,423) | 68,899 (0) |
| After, 1 ready Circuit (steady state) | 168,748 (+31,197) | 169,174 (+31,197) | 269,689 (+31,187) | 87,323 (+38,928) | 68,899 (0) |
| After, 2+ ready Circuits | 198,820 (+61,269) | 199,246 (+61,269) | 299,760 (+61,258) | 87,323 (1 settle max) | 68,899 (0) |
| After, 4 manually revealed ids to step over | 148,144 (+10,593) | 148,570 (+10,593) | 245,084 (+6,582) | 66,724 (+18,329) | 68,899 (0) |

Steady state is one reveal per mint, about **+31k** per tape-out or fusion. About 22k of that is the fresh `seedOf` slot, which any reveal must pay. Network-wide this is cheaper than before: a separate keeper `reveal` transaction costs 53.7k. The worst case per call is bounded by 2 reveals + 4 skips for mints (about +72k) and 1 reveal + 4 skips for buys (about +51k). `test_GasOverheadBounded` asserts the bound.

## Known risks and trust assumptions

- **Owner powers.** The owner can:
  - pause and unpause **buys, tape-outs and fusions**
  - withdraw accrued **sell fees** (`protocolFees`)
  - transfer ownership with the two-step flow
  
  The owner **cannot**:
  - touch the curve reserve or the surplus
  - pause sells, reveals or transfers
  - mint CBR or Circuits
  - change curve parameters
  - upgrade anything (there are no proxies)
  - renounce ownership (doing so would strand fees)
- **Sequencer and blockhash randomness.** Trait seeds are `keccak256(blockhash(commitBlock+1), id, chainid, circuit)`. X Layer's single sequencer produces those hashes and could bias them. Traits are cosmetic, and nothing in the protocol pays out based on rarity. Do not build value-bearing mechanics on them without VRF.
- **Reveal timing.** Once `commitBlock+1` is mined, an owner can compute the result off-chain. The auto-reveal queue reveals each Circuit in FIFO order during the next tape-outs, fusions and buys. A re-roll is only possible if no buy, tape-out or fusion reaches the Circuit within 256 blocks (about 4.3 minutes): a quiet period, a pause, or a large same-block burst of mints ahead of it. For those cases run `app/scripts/keeper.ts` (optional backup) or call `processRevealQueue`. If the blockhash comes back zero, the Circuit re-commits; a zero hash is never used.
- **Fair launch is a speed limit, not a sybil filter.** The per-wallet cap can be bypassed with many wallets. The per-block **global** net cap is the real guard. The first buyer in each block still benefits from transaction ordering.
- **Surplus is a lower bound.** See 2-3. The burner chooses the curve point of the burn by selling and rebuying around it.
- **Brain wallets (ERC-6551):**
  - ERC-20 and ERC-1155 approvals granted by a TBA survive a sale of its Circuit. Buyers should check outstanding approvals as well as `state`.
  - A TBA accepts its owner's signatures (ERC-1271), so it should never approve Permit2.
  - Circuit approvals granted by a TBA can no longer move Circuits (2-2).
  - Cycle protection covers canonical TBAs only (2-9).
  - A seller can still drain a TBA through `execute` right before a sale; marketplace orders should be bound to `state`.
- **Canonical registry.** On mainnet the contracts rely on the canonical ERC-6551 registry at `0x000000006551c19487814612e58FE06813775758`. Its runtime bytecode was compared with the vendored reference.
- **Single sequencer and MEV.** Trades are protected only by the `maxCost` and `minRefund` slippage bounds. There is no deadline parameter.
