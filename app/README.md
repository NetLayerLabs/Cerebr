# Cerebr dApp: neural processor on TapeOut

`/app` is the Cerebr Neural Processor app, built on a TapeOut CPU (processor) created through the TapeOut factory on X Layer. The landing page is at `/`.

- **Processor** (`#processor`): CPU stats read live from TapeOut (supply cap, minted, remaining, unit price, protocol fee, tape-out fee, circuit count). It also shows the issuance terms disclosure, a NAND / LATCH mint panel with the exact `msg.value` breakdown, the creator's `withdraw()`, and which catalog circuits are already onchain. The **Genesis Drop** card sits under the hero: live state of drop #1 on TapeOut's ownerless drops contract (`0xf037…f9b9`, 16 NAND per address), a simulated `claim()` with decoded reverts, then a "next step" quote that opens the Studio on a 16-NAND neuron not yet onchain (`#studio/neuron:<w,..>:<θ>`). The landing page shows a small live link to it until the drop is drained.
- **Circuit Studio** (`#studio[/<catalogId>]`): pick a catalog circuit, or design a threshold neuron (weights −1/0/+1, θ slider) or a 2-layer network (wired by REF or flattened). It shows the compiled netlist's die shot, gate counts, cost and the simulator truth table (checked against the neural model). **Tape out** mints any missing transistors in one call per kind, tapes out missing REF dependencies first, then tapes out the design.
- **Inference** (`#playground/<circuitId>`): runs onchain `eval()` as an `eth_call` (or `step()` for stateful circuits) next to the local simulator, with the eval's gas. It has a 3×3 pixel grid for the line detector and can check all 2^n inputs onchain.
- **Train** (`#train[/<presetId>]`): draw Fires / Silent examples on a 3×3 or 4×4 pixel grid (or 2 to 5 bits), or start from one of the SDK's `TRAINING_PRESETS`. `trainNetwork(..., { prefer: 'robust' })` trains in the browser (exact search, perceptron or local search), shows the weights as heatmaps, the margin and the "XOR moment" when no single neuron fits, and scores the preset's held-out drawings. `compileTrained` checks the NAND netlist against the model on every input before the Studio's own tape-out flow (mint, tape out, name onchain with pin names `r{row}c{col}`) is offered; changing the examples after training blocks the tape-out until you retrain.
- **Arena** (`#arena[/<gameId>]`): tic-tac-toe against circuit #16 through NeuralArena (`0xD984…62BD`). `newGame()` and `play(gameId, cell)` are simulated first; `play` is sent with an explicit gas limit (estimate + 5%, at least +60k, at most 3.3M) because the contract requires ~3.1M available while charging ~1.42M. Each move gets an inference receipt (input and output bits, gas, fallback reason) decoded from its events, with a "Replay with eval()" check. A free `previewBotMove` read shows the bot's answer before you commit. Stats, your games and resume of your active game come from contract reads.
- **Gallery** (`#gallery`): die shots drawn from each circuit's real netlist (CerebrScope's onchain SVG is used instead when a scope address is configured), owners, and each circuit's native TapeOut brain wallet (address, balance, open through the opener). Owners of a circuit without an onchain name get a **Name onchain** action (the catalog label when the bytes match a catalog circuit, else a name they type).
- **Agent** (`#agent`): read-only view of CerebrAgent (`0x3d73…3340`), an autonomous agent whose policy is circuit #8 (Go/No-Go Neuron, 19 NAND); a keeper calls `act()` every 10 minutes. It shows `stats()`, the live observation from `observeAt(latest block baseFeePerGas)` (an `eth_call` without a gas price sees `BASEFEE = 0` on X Layer) as five pin lamps with their weights, the weighted sum against θ = 2 and the next allowed act block, a 24 h strip of Go / No-Go dots, and the 64-entry ring buffer from `decisions()` (X Layer's RPC caps `eth_getLogs` at ~100 blocks, so logs are not used). Each row's **Replay** calls `eval(8, inputs)` and compares it with the recorded output, then runs the SDK's `checkRecord` locally (`sdk/src/neuro/agent.ts`). No wallet needed, no write buttons. `VITE_AGENT_196` overrides the address.
- **Marketplace** (in every Gallery card, plus a **For sale** filter): TapeOut's circuit market (`0xd89f…75DB`). Owners list with a single-token `approve` then `list` (or one call when already approved), reprice or delist; buyers see price, seller, the 1% fee fixed for that listing and the brain wallet that moves with the NFT, and `buy` re-reads the listing and passes the expected price. Stale listings show **Clear** (`delistStale`, anyone). Cerebr wallets never buy on the marketplace (no self-trading). Every click is locked until its flow ends, so a double click cannot send twice.

**Circuit names are onchain.** Every view reads circuit names, descriptions and pin names from CerebrScope's label registry (`labelOf`, one multicall for all circuits, read in parallel with the circuit list). Fallback order: the onchain label, then the catalog circuit recognised from the exact netlist bytes (`identifyCircuits`), then `Circuit #N`. Labels are written with `CerebrScope.setLabel` (owner only; name 64 bytes, description 512, at most nIn / nOut pin names of 32 bytes each, clipped client-side by `fitLabel`). The studio's tape-out ends with a separate **Name it onchain** transaction; rejecting it keeps the circuit, and it can be retried or skipped. Nothing is cached in the browser: the CPU, circuits and labels shown are live chain reads.

**Network and wallets.** The app runs on **X Layer mainnet (196) only**, with real injected wallets (OKX Wallet first, then any EIP-6963 / injected wallet). There is no test account, mock connector or local fork in the app.

**Config.** `npm run sync` turns the launch script's mainnet record (`../launch/out/196.json`, schema `cerebr.launch/1`) into `src/generated/cpus.ts`; fork rehearsal records (`*.fork.json`) are skipped. A `scope` address in the record (set `scope` in `launch/config.json`) turns on CerebrScope images and onchain labels. `VITE_CPU_196` / `VITE_SCOPE_196` override them at build time.

**Smoke test** (Node only, same lib code paths as the UI; local forks only). The fork chain lives in `scripts/fork-chain.ts` and is never imported by the browser bundle:

```bash
anvil --fork-url https://rpc.xlayer.tech --chain-id 31337 --port 8564
FORK_RPC=http://127.0.0.1:8564 npm run smoke     # createCPU, tape out the catalog, name a circuit onchain, eval/step = simulator, open a brain wallet
```

`CPU=0x..` reuses an existing CPU (for example the mainnet one on a fork); `CHAIN_ID` must match anvil's `--chain-id`. Anvil dev accounts #0, #1 and #5 carry EIP-7702 delegations on X Layer mainnet, so on a fork they reject ERC-1155 transistors: the smoke test signs with account #2.

**Build and deploy.** `npm run build` (typecheck + Vite) writes `dist/`; host it on any static host (`vercel.json` routes `/app`). After a launch: `npm run sync && npm run build`. See `.env.example` for overrides.

**Vercel settings.** Import `NetLayerLabs/Cerebr`, then set:

| Setting | Value |
|---|---|
| Root Directory | `app` |
| Include files outside the Root Directory | **enabled** (the app builds `../sdk` and `../launch` from source) |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | none required (optional `VITE_RPC_196` for a private RPC) |

| Script | |
|---|---|
| `npm run dev` | Vite dev server (X Layer mainnet) |
| `npm run build` | `tsc --noEmit` and a production build to `dist/` |
| `npm run sync` | `../launch/out/196.json` -> `src/generated/cpus.ts` |
| `npm run smoke` | end-to-end fork test (`FORK_RPC`, loopback only; `CPU=0x..` reuses an existing CPU, `CHAIN_ID` the fork's chain id) |

**Circuit transfers.** The app offers no NFT transfers. Never send a circuit NFT into its own brain wallet (`accountOf(circuit)`): the wallet would own itself and be locked for good.
