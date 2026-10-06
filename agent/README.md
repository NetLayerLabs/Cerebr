# Cerebr Agent keeper (VPS service)

A small Node 26 daemon that keeps the [Cerebr Agent](../AGENT.md) alive. Every `INTERVAL_SEC` (600 s by default) it:

1. reads `observeAt(latest basefee)` on the `CerebrAgent` contract. This returns the inputs the neuron would see, its preview verdict, and whether `act()` is allowed yet;
2. if allowed, simulates and then sends `act()` from a dedicated **hot wallet**, using the gas estimate plus a 20% margin. It sends one transaction at a time, with the nonce read from the pending block. A stuck transaction is replaced with the same nonce and 20% higher fees;
3. reads the stored decision back and checks it offline. It re-derives the five inputs from the recorded basefee, EMA, timestamp and last-Go block, then re-simulates the NAND netlist of circuit #8 (`sdk/src/neuro/agent.ts`). The result is logged as `"verified": true|false`.

The contract makes the decision; the daemon just triggers it. `act()` is permissionless, so anyone can run a keeper. A keeper that loses a race simply skips that cycle.

Optional: once a day, when `BRAIN_WALLET_CHECKPOINT=1`, the daemon sends the call **through the policy circuit's own TapeOut account** (`account.execute(agent, 0, act(), 0)`). The decision is then recorded with `viaBrainWallet = true`. This needs an opened brain wallet (0.08 OKB, one-time) and a hot wallet that owns the circuit NFT. Each checkpoint pays TapeOut's **EXEC_FEE of 0.0013 OKB**, as much as about 3.5 days of `act()` gas. Daily checkpoints would cost about 0.039 OKB a month, roughly 3.5 times the agent's own gas, so they are off by default.

## Costs (measured on an X Layer mainnet fork, gas price 0.020000001 gwei)

| What | Gas used | OKB |
|---|---|---|
| `act()` while the 64-slot ring buffer is first being filled | 162k to 180k | ~0.0000033 |
| `act()` in steady state (ring wrapped) | 128,345 | 0.0000026 |
| per day at `INTERVAL_SEC=600` (144 acts) | | **~0.00037** (0.00047 in the first ~11 h) |
| per day at `INTERVAL_SEC=1800` (48 acts) | | ~0.00012 |
| brain-wallet checkpoint (`execute` → `act`) | 235,140 | 0.0000047 + **0.0013 EXEC_FEE** |

How long a balance lasts, given the 0.001 OKB `MIN_BALANCE_OKB` floor:

* **0.02 OKB at 10-minute cycles lasts about 51 days.**
* 0.01 OKB at 10-minute cycles lasts about 24 days.
* 0.01 OKB at 30-minute cycles lasts about 73 days.

X Layer charges no L1 data fee (`l1Fee = 0` in receipts). The gas *limit* is about 1.26M, because the contract refuses to run unless the full 1M eval budget is available. Only the gas actually used is charged.

## VPS setup, step by step

### 0. Prerequisites

* The `CerebrAgent` address from the deployment (see [AGENT.md](../AGENT.md#mainnet-rollout)).
* A Linux VPS. 1 vCPU and 512 MB RAM is plenty.

### 1. Create a dedicated hot wallet

Do this on your own machine, not the VPS, and do not reuse any wallet:

```sh
cast wallet new          # prints an address and a private key; store the key in your password manager
```

From your main wallet, send it **0.02 OKB** on X Layer (chainId 196). That is roughly 7 weeks at 10-minute cycles. The hot wallet should never hold anything else. It needs no tokens, NFTs or approvals.

### 2a. Run with Docker (recommended)

```sh
# Install Docker if needed: https://docs.docker.com/engine/install/  (BuildKit, the default since Docker 23,
# honours agent/Dockerfile.dockerignore so only agent/ and sdk/src/neuro/ are sent as build context)
git clone <this repo> cerebr && cd cerebr/agent
cp .env.example .env && chmod 600 .env
$EDITOR .env             # NETWORK=xlayer, AGENT_ADDRESS=0x..., AGENT_PRIVATE_KEY=0x...
# First run: observe only, never sends
sed -i 's/^DRY_RUN=0/DRY_RUN=1/' .env && docker compose up --build   # Ctrl-C after a cycle or two
# Then for real
sed -i 's/^DRY_RUN=1/DRY_RUN=0/' .env && docker compose up -d --build
docker compose logs -f
curl -s 127.0.0.1:8787/status | jq
```

To keep the key out of `.env`, mount it as a file and set `AGENT_PRIVATE_KEY_FILE=/run/secrets/agent_key` instead.

### 2b. Run natively with systemd

```sh
# Node 26 (runs the TypeScript sources directly; >= 24.12 also works)
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin cerebr
sudo git clone <this repo> /opt/cerebr && cd /opt/cerebr/agent && sudo npm ci --omit=dev
sudo install -m 600 -o root .env.example /etc/cerebr-agent.env && sudo $EDITOR /etc/cerebr-agent.env
sudo cp deploy/cerebr-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cerebr-agent
journalctl -u cerebr-agent -f
curl -s 127.0.0.1:8787/status
```

### 3. Startup guards

The daemon refuses to start in any of these cases:

* `NETWORK` is not set explicitly. `NETWORK=xlayer` needs an RPC that reports chainId 196 and is not a dev node. `NETWORK=fork` needs anvil or hardhat.
* `AGENT_ADDRESS` has no code.
* There is no key and `DRY_RUN` is off.
* The hot wallet holds less than `MIN_BALANCE_OKB`. While running, it stops sending below this balance and reports `status: "low-balance"`.

It also skips any cycle whose `maxFeePerGas` would exceed `MAX_FEE_GWEI`.

The private key is read once and removed from `process.env`. Log fields with secret-like names are redacted. The status endpoint never includes the key.

## Monitoring

* `GET /health` returns 200 while the daemon is running and has completed a cycle within the last 3 intervals; otherwise it returns 503. Docker's `HEALTHCHECK` uses it.
* `GET /status` returns JSON with: status, balance, counters, the last transaction, the last decision (pins decoded), the current observation, the next run time and the last error.
* Logs are one JSON object per line. The useful events are `observe`, `tx.sent`, `decision` (with `verified`), `cycle`, `balance.low`, `tx.replaced` and `cycle.error`. Transient RPC errors are retried with backoff: 1, 2 and 4 s per read, and a failed cycle is retried after 15 s, then 30 s, and so on, capped at the interval.

## Verifying decisions yourself

```sh
AGENT=0x...   # CerebrAgent
cast call $AGENT "latestDecision()((address,uint40,uint40,uint8,uint8,uint40,uint40,uint64,uint64,uint8,uint8,bool))" -r https://rpc.xlayer.tech
# fields: caller, block, timestamp, inputs, outputs, seq, prevGoBlock, basefee, ema, verdict(0 NoGo/1 Go/2 Abstain), reason, viaBrainWallet
cast call 0xB04EB79D1A5EECaabAAfF7B77d7c27578EE693FF "eval(uint256,bytes)(bytes)" 8 0x07 -r https://rpc.xlayer.tech   # = outputs
cast call $AGENT "replay(uint256)(uint8,bool)" <seq> -r https://rpc.xlayer.tech                                        # convenience
```

[AGENT.md](../AGENT.md#verifiability) shows how to recompute the inputs themselves from the recorded basefee, EMA, timestamp and last-Go block.

## Stopping

* Docker: `docker compose down`. systemd: `sudo systemctl stop cerebr-agent` (and `disable` to keep it off).
* On SIGTERM the daemon stops scheduling and waits up to 30 s for an in-flight transaction. An unconfirmed transaction is saved in `STATE_FILE` and resolved on the next start.
* To retire the agent, stop the daemon and send the hot wallet's remaining OKB back. The contract has no funds and no admin, so there is nothing to withdraw. It simply stops making decisions until someone calls `act()` again.

## Development

```sh
npm install
npm run typecheck
# fork end-to-end: deploys CerebrAgent on a fork, runs the Runner for several cycles with simulated basefee/time
anvil --fork-url https://rpc.xlayer.tech --chain-id 196 --auto-impersonate --port 8605 --silent &
(cd .. && forge build) && npm run fork:e2e        # prints PASS/FAIL per check and the measured gas
```
