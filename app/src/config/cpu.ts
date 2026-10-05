// Pure Cerebr CPU lookup (no import.meta.env) so Node scripts can import this file too.
import type { Address } from 'viem'
import { generatedCpus } from '../generated/cpus.ts'

/**
 * Where the Cerebr processor lives on one chain. Generated from launch/out/<chainId>.json by
 * scripts/sync-cpu.mjs. Only `circuits` is strictly needed: everything else (transistors, supply,
 * price, fees) is re-read from TapeOut at runtime.
 */
export type CpuConfig = {
  chainId: number
  /** The CPU's circuits contract (ERC-721 circuits, tapeout / eval / step). */
  circuits: Address
  /** The CPU's transistors contract (ERC-1155 NAND / LATCH). */
  transistors?: Address
  /** CerebrScope (on-chain die shots + metadata), when deployed. */
  scope?: Address
  /** Block of createCPU, if known. */
  block?: number
  /** Catalog id -> circuit id for the circuits taped out by the launch script. */
  catalog: Record<string, string>
}

export type { Address }

export function cpuConfigFor(chainId: number, override?: Partial<CpuConfig> & { circuits?: Address }): CpuConfig | undefined {
  const base = generatedCpus[chainId]
  if (override?.circuits && override.circuits.toLowerCase() !== base?.circuits.toLowerCase()) {
    // A different CPU: nothing from the generated file applies except an explicit scope.
    return { chainId, catalog: {}, ...override, circuits: override.circuits, scope: override.scope ?? base?.scope }
  }
  if (!base) return undefined
  return { ...base, scope: override?.scope ?? base.scope }
}
