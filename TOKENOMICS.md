# Cerebr Tokenomics

Cerebr has two assets. **Transistors ($CBR)** are an ERC-20 issued on a bonding curve and backed by native OKB. **Neural Circuits** are ERC-721 "AI brains" that can only be made by burning $CBR. Every burn takes $CBR out of circulation, and the OKB that paid for it stays locked in the Processor for good.

All numbers below use the default deployment parameters (`BASE_PRICE = 1e12` wei, `SLOPE = 1e8` wei).

## 1. Transistors ($CBR): the bonding curve

| Parameter | Value |
|---|---|
| Max circulating supply | 10,000,000 CBR. Burned tokens free up room under the cap. |
| Price function | `price(s) = BASE_PRICE + SLOPE · s`, in wei per whole CBR, where `s` is the circulating supply |
| Start price | 0.000001 OKB / CBR |
| Price at 10M supply | 0.001001 OKB / CBR |
| OKB needed to fill the whole curve | about 5,010 OKB |
| Sell fee | 1%, paid to `protocolFees` (the only thing the owner can withdraw) |

- **Buy.** `buyTransistors(amount, maxCost)` charges the exact area under the curve, rounded **up**, and refunds any extra OKB sent.
- **Sell.** `sellTransistors(amount, minRefund)` burns the CBR and pays out the area under the curve, rounded **down**, minus the 1% fee. Sells can never be paused, capped or rate-limited.
- **Solvency.** `balance ≥ reserveRequired() + protocolFees` holds at all times. `reserveRequired()` is the OKB needed to buy back every outstanding CBR along the curve. A stateful invariant suite checks this (see [AUDIT.md](AUDIT.md)).

## 2. Neural Circuits: the sinks

### Tape-out (burn CBR, mint a Circuit)

| Tier | CBR burned | OKB to buy that CBR at supply 0 | Rarity C / R / E / L | Cores | Clock | Node |
|---|---|---|---|---|---|---|
| Basic (`tapeOutCircuit()`) | 5,000 | 0.00625 OKB | 60 / 25 / 12 / 3 % | 8–128 | 1.0–5.9 GHz | 14 / 7 / 5 / 3 nm |
| Pro | 20,000 | 0.04 OKB | 35 / 35 / 22 / 8 % | 32–256 | 2.0–6.9 GHz | 7 / 5 / 3 / 2 nm |
| Quantum | 100,000 | 0.6 OKB | 10 / 35 / 38 / 17 % | 128–512 | 3.0–7.9 GHz | 5 / 3 / 2 / 1 nm |
| Singularity | fusion only | — | 0 / 15 / 45 / 40 % | 512–1024 | 5.0–9.9 GHz | 3 / 2 / 1 / 1 nm |

The OKB price of a tape-out goes up as supply grows. For example, a Basic tape-out at 50% supply costs about 2.5 OKB.

### Fusion (burn CBR, combine two Circuits into the next tier)

`fuseCircuits(a, b)` takes two **revealed** Circuits of the **same tier** that you own directly, and burns the tape-out cost of that tier:

- Basic + Basic + 5k CBR → **Pro**
- Pro + Pro + 20k CBR → **Quantum**
- Quantum + Quantum + 100k CBR → **Singularity** (the only way to make one)

The parents are **not burned**. They move into the new Circuit's ERC-6551 token-bound account (its "brain wallet"), so the child's owner owns everything the parents held. **Each Circuit can be used as a fusion parent only once** (`fusedInto[id]`). Parents taken back out of the wallet keep a "Fused Into #N" mark and can never be fused again. That rule makes Singularity supply strictly bounded by the Quantum CBR burned to create it.

> **Pricing note.** Building up by fusion is currently cheaper in CBR than a direct tape-out: a Pro costs 15k by fusion against 20k direct, and a Quantum costs 50k against 100k. A direct tape-out is a premium for skipping the reveal waits and keeping your Basics free. Whether to rebalance this is an open decision; see the [README](README.md#open-decisions).

### Commit-reveal traits

A new Circuit is minted **sealed**. Its seed is the hash of the block *after* the mint block, which nobody knows when the mint transaction runs. That means reverting a transaction cannot re-roll the traits. Anyone can call `reveal(id)` from `commitBlock + 2`. You usually don't need to: sealed Circuits wait in a first-in, first-out queue, and every tape-out and fusion reveals up to two ready Circuits from it (every buy reveals one). An owner therefore can't sit on a reveal until the 256-block hash window expires and re-roll, as long as anyone is using the protocol. The tape-out or fusion pays the reveal, about 31k gas. The dApp's reveal buttons and the optional keeper (`app/scripts/keeper.ts`) cover quiet periods and pauses.

## 3. The economic loop and the surplus

Buying $CBR pushes OKB into the reserve and moves the price up the curve. A burn (tape-out or fusion) removes $CBR **without** paying any OKB out. The OKB that backed the burned tokens stays in the Processor, and nobody can reach it, including the owner.

- `surplusReserve() = balance − reserveRequired() − protocolFees` is that locked excess. It grows with every burn.
- `totalCbrBurned()` counts CBR burned by tape-outs and fusions. Sells are not counted.
- `mintedByTier(tier)` counts Circuits per tier.

**Honest framing:**

- **A burn lowers the spot price** for the next buyer, because price follows circulating supply. What a burn buys is **over-collateralisation**: after every burn the reserve holds more OKB than it needs to buy back all remaining $CBR.
- **The surplus a burn adds is a lower bound.** It equals the curve value of the burned slice *at the supply when the burn executes*. A holder can lower that point by selling, burning, then buying back, and pays only the 1% fee to do it. This takes nothing from other holders (sell prices depend only on supply). It only changes how much OKB ends up locked for good.

## 4. Fair launch

For the first `LAUNCH_BLOCKS` blocks after deployment, **net** buys are capped per wallet per block (`WALLET_CAP_PER_BLOCK`) and for all wallets together per block (`BLOCK_CAP`).

- "Net" means a sell in the same block gives back the seller's and the block's usage, so a buy-and-sell loop cannot fill the cap and lock other buyers out.
- Sells and tape-outs are never capped.
- The per-wallet cap can be bypassed with many wallets (sybil-able). The global per-block cap is the real guard.

Recommended mainnet values (X Layer produces about one block per second):

| Parameter | Value | Effect |
|---|---|---|
| `LAUNCH_BLOCKS` | 3,600 | About 1 hour |
| `WALLET_CAP_PER_BLOCK` | 1,000 CBR | A Basic tape-out takes 5 blocks (about 5 s) of buying from one wallet |
| `BLOCK_CAP` | 2,500 CBR | At least 3 wallets per block. The window absorbs at most 9M CBR (90% of supply). The cheapest 10% of supply (1M CBR, about 51 OKB) takes at least 400 blocks to accumulate. |

See [DEPLOY.md](DEPLOY.md) for how to tune them.
