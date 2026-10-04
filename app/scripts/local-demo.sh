#!/usr/bin/env bash
# One-shot LOCAL demo: anvil + full deploy + seeded activity + app config. Never touches a public chain.
# Usage: app/scripts/local-demo.sh [port]   (default 8545). Leaves anvil running; prints its PID.
set -euo pipefail
PORT="${1:-8545}"
RPC="http://127.0.0.1:${PORT}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  anvil --port "$PORT" --silent &
  echo "anvil started on $RPC (pid $!)"
  for _ in $(seq 1 40); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.25; done
fi
[ "$(cast chain-id --rpc-url "$RPC")" = "31337" ] || { echo "not anvil (chain id != 31337), aborting"; exit 1; }

forge script script/LocalDemo.s.sol --rpc-url "$RPC" --broadcast --gas-estimate-multiplier 200
cast rpc anvil_mine 2 --rpc-url "$RPC" >/dev/null
forge script script/LocalDemo.s.sol --sig "finalize()" --rpc-url "$RPC" --broadcast --gas-estimate-multiplier 200

cd app
node scripts/gen-abi.mjs ../out
node scripts/sync-deployments.mjs
echo "Done. Run: cd app && VITE_RPC_31337=$RPC VITE_DEFAULT_CHAIN_ID=31337 npm run dev"
