import {
  CircuitTapedOut,
  CircuitsFused,
  FeesWithdrawn,
  OwnershipTransferStarted,
  OwnershipTransferred,
  Paused,
  Transfer,
  TransistorsBought,
  TransistorsSold,
  Unpaused,
} from "../generated/CerebrProcessor/CerebrProcessor";
import { Circuit, FeeWithdrawal, Fusion, TapeOut, Trade } from "../generated/schema";
import {
  WAD,
  ZERO,
  ZERO_ADDRESS,
  bumpTierCount,
  commit,
  eventId,
  getAccount,
  getProtocol,
  getSnapshot,
  tapeOutCost,
  tierName,
} from "./helpers";

/** CBR ERC-20 transfers: balances, holder count and total supply (mint = buy, burn = sell/sink). */
export function handleCbrTransfer(event: Transfer): void {
  let from = event.params.from;
  let to = event.params.to;
  let value = event.params.value;
  if (from.equals(to)) return; // self-transfer: no balance change

  let p = getProtocol(event.address);
  let s = getSnapshot(p, event);
  let ts = event.block.timestamp;

  if (from.equals(ZERO_ADDRESS)) {
    p.totalSupply = p.totalSupply.plus(value);
  } else {
    let a = getAccount(from, ts);
    let before = a.cbrBalance;
    a.cbrBalance = before.minus(value);
    if (before.gt(ZERO) && a.cbrBalance.isZero()) p.holderCount = p.holderCount - 1;
    a.save();
  }

  if (to.equals(ZERO_ADDRESS)) {
    p.totalSupply = p.totalSupply.minus(value);
  } else {
    let b = getAccount(to, ts);
    let before = b.cbrBalance;
    b.cbrBalance = before.plus(value);
    if (before.isZero() && b.cbrBalance.gt(ZERO)) p.holderCount = p.holderCount + 1;
    b.save();
  }

  commit(p, s, event);
}

export function handleTransistorsBought(event: TransistorsBought): void {
  let p = getProtocol(event.address);
  let s = getSnapshot(p, event);
  let amount = event.params.amount;
  let cost = event.params.cost;

  let a = getAccount(event.params.buyer, event.block.timestamp);
  a.cbrBought = a.cbrBought.plus(amount);
  a.okbSpent = a.okbSpent.plus(cost);
  a.tradeCount = a.tradeCount + 1;
  a.save();

  let t = new Trade(eventId(event));
  t.type = "BUY";
  t.account = a.id;
  t.amountCbr = amount;
  t.okbAmount = cost;
  t.fee = ZERO;
  t.avgPrice = amount.isZero() ? ZERO : cost.times(WAD).div(amount);
  t.priceAfter = event.params.newPrice;
  t.supplyAfter = event.params.newSupply;
  t.blockNumber = event.block.number;
  t.timestamp = event.block.timestamp;
  t.transactionHash = event.transaction.hash;
  t.save();

  p.totalCbrBought = p.totalCbrBought.plus(amount);
  p.okbBalance = p.okbBalance.plus(cost);
  p.totalOkbIn = p.totalOkbIn.plus(cost);
  p.tradeCount = p.tradeCount + 1;
  p.buyCount = p.buyCount + 1;
  p.totalSupply = event.params.newSupply; // authoritative; equals the Transfer-tracked value

  s.buyCount = s.buyCount + 1;
  s.cbrBought = s.cbrBought.plus(amount);
  s.okbIn = s.okbIn.plus(cost);
  commit(p, s, event);
}

export function handleTransistorsSold(event: TransistorsSold): void {
  let p = getProtocol(event.address);
  let s = getSnapshot(p, event);
  let amount = event.params.amount;
  let net = event.params.net;
  let fee = event.params.fee;

  let a = getAccount(event.params.seller, event.block.timestamp);
  a.cbrSold = a.cbrSold.plus(amount);
  a.okbReceived = a.okbReceived.plus(net);
  a.feesPaid = a.feesPaid.plus(fee);
  a.tradeCount = a.tradeCount + 1;
  a.save();

  let t = new Trade(eventId(event));
  t.type = "SELL";
  t.account = a.id;
  t.amountCbr = amount;
  t.okbAmount = net;
  t.fee = fee;
  t.avgPrice = amount.isZero() ? ZERO : net.plus(fee).times(WAD).div(amount);
  t.priceAfter = event.params.newPrice;
  t.supplyAfter = event.params.newSupply;
  t.blockNumber = event.block.number;
  t.timestamp = event.block.timestamp;
  t.transactionHash = event.transaction.hash;
  t.save();

  // The fee stays in the contract as protocolFees; only `net` leaves.
  p.totalCbrSold = p.totalCbrSold.plus(amount);
  p.okbBalance = p.okbBalance.minus(net);
  p.totalOkbOut = p.totalOkbOut.plus(net);
  p.protocolFees = p.protocolFees.plus(fee);
  p.totalFeesCollected = p.totalFeesCollected.plus(fee);
  p.tradeCount = p.tradeCount + 1;
  p.sellCount = p.sellCount + 1;
  p.totalSupply = event.params.newSupply;

  s.sellCount = s.sellCount + 1;
  s.cbrSold = s.cbrSold.plus(amount);
  s.okbOut = s.okbOut.plus(net);
  s.feesCollected = s.feesCollected.plus(fee);
  commit(p, s, event);
}

export function handleCircuitTapedOut(event: CircuitTapedOut): void {
  let p = getProtocol(event.address);
  let s = getSnapshot(p, event);
  let tier = event.params.tier;
  let burned = event.params.cbrBurned;
  let tokenId = event.params.tokenId;

  let a = getAccount(event.params.owner, event.block.timestamp);
  a.tapeOutCount = a.tapeOutCount + 1;
  a.cbrBurned = a.cbrBurned.plus(burned);
  a.save();

  // The Circuit entity was created by the Circuit Transfer (mint) log earlier in this tx.
  let c = Circuit.load(tokenId.toString());
  if (c != null) {
    c.tier = tierName(tier);
    c.origin = "TAPE_OUT";
    c.cbrBurned = burned;
    c.save();
  }

  let t = new TapeOut(eventId(event));
  t.owner = a.id;
  t.circuit = tokenId.toString();
  t.tier = tierName(tier);
  t.cbrBurned = burned;
  t.supplyAfter = event.params.newSupply;
  t.blockNumber = event.block.number;
  t.timestamp = event.block.timestamp;
  t.transactionHash = event.transaction.hash;
  t.save();

  p.totalCbrBurned = p.totalCbrBurned.plus(burned);
  p.tapeOutCount = p.tapeOutCount + 1;
  bumpTierCount(p, tier);
  p.totalSupply = event.params.newSupply;

  s.tapeOuts = s.tapeOuts + 1;
  s.cbrBurned = s.cbrBurned.plus(burned);
  commit(p, s, event);
}

export function handleCircuitsFused(event: CircuitsFused): void {
  let p = getProtocol(event.address);
  let s = getSnapshot(p, event);
  let childTier = event.params.tier; // tier of the child
  let inputTier = childTier - 1;
  let burned = tapeOutCost(inputTier);
  let childId = event.params.childId.toString();
  let aId = event.params.parentA.toString();
  let bId = event.params.parentB.toString();
  let fusionId = eventId(event);

  let owner = getAccount(event.params.owner, event.block.timestamp);
  owner.fusionCount = owner.fusionCount + 1;
  owner.cbrBurned = owner.cbrBurned.plus(burned);
  owner.save();

  let child = Circuit.load(childId);
  let childTba = child != null ? child.tba : null;
  if (child != null) {
    child.tier = tierName(childTier);
    child.origin = "FUSION";
    child.cbrBurned = burned;
    child.parentA = aId;
    child.parentB = bId;
    child.fusion = fusionId;
    child.save();
  }
  let pa = Circuit.load(aId);
  if (pa != null) {
    pa.fusedInto = childId;
    pa.save();
  }
  let pb = Circuit.load(bId);
  if (pb != null) {
    pb.fusedInto = childId;
    pb.save();
  }

  let f = new Fusion(fusionId);
  f.owner = owner.id;
  f.child = childId;
  f.parentA = aId;
  f.parentB = bId;
  f.inputTier = tierName(inputTier);
  f.outputTier = tierName(childTier);
  f.cbrBurned = burned;
  f.childTba = childTba;
  f.blockNumber = event.block.number;
  f.timestamp = event.block.timestamp;
  f.transactionHash = event.transaction.hash;
  f.save();

  p.totalCbrBurned = p.totalCbrBurned.plus(burned);
  p.fusionCount = p.fusionCount + 1;
  bumpTierCount(p, childTier);

  s.fusions = s.fusions + 1;
  s.cbrBurned = s.cbrBurned.plus(burned);
  commit(p, s, event);
}

export function handleFeesWithdrawn(event: FeesWithdrawn): void {
  let p = getProtocol(event.address);
  let s = getSnapshot(p, event);
  let amount = event.params.amount;

  let w = new FeeWithdrawal(eventId(event));
  w.to = event.params.to;
  w.amount = amount;
  w.blockNumber = event.block.number;
  w.timestamp = event.block.timestamp;
  w.transactionHash = event.transaction.hash;
  w.save();

  p.protocolFees = p.protocolFees.gt(amount) ? p.protocolFees.minus(amount) : ZERO;
  p.okbBalance = p.okbBalance.minus(amount);
  p.totalFeesWithdrawn = p.totalFeesWithdrawn.plus(amount);
  p.totalOkbOut = p.totalOkbOut.plus(amount);
  s.okbOut = s.okbOut.plus(amount);
  commit(p, s, event);
}

export function handleOwnershipTransferStarted(event: OwnershipTransferStarted): void {
  let p = getProtocol(event.address);
  p.pendingOwner = event.params.newOwner;
  commit(p, getSnapshot(p, event), event);
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  let p = getProtocol(event.address);
  p.owner = event.params.newOwner;
  p.pendingOwner = null;
  commit(p, getSnapshot(p, event), event);
}

export function handlePaused(event: Paused): void {
  let p = getProtocol(event.address);
  p.paused = true;
  commit(p, getSnapshot(p, event), event);
}

export function handleUnpaused(event: Unpaused): void {
  let p = getProtocol(event.address);
  p.paused = false;
  commit(p, getSnapshot(p, event), event);
}
