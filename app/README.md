# Cerebr dApp: neural processor on TapeOut

`/app` is the Cerebr Neural Processor app, built on a TapeOut CPU (processor) created through the TapeOut factory on X Layer. The landing page is at `/`.

- **Processor** (`#processor`): CPU stats read live from TapeOut (supply cap, minted, remaining, unit price, protocol fee, tape-out fee, circuit count). It also shows the issuance terms disclosure, a NAND / LATCH mint panel with the exact `msg.value` breakdown, the creator's `withdraw()`, and which catalog circuits are already on chain.
- **Circuit Studio** (`#studio[/<catalogId>]`): pick a catalog circuit, or design a threshold neuron (weights −1/0/+1, θ slider) or a 2-layer network (wired by REF or flattened). It shows the compiled netlist's die shot, gate counts, cost and the simulator truth table (checked against the neural model). **Tape out** mints any missing transistors in one call per kind, tapes out missing REF dependencies first, then tapes out the design.
- **Inference** (`#playground/<circuitId>`): runs on-chain `eval()` as an `eth_call` (or `step()` for stateful circuits) next to the local simulator, with the eval's gas. It has a 3×3 pixel grid for the line detector and can check all 2^n inputs on-chain.
- **Gallery** (`#gallery`): die shots drawn from each circuit's real netlist (CerebrScope's on-chain SVG is used instead when a scope address is configured), owners, and each circuit's native TapeOut brain wallet (address, balance, open through the opener).

**Config.** `npm run sync` turns the launch script's records (`../launch/out/*.json`, schema `cerebr.launch/1`) into `src/generated/cpus.ts`; fork records (`*.fork.json`) map to the local fork chain 31337, and a `scope` address in the record (set `scope` in `launch/config.json`) turns on CerebrScope images. `VITE_CPU_<chainId>` / `VITE_SCOPE_<chainId>`, or `?cpu=0x…` (a circuits address), override it. The chains are X Layer (196) and, in dev, a local X Layer fork on chain id 31337 (`anvil --fork-url https://rpc.xlayer.tech --chain-id 31337`).

**Fork note:** anvil dev accounts #0, #1 and #5 carry EIP-7702 delegations on X Layer mainnet, so on a fork they reject ERC-1155 transistors. The dev connector and the smoke test use account #2.

**Smoke test** (same lib code paths as the UI; local forks only):

```bash
anvil --fork-url https://rpc.xlayer.tech --chain-id 31337 --port 8564
FORK_RPC=http://127.0.0.1:8564 npm run smoke     # createCPU, tape out the catalog, eval/step = simulator, open a brain wallet
```

**Build and deploy.** `npm run build` (typecheck + Vite) writes `dist/`; host it on any static host (`vercel.json` routes `/app`). After a launch: `npm run sync && npm run build`. The app shows **X Layer mainnet only**; the local fork is a developer opt-in (`VITE_ENABLE_ANVIL=true`, plus `npm run sync -- --fork`). See `.env.example` for overrides.

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
| `npm run dev` | Vite dev server (offers the local fork and dev account #2) |
| `npm run build` | `tsc --noEmit` and a production build to `dist/` |
| `npm run sync` | `../launch/out/*.json` -> `src/generated/cpus.ts` |
| `npm run smoke` | end-to-end fork test (`FORK_RPC`, loopback only; `CPU=0x..` reuses an existing CPU) |

**Circuit transfers.** The app offers no NFT transfers. Never send a circuit NFT into its own brain wallet (`accountOf(circuit)`): the wallet would own itself and be locked for good.
