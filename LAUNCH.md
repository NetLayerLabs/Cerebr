# Launching the Cerebr processor on X Layer

This is the runbook for putting Cerebr live on X Layer mainnet: one processor (CPU) created through the TapeOut factory, plus the neural-circuit library taped out on it. A single script does the work, `sdk/scripts/launch.ts`:

1. **Preflight.** It checks the chain id and confirms TapeOut's implementations still match the versions we tested (TapeOut is upgradeable): the factory, transistor and circuit beacons, the opener's account proxy, and the implementation behind that proxy's beacon (`pins.accountBeaconImpl`). It reads the live fees, checks the wallet balance, prints the plan with its exact OKB cost, and waits for `--yes` before sending anything.
2. **`createCPU`.** It creates the processor through the TapeOut factory. The supply cap and unit price go onchain in this transaction.
3. **Mint.** It mints the NAND and LATCH transistors that the circuits will burn, plus the configured `keep` (minted once per token).
4. **Tape out.** It tapes out the 14 catalog circuits in dependency order. Before each REF-composed network, the REF placeholders are filled in with the real circuit ids of the neurons it reuses.
5. **Verify.** Each circuit is checked onchain right after its tapeout. The stored netlist bytes must match the compiled ones, and `circuitInfo` and the `TapedOut` event must match the simulator. `eval` is compared with the simulator on every possible input; for the spiking neuron, `step` is compared on every state and input pair.
6. **Open an account.** It opens the TapeOut native account ("brain wallet") of the flagship circuit.
7. **Withdraw.** It withdraws the creator's mint revenue. You are the creator, so your own mint payments come back to you.
8. **Write the output.** The result goes to `launch/out/196.json`, which the dApp reads.

The run is **idempotent and resumable**. `launch/state.196.json` is rewritten after every step, and also *before* the script waits on each transaction. If the run is interrupted (Ctrl-C, a dropped RPC, a closed laptop), run the same command again. It finishes the pending transaction, finds any circuits that already landed onchain (by matching netlist bytes), and carries on without paying for anything twice. This was tested on the fork by killing the run during a mint and again during a tapeout.

> Fork and mainnet can share chain id 196. Fork runs write `state.<chainId>.fork.json` and `out/<chainId>.fork.json`, and mainnet runs write `state.196.json` and `out/196.json`, so a rehearsal can never be mistaken for the real launch. Fork mode also accepts an anvil started with `--chain-id 31337`, the dApp's local-fork id, so one fork can serve the launch script, `npm run sync` and the dApp (fork records always map to chain 31337 in the app). Fork records are git-ignored; mainnet records are committed.
>
> **Resume safety.** If a pending transaction from an interrupted run still has no receipt (still in the mempool, or the RPC failed), the script stops and sends nothing instead of guessing. Before any send it also refuses to continue while the wallet has unconfirmed transactions in flight (`pending nonce > latest nonce`). Run the same command again once they settle.
>
> **After the launch.** Idempotence does not rest on the state file alone:
> * A mainnet state marked `done` refuses every sending run unless you pass `--continue-after-done` (for example, to tape out a circuit you added to the config later). `--dry-run` and `--verify-only` still work.
> * When the state has no processor, the script refuses to plan `createCPU` if `launch/out/196.json` exists (mainnet) or if the TapeOut factory already lists a processor whose creator is the deployer (checked on forks too, by walking `factory.cpus(i)`; X Layer's RPC caps `eth_getLogs` at 100 blocks). It prints the existing processor; restore the state file instead, or pass `--allow-second-cpu` if you really want another one. `--fresh` (fork only) implies it. On a fresh fork the first walk over ~280 processors can take a few minutes while anvil fetches the storage.

## Mainnet launch record (2026-10-05)

**Done.** Run from the deployment wallet on X Layer mainnet (chain 196) on 2026-10-05, blocks 72,461,494–72,461,669. Full record: [`launch/out/196.json`](launch/out/196.json) and `launch/state.196.json`.

| What | Value |
|---|---|
| Processor (circuits) | [`0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF`](https://www.okx.com/web3/explorer/xlayer/address/0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF) |
| Transistors | [`0x84b5a5c6fE305319458113b87c09a2A241427D2D`](https://www.okx.com/web3/explorer/xlayer/address/0x84b5a5c6fE305319458113b87c09a2A241427D2D) |
| Deployment wallet (creator) | [`0xc742AdA2872a042dD36D2E706907b4036968960C`](https://www.okx.com/web3/explorer/xlayer/address/0xc742AdA2872a042dD36D2E706907b4036968960C) |
| `createCPU` | [0x3295…6815](https://www.okx.com/web3/explorer/xlayer/tx/0x3295efc1ceec4aba0f918f89e5316fd62f1f705abdc52d483715e4fcada86815): Cerebr / CRBR, cap 1,000,000, 0.00001 OKB |
| Mint NAND | [0x8cd6…62e1](https://www.okx.com/web3/explorer/xlayer/tx/0x8cd6b747194cba30aafce82b85546b013daa9f314a878e9a04d5ae47b84f62e1): 1,139 (139 burned + 1,000 kept) |
| Mint LATCH | [0xeaf3…563c](https://www.okx.com/web3/explorer/xlayer/tx/0xeaf30d1f02cf16dec19c77c229a1e62f38e259a7d9da1285cbeb4c3edd6e563c): 102 (2 burned + 100 kept) |
| `withdraw()` | [0xcbda…f1f5](https://www.okx.com/web3/explorer/xlayer/tx/0xcbda8ac5f69e2c62077a10b4a3094f318682ae114d6c0d659e241c873052f1f5): 0.01241 OKB creator revenue returned |
| Minted / listed | 1,241 minted at launch (1,251 to date, see below); `listedInTapeoutApp: true` |
| Net cost | **0.02621748 OKB** for the 18-transaction run (0.03853 sent + 0.00009748 gas − 0.01241 withdrawn); the brain-wallet open below is 1 more transaction |

All 14 circuits were taped out once each and every one passed the onchain checks (1,164 cases; `eval`/`step` equal to the simulator on every input):

| Id | Circuit | Elements | Flat gates | Checked | Tapeout tx |
|---|---|---|---|---|---|
| #1 | and-neuron | 2 NAND | 2 | 4 inputs | [0xeb5e…8254](https://www.okx.com/web3/explorer/xlayer/tx/0xeb5e9cedb905ad98209f04a40b2a93e7caaadce88f031b2bcb07f21d78d18254) |
| #2 | or-neuron | 3 NAND | 3 | 4 inputs | [0x9dbc…0895](https://www.okx.com/web3/explorer/xlayer/tx/0x9dbcfd1e5b9a00083bd1058a83108778cb5f242a19e60f425bd782d8d7770895) |
| #3 | nand-neuron | 1 NAND | 1 | 4 inputs | [0xab5b…8a81](https://www.okx.com/web3/explorer/xlayer/tx/0xab5badaeb079e3274b02a1642f4f345e4879f6f17373af732e6449dcc2168a81) |
| #4 | xor-net | 6 NAND | 6 | 4 inputs | [0x4ace…30a8](https://www.okx.com/web3/explorer/xlayer/tx/0x4ace108c8ecb85f8ea47d6a13cc9e96c7e3013a4618ed086401cbce6519930a8) |
| #5 | **xor-net-ref** | 3 REF → #2, #3, #1 | 6 | 4 inputs | [0xc3e1…b66e](https://www.okx.com/web3/explorer/xlayer/tx/0xc3e10087944a57070a3f4acf618992085d06d6af5e381b4675d9fd482976b66e) |
| #6 | majority-3 | 6 NAND | 6 | 8 inputs | [0x2418…15ca](https://www.okx.com/web3/explorer/xlayer/tx/0x2418f266c2f0ba0b728813c8cf07999ec0fb41efdb81d42b7d1f2b941d3315ca) |
| #7 | majority-5 | 24 NAND | 24 | 32 inputs | [0xb25b…5558](https://www.okx.com/web3/explorer/xlayer/tx/0xb25b7f1822c3aa229ec7931ba8728cdb656e8b56f11d430913f87ae095c95558) |
| #8 | threshold-neuron | 19 NAND | 19 | 32 inputs | [0xc58e…fd3d](https://www.okx.com/web3/explorer/xlayer/tx/0xc58e60186673067a51e6606901a65195267599730f716180b95ba4ef95d3fd3d) |
| #9 | line-cell | 4 NAND | 4 | 8 inputs | [0xdcdf…3819](https://www.okx.com/web3/explorer/xlayer/tx/0xdcdf8f9a4bbb13b57b30f3a8f437499f68e8d0b9fd2e9f41d955043fb9233819) |
| #10 | any-of-3 | 6 NAND | 6 | 8 inputs | [0x57a1…b37a](https://www.okx.com/web3/explorer/xlayer/tx/0x57a1e3547687a8ff7ef97cb01b9366768b295f7c73a1120c4f4461b44e7cb37a) |
| #11 | line-detector | 37 NAND | 37 | 512 inputs | [0x69a2…dce5](https://www.okx.com/web3/explorer/xlayer/tx/0x69a23927d56107894ba2b62a4c73829d5770c1db4194d8105a2ed8bb6319dce5) |
| #12 | **line-detector-ref** | 11 REF → #9 ×8, #10 ×2, #2 | 47 | 512 inputs | [0x65fa…48ea](https://www.okx.com/web3/explorer/xlayer/tx/0x65fa37ad39f3d62ff4088ef352904ec9ee8520ec7ada0326652f13cccc2648ea) |
| #13 | adder-2bit | 14 NAND | 14 | 16 inputs | [0xdbbe…f3f3](https://www.okx.com/web3/explorer/xlayer/tx/0xdbbec9cd6b0909f3e505e3927f6f9e8e3f60e63039fd2aaae9ac01a141dbf3f3) |
| #14 | spiking-neuron | 17 NAND + 2 LATCH | 19 | 16 state × input | [0x91e5…7016](https://www.okx.com/web3/explorer/xlayer/tx/0x91e5a6585576e608318a33d7d616b0e6fe769bce3aa3510b9e08782ca11d7016) |

**Completed after the initial run (2026-10-05):**
- Flagship brain wallet opened: Open: `xor-net-ref` (#5) native account [`0x9E1d3eC3B3D0fe84997df0E065a96a7c93c13166`](https://www.okx.com/web3/explorer/xlayer/address/0x9E1d3eC3B3D0fe84997df0E065a96a7c93c13166) (open tx [0x8781…dad3](https://www.okx.com/web3/explorer/xlayer/tx/0x8781ed8467f4cef1d10dce3ec48cf1da99cfea615b250da8a352eda7a538dad3), 0.08 OKB).
- CerebrScope deployed: [`0x2640F8E89b2B107919568FFd42dFb46A1866e528`](https://www.okx.com/web3/explorer/xlayer/address/0x2640F8E89b2B107919568FFd42dFb46A1866e528) (deploy tx [0x17d0…9cfd](https://www.okx.com/web3/explorer/xlayer/tx/0x17d01f5dbdc49a9dc88d6fc2f7b347dd55bc903e17fa70cfd2d34ea036359cfd); source verified on [Sourcify](https://repo.sourcify.dev/contracts/full_match/196/0x2640F8E89b2B107919568FFd42dFb46A1866e528/), exact match).

**After launch (2026-10-06):**
- Catalog circuits #1-#14 named onchain in CerebrScope by `sdk/scripts/label-catalog.ts` (14 `setLabel` transactions).
- Real-wallet test of the live app's Circuit Studio by the deployment wallet: mint 10 NAND ([0x1fb9…3f2a](https://www.okx.com/web3/explorer/xlayer/tx/0x1fb9dc0eb048bd2d88f985694dc7d7005235dfd7ff27790d44fd4d474af53f2a)), tape out a new design as **#15** (first named "Studio test neuron"), y = [x0 + x1 + x2 - x3 ≥ 2], 4 → 1, 16 NAND ([0x4133…1c15](https://www.okx.com/web3/explorer/xlayer/tx/0x413387037233847f2d2dd24c2bfa0733a5300d93e4e4f195d3ac9bd4ca1f1c15)), and name it onchain ([0xc5ff…95fb](https://www.okx.com/web3/explorer/xlayer/tx/0xc5ffa319abb3f5dd0202c4b194efaab71ab6f22d677074050d1403d0f33f95fb)).
- State after that: `minted()` 1,251, 157 burned (141 into #1-#14, 16 into #15), creator holds 994 NAND + 100 LATCH, `owed()` 0.0001 OKB (not withdrawn), circuits #1-#15 all owned by the creator and all labelled. These transactions are not in `launch/out/196.json`, which records the launch run only. Disclosed in [ISSUANCE.md](ISSUANCE.md) §6.
- Circuit #15 relabelled "Vote-with-veto neuron" in CerebrScope ([0x2778…099a](https://www.okx.com/web3/explorer/xlayer/tx/0x277868e6de15edc615d8dd963074018fb559470e15d27daac193089f17f8099a), block 72,516,013).
- Genesis Drop: the creator deployed an ownerless instance of TapeOut's drops contract from TapeOut's published bytecode, [`0xf037a5543f19619a2291009ae1542b71d50ff9b9`](https://www.okx.com/web3/explorer/xlayer/address/0xf037a5543f19619a2291009ae1542b71d50ff9b9) ([0xd0f4…8e02](https://www.okx.com/web3/explorer/xlayer/tx/0xd0f4367fc525a3500658953c334adafbe490b16040e71cdbab6f8ad3bfcb8e02), block 72,516,039), approved it ([0x2fba…1eaf](https://www.okx.com/web3/explorer/xlayer/tx/0x2fbaaaec60be0aef742d758e1b51d1cb5212d9d83c09639f6a1afae5c0791eaf)), created drop #1 with 400 NAND at 16 per claim ([0x2d7c…8f20](https://www.okx.com/web3/explorer/xlayer/tx/0x2d7c052914b7e7a441b721ed025ce7e9bf832fb9804b85b885e6160ab1598f20), block 72,516,049) and revoked the approval ([0x4242…f708](https://www.okx.com/web3/explorer/xlayer/tx/0x42424e51b9044008a39f98c4506241e746fad4853a7a9100fb05aec5d851f708)). Circuit #16, the NeuralArena bot, burned 590 NAND ([0x0867…6f78](https://www.okx.com/web3/explorer/xlayer/tx/0x0867ed331fa75965a70facd01b0a0f0f456c9c0be33b4e0f5787f5eec70b6f78), [ARENA.md](ARENA.md)). The creator now holds 4 NAND + 100 LATCH.

**First outside activity (2026-10-08, not signed by Cerebr):**
- Genesis Drop claims 3-6 came from wallets outside the Cerebr team ([0xf11d…72a6](https://www.okx.com/web3/explorer/xlayer/tx/0xf11d057d6cdf5404ed46e47df7b1795045d647b6cf3c8993f32f4d0b47af72a6), [0xc1ba…c748](https://www.okx.com/web3/explorer/xlayer/tx/0xc1ba322023954c886e62ea9caa4877068d5c9378ca82f9d08434b01b3c70c748), [0xa6ae…1e89](https://www.okx.com/web3/explorer/xlayer/tx/0xa6ae49e21813e63661285b4a7e67650381c321e437b7f51cd6ae41c53f681e89), [0x69cf…e95b](https://www.okx.com/web3/explorer/xlayer/tx/0x69cf08ff84517f12bd88eed8012592d11dc4d1988f949c5720d8ef2a5bfae95b)); claims 1-2 were the disclosed team tests ([ISSUANCE.md](ISSUANCE.md) §6).
- [`0xd4a8…aa9d`](https://www.okx.com/web3/explorer/xlayer/address/0xd4a80cdda4d12896ea3af9d210477c014758aa9d), the sixth claimer, taped out circuit #17 "Threshold Neuron" (3 in, 1 out, 5 NAND) with its drop NAND ([0xe4ab…c18b](https://www.okx.com/web3/explorer/xlayer/tx/0xe4abca3220b0410ed0d01b5712b08dab9a842a855f78fcff308b849faca5c18b), block 72,720,601): the first circuit on Cerebr taped out by a wallet outside the team.
- State at time of writing (block 72,721,877): `nextId()` = 17, `minted()` 1,251 (unchanged), 752 burned, drop #1 at 6 claims and 304 NAND remaining, creator still holds 4 NAND + 100 LATCH.

## Issuance terms (disclosed onchain at `createCPU`)

| Term | Value | Notes |
|---|---|---|
| Processor name | `Cerebr` | `launch/config.json` → `cpu.name` |
| Symbol | `CRBR` | `cpu.symbol` |
| Story | "Cerebr is an on-chain neural processor. Its transistors are synapses …" | `cpu.story`, stored onchain |
| Transistor supply cap | **1,000,000** | shared by NAND (id 0) and LATCH (id 1); burns don't free supply |
| Unit price | **0.00001 OKB** | creator revenue, pulled with `withdraw()` |
| TapeOut protocol fee | 0.00066 OKB per `mint()` call | set by TapeOut, read live |
| Tapeout fee | 0.0013 OKB per circuit (exact amount) | goes to TapeOut's treasury |
| Account open fee | 0.08 OKB | for TapeOut's native circuit accounts |
| App listing rule | supply cap ≥ 10,000 and minted ≥ 1 | 1,241 minted at launch (1,251 to date), so it meets the rule |

Confirmed by the user on 2026-10-04. The 14 circuits burn 139 NAND and 2 LATCH, which is 0.0141% of the cap. [ISSUANCE.md](ISSUANCE.md) explains the choice.

## Launch cost

The actual mainnet cost is in the launch record above (net 0.02621748 OKB). Fees are TapeOut's, read live on every run: deploy 0.0066, 0.00066 per `mint()` call, 0.0013 per tapeout, 0.08 per account open. Gas at 0.02 gwei is about 0.0001 OKB for the whole run. The dry run prints the live figures before anything is sent.

## Transistors you keep

`launch/config.json` → `keep` mints transistors on top of what the tapeouts burn, in the same mint calls (no extra protocol fee). They stay in the deployment wallet. Because the deployer is the processor's creator, their unit price comes back with `withdraw()`, so they cost only gas. The default, used at launch, is **1,000 NAND and 100 LATCH** (disclosed in ISSUANCE.md §6); the run's Result prints `your transistors: …` as proof. Set both to `"0"` to keep none.

`keep` is **minted once per token**, not a target balance: it is added only to the first NAND (resp. LATCH) mint, and once the state file records a mint of that token it no longer applies. Spending or transferring kept transistors therefore never makes a re-run mint them again. A later run (say, after adding a circuit) mints only what its tapeouts still need beyond your current balance, so it may use up kept transistors.

## Steps to go live

All commands run from `sdk/` (`cd sdk && npm install` once). The launch needs Node 26 or newer, which runs the TypeScript directly.

### 1. Decide the terms (done)

Edit `launch/config.json`:
- `issuance.transistorSupply` and `issuance.mintPriceOkb`: the final numbers.
- `issuance.confirmed`: set it to `true`. The launcher refuses to touch mainnet while this is `false`.
- Optional: `cpu.symbol`, `cpu.story`, `openAccounts` (set it to `[]` to skip the 0.08 OKB open), and `circuits`. Each circuit is listed after the circuits it REFs; the config loader enforces this order.

### 2. Rehearse on a fork as your real wallet (done; free, nothing is broadcast)

```sh
anvil --fork-url https://rpc.xlayer.tech --chain-id 31337 --auto-impersonate --port 8545   # or --chain-id 196
# in another terminal, from sdk/
node scripts/launch.ts --as 0xYOUR_DEPLOYMENT_WALLET --dry-run
node scripts/launch.ts --as 0xYOUR_DEPLOYMENT_WALLET --yes --fresh
```

`--as` impersonates your address on the fork using its **real** mainnet balance, so this also proves the wallet has enough funds. Leave out `--as` to use a synthetic, auto-funded wallet. Use `--rpc http://127.0.0.1:<port>` if anvil runs on another port. The run must end with `ALL CIRCUITS VERIFIED`.

### 3. Fund the deployment wallet (done)

Send at least 0.13 OKB on **X Layer** (chain 196) to the wallet you will name in the submission. This wallet becomes the processor's `creator` and the author of every launch circuit.

### 4. Set the key (done; never commit it)

```sh
# sdk/.env  (git-ignored by the repo's .gitignore: ".env")
PRIVATE_KEY=0x...
# optional: XLAYER_RPC=https://rpc.xlayer.tech
```

The script reads `PRIVATE_KEY` only from the environment. It never prints or writes the key; the state and output files contain only addresses and transaction hashes. Loading it with `--env-file` keeps it out of your shell history.

### 5. Mainnet dry run (read-only; done)

```sh
node --env-file=.env scripts/launch.ts --network xlayer --dry-run
```

Check the plan, the issuance terms (they must show `confirmed by user yes`), the live fees, and the balance line. If TapeOut upgraded its contracts since 2026-10-04, the preflight stops with a pin mismatch. In that case, rehearse on a fork again (step 2), then update `pins` in the config, or pass `--allow-impl-change` once you're satisfied.

### 6. Launch (done 2026-10-05; brain wallet opened afterwards)

```sh
node --env-file=.env scripts/launch.ts --network xlayer --yes
```

Mainnet needs all three of `--network xlayer`, `PRIVATE_KEY` and `--yes`, and the RPC must not be local. The run takes about a minute on X Layer (18 transactions, plus 1 for the brain-wallet open). If it stops for any reason, run **the same command** again.

### 6b. Deploy CerebrScope (done: [`0x2640…e528`](https://www.okx.com/web3/explorer/xlayer/address/0x2640F8E89b2B107919568FFd42dFb46A1866e528), Sourcify-verified)

CerebrScope is a separate, no-admin lens contract (4.60M gas on mainnet, about 0.00009 OKB). It is not part of the hackathon's required deployment, but the demo shows its onchain images. From the repo root, rehearse on a fork first, then sign on mainnet yourself:

```sh
# fork rehearsal (nothing leaves the machine)
CEREBR_CIRCUITS=<processor.circuits> forge script script/DeployScope.s.sol --rpc-url http://127.0.0.1:8545 --sender 0xYOUR_WALLET
# mainnet (you sign; use --account/--ledger, never a key in a file)
CEREBR_CIRCUITS=<processor.circuits> forge script script/DeployScope.s.sol --rpc-url xlayer --broadcast --account <name>
```

Then put the printed address in `launch/config.json` as `"scope": "0x..."` and run `node scripts/launch.ts --network xlayer --verify-only --as 0xYOUR_WALLET`. The launcher checks that the address is a CerebrScope bound to the TapeOut factory and writes `scope` into `out/196.json`; `cd app && npm run sync` then turns on the Scope images. (Alternatively set `VITE_SCOPE_196` at build time.) Without it, the dApp draws the same die shots client-side from the netlists; reword the demo line about onchain rendering in that case.

### 7. Verify on OKX Explorer and re-check (done: all 14 launch circuits verified; meets the TapeOut app listing rule)

- The processor is at `https://www.okx.com/web3/explorer/xlayer/address/<processor.circuits>`. All links are in `launch/out/196.json`.
- Find the `CPUCreated` event in the `createCPU` transaction (`processor.links.createTx`), and one `TapedOut` event per circuit transaction.
- Run `node scripts/launch.ts --network xlayer --verify-only --as 0xYOUR_WALLET` to re-run every onchain check without a key and refresh `out/196.json`.
- `listedInTapeoutApp: true` means the processor meets the TapeOut app's listing rule (supply cap ≥ 10,000 and minted ≥ 1). Check that it shows up at tapeout.net.

Commit `launch/out/196.json` and `launch/state.196.json`. Neither contains a secret, and the dApp reads the out file (`cd app && npm run sync && npm run build`).

### 8. Submission form

| Field | Where to find it |
|---|---|
| Processor address | `processor.circuits` in `launch/out/196.json` (the address the factory registers with `isCPU`). Also give `processor.transistors` as the transistor token. |
| Deployment wallet | `deployer` (equal to `processor.creator`) |
| Creation tx | `processor.links.createTx` |
| Circuits taped out | 17: the 14 catalog circuits taped out at launch (ids and transactions in `circuits[]`), #15, taped out through the app on 2026-10-06 (above), #16, the NeuralArena bot (590 NAND, [ARENA.md](ARENA.md)), and #17, taped out on 2026-10-08 by a wallet outside the Cerebr team with Genesis Drop NAND (above). The flagship circuits are `xor-net-ref` (the XOR problem built by REF from three taped-out neurons) and `line-detector-ref` (a 3×3 vision network with 11 REFs) |
| Issuance terms | 1,000,000 transistors at 0.00001 OKB (table above) |
| Demo video / description | the dApp flow: mint transistors → build a neural circuit → tape it out → run `eval` live → browse the gallery |

**Rules to respect:** wash trading and self-trading disqualify an entry. The launch minted what its own circuits burn plus the disclosed 1,000 NAND + 100 LATCH kept by the creator, all through the public `mint()` at the public price, and did no trading. The 2026-10-06 app test (10 NAND, circuit #15) is disclosed the same way. Don't generate artificial transfers or volume afterwards.

## Command reference

```
node scripts/launch.ts [--network fork|xlayer] [--rpc URL] [--config PATH]
                       [--dry-run | --yes | --verify-only]
                       [--as ADDRESS] [--fund OKB] [--fresh] [--no-open] [--allow-impl-change]
                       [--launch-dir DIR] [--continue-after-done] [--allow-second-cpu]
```

| Flag | Meaning |
|---|---|
| `--network` | `fork` (default; a local anvil only, which the script checks with `web3_clientVersion`) or `xlayer` (mainnet) |
| `--rpc` | fork default: `$FORK_RPC` or `http://127.0.0.1:8545`; mainnet default: `$XLAYER_RPC` or `https://rpc.xlayer.tech` |
| `--dry-run` | prints the plan, issuance terms, fees and cost; sends nothing |
| `--yes` | executes; without it, the script prints the plan and exits with code 2 |
| `--verify-only` | re-runs every onchain check and rewrites the out file |
| `--as` | fork: impersonate this wallet. Mainnet: the address for a dry run or verify run without a key |
| `--fund` | fork only: set the deployer's balance (OKB) |
| `--fresh` | fork only: archive the state file and start a new processor |
| `--no-open` | skip opening native accounts |
| `--allow-impl-change` | continue even though TapeOut's implementations differ from `pins` |
| `--launch-dir` | read and write the state and out files in this directory instead of `launch/` (e.g. a scratch copy for a rehearsal or a read-only check) |
| `--continue-after-done` | mainnet: allow sending although the state says the launch is `done` |
| `--allow-second-cpu` | allow `createCPU` although this deployer already has a processor (out file or factory) |

Exit codes: 0 means done and verified, 1 means an error or a failed verification, 2 means the plan was printed and `--yes` is needed.

## Output schema: `launch/out/<chainId>[.fork].json` (`cerebr.launch/1`)

All wei amounts and ids are decimal strings, and addresses are checksummed. Every fork run writes a complete example to `launch/out/<chainId>.fork.json` (git-ignored; the record of the 2026-10-04 rehearsal is summarised below).

```ts
interface LaunchOut {
  schema: 'cerebr.launch/1';
  network: 'xlayer' | 'fork';
  chainId: number;                // 196 (mainnet; a fork may also report 31337)
  generatedAt: string;            // ISO time
  block: string;                  // block height when the file was written
  explorer: 'https://www.okx.com/web3/explorer/xlayer';
  deployer: Address;              // the deployment wallet (= processor.creator)
  tapeout: {
    factory: Address; opener: Address; registry: Address; accountImpl: Address; multicall3: Address;
    implementations: { factoryImpl; transistorImpl; circuitImpl; openerImplementation: Address;
                       accountBeacon; accountBeaconImpl: Address;   // the account proxy's beacon and its logic (pinned)
                       openerCodeHash: Hex; sealed: boolean };
  };
  processor: {
    name: string; symbol: string; story: string;
    circuits: Address;            // THE processor address: ERC-721 circuits, tapeout/eval/step
    transistors: Address;         // ERC-1155 transistors: mint(id, amount), NAND = 0, LATCH = 1
    creator: Address;
    supplyCap: string; minted: string;
    mintPrice: string; mintPriceOkb: string;   // per transistor
    protocolFee: string;          // per mint() call, add it to amount * mintPrice
    tapeoutFee: string;           // exact msg.value for tapeout()
    circuitCount: string;         // ids are 1..circuitCount (includes circuits other people tape out later)
    tokenIds: { NAND: '0'; LATCH: '1' };
    listedInTapeoutApp: boolean;
    createTx: Hash; createBlock: string;
    links: { circuits: string; transistors: string; createTx: string };
  };
  scope?: Address;                // CerebrScope, when launch/config.json sets "scope"
  outputMode: 'direct' | 'buffered';   // how the compiler placed the outputs (direct = no NOT-NOT buffer)
  circuits: Array<{
    key: string;                  // catalog id, e.g. 'xor-net-ref' (getCircuit(key) in @cerebr/sdk)
    circuitId: string;            // ERC-721 token id on processor.circuits
    name: string; description: string; story: string;
    kind: 'combinational' | 'sequential';      // sequential: use step(), not eval()
    flagship: boolean;
    inputs: string[]; outputs: string[];       // pin labels; bit i of eval() input/output = label i (LSB-first)
    state?: string[];                          // LATCH labels for sequential circuits
    layers?: { weights: number[]; theta: number; name?: string }[][];  // neural spec, when it is a threshold network
    deps: { key: string; circuitId: string }[];  // circuits it REFs
    nIn: number; nOut: number; nState: number;
    gateCount: number;            // flattened NAND+LATCH through REFs (as circuitInfo reports it)
    elements: { nand: number; latch: number; ref: number };  // this netlist's own elements (= transistors burned)
    netlist: Hex;                 // exact onchain bytes
    tx?: Hash; block?: string;    // absent only for circuits adopted on a resumed run
    account: { address: Address; opened: boolean; tx?: Hash };  // native TapeOut account (deterministic even before open)
    verified: { ok: boolean; cases: number; checks: string[]; at: string } | null;
    links: { tx?: string; account: string };
  }>;
  costs: { valuePaid: string; gasPaid: string; withdrawn: string; net: string; netOkb: string };
}
```

Notes for the dApp:
- To evaluate a circuit, call `eval(circuitId, packBits(inputs))` on `processor.circuits`, or use `evalCircuit` from `@cerebr/sdk`. For `kind: 'sequential'`, call `step(circuitId, state, inputs)`.
- `account.address` can receive funds before it is opened. Opening costs 0.08 OKB and anyone can pay it. Don't let users transfer a circuit NFT into its own account, because that locks the account.
- On resumed runs, `costs` only covers transactions that this tool recorded.

## Fork rehearsal record (2026-10-04)

This rehearsal ran on an anvil fork of X Layer at block 72,376,255, with the synthetic wallet `0xcE7e…c0fFEe` and the placeholder terms (100,000 supply at 0.000066 OKB):

- `createCPU` used 987k gas. The supply cap of 100,000 and the price of 0.000066 OKB read back from chain, and `listedInTapeoutApp` came out true.
- The script minted 139 NAND and 2 LATCH, so `minted` = 141.
- All 14 circuits were taped out and passed every check (1,164 cases):

| # | Circuit | Elements | Flat gates | Tapeout gas | Checked |
|---|---|---|---|---|---|
| 1 | and-neuron | 2 NAND | 2 | 246,582 | 4 inputs |
| 2 | or-neuron | 3 NAND | 3 | 215,154 | 4 |
| 3 | nand-neuron | 1 NAND | 1 | 209,615 | 4 |
| 4 | xor-net | 6 NAND | 6 | 223,740 | 4 |
| 5 | **xor-net-ref** | 3 REF → #2, #3, #1 | 6 | 254,761 | 4 |
| 6 | majority-3 | 6 NAND | 6 | 223,740 | 8 |
| 7 | majority-5 | 24 NAND | 24 | 274,708 | 32 |
| 8 | threshold-neuron | 19 NAND | 19 | 260,582 | 32 |
| 9 | line-cell | 4 NAND | 4 | 217,921 | 8 |
| 10 | any-of-3 | 6 NAND | 6 | 223,740 | 8 |
| 11 | line-detector | 37 NAND | 37 | 311,563 | 512 |
| 12 | **line-detector-ref** | 11 REF → #9 ×8, #10 ×2, #2 | 47 | 423,242 | 512 |
| 13 | adder-2bit | 14 NAND | 14 | 246,457 | 16 |
| 14 | spiking-neuron | 17 NAND + 2 LATCH | 19 | 260,865 | 16 state × input |

- The `xor-net-ref` native account was opened, and the creator's 0.009306 OKB was withdrawn.
- The net balance change was 0.11115 OKB at the fork's ~1 gwei gas price. At mainnet's 0.02 gwei the same run costs ≈0.10623 OKB.
- The contract accepts the compiler's `direct` output mode (no NOT-NOT output buffers), which saves 40 NAND against `buffered` across the catalog.
