# Deploying Cerebr to X Layer

`script/Deploy.s.sol` deploys the whole system in one broadcast. The deployer becomes the owner.

1. **ERC-6551 registry.** If `ERC6551_REGISTRY` (default: the canonical `0x000000006551c19487814612e58FE06813775758`) has code, the script uses it. That is the case on **mainnet 196**. If the canonical address has no code (**testnet 1952**, anvil), it deploys the vendored `ERC6551Registry` instead. An explicitly set `ERC6551_REGISTRY` that has no code makes the script revert.
2. **Account implementation.** The script uses `ERC6551_ACCOUNT_IMPL` if you set it (it must have code). Otherwise it deploys `CerebrAccount`.
3. **`CerebrProcessor`**, whose constructor deploys **`CerebrCircuit`**.
4. **`CerebrLens(processor)`**.
5. Addresses are written to `deployments/<chainId>.json` on a real broadcast, or to `deployments/<chainId>.dry-run.json` in a simulation. The keys are `chainId`, `deployBlock`, `launchEndBlock`, `owner`, `processor`, `circuit`, `lens`, `erc6551Registry`, `canonicalRegistry` and `accountImplementation`. The dApp (`npm run sync`) and the indexer read this file.

Brain wallets (token-bound accounts) are **never** deployed at mint. Users create them on demand from the dApp ("Activate brain wallet"), which calls `registry.createAccount`.

## Environment

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `PRIVATE_KEY` | yes | — | Deployer key. It becomes the owner. Use a fresh wallet. |
| `BASE_PRICE` | no | `1e12` wei | OKB price of 1 CBR at supply 0 (≤ 1e36) |
| `SLOPE` | no | `1e8` wei | Price rise per whole CBR minted (≤ 1e36) |
| `LAUNCH_BLOCKS` | no | `3600` | Fair-launch window in blocks. `0` disables the guard. Max 1,000,000. |
| `WALLET_CAP_PER_BLOCK` | no | `1000e18` | Net CBR one wallet may buy per block during the window |
| `BLOCK_CAP` | no | `2500e18` | Net CBR all wallets together may buy per block during the window |
| `ERC6551_REGISTRY` | no | canonical | Registry override. Leave unset on 196 and 1952. |
| `ERC6551_ACCOUNT_IMPL` | no | deploy new | Reuse an already deployed `CerebrAccount` |
| `OKLINK_API_KEY` | for verify | — | OKLink explorer API key |

| Network | Chain id | RPC alias (`foundry.toml`) | Explorer | ERC-6551 registry |
|---|---|---|---|---|
| X Layer testnet | 1952 | `xlayer_testnet` | https://www.oklink.com/xlayer-test | vendored copy (deployed by the script) |
| X Layer mainnet | 196 | `xlayer` | https://www.oklink.com/xlayer | canonical `0x000000006551c19487814612e58FE06813775758` |

Both chains support Cancun (`MCOPY`, `TSTORE`). This was verified by live RPC probes, so `evm_version = "cancun"` and `ReentrancyGuardTransient` are safe to use.

## Recommended fair-launch parameters

X Layer produces about **one block per second**: a read-only RPC probe found 1,000 blocks took 1,000 s on both 196 and 1952. The guard caps **net** buys per block, since a same-block sell gives the usage back. Its job is to slow the first accumulation down, not to block sybils.

| Parameter | Recommended | Reasoning |
|---|---|---|
| `LAUNCH_BLOCKS` | **3,600** | About 1 hour. Long enough for the community to arrive after an announcement, short enough not to annoy anyone. |
| `BLOCK_CAP` | **2,500 CBR** | `LAUNCH_BLOCKS × BLOCK_CAP` = 9M CBR, or 90% of `MAX_SUPPLY`. The window spreads out nearly the whole curve instead of filling in 100 blocks (the old 100k default allowed 18× supply). The cheapest 10% of supply (1M CBR, about 51 OKB) takes at least 400 blocks (about 7 minutes). |
| `WALLET_CAP_PER_BLOCK` | **1,000 CBR** | At least three wallets are needed to fill a block. A Basic tape-out (5k) takes one wallet about 5 seconds of buys. Sybils can get around this cap; the block cap is the real guard. |

Tuning rule: choose `BLOCK_CAP ≈ (share of supply to spread out × MAX_SUPPLY) / LAUNCH_BLOCKS`, then set `WALLET_CAP_PER_BLOCK` to `BLOCK_CAP / 2.5` or lower. For a quick demo with no guard, use `LAUNCH_BLOCKS=0`.

## Default curve economics

| Metric | Value |
|---|---|
| Start price | 0.000001 OKB / CBR |
| End price at 10M supply | 0.001001 OKB / CBR |
| OKB needed to fill the whole curve | about 5,010 OKB |
| Basic tape-out (5,000 CBR) at supply 0 / at 50% | 0.00625 OKB / about 2.506 OKB |
| Pro (20,000 CBR) / Quantum (100,000 CBR) at supply 0 | 0.04 OKB / 0.6 OKB |

The script prints these figures in every simulation. Re-run it if you change `BASE_PRICE` or `SLOPE`.

## 0. Setup

```bash
# Never commit this file; .env is gitignored
cat > .env <<'EOF'
PRIVATE_KEY=0x...            # fresh deployer wallet, funded with OKB
OKLINK_API_KEY=...
EOF
source .env
forge build && forge test
```

## 1. Simulate (nothing sent)

```bash
forge script script/Deploy.s.sol                                  # local, no RPC (deploys vendored registry)
forge script script/Deploy.s.sol --rpc-url xlayer_testnet         # fork of testnet 1952
forge script script/Deploy.s.sol --rpc-url xlayer                 # fork of mainnet 196 (uses canonical registry)
```

Each simulation writes `deployments/<chainId>.dry-run.json`. That file is gitignored.

## 2. Testnet (chain 1952)

Get test OKB from the X Layer testnet faucet first.

```bash
forge script script/Deploy.s.sol --rpc-url xlayer_testnet --broadcast --slow
cat deployments/1952.json
```

Then:

1. Verify every contract (section 4).
2. Run the post-deploy smoke test (section 5).
3. Point the dApp and the indexer at the new addresses (section 6).
4. Optionally start the reveal keeper (section 7).

## 3. Mainnet (chain 196)

Only do this once the checklist at the end passes on testnet.

```bash
forge script script/Deploy.s.sol --rpc-url xlayer               # fork simulation; check the logged economics
forge script script/Deploy.s.sol --rpc-url xlayer --broadcast --slow
cat deployments/196.json
```

To verify while deploying, add `--verify --verifier oklink --verifier-url "$VURL" --etherscan-api-key "$OKLINK_API_KEY"` (with `VURL` set as in section 4).

## 4. Verify on OKLink

```bash
CHAIN=196;  VURL=https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER
# testnet: CHAIN=1952; VURL=https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET
D=deployments/$CHAIN.json
PROCESSOR=$(jq -r .processor $D); CIRCUIT=$(jq -r .circuit $D); LENS=$(jq -r .lens $D)
REGISTRY=$(jq -r .erc6551Registry $D); IMPL=$(jq -r .accountImplementation $D); OWNER=$(jq -r .owner $D)
# Constructor values actually used (defaults shown; use your env values if you overrode them)
BASE=1000000000000; SLOPE=100000000; LAUNCH=3600; WCAP=1000000000000000000000; BCAP=2500000000000000000000

V="--chain-id $CHAIN --verifier oklink --verifier-url $VURL --etherscan-api-key $OKLINK_API_KEY --watch"

# CerebrAccount() - no constructor args
forge verify-contract "$IMPL" src/erc6551/CerebrAccount.sol:CerebrAccount $V

# ERC6551Registry() - testnet only (mainnet uses the canonical, already-verified registry)
[ "$(jq -r .canonicalRegistry $D)" = "false" ] && \
  forge verify-contract "$REGISTRY" src/erc6551/ERC6551Registry.sol:ERC6551Registry $V

# CerebrProcessor(uint256 basePrice, uint256 slope, address owner, uint256 launchBlocks,
#                 uint256 walletCapPerBlock, uint256 blockCap, address registry, address accountImpl)
forge verify-contract "$PROCESSOR" src/CerebrProcessor.sol:CerebrProcessor $V \
  --constructor-args $(cast abi-encode "constructor(uint256,uint256,address,uint256,uint256,uint256,address,address)" \
     $BASE $SLOPE $OWNER $LAUNCH $WCAP $BCAP $REGISTRY $IMPL)

# CerebrCircuit(address processor, address registry, address accountImplementation) - deployed by the processor
forge verify-contract "$CIRCUIT" src/CerebrCircuit.sol:CerebrCircuit $V \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" $PROCESSOR $REGISTRY $IMPL)

# CerebrLens(address processor)
forge verify-contract "$LENS" src/CerebrLens.sol:CerebrLens $V \
  --constructor-args $(cast abi-encode "constructor(address)" $PROCESSOR)
```

Verification only needs the compiler settings from `foundry.toml` (solc 0.8.28, optimizer 200 runs, `cancun`), and forge picks them up automatically.

## 5. Post-deploy smoke test

```bash
RPC=xlayer_testnet   # or xlayer
cast call $PROCESSOR "currentPrice()(uint256)" --rpc-url $RPC
cast call $PROCESSOR "launchCapRemaining(address)(uint256,uint256)" $OWNER --rpc-url $RPC
AMT=1000000000000000000000   # 1,000 CBR (fits the default launch wallet cap)
COST=$(cast call $PROCESSOR "quoteBuy(uint256)(uint256)" $AMT --rpc-url $RPC | awk '{print $1}')
cast send $PROCESSOR "buyTransistors(uint256,uint256)" $AMT $COST --value $COST --private-key $PRIVATE_KEY --rpc-url $RPC
# ...repeat across 5 blocks to reach 5,000 CBR during the launch window, then:
cast send $PROCESSOR "tapeOutCircuit()" --private-key $PRIVATE_KEY --rpc-url $RPC
cast send $CIRCUIT "reveal(uint256)" 1 --private-key $PRIVATE_KEY --rpc-url $RPC   # from commitBlock + 2
cast call $CIRCUIT "tokenURI(uint256)(string)" 1 --rpc-url $RPC                    # base64 JSON + on-chain SVG
cast call $PROCESSOR "surplusReserve()(uint256)" --rpc-url $RPC                    # > 0 after the tape-out
cast call $PROCESSOR "totalCbrBurned()(uint256)" --rpc-url $RPC
```

For a full end-to-end rehearsal (buy, sell, every tier, reveal, fusion, brain wallet), run the dApp smoke script against a local anvil: see [app/README.md](app/README.md).

## 6. dApp and indexer

```bash
cd app && npm run abi && npm run sync && npm run build      # reads deployments/<chainId>.json
```

For the indexer, put the `processor`, `circuit` and (on testnet) `erc6551Registry` addresses into `indexer/networks.json`. Use `deployBlock` as each `startBlock`. Then build and deploy as described in [indexer/README.md](indexer/README.md).

## 7. Reveal keeper (optional backup)

The contracts reveal Circuits on-chain. Every tape-out and fusion settles up to 2 queued Circuits, and every buy settles 1 (see AUDIT.md, finding 2-6). While the protocol is active, no keeper is needed. A keeper only matters during quiet periods (no buy, tape-out or fusion for 256 blocks, about 4.3 minutes) and while the protocol is paused. In those cases an owner could otherwise wait out the blockhash window and re-roll. Running one is cheap insurance:

```bash
cd app && RPC_URL=https://rpc.xlayer.tech KEEPER_PRIVATE_KEY=0x... npm run keeper
```

## Pre-mainnet checklist

- [ ] `forge test` passes in full (219 tests, including the fuzz, both invariant suites and the auto-reveal liveness suite).
- [ ] `BASE_PRICE` and `SLOPE` are final, and the simulated economics are checked.
- [ ] The launch parameters are chosen with the rule above, and `LAUNCH_END_BLOCK` (logged) matches the announced launch time.
- [ ] The deployer is a fresh wallet. Ownership is moved to a multisig with `transferOwnership` + `acceptOwnership`. `renounceOwnership` always reverts by design.
- [ ] Every flow has been run end to end on testnet:
  - [ ] buy, sell (1% fee goes to `protocolFees`) and the launch caps (including that a same-block sell gives cap back)
  - [ ] a tape-out for each tier, reveal (manual, and automatic through the next tape-out or buy; check `revealQueueHead()`), and the `tokenURI` sealed and revealed views
  - [ ] fusion, and confirming that recycled parents revert `AlreadyFused`
  - [ ] activating a brain wallet and pulling a parent out through `execute`
  - [ ] pause blocks buys, tape-outs and fusions but **not** sells or reveals
  - [ ] `withdrawFees` moves only the fees
- [ ] All five contracts (four on mainnet) are verified on OKLink.
- [ ] The mainnet fork simulation reports `ERC6551 registry: canonical`.
- [ ] The dApp and indexer point at the new addresses. Optionally, the reveal keeper is running as a backup.
- [ ] `.env` is not committed. Prefer `cast wallet import` + `--account` over a raw `PRIVATE_KEY`.
