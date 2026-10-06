# Cerebr dApp: neural processor on TapeOut

`/app` is the Cerebr Neural Processor app, built on a TapeOut CPU (processor) created through the TapeOut factory on X Layer. The landing page is at `/`.

- **Processor** (`#processor`): CPU stats read live from TapeOut (supply cap, minted, remaining, unit price, protocol fee, tape-out fee, circuit count). It also shows the issuance terms disclosure, a NAND / LATCH mint panel with the exact `msg.value` breakdown, the creator's `withdraw()`, and which catalog circuits are already on chain.
- **Circuit Studio** (`#studio[/<catalogId>]`): pick a catalog circuit, or design a threshold neuron (weights −1/0/+1, θ slider) or a 2-layer network (wired by REF or flattened). It shows the compiled netlist's die shot, gate counts, cost and the simulator truth table (checked against the neural model). **Tape out** mints any missing transistors in one call per kind, tapes out missing REF dependencies first, then tapes out the design.
- **Inference** (`#playground/<circuitId>`): runs onchain `eval()` as an `eth_call` (or `step()` for stateful circuits) next to the local simulator, with the eval's gas. It has a 3×3 pixel grid for the line detector and can check all 2^n inputs onchain.
- **Gallery** (`#gallery`): die shots drawn from each circuit's real netlist (CerebrScope's onchain SVG is used instead when a scope address is configured), owners, and each circuit's native TapeOut brain wallet (address, balance, open through the opener). Owners of a circuit without an onchain name get a **Name onchain** action (the catalog label when the bytes match a catalog circuit, else a name they type).

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
