# Cerebr: hackathon submission

IGNIX X Layer "TapeOut Genesis Transistor" hackathon. Deadline: **2026-10-09 06:00 UTC+2** (confirmed).

## Submission fields

| Field | Value |
|---|---|
| Project name | Cerebr |
| One-liner | A neural processor, taped out on X Layer: neurons compiled to NAND netlists, composed with REF and run onchain with `eval()`. |
| Processor contract address (circuits) | [`0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`](https://www.okx.com/web3/explorer/xlayer/address/0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF) (created 2026-10-05, [tx](https://www.okx.com/web3/explorer/xlayer/tx/0x3295efc1ceec4aba0f918f89e5316fd62f1f705abdc52d483715e4fcada86815)) |
| Transistors contract address | [`0x84b5a5c6fE305319458113b87c09a2A241427D2D`](https://www.okx.com/web3/explorer/xlayer/address/0x84b5a5c6fE305319458113b87c09a2A241427D2D) |
| Deployment wallet | [`0xc742AdA2872a042dD36D2E706907b4036968960C`](https://www.okx.com/web3/explorer/xlayer/address/0xc742AdA2872a042dD36D2E706907b4036968960C) (= `creator`) |
| Transistor supply cap / unit price | 1,000,000 at 0.00001 OKB per transistor; 1,251 minted to date (1,241 at launch + 10 on 2026-10-06), all by the deployment wallet ([ISSUANCE.md](ISSUANCE.md)) |
| Circuits taped out | 16 (`nextId()` = 16): #1-#14 catalog (2026-10-05), #15 "Vote-with-veto neuron" taped out through the live app's Circuit Studio (2026-10-06) and #16 "Neural Arena Bot" for NeuralArena (2026-10-06), all verified onchain and named in CerebrScope (table below) |
| Flagship brain wallet | Open: `xor-net-ref` (#5) native account [`0x9E1d3eC3B3D0fe84997df0E065a96a7c93c13166`](https://www.okx.com/web3/explorer/xlayer/address/0x9E1d3eC3B3D0fe84997df0E065a96a7c93c13166) (open tx [0x8781…dad3](https://www.okx.com/web3/explorer/xlayer/tx/0x8781ed8467f4cef1d10dce3ec48cf1da99cfea615b250da8a352eda7a538dad3), 0.08 OKB) |
| CerebrScope | [`0x2640F8E89b2B107919568FFd42dFb46A1866e528`](https://www.okx.com/web3/explorer/xlayer/address/0x2640F8E89b2B107919568FFd42dFb46A1866e528) (deploy tx [0x17d0…9cfd](https://www.okx.com/web3/explorer/xlayer/tx/0x17d01f5dbdc49a9dc88d6fc2f7b347dd55bc903e17fa70cfd2d34ea036359cfd); source verified on [Sourcify](https://repo.sourcify.dev/contracts/full_match/196/0x2640F8E89b2B107919568FFd42dFb46A1866e528/), exact match) |
| CerebrAgent | [`0x3d736c6419dCa667a351907578b68717Cd6e3340`](https://www.okx.com/web3/explorer/xlayer/address/0x3d736c6419dCa667a351907578b68717Cd6e3340) (deploy tx [0xa9aa…a31f](https://www.okx.com/web3/explorer/xlayer/tx/0xa9aaacef0f3af99dc0046a67d5e3132879c65301415fca4b10202d617e15a31f); source verified on Sourcify, exact match): an autonomous agent whose policy is circuit #8, acting every 10 minutes ([AGENT.md](AGENT.md)) |
| Demo video | **TODO_USER** (2 minutes; script below) |
| dApp / landing page | https://cerebr.xyz (landing) and https://cerebr.xyz/app (dApp), self-hosted on our VPS over HTTPS |
| Repository | https://github.com/NetLayerLabs/Cerebr (**currently private: make it public before submitting**) |
| Contact | NetLayer Labs: [netlayerlabs@gmail.com](mailto:netlayerlabs@gmail.com), X [@NetLayerLabs](https://x.com/NetLayerLabs). Builder: Telegram [@mr_network001](https://t.me/mr_network001), X [@encrypt_wizard](https://x.com/encrypt_wizard), [mrnetwork0001@gmail.com](mailto:mrnetwork0001@gmail.com) |

### Circuits taped out (X Layer mainnet)

Processor [`0xB04E…93FF`](https://www.okx.com/web3/explorer/xlayer/address/0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF). #1-#14 were taped out by the launch script on 2026-10-05, which checked every circuit's `eval` (or `step`) against the simulator on every input. #15 was taped out through the live app's Circuit Studio during a real-wallet test on 2026-10-06. #16 is the NeuralArena bot ([ARENA.md](ARENA.md)). Flagships in bold.

| Id | Circuit | Elements | Tapeout tx |
|---|---|---|---|
| #1 | AND Neuron | 2 NAND | [0xeb5e…8254](https://www.okx.com/web3/explorer/xlayer/tx/0xeb5e9cedb905ad98209f04a40b2a93e7caaadce88f031b2bcb07f21d78d18254) |
| #2 | OR Neuron | 3 NAND | [0x9dbc…0895](https://www.okx.com/web3/explorer/xlayer/tx/0x9dbcfd1e5b9a00083bd1058a83108778cb5f242a19e60f425bd782d8d7770895) |
| #3 | Inhibitory Neuron (NAND) | 1 NAND | [0xab5b…8a81](https://www.okx.com/web3/explorer/xlayer/tx/0xab5badaeb079e3274b02a1642f4f345e4879f6f17373af732e6449dcc2168a81) |
| #4 | The XOR Problem | 6 NAND | [0x4ace…30a8](https://www.okx.com/web3/explorer/xlayer/tx/0x4ace108c8ecb85f8ea47d6a13cc9e96c7e3013a4618ed086401cbce6519930a8) |
| #5 | **The XOR Problem (REF-composed)** | 3 REF | [0xc3e1…b66e](https://www.okx.com/web3/explorer/xlayer/tx/0xc3e10087944a57070a3f4acf618992085d06d6af5e381b4675d9fd482976b66e) |
| #6 | Majority-3 | 6 NAND | [0x2418…15ca](https://www.okx.com/web3/explorer/xlayer/tx/0x2418f266c2f0ba0b728813c8cf07999ec0fb41efdb81d42b7d1f2b941d3315ca) |
| #7 | Majority-5 | 24 NAND | [0xb25b…5558](https://www.okx.com/web3/explorer/xlayer/tx/0xb25b7f1822c3aa229ec7931ba8728cdb656e8b56f11d430913f87ae095c95558) |
| #8 | Go/No-Go Neuron | 19 NAND | [0xc58e…fd3d](https://www.okx.com/web3/explorer/xlayer/tx/0xc58e60186673067a51e6606901a65195267599730f716180b95ba4ef95d3fd3d) |
| #9 | Line Cell | 4 NAND | [0xdcdf…3819](https://www.okx.com/web3/explorer/xlayer/tx/0xdcdf8f9a4bbb13b57b30f3a8f437499f68e8d0b9fd2e9f41d955043fb9233819) |
| #10 | Any-of-3 Neuron | 6 NAND | [0x57a1…b37a](https://www.okx.com/web3/explorer/xlayer/tx/0x57a1e3547687a8ff7ef97cb01b9366768b295f7c73a1120c4f4461b44e7cb37a) |
| #11 | Line Detector | 37 NAND | [0x69a2…dce5](https://www.okx.com/web3/explorer/xlayer/tx/0x69a23927d56107894ba2b62a4c73829d5770c1db4194d8105a2ed8bb6319dce5) |
| #12 | **Line Detector (REF-composed)** | 11 REF | [0x65fa…48ea](https://www.okx.com/web3/explorer/xlayer/tx/0x65fa37ad39f3d62ff4088ef352904ec9ee8520ec7ada0326652f13cccc2648ea) |
| #13 | 2-bit Adder | 14 NAND | [0xdbbe…f3f3](https://www.okx.com/web3/explorer/xlayer/tx/0xdbbec9cd6b0909f3e505e3927f6f9e8e3f60e63039fd2aaae9ac01a141dbf3f3) |
| #14 | Integrate-and-Fire Neuron | 17 NAND + 2 LATCH | [0x91e5…7016](https://www.okx.com/web3/explorer/xlayer/tx/0x91e5a6585576e608318a33d7d616b0e6fe769bce3aa3510b9e08782ca11d7016) |
| #15 | Vote-with-veto neuron, y = [x0 + x1 + x2 - x3 ≥ 2] (Studio, real-wallet test) | 16 NAND | [0x4133…1c15](https://www.okx.com/web3/explorer/xlayer/tx/0x413387037233847f2d2dd24c2bfa0733a5300d93e4e4f195d3ac9bd4ca1f1c15) |
| #16 | **Neural Arena Bot** (tic-tac-toe, 18 → 9) | 590 NAND | [0x0867…6f78](https://www.okx.com/web3/explorer/xlayer/tx/0x0867ed331fa75965a70facd01b0a0f0f456c9c0be33b4e0f5787f5eec70b6f78) |

## Project description (about 330 words)

**Cerebr is a neural processor built on TapeOut.** TapeOut lets anyone create a processor on X Layer: transistors you mint, and circuits you tape out by burning them. Cerebr adds what turns those gates into intelligence, a compiler from neurons to NAND netlists.

A Cerebr neuron is a binary threshold unit: integer weights, a threshold, and a 0 or 1 output. Our compiler tries four constructions for each neuron (decision diagrams of multiplexers, or popcount plus compare, each in two forms) and keeps the one with the fewest gates. An AND neuron costs 2 NAND, a 5-input "Go/No-Go" neuron 19, and an integrate-and-fire spiking neuron 17 NAND plus 2 LATCH. Each circuit is taped out on the Cerebr processor and burns exactly as many transistors as it has gates.

Neurons then become networks. The XOR problem, which no single neuron can solve, is a 2-layer network: OR and NAND neurons feeding an AND. On Cerebr it is a circuit that **REFs three taped-out neurons**. It burns no new transistors, and anyone can verify the answer with a free `eval()` call. The same idea scales to a 3×3 line detector built from 11 REFs. Every circuit is checked against its reference model on all inputs, both in our simulator, which matches TapeOut's own client byte for byte, and on a fork of X Layer mainnet.

The product around it:
- **A dApp** to mint transistors, build a neuron, tape it out, test it live and browse the gallery.
- **Brain wallets.** Each circuit can open TapeOut's native ERC-6551 account.
- **CerebrScope.** An onchain renderer that draws every circuit as an SVG die shot from its real gates. TapeOut's own `tokenURI` is empty.
- **An SDK** that other teams can build with.

**Issuance is simple.** There is one asset, the transistor: 1,000,000 at 0.00001 OKB, a cap and price fixed by Cerebr at `createCPU` (enforced by TapeOut's upgradeable contracts), no reserved allocation (1,251 minted via the public `mint()` at the public price, 747 burned into 16 circuits, 400 NAND deposited in the Genesis Drop, 4 NAND + 100 LATCH held by the creator, all disclosed) and no curve. Burns never refill the cap. REF makes reuse free, so every network built on our neurons grows the graph instead of copying it.

**Use cases:**
- Onchain game AI that anyone can audit.
- Small, verifiable decision primitives for DeAI agents.
- Public neurons that any TapeOut team can REF into their own circuits.

## Use case

Small, verifiable intelligence that lives entirely onchain. A game, a DAO or an agent can call a Cerebr circuit to decide something: whether a pattern contains a line, whether a majority voted yes, whether enough excitatory signals beat the inhibitory ones. Anyone can recompute the same decision with a free `eval()` call. There is no oracle, model server or trust assumption beyond the X Layer chain and TapeOut's contracts. Because circuits are public and REF-able, every Cerebr neuron is a building block other teams can wire into their own TapeOut processors.

## Eligibility

| Requirement | How Cerebr meets it | Evidence |
|---|---|---|
| Processor deployed on X Layer **through the TapeOut factory** | `createCPU` on the TapeOut factory; `factory.isCPU(processor) = true` | [create tx](https://www.okx.com/web3/explorer/xlayer/tx/0x3295efc1ceec4aba0f918f89e5316fd62f1f705abdc52d483715e4fcada86815), [`sdk/scripts/launch.ts`](sdk/scripts/launch.ts) |
| Transistor supply, unit price and cap set and disclosed at deployment | **1,000,000 transistors at 0.00001 OKB**, the parameters of `createCPU`, recorded in its `CPUCreated` event and shown live on the landing page | [ISSUANCE.md](ISSUANCE.md), [`launch/config.json`](launch/config.json) |
| At least one circuit taped out | **16 circuits**, each checked onchain against the simulator or a reference model on every input | [catalog](README.md#the-circuit-catalog) |
| A clear use case | Verifiable onchain inference: an autonomous agent that decides with a neuron, a game AI, user-trained classifiers, and public neurons other teams can `REF` | [Product tour](README.md#product-tour) |
| Mainnet launch | X Layer mainnet, chain 196 | [addresses](README.md#live-on-x-layer-mainnet) |

## Judging criteria

| Criterion | What we show |
|---|---|
| **Application innovation** | A neural compiler for TapeOut: gates become neurons, `REF` becomes the connections between them, `eval` becomes inference. A spiking neuron runs on LATCH state with `step()`. In-browser training that finds the hidden layer when one neuron is not enough. An autonomous agent whose policy is a taped-out circuit, and a game opponent that is a 590-gate network. |
| **Depth of TapeOut integration** | Uses every TapeOut primitive: `createCPU`, `mint` (NAND and LATCH), `tapeout`, `REF`, `eval`, `step`, the circuit NFTs, native brain wallets (`opener.open`, `accountOf`), the drops contract (an ownerless instance of TapeOut's published bytecode, deployed by Cerebr) and the circuit marketplace. Two of our contracts call `eval()` from inside a transaction. Every behaviour was verified on a mainnet fork, then on mainnet ([TAPEOUT.md](TAPEOUT.md)). |
| **Product completeness and UX** | A landing page whose every figure is read live from X Layer and a 7-view dApp (Processor, Circuit Studio, Train, Inference, Arena, Gallery, Agent). Two languages, two themes, mobile wallet deep links, simulated writes and exact fee quotes. Plus an SDK, three verified contracts, a launch runbook and a production keeper service. |
| **Asset issuance design** | One asset, the transistor: fixed supply and price, burned by use, reuse through `REF` is free. No curve, no presale, no reserved allocation; the creator's mints are disclosed. A Genesis Drop of 400 NAND hands new builders 16 each; the one claim so far is our own disclosed test. See [Asset issuance](README.md#asset-issuance). |
| **Quality of X Layer integration** | Native OKB fees, OKX Wallet first (with deep links into the OKX and MetaMask apps on mobile), OKX Explorer links throughout, batched reads against the public X Layer RPC, gas from `eth_estimateGas`, and ~1-second blocks that make a live tape-out-and-test loop and a 10-minute agent practical. Handles X Layer specifics such as `eth_call` seeing a basefee of 0. |
| **User growth potential** | A first neuron costs two transactions; the Genesis Drop pays the transistors. Every taped-out neuron is a public building block that any team on any TapeOut processor can `REF` for free. Circuits can be listed and bought on the TapeOut market. The Arena and Agent give non-builders a reason to visit. |
| **Contract security and economic model** | No custody. Our three contracts have no admin and no payable functions, and their source is verified. Gas-capped inference with strict decoding, so a bad circuit can never block a game or the agent. The keeper is permissionless and holds only gas money. Internal review rounds, fuzzing and fork tests ([AUDIT.md](AUDIT.md), an internal review, not a third-party audit). |

## Demo video script (2:00)

Record at 1440p in the dApp on X Layer mainnet, after launch, with OKX Wallet. Keep the wallet balance visible but blur the address if needed. Each shot lists the screen, then the voice-over.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00-0:10 | Landing hero with the live processor pinout, then a slow scroll to the Electrical characteristics table (minted / cap, circuits taped out, fees). | "This is Cerebr, a neural processor taped out on X Layer through TapeOut. These numbers are read live from our processor." |
| 0:10-0:25 | XOR section: the network diagram, the input-plane plot and the truth table. | "A single neuron can't compute XOR, because no straight line separates the cases. Two layers can. Cerebr compiles each neuron to NAND gates and tapes it out." |
| 0:25-0:40 | dApp, Processor view: the supply cap, unit price and fees. Mint 10 NAND and confirm in OKX Wallet. OKX Explorer tx link appears. | "Transistors are the asset. The cap and price were fixed at deployment. I mint ten NAND, paying the unit price plus TapeOut's per-call fee, sent exactly." |
| 0:40-1:05 | Studio: choose "Threshold neuron" and set a **new** design that is not already onchain (for example weights +1 +1 +1 +1 -1, threshold 3; check it against #1-#16 first). The compiler shows the gate count and the truth table. Tap "Tape out", confirm, and name it onchain. The new circuit id appears. | "In the Studio I build a new neuron: four excitatory inputs, one inhibitory, threshold three. The compiler picks the smallest of four constructions and checks every input before tape-out." |
| 1:05-1:25 | Inference: open the XOR (REF) circuit. Toggle x0 and x1 and the output lights up live through `eval`. Show "0 NAND + 3 REF". | "This XOR network is built from three neurons that were already taped out, linked with REF. It burned no new transistors. Every result here is a free eval call onchain." |
| 1:25-1:40 | Inference: the integrate-and-fire neuron. Send spikes 1, 1, 1 and it fires on the third. Then send inhibit and the state resets. | "Neurons can have memory. This spiking neuron uses two latches and fires on every third spike, using TapeOut's step function." |
| 1:40-1:52 | Gallery: grid of die shots drawn from each circuit's netlist. Flip the switch to CerebrScope's onchain SVG, then open one to show its brain-wallet address and the "Open wallet" button. | "Each die shot is drawn from the circuit's real gates, and CerebrScope draws the same image onchain. Each circuit can open TapeOut's native wallet, so a neuron can hold assets and act." |
| 1:52-2:00 | Back to the landing CTA, with the processor address and the GitHub URL overlaid. | "Cerebr: neurons you can own, run and reuse on X Layer. Processor address and code are below." |

Before recording, check that:
- every onscreen transaction is a real, single-purpose action, with no self-trading;
- the taped-out design is new, not a duplicate of an existing circuit;
- the circuit ids shown match `launch/out/196.json` (#1-#14) and the chain (#15 onward);
- the fee shown in the Processor view matches `readFees()` on the day.

After recording, disclose the demo's mint, tape-out and label transactions in [ISSUANCE.md](ISSUANCE.md) §6.

## Also built (in the app, on X Layer mainnet)

- **Genesis Drop**: drop #1 on [`0xf037a5543f19619a2291009ae1542b71d50ff9b9`](https://www.okx.com/web3/explorer/xlayer/address/0xf037a5543f19619a2291009ae1542b71d50ff9b9), an ownerless instance of TapeOut's drops contract deployed by Cerebr ([deploy tx](https://www.okx.com/web3/explorer/xlayer/tx/0xd0f4367fc525a3500658953c334adafbe490b16040e71cdbab6f8ad3bfcb8e02), [create tx](https://www.okx.com/web3/explorer/xlayer/tx/0x2d7c052914b7e7a441b721ed025ce7e9bf832fb9804b85b885e6160ab1598f20)), 400 NAND at 16 per address. At time of writing it has 1 claim and 384 NAND remaining; that claim is a Cerebr team test wallet, `0xcd0a…3c02`, disclosed ([tx](https://www.okx.com/web3/explorer/xlayer/tx/0x4d186077dfab5eb3f5c25e0876d549ef9367ac1ac385105939928cde91ec2db6), block 72,527,608). The Processor view shows it live, simulates the claim, then opens the Studio on a 16-NAND neuron that is not onchain yet.
- **Train** (`/app#train`): in-browser training of threshold networks from drawn examples (SDK `trainNetwork` / `compileTrained`), verified on every input, then taped out and named onchain like any Studio design.
- **Arena** (`/app#arena`): tic-tac-toe against bot circuit #16 through NeuralArena [`0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD`](https://www.okx.com/web3/explorer/xlayer/address/0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD); each move's inference receipt is decoded and replayable with `eval()`.
- **Agent** (`/app#agent`): CerebrAgent [`0x3d736c6419dCa667a351907578b68717Cd6e3340`](https://www.okx.com/web3/explorer/xlayer/address/0x3d736c6419dCa667a351907578b68717Cd6e3340) is an autonomous agent whose brain is circuit #8 (Go/No-Go Neuron, 19 NAND). A keeper calls `act()` every 10 minutes; the contract derives five input pins from chain state, runs one `eval()` of #8 and records the verdict. No funds, no admin. The read-only Agent view shows the live pins, the decision feed and an `eval()` replay of every stored decision.
- **Marketplace** (Gallery cards): list, reprice, delist and buy circuits on TapeOut's circuit market [`0xd89f358c48a7B632c9845af2a02A32eB90DD75DB`](https://www.okx.com/web3/explorer/xlayer/address/0xd89f358c48a7B632c9845af2a02A32eB90DD75DB) (1% fee fixed per listing, brain wallet moves with the NFT). Cerebr wallets never buy.

Each write flow was tested end to end through the real UI on a local fork of X Layer mainnet. The Agent view is read-only and was checked against mainnet.

## Final checklist before submitting

- [x] The user has confirmed the supply cap and unit price in `launch/config.json` (`issuance.confirmed: true`): 1,000,000 at 0.00001 OKB.
- [x] The launch has been rehearsed on a fork.
- [x] Mainnet launch signed by the deployment wallet (2026-10-05); `launch/out/196.json` written and synced into the app. Commit it with `launch/state.196.json`.
- [x] The flagship `xor-net-ref` brain wallet is open (0x9E1d…3166).
- [x] CerebrScope is deployed (0x2640…e528, Sourcify-verified) and `scope` appears in `launch/out/196.json`.
- [x] The processor address, deployment wallet and circuit tx links are filled in above and in README.md.
- [x] The landing page's Electrical characteristics table shows the mainnet CPU, and the issuance values are the real ones.
- [ ] The demo video is uploaded and linked.
- [x] The deadline is confirmed: 2026-10-09 06:00 UTC+2.
- [ ] Make the repo public.
- [x] dApp hosting URL filled in above: https://cerebr.xyz, live over HTTPS (Let's Encrypt), every view checked in a browser on 2026-10-06 with 0 errors.
- [x] Contact filled in above.
- [ ] Demo transactions disclosed in ISSUANCE.md §6.
