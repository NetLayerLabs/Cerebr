# Cerebr asset issuance

Cerebr issues exactly one asset: the **transistor** of the Cerebr processor, created through the TapeOut factory on X Layer mainnet. Cerebr has no token of its own and no bonding curve. Circuits are ERC-721 NFTs on the same processor, and each one exists only because transistors were burned to make it.

Every fee and contract behaviour below was verified on a fork of X Layer mainnet; [TAPEOUT.md](TAPEOUT.md) has the evidence. TapeOut's contracts are upgradeable, so its owner can change any TapeOut fee. The dApp and the launch script read fees live before quoting.

The terms below are live on X Layer mainnet since 2026-10-05. They were passed to `createCPU` from `launch/config.json` (`issuance`), which the landing page also reads, and they read back from chain in [`launch/out/196.json`](launch/out/196.json).

## 1. The asset

| Property | Value | Set by |
|---|---|---|
| Name / symbol | Cerebr / CRBR | `createCPU` |
| Token standard | ERC-1155-style, two ids: `NAND` = 0, `LATCH` = 1 | TapeOut |
| Transistors contract | [`0x84b5a5c6fE305319458113b87c09a2A241427D2D`](https://www.okx.com/web3/explorer/xlayer/address/0x84b5a5c6fE305319458113b87c09a2A241427D2D) | `createCPU` |
| Supply cap | **1,000,000** | `createCPU(..., transistorSupply, ...)` |
| Unit price | **0.00001 OKB** per transistor | `createCPU(..., mintPrice)` |
| Who can mint | Anyone, at the same price, until the cap is reached | TapeOut |
| Minted to date | 1,251 (0.1251% of the cap), all by the deployment wallet: 1,241 at launch (1,139 NAND + 102 LATCH) and 10 NAND on 2026-10-06. 752 burned (141 into the 14 catalog circuits, 16 NAND into #15, 590 NAND into #16, and 5 NAND into #17 by a wallet outside the Cerebr team, from its Genesis Drop claim); 400 NAND deposited in the Genesis Drop (304 left after 6 claims); 4 NAND + 100 LATCH held by the creator (section 6) | `mint()` |
| Team allocation, presale, vesting | None reserved in the contract. Every transistor minted so far was minted by the creator through the public `mint()` at the public price, and is disclosed below | - |

Behaviour, verified on the fork:

- **NAND and LATCH share one cap.** `minted()` counts both kinds.
- **The cap counts lifetime issuance.** Burning transistors in a tape-out does **not** lower `minted()`, so burns never make room for new supply. Every tape-out makes the remaining circulating supply smaller.
- **What a tape-out burns.** Each NAND element burns 1 NAND and each LATCH element burns 1 LATCH. A `REF` to an existing circuit burns **nothing**.
- **Mint price.** A mint costs `amount × mintPrice + protocolFee`, where `protocolFee` is a flat 0.00066 OKB per mint call. Any OKB sent above that is stranded in the contract and nobody can recover it, so the dApp always sends the exact amount.

## 2. Why 1,000,000 at 0.00001 OKB

Cerebr's transistors are synapses, so the price is set for building neurons, not for scarcity:

1. **Gates are cheap.** Each gate costs 0.00001 OKB, a fraction of a cent-equivalent, so a community neuron of a few to a few dozen gates costs 0.00001–0.0004 OKB in transistors. A 150-gate network costs about 0.0015 OKB in transistors, plus TapeOut's 0.0013 OKB tape-out fee, the 0.00066 OKB mint-call fee and gas. Builders pay for TapeOut's fees, not for our gates.
2. **Large headroom.** The whole showcase catalog burns 141 transistors, **0.0141% of the cap**. The cap leaves room for thousands of community networks before scarcity matters, and burns never refill it.
3. **It meets the listing rule.** TapeOut's app lists a processor only with `supplyCap >= 10000` and `minted >= 1`. Cerebr clears both (`listedInTapeoutApp: true`).
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
| Gas (18 transactions: `createCPU`, 2 mints, 14 tape-outs, `withdraw`) | 0.00009748 |
| **Gross** | **0.03862748** |
| Creator revenue returned via `withdraw()` (1,241 × 0.00001) | −0.01241 |
| **Net** | **0.02621748** |

Brain wallet #5 was opened afterwards in 1 more transaction (0.08 OKB fee + 0.0000033 OKB gas, tx [0x8781…dad3](https://www.okx.com/web3/explorer/xlayer/tx/0x8781ed8467f4cef1d10dce3ec48cf1da99cfea615b250da8a352eda7a538dad3)). With it, `costs.net` in [`launch/out/196.json`](launch/out/196.json) is 0.10622082 OKB over 19 transactions.

The 2026-10-06 real-wallet test (mint 10 NAND, tape out #15, name it) is outside these figures; see section 6.

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

- **We disclose our own activity exactly.** At launch the deployment wallet minted 1,241 transistors in two public `mint()` calls at the public price: 141 were burned into the 14 catalog circuits, each taped out **once**. Launch transactions are listed in `launch/out/196.json` and linked from SUBMISSION.md and LAUNCH.md.
- **The 2026-10-06 real-wallet test.** The owner tested the live app with the deployment wallet: one public `mint()` of 10 NAND ([0x1fb9…3f2a](https://www.okx.com/web3/explorer/xlayer/tx/0x1fb9dc0eb048bd2d88f985694dc7d7005235dfd7ff27790d44fd4d474af53f2a)), one tape-out of a new design through the Circuit Studio, circuit #15 (y = [x0 + x1 + x2 - x3 ≥ 2], 16 NAND, [0x4133…1c15](https://www.okx.com/web3/explorer/xlayer/tx/0x413387037233847f2d2dd24c2bfa0733a5300d93e4e4f195d3ac9bd4ca1f1c15)), and one CerebrScope label ([0xc5ff…95fb](https://www.okx.com/web3/explorer/xlayer/tx/0xc5ffa319abb3f5dd0202c4b194efaab71ab6f22d677074050d1403d0f33f95fb)). Circuit #15 was then relabelled "Vote-with-veto neuron" ([0x2778…099a](https://www.okx.com/web3/explorer/xlayer/tx/0x277868e6de15edc615d8dd963074018fb559470e15d27daac193089f17f8099a), block 72,516,013, no OKB value). The 14 catalog circuits were also named onchain that day by `sdk/scripts/label-catalog.ts` (14 `setLabel` transactions, no OKB value).
- **NeuralArena bot and Genesis Drop (2026-10-06).** The creator taped out circuit #16 "Neural Arena Bot", burning 590 NAND ([0x0867…6f78](https://www.okx.com/web3/explorer/xlayer/tx/0x0867ed331fa75965a70facd01b0a0f0f456c9c0be33b4e0f5787f5eec70b6f78), see [ARENA.md](ARENA.md)), deployed an ownerless instance of TapeOut's drops contract from TapeOut's published bytecode, [`0xf037…f9b9`](https://www.okx.com/web3/explorer/xlayer/address/0xf037a5543f19619a2291009ae1542b71d50ff9b9) ([0xd0f4…8e02](https://www.okx.com/web3/explorer/xlayer/tx/0xd0f4367fc525a3500658953c334adafbe490b16040e71cdbab6f8ad3bfcb8e02), block 72,516,039), and deposited 400 NAND into its drop #1 ([0x2d7c…8f20](https://www.okx.com/web3/explorer/xlayer/tx/0x2d7c052914b7e7a441b721ed025ce7e9bf832fb9804b85b885e6160ab1598f20), block 72,516,049), claimable by other wallets at 16 per address. CerebrAgent ([AGENT.md](AGENT.md)) uses the existing circuit #8 and burned no transistors.
- **Totals as of 2026-10-06 (read onchain).** `minted()` = 1,251, all minted by the deployment wallet; 747 burned (141 into #1-#14, 16 into #15, 590 into #16); 400 NAND deposited in the Genesis Drop; the creator holds **4 NAND + 100 LATCH**. Circuits #1-#16 are all owned by the creator and all labelled in CerebrScope. Only #5's brain wallet is opened.
- **One creator transfer.** Apart from the 400-NAND deposit into the Genesis Drop, every transistor and circuit transfer event by the creator since launch is a mint or burn. No other wallet has minted. One wallet outside the team has taped out: circuit #17, with Genesis Drop NAND (below).
- **Team test claims (disclosed).** Claims 1 and 2 of drop #1 are Cerebr team wallets testing the claim flow on mainnet, not outside users. The first, [`0xcd0a…3c02`](https://www.okx.com/web3/explorer/xlayer/address/0xcd0a2370f2dc12c1802707b7d9ab3fec891e3c02) ([0x4d18…2db6](https://www.okx.com/web3/explorer/xlayer/tx/0x4d186077dfab5eb3f5c25e0876d549ef9367ac1ac385105939928cde91ec2db6), block 72,527,608), is a Cerebr team wallet testing the claim flow on mainnet, not an outside user; the creator funded it with 0.003 OKB for gas in [0x6e93…e976](https://www.okx.com/web3/explorer/xlayer/tx/0x6e93f0ce306f9479d9615ef77f0fc3c3b2d3dbb1f3f171b1f5586ea7bc21e976) (block 72,527,598). The second, [`0xebb9…c426`](https://www.okx.com/web3/explorer/xlayer/address/0xebb92c8f27368222e4b722fb386dbc6fe80cc426) ([0x55e0…8a7a](https://www.okx.com/web3/explorer/xlayer/tx/0x55e03413c3dd05cbeff2b17aa0104acbd9030f531fe70e0544ec6e36078d8a7a), block 72,662,515), is a teammate's wallet.
- **Outside claims and the first outside tape-out (2026-10-08).** Claims 3-6 came from wallets outside the Cerebr team: no team wallet has sent them anything, and each paid its own gas. They are [`0x7b86…d1d0`](https://www.okx.com/web3/explorer/xlayer/address/0x7b864fb3aa6ddae51c0a5242f4fc50cf7866d1d0) ([0xf11d…72a6](https://www.okx.com/web3/explorer/xlayer/tx/0xf11d057d6cdf5404ed46e47df7b1795045d647b6cf3c8993f32f4d0b47af72a6), block 72,718,074, 19:18 UTC), [`0x78b7…1843`](https://www.okx.com/web3/explorer/xlayer/address/0x78b7f45415c7faaf7fc4741478379b34acc81843) ([0xc1ba…c748](https://www.okx.com/web3/explorer/xlayer/tx/0xc1ba322023954c886e62ea9caa4877068d5c9378ca82f9d08434b01b3c70c748), block 72,718,666, 19:28 UTC), [`0x58b8…7b5c`](https://www.okx.com/web3/explorer/xlayer/address/0x58b821c4d9c603f1cf818a6aa8c0ec9685757b5c) ([0xa6ae…1e89](https://www.okx.com/web3/explorer/xlayer/tx/0xa6ae49e21813e63661285b4a7e67650381c321e437b7f51cd6ae41c53f681e89), block 72,720,169, 19:53 UTC) and [`0xd4a8…aa9d`](https://www.okx.com/web3/explorer/xlayer/address/0xd4a80cdda4d12896ea3af9d210477c014758aa9d), an ERC-4337 smart account that claimed through the EntryPoint `0x0000000071727De22E5E9d8BAF0edAc6f37da032` ([0x69cf…e95b](https://www.okx.com/web3/explorer/xlayer/tx/0x69cf08ff84517f12bd88eed8012592d11dc4d1988f949c5720d8ef2a5bfae95b), block 72,720,552, 19:59 UTC). One minute later [`0xd4a8…aa9d`](https://www.okx.com/web3/explorer/xlayer/address/0xd4a80cdda4d12896ea3af9d210477c014758aa9d) taped out circuit #17 "Threshold Neuron" (y = [ +x0 −x1 +x2 ≥ 0 ], 3 in, 1 out, 5 NAND) with 5 of its 16 drop NAND ([0xe4ab…c18b](https://www.okx.com/web3/explorer/xlayer/tx/0xe4abca3220b0410ed0d01b5712b08dab9a842a855f78fcff308b849faca5c18b), block 72,720,601, 20:00 UTC) and named it in CerebrScope. It is the first circuit on Cerebr taped out by a wallet outside the team, and it owns it. We make no claim about who is behind them.
- **Totals at time of writing (block 72,721,877, read onchain).** `minted()` = 1,251, all minted by the deployment wallet (the outside builder used drop NAND, not a mint); `nextId()` = 17; 752 burned (747 by the creator, 5 by the builder of #17); drop #1 has **6 claims and 304 NAND remaining** (19 kits); the creator still holds **4 NAND + 100 LATCH**. #1-#16 are owned by the creator, #17 by [`0xd4a8…aa9d`](https://www.okx.com/web3/explorer/xlayer/address/0xd4a80cdda4d12896ea3af9d210477c014758aa9d). The 19 remaining claims are open to the public.
- **Mainnet UI test of the Arena and the marketplace (2026-10-06).** From the deployment wallet, through cerebr.xyz: two NeuralArena `newGame` calls [0xba04…72fd](https://www.okx.com/web3/explorer/xlayer/tx/0xba042db574a1e2cb0cf2db443a0926eb9107560576c515e653541561fbae72fd) and [0x6493…0f41](https://www.okx.com/web3/explorer/xlayer/tx/0x64936171f479283fc82be80b4ce44ec1e942a21fabc64861c7fa102cc0060f41) and one `play` (human centre, the network answered in a corner with an onchain `eval()` of #16, 1.41M gas) [0xc944…304a](https://www.okx.com/web3/explorer/xlayer/tx/0xc944e11b01b2b18c666eb963ad31b8d5335f0c6f6463058f1fe99f0ffeed304a); then circuit #15 on TapeOut's circuit market: `approve` [0x4757…39eb](https://www.okx.com/web3/explorer/xlayer/tx/0x475778f05cde1048bc8b6687a028ee73f7984f6e6086a293b904428030b339eb), `list` at 1 OKB [0x8251…edbb](https://www.okx.com/web3/explorer/xlayer/tx/0x8251f21e0a61a2263d9504989ae4bd1c92b6065eab8814cf0183500007dcedbb), `setPrice` to 1.4 OKB [0x7f89…f056](https://www.okx.com/web3/explorer/xlayer/tx/0x7f898098238cf2a9269f3b71f8c333ef052a81b69569e1bbcd27f3a085f2f056) and `delist` [0xe741…0af4](https://www.okx.com/web3/explorer/xlayer/tx/0xe741e88bdec69f9dabbd1e4e1329d7781bd86604bc7750363c154f128d150af4) (blocks 72,535,416-72,535,697). Nothing was bought or sold: no wallet we control has ever bought on the market, and #15 never left the creator.
- **Shared deployment wallet.** The deployment wallet is also used by other NetLayer Labs projects; none of those transactions touch Cerebr's contracts.
- **The kept transistors are not wash trading.** They are a primary mint at the public price, with no trades, transfers or sales, and they do not count as demand. Because the deployment wallet is also the creator, their unit price came back through `withdraw()`, so in practice they cost only the shared mint-call fee and gas. We state this rather than hide it.
- **No circular flows.** We never move transistors or circuits between wallets we control to inflate `minted`, the circuit count or volume. We use no sock-puppet minters and run no incentivised loops.
- **The creator's refund is disclosed.** When the creator mints, the unit price comes back through `withdraw()` (0.01241 OKB paid at launch). The 10-NAND test's 0.0001 OKB is still `owed()` to the creator and has not been withdrawn. Only the protocol fee is a real cost. We do not count those mints as demand.
- **Organic numbers only.** The landing page's Electrical characteristics table reads `minted()` and the circuit count directly from the chain. It shows no inflated or offchain figures.
