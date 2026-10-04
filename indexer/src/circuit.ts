import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  CerebrCircuit,
  CircuitRevealed,
  Recommitted,
  Transfer,
} from "../generated/CerebrCircuit/CerebrCircuit";
import { Circuit, CircuitTransfer, Protocol } from "../generated/schema";
import { PROTOCOL_ID, ZERO, ZERO_ADDRESS, commit, eventId, getAccount, getProtocol, getSnapshot, tierName } from "./helpers";

const TWO = BigInt.fromI32(2);

function protocolFromCircuit(circuit: Address): Protocol {
  let p = Protocol.load(PROTOCOL_ID);
  if (p != null) return p;
  // Normally created by the processor's constructor events; fall back to CIRCUIT -> PROCESSOR.
  let proc = CerebrCircuit.bind(circuit).try_PROCESSOR();
  return getProtocol(proc.reverted ? ZERO_ADDRESS : proc.value);
}

/** ERC-721 Transfer: mint creates the Circuit; every transfer updates owner and TBA nesting. */
export function handleCircuitTransfer(event: Transfer): void {
  let id = event.params.tokenId;
  let key = id.toString();
  let from = event.params.from;
  let to = event.params.to;
  let ts = event.block.timestamp;

  let c = Circuit.load(key);
  if (from.equals(ZERO_ADDRESS)) {
    let p = protocolFromCircuit(event.address);
    let s = getSnapshot(p, event);
    let binding = CerebrCircuit.bind(event.address);

    c = new Circuit(key);
    c.tokenId = id;
    // Tier and origin are finalised by CircuitTapedOut / CircuitsFused later in the same tx.
    let info = binding.try_circuitInfo(id);
    c.tier = tierName(info.reverted ? 0 : info.value.value0);
    c.origin = "TAPE_OUT";
    c.minter = getAccount(to, ts).id;
    c.cbrBurned = ZERO;
    c.revealed = false;
    c.commitBlock = event.block.number;
    c.revealReadyBlock = event.block.number.plus(TWO);
    c.recommitCount = 0;
    c.tbaDeployed = false;
    c.mintedAtBlock = event.block.number;
    c.mintedAtTimestamp = ts;
    c.mintTx = event.transaction.hash;

    // Counterfactual ERC-6551 account (registry.account view via the Circuit contract).
    let tba = binding.try_tokenBoundAccount(id);
    if (!tba.reverted) {
      c.tba = tba.value;
      let acct = getAccount(tba.value, ts);
      acct.tokenBoundAccountOf = key;
      // Someone may have called registry.createAccount before the mint.
      if (acct.registryDeployed) {
        c.tbaDeployed = true;
        c.tbaDeployedAt = acct.registryDeployedAt;
        p.brainWalletsActivated = p.brainWalletsActivated + 1;
      }
      acct.save();
    }

    p.circuitsMinted = p.circuitsMinted + 1;
    s.circuitsMinted = s.circuitsMinted + 1;
    commit(p, s, event);
  } else if (c != null) {
    let prev = getAccount(from, ts);
    prev.circuitCount = prev.circuitCount - 1;
    prev.save();
  }
  if (c == null) return; // transfer of a token minted before startBlock (misconfiguration)

  let owner = getAccount(to, ts);
  owner.circuitCount = owner.circuitCount + 1;
  owner.save();
  c.owner = owner.id;
  // Nested ownership: the new owner may be another Circuit's token-bound account.
  c.heldBy = owner.tokenBoundAccountOf;
  c.save();

  let t = new CircuitTransfer(eventId(event));
  t.circuit = key;
  t.from = from;
  t.to = to;
  t.blockNumber = event.block.number;
  t.timestamp = ts;
  t.transactionHash = event.transaction.hash;
  t.save();
}

export function handleCircuitRevealed(event: CircuitRevealed): void {
  let key = event.params.tokenId.toString();
  let c = Circuit.load(key);
  if (c == null) return;
  let seed = event.params.seed;
  let tier = event.params.tier;

  c.revealed = true;
  c.seed = seed;
  c.tier = tierName(tier);
  c.revealedAt = event.block.timestamp;
  c.revealedBy = event.transaction.from;
  c.revealTx = event.transaction.hash;

  // computeTraits is pure, so the eth_call result never depends on the block.
  let traits = CerebrCircuit.bind(event.address).try_computeTraits(seed, tier);
  if (!traits.reverted) {
    let t = traits.value;
    c.architecture = t.architecture;
    c.cores = t.cores.toI32();
    c.clockTenthsGHz = t.clockTenthsGHz.toI32();
    c.nodeNm = t.nodeNm.toI32();
    c.rarity = t.rarity;
  }
  c.save();

  let p = protocolFromCircuit(event.address);
  let s = getSnapshot(p, event);
  p.circuitsRevealed = p.circuitsRevealed + 1;
  s.reveals = s.reveals + 1;
  commit(p, s, event);
}

/** Blockhash window expired (or was zero): the Circuit re-committed to a new block. */
export function handleRecommitted(event: Recommitted): void {
  let c = Circuit.load(event.params.tokenId.toString());
  if (c == null) return;
  c.commitBlock = event.params.commitBlock;
  c.revealReadyBlock = event.params.commitBlock.plus(TWO);
  c.recommitCount = c.recommitCount + 1;
  c.save();

  let p = protocolFromCircuit(event.address);
  p.recommitCount = p.recommitCount + 1;
  commit(p, getSnapshot(p, event), event);
}
