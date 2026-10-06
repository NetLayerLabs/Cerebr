# Agent instructions

- Cerebr is a TapeOut processor on X Layer mainnet (live since 2026-10-05) plus a neural compiler (`sdk/`), CerebrScope (`src/scope/`) and a dApp (`app/`).
- There is no Cerebr token, no bonding curve and no CerebrProcessor contract.
- Never send transactions or read `sdk/.env`. Mainnet actions are signed only by the deployment wallet's owner.
- Facts live in [README.md](README.md), [TAPEOUT.md](TAPEOUT.md), [ISSUANCE.md](ISSUANCE.md), [LAUNCH.md](LAUNCH.md) and [AUDIT.md](AUDIT.md).
- Checks: `forge test`; `cd sdk && npm test`; `cd app && npm run build`.
- Copy style: write "onchain", and use no em dashes.
