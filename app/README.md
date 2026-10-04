# Cerebr dApp

A one-page dApp for the Cerebr protocol, built with Vite, React, TypeScript, viem and wagmi v3. It runs on X Layer mainnet (196), X Layer testnet (1952) and a local anvil node (31337).

## What it does

- **Live bonding curve chart.** It draws `lens.curvePoints(120)` and marks where the supply is now. The OKB reserve is shaded under the curve, and the buy or sell you are typing is previewed on the chart. Hover to read the price at any supply.
- **Buy and sell.**
  - **Buy by exact OKB:** the app quotes with `lens.quoteBuyExactOKB`. You get exactly the CBR it quotes, and the most you can spend is the quote plus your slippage. The contract refunds any OKB it doesn't use.
  - **Buy by exact CBR:** the app quotes with `quoteBuy`.
  - **Sell:** the app quotes with `quoteSell`. Your minimum refund is the quoted net amount minus your slippage.
  - **Slippage:** choose 0.1%, 0.5%, 1% or 3%, or type your own.
  - **Fair-launch caps:** while the launch window is open, the app shows the caps and checks your buy against them.
- **Tape-out per tier.** There is a card for Basic (5k CBR), Pro (20k) and Quantum (100k). Basic calls the canonical `tapeOutCircuit()`. Each card shows the rarity odds, the trait ranges and the OKB cost of buying that much CBR now. Singularity can only be made by fusion.
- **Fusion picker.** Pick two revealed Circuits of the same tier that have never been fused (`fusedInto == 0`; each Circuit can be a fusion parent only once). The app shows the CBR cost and the tier you will get, then calls `fuseCircuits`. Used parents carry a "fused → #child" badge in the gallery.
- **Circuit gallery.**
  - Each card shows the on-chain SVG from `tokenURI`. Only inline `data:image/svg+xml` images are rendered.
  - Unrevealed Circuits show as a sealed wafer. The **Reveal** button turns on once `revealReadyBlock` is reached. **Reveal all ready** reveals every Circuit that is ready.
- **Brain wallet (ERC-6551).**
  - Every Circuit card shows its token-bound account: the address, whether it has been created yet, and its OKB balance.
  - **Activate brain wallet** calls `registry.createAccount(...)`.
  - The card lists any Circuits held inside that account, such as the parents of a fusion.
  - **withdraw** pulls a held Circuit back to your wallet through `account.execute`. Circuits inside a brain wallet can only be moved by the wallet itself (`execute`), never by an operator it approved.
  - Do not approve ERC-20s to Permit2 (or similar signature-based spenders) from a brain wallet: the wallet accepts its owner's signatures (ERC-1271), and ERC-20 approvals survive a sale of the Circuit. See `AUDIT.md`.
- **Live counters.** These come from `lens.protocolState()` and refresh every block:
  - spot price, supply and OKB reserve
  - **surplus reserve** (locked forever) and **CBR burned**
  - Circuits minted per tier
  - pause and launch-window banners
- **Wallets.** OKX Wallet is listed first (`window.okxwallet`). Any other injected or EIP-6963 wallet also works. On anvil only, there is an "Anvil dev account #0" connector. It sends `eth_sendTransaction` to anvil's unlocked account, so the app never holds a private key.

Before sending, every transaction is simulated so that custom errors show up as readable messages, such as `SlippageExceeded` or `LaunchWalletCapExceeded`. The app then waits for the receipt and refreshes all reads.

## Layout

```
app/
  scripts/gen-abi.mjs           forge artifacts -> src/abi/*.ts (typed `as const`)
  scripts/sync-deployments.mjs  ../deployments/<chainId>.json -> src/generated/deployments.ts
  scripts/smoke.ts              node + viem end-to-end test (same ABIs/config as the app)
  scripts/local-demo.sh         anvil + LocalDemo deploy/seed + abi + sync, in one go
  scripts/keeper.ts             optional permissionless reveal keeper (backup to the on-chain auto-reveal)
  src/config/chains.ts          X Layer 196 / 1952 / anvil 31337 (pure, Node-importable)
  src/config/deployments.ts     deployment lookup (pure, Node-importable)
  src/config/env.ts             VITE_* overrides (see .env.example)
  src/components/*              Header, Stats, CurveChart, TradePanel, TapeOutPanel, FusionPanel, Gallery
```

The app only needs the **CerebrLens** address for each chain. It reads every other address (processor, circuit, registry and account implementation) from `lens.protocolState()`.

## Run locally (anvil)

Requirements: Foundry and Node 23.6 or newer. Node runs `scripts/smoke.ts` directly, with no extra dependencies.

```bash
# 1. one shot: starts anvil on :8545 (if not running), deploys + seeds, generates ABIs + config
app/scripts/local-demo.sh            # or: app/scripts/local-demo.sh 8547

# 2. the app
cd app && npm install
VITE_RPC_31337=http://127.0.0.1:8545 VITE_DEFAULT_CHAIN_ID=31337 npm run dev
#   add VITE_ANVIL_AUTOCONNECT=true to auto-connect anvil's account #0
```

If you prefer to run the steps by hand:

```bash
anvil --port 8545 &
forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cast rpc anvil_mine 2 --rpc-url http://127.0.0.1:8545          # reveals need commitBlock + 2
forge script script/LocalDemo.s.sol --sig "finalize()" --rpc-url http://127.0.0.1:8545 --broadcast
cd app && npm run abi && npm run sync
```

`script/LocalDemo.s.sol` reverts on any chain other than 31337. It derives anvil's public test keys from the default mnemonic.

- **`run()`** deploys the vendored registry, `CerebrAccount`, the processor (which deploys the Circuit) and the Lens. It writes `deployments/31337.json`, then seeds activity:
  - account 0: buys CBR and tapes out 3 Basic Circuits
  - account 1: tapes out a Basic and a Pro
  - account 2: tapes out a Quantum, then sells some CBR
  - account 3: buys and sells
- **`finalize()`**:
  - reveals every Circuit that is ready
  - fuses two of account 0's Basic Circuits into a Pro
  - activates the child's brain wallet and sends it 0.05 ETH

The local launch guard is off by default (`LAUNCH_BLOCKS=0`). Set `LAUNCH_BLOCKS=1800` to try the caps.

To use the app, import anvil's account #0 into OKX Wallet or MetaMask (local only), or use the dev connector.

## Smoke test

```bash
cd app && RPC_URL=http://127.0.0.1:8545 npm run smoke
```

The smoke test uses anvil's unlocked account #4 and refuses to run on any chain other than 31337. It checks:

- the generated config matches `protocolState`
- exact-OKB buy: the quote is optimal, and you receive exactly the quoted CBR for exactly the quoted cost
- exact-CBR buy
- sell: the 1% fee goes to `protocolFees`
- two `tapeOutCircuit()` calls, and the sealed `tokenURI`
- revealing too early reverts `RevealTooEarly`
- reveal works and the traits decode
- `fuseCircuits`: the parents end up in the child's account, and `totalCbrBurned` goes up by 15k
- creating the account, `owner()`, and the nested holdings shown in the lens
- `execute` withdraws a parent back to the owner
- revealing the child, and `curvePoints`
- `balance >= reserveRequired + protocolFees` at every stage

## Testnet / mainnet

1. Deploy with `script/Deploy.s.sol` (see `DEPLOY.md`). A real broadcast writes `deployments/<chainId>.json`.
2. Run `cd app && npm run abi && npm run sync && npm run build`, then host `app/dist/` on any static host.

Or skip the generated file and set `VITE_LENS_196=0x...` (or `VITE_LENS_1952`) at build time.

Anvil is left out of production builds unless `VITE_ENABLE_ANVIL=true`.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit` and a production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run abi [outDir]` | regenerate the ABIs from `../out` (or `FORGE_OUT`, or a path) |
| `npm run sync` | regenerate `src/generated/deployments.ts` |
| `npm run smoke` | the end-to-end test (needs `RPC_URL`) |
| `npm run keeper` | optional reveal keeper (needs `RPC_URL`; `KEEPER_PRIVATE_KEY` off anvil; `ONCE=1` for a single pass) |

## Reveal keeper (optional)

The contracts reveal Circuits on-chain. Every tape-out and fusion reveals up to 2 ready Circuits from a FIFO queue, and every buy reveals 1, so you don't need a keeper while the protocol is in use. `reveal(id)` is still permissionless. `scripts/keeper.ts` is a backup for quiet periods (no buy, tape-out or fusion for 256 blocks, about 4 minutes at X Layer's ~1 s blocks) and for pauses. In those cases an owner could otherwise wait out the blockhash window to force a re-commit and re-roll traits. Use a dedicated low-balance hot wallet; each reveal costs about 54k gas. When a queued tape-out or buy gets to a Circuit first, the keeper's simulation reverts `AlreadyRevealed` and the keeper skips it.

```bash
RPC_URL=https://testrpc.xlayer.tech KEEPER_PRIVATE_KEY=0x... npm run keeper
```
