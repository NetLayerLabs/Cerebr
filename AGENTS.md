# Agent Instructions for Claude Code

You are building the smart contracts for **Cerebr**, a Web3 protocol for the X Layer hackathon. The deadline is in 4 days. Prioritize contract security, gas efficiency, and simplicity.

## Tech Stack
- **Framework:** Hardhat or Foundry (Solidity).
- **Network:** X Layer (OKX L2).
- **Libraries:** OpenZeppelin (ERC20, ERC721, ReentrancyGuard).

## Contract 1: CerebrProcessor.sol
This is the core contract. It must implement:
1. **Bonding Curve Minting:** A payable `buyTransistors()` function that calculates the price of $CBR based on the current supply.
2. **Bonding Curve Selling:** A `sellTransistors()` function that burns the user's $CBR and refunds them.
3. **The TapeOut Function:** A `tapeOutCircuit()` function. It takes 5,000 $CBR from the user, calls `_burn()` on those tokens, and then mints 1 ERC721 Circuit NFT to the user.

## Immediate Next Steps for Claude
1. Read `TOKENOMICS.md` to understand the economic loop.
2. Initialize a new Hardhat/Foundry project in this directory.
3. Write the `CerebrProcessor.sol` contract ensuring the bonding curve math avoids integer overflow/underflow vulnerabilities.
4. Write a comprehensive test script to prove the math works before we deploy to X Layer mainnet.
