# Cerebr subgraph

This subgraph indexes every Cerebr protocol event on X Layer. It covers the CBR bonding curve, tape-outs, fusion, commit-reveal traits and the ERC-6551 "brain wallets".

## Data sources

| Data source | Contract | Events |
|---|---|---|
| `CerebrProcessor` | `CerebrProcessor`, which is also the CBR ERC-20 | `Transfer` (ERC-20), `TransistorsBought`, `TransistorsSold`, `CircuitTapedOut`, `CircuitsFused`, `FeesWithdrawn`, `OwnershipTransferStarted`, `OwnershipTransferred`, `Paused`, `Unpaused` |
| `CerebrCircuit` | `CerebrCircuit` (ERC-721). The processor's constructor deploys it, and you can read its address from `CIRCUIT()`. | `Transfer` (ERC-721), `CircuitRevealed`, `Recommitted` |
| `ERC6551Registry` | Canonical registry `0x000000006551c19487814612e58FE06813775758` on mainnet, the vendored `ERC6551Registry` on testnet | `ERC6551AccountCreated`. The mapping drops events for other NFT collections. |

Only the standard ERC-20 and ERC-721 `Approval`/`ApprovalForAll` events are left out.

## Entities

- **`Protocol`** (`id: "cerebr"`). This is the live economic state:
  - Supply, spot price, `reserveRequired` and `surplusReserve`, the tracked OKB balance, `protocolFees`, `totalCbrBurned` (sinks only, which matches the on-chain counter) and holder count.
  - Circuit counts per tier, plus counts of reveals, recommits and activated brain wallets.
  - The owner, the pending owner and the paused flag.
- **`Account`**: CBR balance and trading totals, burns, tape-out and fusion counts, and owned circuits. `tokenBoundAccountOf` is set when the address is a Circuit's token-bound account (TBA).
- **`Trade`**: one per buy or sell. It holds the OKB amount, the fee, the average price, and the price and supply after the trade.
- **`Circuit`**:
  - Basics: tier, origin (`TAPE_OUT` or `FUSION`) and owner. `heldBy` is set when the owner is another Circuit's TBA.
  - Reveal: the reveal state (`commitBlock`, `revealReadyBlock`, `recommitCount`, `seed`) and the decoded traits.
  - Brain wallet: the TBA address and whether it has been deployed.
  - Lineage: `parentA`/`parentB`, `fusedInto` and `holdings`.
- **`Fusion`**, **`TapeOut`**, **`FeeWithdrawal`**, **`CircuitTransfer`**: immutable event logs.
- **`DailySnapshot`** (`id` = `floor(timestamp / 86400)`): the day's activity (volumes, burns, tape-outs, fusions, reveals, OHLC price) and the protocol state at the end of the day. Use it for charts.

### How values are derived

- **Reserve stats:** `reserveRequired` uses the contract's formula, `ceil(BASE_PRICE*S/1e18) + ceil(SLOPE*S²/2e36)`. `BASE_PRICE` and `SLOPE` are read once by eth_call.
- **OKB balance:** `okbBalance` is built from event flows: `+cost` on each buy, `-net` on each sell and `-amount` on each fee withdrawal. OKB force-sent to the processor (selfdestruct) emits no event, so in that case the on-chain `surplusReserve()` can read higher than the indexed value.
- **Traits:** traits are decoded by calling the pure `computeTraits(seed, tier)` at reveal time, so they always match `tokenURI`.
- **TBA address:** the address comes from `tokenBoundAccount(id)`, read by eth_call at mint. The wallet counts as activated only when the registry deploys exactly that address, which means the canonical implementation with salt 0. A `createAccount` call made before the mint is also caught.
- **Fusion:** the `CircuitsFused.tier` field is the child's tier. The CBR burned is `tapeOutCost(tier - 1)`. That is 5k for Basic parents, 20k for Pro and 100k for Quantum.

## Setup

```bash
cd indexer
npm install
npm run abis      # optional: re-extract ABIs from src/ (needs forge + jq; uses private out-indexer/ dirs)
npm run codegen
npm run build     # builds subgraph.yaml as checked in (network: xlayer)
```

`networks.json` holds addresses and start blocks for each network. `graph build --network <name>` copies them into `subgraph.yaml`, rewriting the file in place and removing its comments.

| networks.json key | Chain | Use |
|---|---|---|
| `x1` | X Layer mainnet (196) | Goldsky's subgraph slug for X Layer mainnet (per docs.goldsky.com/chains/xlayer) |
| `xlayer` | X Layer mainnet (196) | A self-hosted graph-node whose chain is named `xlayer` |
| `xlayer-testnet` | X Layer testnet (1952) | Self-hosted graph-node only. Goldsky does not list X Layer testnet for subgraphs. |

After you deploy, fill in all three addresses and set `startBlock` to the processor's deployment block (the same block applies to all three data sources):

- `CerebrProcessor`: from the deploy logs or `broadcast/Deploy.s.sol/<chainId>/run-latest.json`.
- `CerebrCircuit`: `cast call $PROCESSOR "CIRCUIT()(address)" --rpc-url xlayer`.
- `ERC6551Registry`: the canonical registry on mainnet (already filled in), or the vendored registry deployed on testnet.

Keep the start block at the processor's deployment block so the constructor's `OwnershipTransferred` event is indexed.

## Deploy to Goldsky (X Layer mainnet)

```bash
npm i -g @goldskycom/cli        # or: curl https://goldsky.com | sh
goldsky login                   # paste API key from app.goldsky.com -> Settings
cd indexer
npm run codegen
graph build --network x1        # writes x1 addresses into subgraph.yaml and builds
goldsky subgraph deploy cerebr/0.1.0 --path .
# or simply: npm run deploy:goldsky   (uses package.json version as the subgraph version)

goldsky subgraph list                               # status / sync progress
goldsky subgraph tag create cerebr/0.1.0 --tag prod # stable endpoint: .../cerebr/prod/gn
goldsky subgraph log cerebr/0.1.0                   # indexing errors
```

The GraphQL endpoint is printed after the deploy. It looks like `https://api.goldsky.com/api/public/<project>/subgraphs/cerebr/prod/gn`. Put it in the dApp's env.

## Self-hosted graph-node (local anvil or testnet)

Run graph-node with an `ethereum` chain named `xlayer-testnet` (or `xlayer`) that points at `https://testrpc.xlayer.tech`, then:

```bash
graph build --network xlayer-testnet
npm run deploy:local
```

## Example queries

```graphql
{
  protocol(id: "cerebr") {
    totalSupply currentPrice reserveRequired okbBalance surplusReserve protocolFees
    totalCbrBurned circuitsBasic circuitsPro circuitsQuantum circuitsSingularity
    circuitsRevealed brainWalletsActivated holderCount
  }
  dailySnapshots(orderBy: dayStartTimestamp, orderDirection: desc, first: 30) {
    dayStartTimestamp closePrice totalSupply surplusReserve cbrBurned tapeOuts fusions
  }
}
```

```graphql
query Gallery($owner: Bytes!) {
  circuits(where: { owner: $owner }, orderBy: tokenId) {
    tokenId tier revealed revealReadyBlock rarity architecture cores clockTenthsGHz nodeNm
    tba tbaDeployed
    parentA { tokenId tier } parentB { tokenId tier }
    holdings { tokenId tier }
  }
}
```

Unrevealed circuits whose `revealReadyBlock` is at or below the current block are ready for `reveal(id)`, and anyone can call it. Most are revealed automatically by the next tape-out, fusion or buy (on-chain FIFO queue). Those `CircuitRevealed` events come from a Processor transaction, but they are the same Circuit event, so no mapping change is needed. An optional keeper can poll `circuits(where: { revealed: false })`.
