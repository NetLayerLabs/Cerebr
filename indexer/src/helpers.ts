import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Account, DailySnapshot, Protocol } from "../generated/schema";
import { CerebrProcessor } from "../generated/CerebrProcessor/CerebrProcessor";

export const PROTOCOL_ID = "cerebr";
export const ZERO_ADDRESS = Address.zero();
export const ZERO = BigInt.zero();
export const ONE = BigInt.fromI32(1);
export const WAD = BigInt.fromString("1000000000000000000");
export const TWO_WAD_SQ = BigInt.fromString("2000000000000000000000000000000000000");
export const SECONDS_PER_DAY = 86400;

// Tape-out costs (CBR base units); must match CerebrProcessor constants.
export const BASIC_COST = BigInt.fromString("5000000000000000000000");
export const PRO_COST = BigInt.fromString("20000000000000000000000");
export const QUANTUM_COST = BigInt.fromString("100000000000000000000000");

/** Tier enum value (uint8 in the ABI) to the GraphQL Tier enum string. */
export function tierName(tier: i32): string {
  if (tier == 0) return "Basic";
  if (tier == 1) return "Pro";
  if (tier == 2) return "Quantum";
  return "Singularity";
}

/** CBR burned to tape out `tier` (also the cost of fusing two `tier` Circuits). Singularity -> 0. */
export function tapeOutCost(tier: i32): BigInt {
  if (tier == 0) return BASIC_COST;
  if (tier == 1) return PRO_COST;
  if (tier == 2) return QUANTUM_COST;
  return ZERO;
}

export function ceilDiv(a: BigInt, b: BigInt): BigInt {
  if (a.isZero()) return ZERO;
  return a.minus(ONE).div(b).plus(ONE);
}

/**
 * Load the Protocol singleton, creating it on first sight of the processor. The immutables
 * (CIRCUIT, BASE_PRICE, SLOPE) are read once via eth_call.
 */
export function getProtocol(processor: Address): Protocol {
  let p = Protocol.load(PROTOCOL_ID);
  if (p != null) return p;
  p = new Protocol(PROTOCOL_ID);
  let c = CerebrProcessor.bind(processor);
  let circuit = c.try_CIRCUIT();
  let base = c.try_BASE_PRICE();
  let slope = c.try_SLOPE();
  p.processor = processor;
  p.circuit = circuit.reverted ? ZERO_ADDRESS : circuit.value;
  p.paused = false;
  p.basePrice = base.reverted ? ZERO : base.value;
  p.slope = slope.reverted ? ZERO : slope.value;
  p.totalSupply = ZERO;
  p.currentPrice = p.basePrice;
  p.totalCbrBought = ZERO;
  p.totalCbrSold = ZERO;
  p.totalCbrBurned = ZERO;
  p.holderCount = 0;
  p.okbBalance = ZERO;
  p.reserveRequired = ZERO;
  p.surplusReserve = ZERO;
  p.protocolFees = ZERO;
  p.totalFeesCollected = ZERO;
  p.totalFeesWithdrawn = ZERO;
  p.totalOkbIn = ZERO;
  p.totalOkbOut = ZERO;
  p.tradeCount = 0;
  p.buyCount = 0;
  p.sellCount = 0;
  p.tapeOutCount = 0;
  p.fusionCount = 0;
  p.circuitsMinted = 0;
  p.circuitsBasic = 0;
  p.circuitsPro = 0;
  p.circuitsQuantum = 0;
  p.circuitsSingularity = 0;
  p.circuitsRevealed = 0;
  p.recommitCount = 0;
  p.brainWalletsActivated = 0;
  p.lastUpdatedBlock = ZERO;
  p.lastUpdatedTimestamp = ZERO;
  return p;
}

/** Spot price at `supply`, same formula as CerebrProcessor._priceAt. */
export function priceAt(p: Protocol, supply: BigInt): BigInt {
  return p.basePrice.plus(p.slope.times(supply).div(WAD));
}

/** OKB needed to buy back all of `supply` along the curve (rounded up, like reserveRequired()). */
export function reserveFor(p: Protocol, supply: BigInt): BigInt {
  return ceilDiv(p.basePrice.times(supply), WAD).plus(ceilDiv(p.slope.times(supply).times(supply), TWO_WAD_SQ));
}

export function getAccount(addr: Address, timestamp: BigInt): Account {
  let a = Account.load(addr);
  if (a != null) return a;
  a = new Account(addr);
  a.cbrBalance = ZERO;
  a.cbrBought = ZERO;
  a.cbrSold = ZERO;
  a.cbrBurned = ZERO;
  a.okbSpent = ZERO;
  a.okbReceived = ZERO;
  a.feesPaid = ZERO;
  a.tradeCount = 0;
  a.tapeOutCount = 0;
  a.fusionCount = 0;
  a.circuitCount = 0;
  a.registryDeployed = false;
  a.firstSeenTimestamp = timestamp;
  return a;
}

/** Today's snapshot, created with the protocol's current state as the opening values. */
export function getSnapshot(p: Protocol, event: ethereum.Event): DailySnapshot {
  let day = event.block.timestamp.toI32() / SECONDS_PER_DAY;
  let id = day.toString();
  let s = DailySnapshot.load(id);
  if (s != null) return s;
  s = new DailySnapshot(id);
  s.dayStartTimestamp = BigInt.fromI32(day * SECONDS_PER_DAY);
  s.buyCount = 0;
  s.sellCount = 0;
  s.cbrBought = ZERO;
  s.cbrSold = ZERO;
  s.okbIn = ZERO;
  s.okbOut = ZERO;
  s.feesCollected = ZERO;
  s.cbrBurned = ZERO;
  s.tapeOuts = 0;
  s.fusions = 0;
  s.reveals = 0;
  s.circuitsMinted = 0;
  s.openPrice = p.currentPrice;
  s.highPrice = p.currentPrice;
  s.lowPrice = p.currentPrice;
  s.closePrice = p.currentPrice;
  s.totalSupply = p.totalSupply;
  s.totalCbrBurned = p.totalCbrBurned;
  s.okbBalance = p.okbBalance;
  s.reserveRequired = p.reserveRequired;
  s.surplusReserve = p.surplusReserve;
  s.protocolFees = p.protocolFees;
  s.holderCount = p.holderCount;
  s.totalCircuits = p.circuitsMinted;
  return s;
}

/**
 * Recompute curve-derived stats, then save the protocol and the day's snapshot with closing values.
 * Call once at the end of every handler that touched either entity.
 */
export function commit(p: Protocol, s: DailySnapshot, event: ethereum.Event): void {
  p.currentPrice = priceAt(p, p.totalSupply);
  p.reserveRequired = reserveFor(p, p.totalSupply);
  let locked = p.reserveRequired.plus(p.protocolFees);
  p.surplusReserve = p.okbBalance.gt(locked) ? p.okbBalance.minus(locked) : ZERO;
  p.lastUpdatedBlock = event.block.number;
  p.lastUpdatedTimestamp = event.block.timestamp;
  p.save();

  if (p.currentPrice.gt(s.highPrice)) s.highPrice = p.currentPrice;
  if (p.currentPrice.lt(s.lowPrice)) s.lowPrice = p.currentPrice;
  s.closePrice = p.currentPrice;
  s.totalSupply = p.totalSupply;
  s.totalCbrBurned = p.totalCbrBurned;
  s.okbBalance = p.okbBalance;
  s.reserveRequired = p.reserveRequired;
  s.surplusReserve = p.surplusReserve;
  s.protocolFees = p.protocolFees;
  s.holderCount = p.holderCount;
  s.totalCircuits = p.circuitsMinted;
  s.save();
}

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

export function bumpTierCount(p: Protocol, tier: i32): void {
  if (tier == 0) p.circuitsBasic = p.circuitsBasic + 1;
  else if (tier == 1) p.circuitsPro = p.circuitsPro + 1;
  else if (tier == 2) p.circuitsQuantum = p.circuitsQuantum + 1;
  else p.circuitsSingularity = p.circuitsSingularity + 1;
}
