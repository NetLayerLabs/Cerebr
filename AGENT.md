# Cerebr Agent: an onchain agent whose brain is a taped-out neuron

`CerebrAgent` (`src/agent/CerebrAgent.sol`) is an autonomous onchain agent. Its **policy is a circuit taped out on the Cerebr processor**: by default circuit **#8, the "Go/No-Go Neuron"**, a 19-NAND threshold neuron `y = [e0 + e1 + e2 - i0 - i1 >= 2]`.

On every `act()` the contract does four things:

1. derives the neuron's five input bits from onchain state only;
2. runs exactly one `eval()` of the circuit;
3. records the verdict (**Go**, **No-Go**, or **Abstain** if the circuit could not be evaluated) in a 64-entry ring buffer;
4. emits events from which anyone can replay the decision.

The agent holds no funds, has no admin, is not payable and trades nothing. Its output is a public, verifiable signal: *"is now a good moment for onchain activity on X Layer?"*. Any contract or app can consume it through `latestDecision()`.

A keeper daemon (`agent/`, see [agent/README.md](agent/README.md)) calls `act()` every 10 minutes from a dedicated hot wallet. `act()` is permissionless and rate-limited, so the keeper is a convenience and not a trusted party.

| Piece | Path |
|---|---|
| Contract, interface | `src/agent/CerebrAgent.sol`, `src/agent/ICerebrAgent.sol` |
| Tests (unit + fuzz, fork) | `test/agent/CerebrAgent.t.sol`, `test/agent/CerebrAgentFork.t.sol`, `test/agent/AgentMocks.sol` |
| Deploy script | `script/DeployAgent.s.sol` |
| SDK (viem-free: ABI, input mapping, netlist mirror, replay check, cost math) | `sdk/src/neuro/agent.ts`, `sdk/test/agent.test.ts` |
| Keeper daemon, Docker, systemd, fork e2e | `agent/` |

## Live on mainnet

Deployed on X Layer mainnet (chain 196) on 2026-10-06 and acting since. Every figure below was read onchain.

| What | Value |
|---|---|
| CerebrAgent | [`0x3d736c6419dCa667a351907578b68717Cd6e3340`](https://www.okx.com/web3/explorer/xlayer/address/0x3d736c6419dCa667a351907578b68717Cd6e3340), source verified on Sourcify (exact match) |
| Deploy tx | [0xa9aa…a31f](https://www.okx.com/web3/explorer/xlayer/tx/0xa9aaacef0f3af99dc0046a67d5e3132879c65301415fca4b10202d617e15a31f), block 72,520,892, from the creator `0xc742…960C` |
| Policy circuit | #8 Go/No-Go Neuron (19 NAND) on the Cerebr processor [`0xB04E…93FF`](https://www.okx.com/web3/explorer/xlayer/address/0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF) |
| Brain wallet | [`0x550500EF28b4Ebe39a7431E2A86A45f97F6db141`](https://www.okx.com/web3/explorer/xlayer/address/0x550500EF28b4Ebe39a7431E2A86A45f97F6db141), **not opened** (no code yet) |
| Keeper hot wallet | [`0x09a00521Ff00407f81963FcE5D4D20917289902A`](https://www.okx.com/web3/explorer/xlayer/address/0x09a00521Ff00407f81963FcE5D4D20917289902A), run by the VPS daemon (`agent/`), one `act()` every **10 minutes** |
| First decision | seq 1, **Go**, [0xb738…c4ed](https://www.okx.com/web3/explorer/xlayer/tx/0xb738dac247760db5bad17709b019a953384132cf5e9c558698a69e7925e2c4ed), block 72,525,341 (inputs `0x07`: CALM, ACTIVE, RESTED; output 1), verified by replay |
| App | the read-only **Agent** tab (`/app#agent`): live pins, decision feed, 24 h strip and a replay button per decision |

**Measured cost on mainnet** (gas price 0.020000001 gwei, `l1Fee = 0`):

| Transaction | Gas used | OKB |
|---|---|---|
| Deploy | 3,670,007 | 0.0000734 |
| `act()` #1 (first decision, Go) | 179,741 | 0.0000036 |
| `act()` #2 (ring buffer filling, No-Go) | 159,598 | 0.0000032 |

That matches the fork measurements below: about 0.00047 OKB a day while the ring buffer fills, about 0.00037 once it wraps. After its first two decisions the keeper wallet held 0.01999 OKB of its 0.02 OKB float.

**Verify any decision yourself.** Read `decisions(fromSeq, count)` (the ring buffer; X Layer's public RPC caps `eth_getLogs` at about 100 blocks), then for each record:

```sh
cast call 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF "eval(uint256,bytes)(bytes)" 8 0x07 -r https://rpc.xlayer.tech   # = 0x01, the output recorded for seq 1
cast call 0x3d736c6419dCa667a351907578b68717Cd6e3340 "replay(uint256)(uint8,bool)" 1 -r https://rpc.xlayer.tech      # (1, true)
```

and re-derive the inputs offline with `checkRecord(record, config)` (see [Verifiability](#verifiability)). The app's Agent tab does both for every stored decision.

## Why circuit #8

It already exists on mainnet, so the brain costs nothing new. The creator wallet holds only 4 NAND, and a fresh tape-out would need minting.

Its 5-input / 1-output shape is exactly a decision neuron: three excitatory and two inhibitory synapses. I verified it on mainnet:

* `circuitInfo(8) = (5, 1, 0, 19)`.
* All 32 inputs give the same output from the real `eval` as from the reference model (fork test `test_fork_policyCircuit`).
* The netlist taped out (`launch/state.196.json`) is byte-identical to `decisionNeuron.build({mode: 'direct'})` in the SDK (`sdk/test/agent.test.ts`).

The constructor accepts any circuit that is combinational, has exactly 5 inputs and 1 output, and has at most 256 gates. It smoke-tests all 32 inputs before it accepts the circuit.

## Input mapping

The eval input is one byte, pins LSB-first. Pin order and signs are those of `threshold-neuron` in `sdk/src/neuro/library.ts`: `inputs: ['e0','e1','e2','i0','i1']`, weights `[+1,+1,+1,-1,-1]`, theta 2.

| Bit | Pin | Weight | Name | Fires when (all onchain) | Default |
|---|---|---|---|---|---|
| 0 | e0 | +1 | **CALM** | `block.basefee <= calmMaxBasefee` | 0.05 gwei |
| 1 | e1 | +1 | **ACTIVE** | the UTC hour of `block.timestamp` is in `[windowStartHour, windowEndHour)` (wraps past midnight if start > end; start == end means all day) | 13 to 21 UTC |
| 2 | e2 | +1 | **RESTED** | no Go yet, or the last Go is at least `restBlocks` old | 43,200 blocks (12 h) |
| 3 | i0 | -1 | **SPIKE** | `basefee * 10000 > ema * spikeBps` (basefee jumps above its moving average) | 1.5x the EMA |
| 4 | i1 | -1 | **REFRACTORY** | the last Go is fewer than `refractoryBlocks` old (feedback from the agent's own last decision) | 3,600 blocks (1 h) |

* `ema` is an exponential moving average of `block.basefee` with alpha = 1/8. The step is rounded up so that it converges exactly. It is updated once per decision, **after** the inputs are derived, so a decision's inputs use the EMA as it stood before that decision.
* basefee is clamped to `uint64`.
* `refractoryBlocks <= restBlocks` is enforced, so REFRACTORY and RESTED never fire together.

**Decision semantics.** The verdict is **Go** iff `CALM + ACTIVE + RESTED - SPIKE - REFRACTORY >= 2`. In words: never inside the refractory hour; otherwise fire when gas is calm and either it is active hours or the agent has rested; a basefee spike argues against.

* **Abstain** means the circuit call failed or returned malformed data. Its `reason` is one of `CallFailed`, `BadReturn` or `BadOutput`.
* An Abstain never counts as a Go and never bricks the agent. It is recorded like any other decision.

**What it does on X Layer today.** X Layer's basefee has sat at a flat 0.02 gwei, so CALM is almost always 1 and SPIKE almost always 0. With 10-minute keeper cycles, the rhythm is therefore driven by time and by the agent's own feedback:

* inside 13 to 21 UTC: a Go every hour (Go, then 5 refractory No-Gos);
* outside the window: No-Go until 12 h after the last Go, which gives one rested Go at about 08:00 UTC.

A simulation with the SDK mirror gives Go at 08:00 and hourly from 13:00 to 20:00 UTC: about 9 Go out of 144 decisions per day. If gas ever spikes, SPIKE and loss of CALM suppress Go immediately, with no admin action.

## Contract interface

* `act() returns (seq, verdict)`:
  * Permissionless. Reverts `TooSoon(nextActBlock)` within `minIntervalBlocks` (300 blocks, about 5 minutes) of the previous decision.
  * Reverts `InsufficientGasForInference()` unless the eval can get its full 1M gas budget, so a low gas limit cannot force an Abstain.
  * When `msg.sender == brainWallet` (the policy circuit's TapeOut ERC-6551 account, `opener.accountOf(circuits, policyCircuitId)`, fixed at deployment), the record has `viaBrainWallet = true`.
* `observe()` and `observeAt(basefee)`: the inputs the agent would use now, the preview verdict, `canAct` and `nextActBlock`.
  * **X Layer quirk:** an `eth_call` without a gas price sees `BASEFEE = 0`. Use `observeAt(latestBlock.baseFeePerGas)`, as the daemon does, or pass a `gasPrice` with the call.
* `latestDecision()`: the latest record, all zeros before the first decision.
* `decisions(fromSeq, count)`: oldest first, paged, at most 64. `fromSeq` is raised to the oldest record still stored.
* `stats()`: decisions, go/noGo/abstain counts, brain-wallet count, last act block. `config()`, `ema()`, `lastGoBlock()`, `brainWallet()`.
* `replay(seq) returns (outputs, matches)`: re-evaluates a stored decision's inputs. `deriveInputs(basefee, ema, timestamp, blockNumber, prevGoBlock)`, `inputBytes(x)`, `hourOf(ts)`.
* Events:
  * `Decision(seq, caller, verdict, blockNumber, basefee, ema, blocksSinceGo, inputs, outputs, viaBrainWallet)`
  * `InferenceReceipt(seq, circuits, circuitId, inputs, outputs, gasUsed, fallbackReason)`, the same shape as NeuralArena's receipt.
* Record layout, two storage slots: `caller, blockNumber, timestamp, inputs, outputs | seq, prevGoBlock, basefee, ema, verdict, reason, viaBrainWallet`.

## Safety

* **The circuit is untrusted at runtime.** TapeOut is upgradeable, so `eval` is a STATICCALL capped at 1M gas, and at most 96 bytes of return data are copied, so a return-data bomb costs nothing. Decoding is strict: the return must be exactly the canonical ABI encoding of a 1-byte `bytes` (offset 0x20, length 1, 0x60 bytes total, zero padding), with value 0 or 1. Anything else is recorded as an Abstain with its reason. The same pattern is used in `NeuralArena`.
* **No funds, no admin, not payable, no token transfers, no approvals.** The only external call in `act()` is that STATICCALL, so there is no reentrancy surface. The constructor makes two more read-only calls: `circuitInfo` and `opener.accountOf`.
* **Rate limit.** One decision per `minIntervalBlocks`, whoever calls, including the brain wallet. Gas per call is bounded at about 1.2M worst case, measured with misbehaving mocks.
* **No trading.** The agent decides; it never moves value. Nothing in the design creates volume, so it cannot be used for wash trading. A downstream consumer that trades on the signal is outside this system.

## Costs (measured on a mainnet fork; X Layer gas price 0.020000001 gwei, no L1 fee)

| Action | Gas | OKB |
|---|---|---|
| Deploy (includes the 32-input smoke test of the circuit) | 3,669,971 | 0.000073 |
| `act()`, first decision | 179,741 | 0.0000036 |
| `act()`, ring buffer still filling (decisions 2 to 64) | about 162,400 | 0.0000032 |
| `act()`, steady state (ring wrapped) | 128,345 | 0.0000026 |
| per day, 10-minute cycles (144) | | **~0.00037** (0.00047 while filling) |
| per day, 30-minute cycles (48) | | ~0.00012 |
| Brain-wallet checkpoint (`account.execute` → `act`) | 235,140 | 0.0000047 + **0.0013 EXEC_FEE** |
| Opening #8's brain wallet (one-time, optional) | ~174,000 | **0.08** open FEE |

The eval of the 19-NAND circuit is about 70k gas of each `act()` (`cast estimate` of `eval(8, 0x07)` is 91k including the 21k intrinsic cost).

`act()` needs about 1.03M gas *available* (a gas limit of about 1.26M with the daemon's margin), but only the gas used is paid.

A 0.02 OKB hot wallet runs 10-minute cycles for about 51 days before reaching the 0.001 OKB floor.

## Verifiability

Every decision can be checked by anyone without trusting the keeper or this repo's code.

1. **The output is the circuit's answer.** Take `inputs` and `outputs` from `Decision`, `InferenceReceipt` or `decisions()`:
   ```sh
   cast call 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF "eval(uint256,bytes)(bytes)" 8 0x<inputs as 1 byte> -r https://rpc.xlayer.tech
   ```
   This must equal `outputs`. `verdict` is Go iff `outputs == 1`, unless the decision was an Abstain. The convenience view `replay(seq)` does the same onchain.
2. **The inputs are honest.** Recompute each bit from the record's `basefee`, `ema`, `timestamp` (the UTC hour), `blockNumber - prevGoBlock`, and the immutable `config()`, using the table above. `basefee` must equal the block's `baseFeePerGas`.
   * The EMA chain can be followed decision by decision: `ema(n+1) = nextEma(ema(n), basefee(n))`.
   * The SDK does all of this offline in `checkRecord(record, config)` (`sdk/src/neuro/agent.ts`), which also re-simulates the taped-out netlist. The daemon logs `"verified": true` after every one of its own decisions.
3. **The circuit is the claimed neuron.** `netlist(8)` on mainnet equals the SDK's compiled `decisionNeuron`, and its 32-row truth table is `y = [e0+e1+e2-i0-i1 >= 2]` (both checked in the tests).

## The brain wallet

TapeOut gives every circuit a deterministic ERC-6551 account: #8's is `0x550500EF28b4Ebe39a7431E2A86A45f97F6db141`. It is **not opened yet**; opening costs 0.08 OKB and anyone may pay. Its owner is whoever owns the circuit NFT, today the creator `0xc742…960C`.

When that account calls `act()` through `account.execute(agent, 0, act(), 0)` (paying EXEC_FEE 0.0013 OKB), the decision is stored and emitted with `viaBrainWallet = true`: "the neuron acting through its own wallet". A call from any other account, including #5's opened account with the same owner, is not attributed. The fork tests check both cases.

The daemon can do this daily (`BRAIN_WALLET_CHECKPOINT=1`), but only if the hot wallet owns the circuit NFT. Moving the NFT, and with it the brain wallet, to a VPS hot key is a real security trade-off, so the recommended path is an occasional manual checkpoint from the creator wallet (below).

## Tests

```sh
forge build
forge test --match-path 'test/agent/*'                       # 25 unit/fuzz tests; fork suite skipped
anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8605 --silent &
AGENT_FORK_RPC=http://127.0.0.1:8605 forge test --match-path 'test/agent/*' -vv   # + 5 fork tests
(cd sdk && npx tsc --noEmit && npm test)                      # includes sdk/test/agent.test.ts
(cd agent && npm install && npm run typecheck && npm run fork:e2e)   # daemon end-to-end on the fork
```

**Unit tests** use a mock circuits contract with nine misbehaviours: revert, gas burn, wrong length, bad output bit, bad ABI offset, short return, return bomb, dirty padding, and a wrong-but-valid circuit. They cover:

* construction checks, the rate limit and gas griefing;
* every pin boundary and window wrap, EMA math and convergence;
* the ring wrap and paging (fuzzed), brain-wallet attribution, replay;
* a fuzz test asserting `observe == act == reference neuron`.

**Fork tests** run against the real processor:

* all 32 inputs;
* 8 decisions driven by basefee, time and rest, each replayed through the real `eval()`, with every pin firing at least once;
* opening #8's account on the fork and checkpointing through `execute`;
* #5's account not being attributed;
* rejection of wrong-shape circuits (#5, #16).

**The fork e2e** deploys the agent and funds a fresh hot wallet with 0.01 OKB. It runs the daemon's Runner through six basefee and time scenarios, each replayed through `eval` and `replay`, and also covers:

* the guards, DRY_RUN, the rate limit and a rival keeper;
* steady-state gas;
* the brain-wallet checkpoint.

It prints PASS/FAIL. Because anvil mines slowly in fork mode, the e2e agent uses compressed block constants: rest 40, refractory 10, interval 3. The mainnet constants are covered by the forge fork tests.

## Mainnet rollout

**Executed on 2026-10-06** (see [Live on mainnet](#live-on-mainnet)): deploy, hot wallet funded with 0.02 OKB, keeper daemon running. The first decision was sent by the keeper, not by hand (step 2 skipped). The optional steps 6 and 7 (opening the brain wallet, checkpoints) have not been done. Only the owner signs. The plan budgeted about **0.020 OKB** from the creator wallet, which then held about 0.057: about 0.0001 for the deploy and 0.02 for the hot wallet.

```sh
# 0. Build and test (above), then rehearse the deployment on the fork - nothing leaves the machine:
POLICY_CIRCUIT_ID=8 forge script script/DeployAgent.s.sol --rpc-url http://127.0.0.1:8605 \
  --sender 0xc742AdA2872a042dD36D2E706907b4036968960C
# Expect: nIn/nOut 5 1, gates 19, brain wallet 0x5505…b141, observe inputs / preview verdict printed.

# 1. Deploy on X Layer (~3.7M gas, ~0.00007 OKB; forge wants ~0.0002 available at its 2x price estimate):
POLICY_CIRCUIT_ID=8 forge script script/DeployAgent.s.sol --rpc-url xlayer --broadcast \
  --account <creator-keystore> --sender 0xc742AdA2872a042dD36D2E706907b4036968960C
export AGENT=<printed agent address>
cast call $AGENT "config()((uint64,uint32,uint8,uint8,uint32,uint32,uint32))" -r https://rpc.xlayer.tech
cast call $AGENT "brainWallet()(address)" -r https://rpc.xlayer.tech     # 0x550500EF28b4Ebe39a7431E2A86A45f97F6db141

# 2. Optional first decision by hand (permissionless; ~180k gas used, ~0.0000036 OKB):
cast send $AGENT "act()" --gas-limit 1300000 --rpc-url xlayer --account <creator-keystore>
cast call $AGENT "latestDecision()((address,uint40,uint40,uint8,uint8,uint40,uint40,uint64,uint64,uint8,uint8,bool))" -r https://rpc.xlayer.tech

# 3. Hot wallet for the keeper (on your machine), funded with 0.02 OKB (~51 days at 10-minute cycles):
cast wallet new
cast send <hot-wallet-address> --value 0.02ether --rpc-url xlayer --account <creator-keystore>

# 4. VPS: follow agent/README.md - NETWORK=xlayer, AGENT_ADDRESS=$AGENT, AGENT_PRIVATE_KEY=<hot key>;
#    run once with DRY_RUN=1, then DRY_RUN=0. Check `curl 127.0.0.1:8787/status` and the "verified": true logs.

# 5. Watch: decisions(), stats(); top up the hot wallet when /status shows < ~0.003 OKB.

# 6. Optional, when funds allow - open #8's brain wallet (0.08 OKB, one-time, ~174k gas):
cast send 0x536add8f30f03b69f6fbf29d425a816a0dc50106 "open(address,uint256)" \
  0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF 8 --value 0.08ether --rpc-url xlayer --account <creator-keystore>

# 7. Optional checkpoint: the neuron acts through its own wallet (0.0013 OKB EXEC_FEE + ~235k gas), from the
#    circuit owner, when act() is allowed (observe canAct):
cast send 0x550500EF28b4Ebe39a7431E2A86A45f97F6db141 "execute(address,uint256,bytes,uint8)" \
  $AGENT 0 $(cast calldata "act()") 0 --value 0.0013ether --gas-limit 1600000 \
  --rpc-url xlayer --account <creator-keystore>
```

To stop: stop the daemon (`docker compose down` / `systemctl stop cerebr-agent`) and sweep the hot wallet. The contract needs no shutdown.

## For the app ("Agent" panel, built: `app/src/views/AgentView.tsx`)

* **Header:** the policy circuit (#8 Go/No-Go Neuron, 19 NAND, with a link to the circuit), the agent address, the brain wallet (opened or not), and `stats()` as counters (Go, No-Go, Abstain, via brain wallet).
* **Current observation:** `observeAt(latest block baseFeePerGas)`.
  * Show the five pins as lamps with their weights (+1/-1) and the live values behind them: basefee vs the calm threshold, basefee vs EMA × 1.5, the UTC hour vs the window, blocks since the last Go vs rest/refractory.
  * Show the weighted sum against θ = 2, the preview verdict, and `canAct` with a countdown to `nextActBlock`.
  * `explainInputs()` in `sdk/src/neuro/agent.ts` decodes the pins.
* **Live decision feed:** `decisions(max(1, n-63), 64)` from the ring buffer, newest first. Poll every ~10 s, or use `Decision` logs. Mind X Layer's ~100-block `eth_getLogs` limit: use the ring buffer for history and logs only for the latest blocks.
  * Each row shows seq, time, verdict badge, input bits, output, basefee and caller.
  * Show a "brain wallet" badge when `viaBrainWallet`, and an Abstain reason when present.
* **Replay button per row:**
  * Call `circuits.eval(8, inputBytes)` directly and show `outputs` = recorded.
  * Run `checkRecord(record, config)` locally to show the re-derived inputs matching.
  * Optionally run `replay(seq)`.
  * Present it as "verified onchain by the neuron itself".
* **Daily rhythm strip:** 24 h of Go/No-Go dots (about 9 Go per day under flat gas) to make the refractory and rest dynamics visible.
