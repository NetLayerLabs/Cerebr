# Cerebr asset issuance

Cerebr issues exactly one asset: the **transistor** of the Cerebr processor, created through the TapeOut factory on X Layer mainnet. Cerebr has no token of its own and no bonding curve. Circuits are ERC-721 NFTs on the same processor, and each one exists only because transistors were burned to make it.

Every fee and contract behaviour below was verified on a fork of X Layer mainnet; [TAPEOUT.md](TAPEOUT.md) has the evidence. TapeOut's contracts are upgradeable, so its owner can change any TapeOut fee. The dApp and the launch script read fees live before quoting.

The terms below are live on X Layer mainnet since 2026-10-05. They were passed to `createCPU` from `launch/config.json` (`issuance`), which the landing page also reads, and they read back from chain in [`launch/out/196.json`](launch/out/196.json).

## 1. The asset

| Property | Value | Set by |
|---|---|---|
| Name / symbol | Cerebr / CRBR | `createCPU` |
| Token standard | ERC-1155-style, two ids: `NAND` = 0, `LATCH` = 1 | TapeOut |
| Transistors contract | [`0x84b5a5c6fE305319458113b87c09a2A241427D2D`](https://www.oklink.com/xlayer/address/0x84b5a5c6fE305319458113b87c09a2A241427D2D) | `createCPU` |
| Supply cap | **1,000,000** | `createCPU(..., transistorSupply, ...)` |
| Unit price | **0.00001 OKB** per transistor | `createCPU(..., mintPrice)` |
| Who can mint | Anyone, at the same price, until the cap is reached | TapeOut |
| Minted at launch | 1,241 (0.1241% of the cap): 141 burned into the 14 catalog circuits, 1,100 kept by the creator (section 6) | launch |
| Team allocation, presale, vesting | None reserved in the contract. The creator's 1,100 were minted through the public `mint()` at the public price and are disclosed below | — |

Behaviour, verified on the fork:

- **NAND and LATCH share one cap.** `minted()` counts both kinds.
- **The cap counts lifetime issuance.** Burning transistors in a tape-out does **not** lower `minted()`, so burns never make room for new supply. Every tape-out makes the remaining circulating supply smaller.
- **What a tape-out burns.** Each NAND element burns 1 NAND and each LATCH element burns 1 LATCH. A `REF` to an existing circuit burns **nothing**.
- **Mint price.** A mint costs `amount × mintPrice + protocolFee`, where `protocolFee` is a flat 0.00066 OKB per mint call. Any OKB sent above that is stranded in the contract and nobody can recover it, so the dApp always sends the exact amount.

## 2. Why 1,000,000 at 0.00001 OKB

Cerebr's transistors are synapses, so the price is set for building neurons, not for scarcity:

1. **Gates are cheap.** Each gate costs 0.00001 OKB, a fraction of a cent-equivalent, so a community neuron of a few to a few dozen gates costs 0.00001–0.0004 OKB in transistors. A 150-gate network costs about 0.0015 OKB in transistors, plus TapeOut's 0.0013 OKB tape-out fee, the 0.00066 OKB mint-call fee and gas. Builders pay for TapeOut's fees, not for our gates.
2. **Large headroom.** The whole showcase catalog burns 141 transistors, **0.0141% of the cap**. The cap leaves room for thousands of community networks before scarcity matters, and burns never refill it.
3. **It is listed.** TapeOut's app lists a processor only with `supplyCap >= 10000` and `minted >= 1`. Cerebr clears both (`listedInTapeoutApp: true`).
4. **Honest revenue.** A sell-out pays the creator 10 OKB; the price is not a fundraising instrument.

The trade-off: at this price TapeOut's flat 0.00066 OKB mint-call fee is most of a small mint (57% of a 50-transistor mint). Minting enough for several circuits in one call spreads that fee, and REF lets networks reuse neurons with no mint at all.

| Option | Supply cap | Unit price (OKB) | Revenue if it sells out | Fee share on a 50-transistor mint | XOR network (6 NAND) | Line detector (37 NAND) |
|---|---|---|---|---|---|---|
| **Chosen** | **1,000,000** | **0.00001** | **10 OKB** | 57% | **0.00006** | **0.00037** |
| Field-typical (the earlier proposal) | 100,000 | 0.000066 | 6.6 OKB | 17% | 0.000396 | 0.002442 |
| Scarce / premium | 21,000 | 0.00066 | 13.86 OKB | 2% | 0.00396 | 0.0244 |

The 100,000 at 0.000066 OKB scale that most entrants use makes a neuron 6.6× dearer and puts the catalog at 0.14% of the cap; it compares well like-for-like but works against a library meant to be reused and extended. A scarce, premium transistor would make anything beyond the smallest neurons costly. The transistor columns show the unit price only; every tape-out also pays TapeOut's 0.0013 OKB fee.

## 3. Cost of each catalog circuit

Gate counts come from the Cerebr compiler (`sdk/src/neuro`) in **direct** output mode. The fork confirmed that TapeOut reads outputs as the last `nOut` signals, so no output buffer is needed. Every circuit is verified exhaustively against its reference model, and the mainnet launch checked `eval` (or `step`) against the simulator on every input for each one.

The OKB column is the transistors at 0.00001 OKB plus the 0.0013 OKB tape-out fee. The flat 0.00066 OKB mint fee is per mint call and is shared across everything minted in that call. Gas at about 0.02 gwei comes to under 0.00001 OKB per tape-out.

| Circuit | Id | Inputs → outputs | NAND | LATCH | REF | Transistors burned | OKB |
|---|---|---|---|---|---|---|---|
| AND neuron | #1 | 2 → 1 | 2 | 0 | 0 | 2 | 0.00132 |
| OR neuron | #2 | 2 → 1 | 3 | 0 | 0 | 3 | 0.00133 |
| Inhibitory neuron (NAND) | #3 | 2 → 1 | 1 | 0 | 0 | 1 | 0.00131 |
| XOR network (flattened) | #4 | 2 → 1 | 6 | 0 | 0 | 6 | 0.00136 |
| XOR network (REF-composed) | #5 | 2 → 1 | 0 | 0 | 3 | 0 | 0.0013 |
| Majority-3 | #6 | 3 → 1 | 6 | 0 | 0 | 6 | 0.00136 |
| Majority-5 | #7 | 5 → 1 | 24 | 0 | 0 | 24 | 0.00154 |
| Go/No-Go threshold neuron | #8 | 5 → 1 | 19 | 0 | 0 | 19 | 0.00149 |
| Line cell | #9 | 3 → 1 | 4 | 0 | 0 | 4 | 0.00134 |
| Any-of-3 | #10 | 3 → 1 | 6 | 0 | 0 | 6 | 0.00136 |
| Line detector (flattened) | #11 | 9 → 3 | 37 | 0 | 0 | 37 | 0.00167 |
| Line detector (REF-composed) | #12 | 9 → 3 | 0 | 0 | 11 | 0 | 0.0013 |
| 2-bit adder | #13 | 4 → 3 | 14 | 0 | 0 | 14 | 0.00144 |
| Integrate-and-fire neuron | #14 | 2 → 1 | 17 | 2 | 0 | 19 | 0.00149 |
| **Whole catalog** | | | **139** | **2** | 14 | **141** | **0.01961** |

The "buffered" output mode, which matches TapeOut's own compiler, adds 2 NAND per output. Cerebr uses direct mode.

### Launch cost (actual, mainnet, 2026-10-05)

| Step | OKB |
|---|---|
| `createCPU` deploy fee (sent exactly) | 0.0066 |
| Mint 1,139 NAND (139 burned + 1,000 kept): 1,139 × 0.00001 + 0.00066 | 0.01205 |
| Mint 102 LATCH (2 burned + 100 kept): 102 × 0.00001 + 0.00066 | 0.00168 |
| 14 tape-outs × 0.0013 | 0.0182 |
| Gas (18 transactions) | 0.0000975 |
| **Gross** | **0.0386275** |
| Creator revenue returned via `withdraw()` (1,241 × 0.00001) | −0.01241 |
| **Net** | **0.02621748** |

Brain wallet #5 opened afterwards (0.08 OKB, tx [0x8781…dad3](https://www.oklink.com/xlayer/tx/0x8781ed8467f4cef1d10dce3ec48cf1da99cfea615b250da8a352eda7a538dad3)).

## 4. Where the OKB goes

```
mint(id, n)    n × unitPrice  ──▶ owed[creator]          (Cerebr deployment wallet, pulled with withdraw())
               protocolFee    ──▶ owed[protocolWallet]   (TapeOut, 0.00066 per call)
               any excess     ──▶ stranded in the contract (nobody can recover it)
tapeout(...)   TAPEOUT_FEE    ──▶ TapeOut treasury        (pushed; must be exact, overpaying reverts)
createCPU      deployFee      ──▶ TapeOut protocolWallet  (anything above it is kept, not refunded)
open(...)      FEE (0.08)     ──▶ TapeOut opener treasury (anything above it is refunded)
execute(...)   EXEC_FEE       ──▶ TapeOut opener treasury (on top of the call's own value)
eval / step    free (view calls)
```

Cerebr's only revenue is the unit price of transistors minted by others. Cerebr never holds user funds. CerebrScope has no payable functions and no admin, and its only state is an optional label registry that each circuit's owner writes.

## 5. Why it is designed this way

- **One asset, judged on its own terms.** The earlier $CBR bonding curve competed with the transistor for attention and made the project harder to explain. It has been removed.
- **Utility is the demand.** Transistors are bought to build neurons. Building burns them for good, and the cap never refills.
- **REF makes reuse free and composition cheap.** A REF-composed network burns no transistors, only the tape-out fee. That pushes builders to reuse the neurons that already exist instead of copying them. The base neurons get more valuable as the graph of networks built on them grows. This is the growth loop: more networks mean more REFs, which mean more reasons to tape out new base neurons.
- **No reflexive economics.** There is no curve, no staking, no emissions and no buyback. Cerebr sets the price and the supply once, at `createCPU`, and has no function to change them, so there is nothing to farm. They are enforced by TapeOut's contracts, which are upgradeable and not sealed: TapeOut's owner, not Cerebr, could change that logic.

## 6. Anti-wash-trading stance

Wash trading or self-trading disqualifies a hackathon entry, and we would not do it anyway.

- **We disclose our own activity exactly.** At launch the deployment wallet minted 1,241 transistors in two public `mint()` calls at the public price: 141 were burned into the 14 catalog circuits, each taped out **once**, and the creator keeps **1,000 NAND + 100 LATCH** (0.11% of the cap) for building circuits later. Every transaction is listed in `launch/out/196.json` and linked from SUBMISSION.md and LAUNCH.md.
- **The kept transistors are not wash trading.** They are a primary mint at the public price, with no trades, transfers or sales, and they do not count as demand. Because the deployment wallet is also the creator, their unit price came back through `withdraw()`, so in practice they cost only the shared mint-call fee and gas. We state this rather than hide it.
- **No circular flows.** We never move transistors or circuits between wallets we control to inflate `minted`, the circuit count or volume. We use no sock-puppet minters and run no incentivised loops.
- **The creator's refund is disclosed.** When the creator mints, the unit price comes back through `withdraw()` (0.01241 OKB at launch). Only the protocol fee is a real cost. We do not count those mints as demand.
- **Organic numbers only.** The landing page's live strip reads `minted()` and the circuit count directly from the chain. It shows no inflated or off-chain figures.
