# Cerebr Security Review

This is an **internal review** for the IGNIX X Layer TapeOut hackathon, done by AI review agents, an integrator who checked every finding against the code, and automated tests on local forks of X Layer mainnet. **It is not a professional third-party audit.** Nothing in this review was broadcast to a public chain, and no real keys were used. The mainnet launch came afterwards (2026-10-05): the launch script's on-chain checks passed for all 14 circuits on X Layer mainnet ([LAUNCH.md](LAUNCH.md#mainnet-launch-record-2026-10-05)).

The earlier $CBR design (bonding curve, Circuit ERC-721, our own ERC-6551 accounts, lens, indexer) has been removed from the repository; its review no longer applies and is not repeated here.

## 1. Scope: what we own vs. what we depend on

**What Cerebr owns (in scope):**

| Component | Path | What could go wrong |
|---|---|---|
| CerebrScope | `src/scope/CerebrScope.sol`, `ITapeOut.sol`, `LibBuffer.sol` (21,019 B runtime) | label-registry authorization, SVG/JSON injection, view gas, malformed-netlist parsing |
| Deploy script | `script/DeployScope.s.sol` | key handling, wrong-chain deploys |
| SDK | `sdk/src/neuro` (compiler, simulator, catalog), `sdk/src/tapeout` (client) | wrong netlists (wasted transistors), wrong `msg.value` (lost OKB) |
| Launch script | `sdk/scripts/launch.ts`, `sdk/scripts/lib/*` | accidental mainnet sends, key leaks, paying twice, launching against upgraded TapeOut code |
| dApp + landing | `app/` | wrong-chain or wrong-value transactions, misleading claims |

**What Cerebr depends on (out of scope, external):** TapeOut's X Layer contracts: the factory (`0x1f09…0761`, an EIP-1967 proxy), the per-processor transistors and circuits contracts (beacon proxies), the opener (`0x536a…0106`) and its native ERC-6551 accounts (canonical registry `0x0000…5758`). TapeOut states they are in a test phase, **upgradeable and unaudited**. Our fork checks (`isSealed() == false`, live `readFees()`) confirm TapeOut's owner can change fees and code at any time, including the logic that enforces our supply cap, unit price, burns and `eval`. Cerebr cannot change any of it. Every TapeOut behaviour we rely on is documented with evidence in [TAPEOUT.md](TAPEOUT.md).

Cerebr deploys **no contract that holds funds** and has **no admin keys**. The processor is a TapeOut CPU; the only value flows are users paying TapeOut directly (mints, tapeouts, account opens) and the creator withdrawing mint revenue from TapeOut.

## 2. Methodology

1. **Fork verification of every TapeOut fact** (`sdk/scripts/fork-smoke.ts`, 18 checks): factory, fees, mint/burn accounting, tapeout rules, REF semantics, eval/step encoding, native accounts. Several facts in TapeOut's client bundle turned out wrong and were corrected (TAPEOUT.md, "corrections").
2. **Compiler cross-checks** (`sdk/test/neuro-*.test.ts`): our encoder, decoder and simulator are compared byte for byte with TapeOut's own shipped client code on hundreds of random chain-valid netlists, including LATCH feedback and REF (on invalid netlists our decoder is deliberately stricter, matching `tapeout()`). Every catalog circuit is exhaustively checked against its neural reference model in both output modes.
3. **Independent on-chain check**: a reviewer taped out the whole catalog on two fresh processors (direct and buffered modes) and compared every `eval`/`step` with hand-written references, not the SDK's model.
4. **CerebrScope tests**: 15 fork tests against the real TapeOut contracts and 6 non-fork tests, including a 1,000-run fuzz test that `scan()` never reverts on arbitrary bytes. All circuits of TapeOut's own CPU #0 (102–103 depending on the block) were rendered and parsed.
5. **End-to-end rehearsals**: the launch script and the dApp's smoke test run against a fresh fork (section 5).
6. **Multi-agent code review** of all components, followed by integrator verification (section 4).

## 3. Component analysis

### CerebrScope

- **No funds, no admin, no upgrade.** No payable functions, no owner, immutable `FACTORY` and `OPENER`. Its only state is the label registry.
- **Label authorization.** `setLabel` requires `FACTORY.isCPU(circuits)` and `ownerOf(id) == msg.sender`, so a fake "circuits" contract cannot spoof ownership. Labels survive NFT transfers (they describe immutable logic); the new owner can overwrite or clear them and the old owner loses access (tested). `clearLabel` skips `isCPU`, which only lets a fake contract delete labels stored under its own address: harmless.
- **Injection.** User-controlled text (labels, processor name/story) is XML-escaped with control characters dropped and cut on UTF-8 boundaries in the SVG, and JSON-escaped in the metadata. A test checks that `<script>` is neutralised. The dApp additionally renders only `data:image/svg+xml;base64` images from `tokenURI`.
- **Malformed netlists.** `scan()` stops at the first truncated or unknown element and reports `wellFormed = false`; REF headers are bounds-checked before reading `nIns` at offset 29. Fuzzed (1,000 runs) for no reverts and consistent counts.
- **Gas.** All rendering functions are views meant for `eth_call`. Drawing is capped at 256 cells and 32 pins per side, label fields have length limits, `page()` is capped at 100 and `truthTable` at 10 inputs. Parsing is linear in netlist size, so `tokenURI` of a very large circuit (thousands of gates) can exceed an RPC's `eth_call` gas cap; measured: about 0.9–1.0M gas for the 37-gate line detector, 3.82M for a 300-gate chain. `truthTable` evaluates every input row, so for the 9-input circuits (#11, #12) it exceeds the public X Layer RPC's `eth_call` gas cap; the dApp computes truth tables locally and falls back to client-side rendering on any Scope error.
- **Trust in TapeOut.** Scope reads `ownerOf`, `circuitInfo`, `netlist`, `eval` and `step` from TapeOut; if TapeOut upgrades those, Scope reports what TapeOut says.

### SDK and compiler

- Pure functions; no keys. The netlist encoder reproduces TapeOut's own client byte for byte, and `scanNetlist` and `decode` enforce the same signal and output rules as `tapeout()` (no raw input or constant as output, NAND/REF inputs strictly before the element's own outputs, LATCH `d` below the signal count, `nOut > 0`), so malformed designs fail locally before paying. They are intentionally stricter than TapeOut's client decoder, which accepts self-referencing NAND/REF inputs and out-of-range LATCH `d` that the chain rejects. The neuron compiler accepts only safe-integer weights and thresholds with `|w| <= 64`.
- Fee helpers send **exact** values: `createCPU` (overpayment is kept by TapeOut), `mint` (`amount × mintPrice + protocolFee`; excess is stuck in TapeOut's contract), `tapeout` (must equal `TAPEOUT_FEE`; overpaying reverts), `open` (excess refunded).
- REF placeholders that are not resolved to a real `{cpu, circuitId}` throw before encoding.

### Launch script

- **Mainnet needs all of:** `--network xlayer`, `PRIVATE_KEY` in the environment, `--yes`, `issuance.confirmed: true` in `launch/config.json`, and a non-loopback RPC. Fork mode requires a loopback RPC that reports itself as anvil and a fork chain id (196 or 31337). The key is never printed or written (an invalid key fails with a generic message, and every error is redacted before printing); state and output files hold only addresses and hashes.
- **Pinned TapeOut implementations.** The factory, transistor, circuit and opener implementations, and the implementation behind the account proxy's beacon (the native accounts' logic), are compared with the versions we tested; a mismatch stops the run unless `--allow-impl-change`.
- **Resumable without paying twice.** The tx hash is saved before waiting. On resume, a pending tx without a receipt now **stops the run** (unless the node no longer knows it and nothing is in flight, i.e. it was dropped), and every sending run refuses to start while the wallet has unconfirmed transactions (`pending nonce > latest`). Circuits already on chain are adopted by netlist bytes, mints are topped up only to the deficit, and `keep` is minted once per token (never re-minted after the kept transistors are spent).
- **No accidental second launch.** A mainnet state marked `done` refuses to send without `--continue-after-done`. With no processor in state, `createCPU` is refused if the mainnet out file exists or the factory already lists a processor created by the deployer, unless `--allow-second-cpu`.
- **Verification.** Every circuit is checked right after tapeout: netlist bytes, `circuitInfo`, the `TapedOut` event, owner, and `eval`/`step` against the simulator on every input (and every state × input).
- Optional `scope` in the config must be a CerebrScope bound to the TapeOut factory (checked via `FACTORY()`).

### dApp

- Every write is simulated first (decoded reverts), sent only when the wallet is on the app's chain, and awaited for a successful receipt. Fees and prices are read live from TapeOut and sent exactly (as above).
- The local fork uses chain id 31337 so wallets never confuse it with X Layer (196); it is hidden in production builds unless `VITE_ENABLE_ANVIL=true`. The dev connector drives an unlocked anvil account; the app never holds a key.
- The app offers **no NFT transfers** and no brain-wallet `execute`. TapeOut allows sending a circuit NFT into its own account, which locks that account forever; users are warned in app/README.md and on the landing page.

## 4. Review findings and resolutions

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | High | `app/scripts/sync-cpu.mjs` crashed on the launch script's `cerebr.launch/1` records (`processor.*`, `circuits[]`), so the dApp and the landing page could never find the mainnet processor. | **Fixed.** Reads `processor`, `createBlock`, `network: 'fork'` and `circuits[].key/circuitId`; regression-run on the fresh fork record (14 catalog ids + scope). |
| 2 | Medium | `launch.ts` resume cleared a pending tx even without a receipt, so the next run could pay for `createCPU` or a mint twice. | **Fixed.** Stops unless the tx is confirmed or provably dropped; plus an in-flight nonce guard before any send. Both paths tested on the fork. |
| 3 | Medium | CerebrScope was never deployed or wired into the app by the runbook; the app's fallback called `svg()`, but the contract has `svgOf()`. | **Fixed.** LAUNCH.md step 6b (fork rehearsal, then user-signed deploy); optional `scope` in `launch/config.json` is validated and written to `launch/out`, and `npm run sync` picks it up; ABI renamed to `svgOf`. Verified on the fork: the app's `scopeImage()` returns on-chain SVGs. SUBMISSION has a checklist item and a fallback voice-over line. |
| 4 | Medium | README/SUBMISSION pointed to an AUDIT.md about the removed $CBR contracts; DEPLOY.md and AGENTS.md still described the curve. | **Fixed** (this document; DEPLOY.md deleted). **AGENTS.md is left for the human** to update: it is the agents' instruction file. |
| 5 | Low | Landing page claimed the dApp blocks sending a circuit into its own wallet; README called Scope "read-only". | **Fixed** wording on both (the app has no transfer feature; Scope is "no admin, no funds", with an owner-written label registry). |
| 6 | Low | "Fixed cap and price" claims ignored TapeOut's upgradeable beacons. | **Fixed.** README, SUBMISSION, ISSUANCE and the landing page now say the terms are fixed by Cerebr at `createCPU` and enforced by TapeOut's upgradeable contracts. |
| 7 | Low | SDK root lacked the `tapeout` export used by the landing snippet; `npm test` failed on Node 26. | **Fixed.** `export * as tapeout`; the snippet typechecks; `npm test` runs `'test/*.test.ts'`; a test covers the root exports. |
| 8 | Low | `sdk/node_modules` not ignored; stray fork receipts in the root. | **Fixed**, plus a bug found while fixing it: the root `out/` ignore rule also matched `launch/out/`, so the mainnet launch record could never have been committed. Rules are now anchored (`/out/`, `/cache/`); fork records are ignored, mainnet records are committable. Stray files deleted. |
| 9 | — | Integrator: `launch.ts` and `fork-smoke.ts` only accepted chain id 196, while the dApp's fork (and the in-app instructions) use 31337. | **Fixed.** Fork mode accepts 196 or 31337 and signs with the node's real id; one fork now serves the launch, sync, smoke test and dApp. |
| 10 | Info | Independent on-chain check of all 14 catalog circuits, both output modes; launch.ts safety rails; CerebrScope authorization, escaping and REF parsing. | No issues found. |

No finding was rejected.

## 5. Test results (2026-10-04)

| Suite | Result |
|---|---|
| `forge test` (CI mode, no fork) | 6 passed (incl. 1,000-run fuzz), fork suite skipped |
| `SCOPE_FORK_RPC=… forge test` (X Layer fork, block ≈72.38M) | 21 passed (15 fork + 6 unit) |
| `sdk`: `npm test`, `tsc --noEmit` | 35 passed, clean |
| `sdk/scripts/fork-smoke.ts` | 18 / 18 checks |
| `sdk/scripts/launch.ts --yes --fresh` (fresh fork, chain 31337) | 19 transactions, 5.03M gas, 14 circuits, 1,164 on-chain cases, **ALL CIRCUITS VERIFIED** |
| `app`: `tsc --noEmit`, `npm run build` | clean |
| `app`: `npm run smoke` | 43 / 43 checks |

CI (`.github/workflows/test.yml`) runs forge fmt/build/test (non-fork), the SDK typecheck and tests, and the app build. Fork suites need a local anvil fork and are run by hand before release (README "Quickstart").

## 6. Known limitations

- **TapeOut is the trust root.** Upgradeable, unaudited, unsealed; its owner can change fees, burns, `eval` semantics or the cap/price enforcement. The launch script's implementation pins detect changes before launch only.
- **Fees are protocol-set.** Quotes are read live; the 0.08 OKB account-open fee dominates launch cost.
- **Circuits are small by design.** `eval` is a view call; networks of tens to hundreds of gates are practical. Very large circuits may exceed RPC `eth_call` gas caps for `eval` or Scope rendering.
- **Self-locking accounts.** TapeOut allows sending a circuit NFT into its own account. The dApp offers no transfers, but other tools can do it.
- **Names of custom designs** live only in the browser that taped them out, unless the owner writes a CerebrScope label.
- **This review is internal.** It is not a substitute for a professional audit of either Cerebr or TapeOut.
