// Launch config (launch/config.json): the processor's identity, the disclosed issuance terms, and
// the catalog circuits to tape out. Validated here so every later step can trust it.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAddress, parseEther, type Address } from 'viem';
import { getCircuit, type OutputMode } from '../../src/neuro/index.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const LAUNCH_DIR = resolve(REPO_ROOT, 'launch');
export const DEFAULT_CONFIG = resolve(LAUNCH_DIR, 'config.json');

export interface CircuitEntry {
  id: string;
  flagship?: boolean;
}

export interface Pins {
  factoryImpl: Address;
  transistorImpl: Address;
  circuitImpl: Address;
  openerImplementation: Address;
  /** Implementation behind the account proxy's beacon (TapeOut's upgradeable ERC-6551 account logic). */
  accountBeaconImpl: Address;
}

export interface LaunchConfig {
  path: string;
  cpu: { name: string; symbol: string; story: string };
  issuance: { transistorSupply: bigint; mintPriceOkb: string; mintPrice: bigint; confirmed: boolean };
  outputMode: OutputMode;
  circuits: CircuitEntry[];
  openAccounts: string[];
  withdrawCreatorRevenue: boolean;
  /** Transistors minted on top of what the tapeouts burn, left in the deployer's wallet. */
  keep: { nand: bigint; latch: bigint };
  pins: Pins;
  /** CerebrScope (deployed separately with script/DeployScope.s.sol); recorded in the launch output for the dApp. */
  scope?: Address;
}

function fail(path: string, msg: string): never {
  throw new Error(`${path}: ${msg}`);
}

export function loadConfig(path = DEFAULT_CONFIG): LaunchConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const str = (v: unknown, what: string) => {
    if (typeof v !== 'string' || v.trim() === '') fail(path, `${what} must be a non-empty string`);
    return v;
  };

  const cpu = { name: str(raw.cpu?.name, 'cpu.name'), symbol: str(raw.cpu?.symbol, 'cpu.symbol'), story: str(raw.cpu?.story, 'cpu.story') };

  const supplyStr = str(raw.issuance?.transistorSupply, 'issuance.transistorSupply');
  if (!/^\d+$/.test(supplyStr)) fail(path, 'issuance.transistorSupply must be an integer string');
  const transistorSupply = BigInt(supplyStr);
  const mintPriceOkb = str(raw.issuance?.mintPriceOkb, 'issuance.mintPriceOkb');
  if (!/^\d+(\.\d{1,18})?$/.test(mintPriceOkb)) fail(path, 'issuance.mintPriceOkb must be a decimal OKB amount');
  const mintPrice = parseEther(mintPriceOkb);
  if (transistorSupply <= 0n) fail(path, 'issuance.transistorSupply must be > 0');
  const confirmed = raw.issuance?.confirmed === true;

  const outputMode = raw.outputMode ?? 'direct';
  if (outputMode !== 'direct' && outputMode !== 'buffered') fail(path, 'outputMode must be "direct" or "buffered"');

  if (!Array.isArray(raw.circuits) || raw.circuits.length === 0) fail(path, 'circuits must be a non-empty array');
  const circuits: CircuitEntry[] = raw.circuits.map((c: CircuitEntry) => ({ id: str(c?.id, 'circuits[].id'), flagship: c.flagship === true }));
  const seen = new Set<string>();
  for (const c of circuits) {
    getCircuit(c.id); // throws on unknown ids
    if (seen.has(c.id)) fail(path, `circuit ${c.id} listed twice`);
    for (const dep of getCircuit(c.id).deps) {
      if (!seen.has(dep)) fail(path, `circuit ${c.id} REFs ${dep}, which must be listed before it`);
    }
    seen.add(c.id);
  }

  const openAccounts: string[] = raw.openAccounts ?? [];
  for (const id of openAccounts) if (!seen.has(id)) fail(path, `openAccounts: ${id} is not in circuits`);

  const keep = { nand: 0n, latch: 0n };
  for (const k of ['nand', 'latch'] as const) {
    const v = raw.keep?.[k] ?? '0';
    if (typeof v !== 'string' || !/^\d+$/.test(v)) fail(path, `keep.${k} must be an integer string`);
    keep[k] = BigInt(v);
  }

  const pins = raw.pins ?? {};
  for (const k of ['factoryImpl', 'transistorImpl', 'circuitImpl', 'openerImplementation', 'accountBeaconImpl'] as const) {
    if (!isAddress(pins[k] ?? '', { strict: false })) fail(path, `pins.${k} must be an address`);
  }

  const scope = raw.scope == null || raw.scope === '' ? undefined : raw.scope;
  if (scope !== undefined && !isAddress(scope, { strict: false })) fail(path, 'scope must be an address (or omitted)');

  return {
    path,
    cpu,
    issuance: { transistorSupply, mintPriceOkb, mintPrice, confirmed },
    outputMode,
    circuits,
    openAccounts,
    withdrawCreatorRevenue: raw.withdrawCreatorRevenue !== false,
    keep,
    pins: pins as Pins,
    ...(scope ? { scope: scope as Address } : {}),
  };
}
