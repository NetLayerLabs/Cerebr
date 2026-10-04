import { Bytes } from "@graphprotocol/graph-ts";
import { Protocol, Circuit } from "../generated/schema";
import { ERC6551AccountCreated } from "../generated/ERC6551Registry/ERC6551Registry";
import { PROTOCOL_ID, commit, getAccount, getSnapshot } from "./helpers";

/**
 * Registry.createAccount ("Activate brain wallet"). The canonical registry serves every NFT on the
 * chain, so only accounts for the Cerebr Circuit collection are recorded. A Circuit's brain wallet
 * counts as activated only if the deployed address equals its canonical TBA (implementation =
 * ACCOUNT_IMPLEMENTATION, salt 0); accounts with other implementations or salts are ignored.
 */
export function handleAccountCreated(event: ERC6551AccountCreated): void {
  let p = Protocol.load(PROTOCOL_ID);
  if (p == null) return;
  if (!event.params.tokenContract.equals(p.circuit)) return;

  let acct = getAccount(event.params.account, event.block.timestamp);
  if (acct.registryDeployed) return; // createAccount is idempotent; the reference registry only emits on first deploy
  acct.registryDeployed = true;
  acct.registryDeployedAt = event.block.timestamp;
  acct.save();

  // If the Circuit is not minted yet, handleCircuitTransfer picks the flag up from the Account.
  let loaded = Circuit.load(event.params.tokenId.toString());
  if (loaded == null) return;
  let c = changetype<Circuit>(loaded);
  if (c.tbaDeployed || c.tba === null) return;
  if (!changetype<Bytes>(c.tba).equals(event.params.account)) return;
  c.tbaDeployed = true;
  c.tbaDeployedAt = event.block.timestamp;
  c.save();

  p.brainWalletsActivated = p.brainWalletsActivated + 1;
  commit(p, getSnapshot(p, event), event);
}
