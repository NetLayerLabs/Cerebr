// Names for circuits taped out from this browser (TapeOut stores no metadata on X Layer: tokenURI
// is ""). Catalog circuits are recognised from their netlist bytes; studio designs (custom neurons
// and networks) are remembered here, per chain and CPU. Best effort: storage may be unavailable.
import type { CircuitLabel } from './cerebr.ts'

const key = (chainId: number, circuits: string) => `cerebr:labels:${chainId}:${circuits.toLowerCase()}`

export function loadLabels(chainId: number, circuits: string): Record<string, CircuitLabel> {
  try {
    return JSON.parse(localStorage.getItem(key(chainId, circuits)) ?? '{}') as Record<string, CircuitLabel>
  } catch {
    return {}
  }
}

export function saveLabel(chainId: number, circuits: string, id: bigint, label: CircuitLabel) {
  try {
    const all = loadLabels(chainId, circuits)
    all[id.toString()] = label
    localStorage.setItem(key(chainId, circuits), JSON.stringify(all))
  } catch {
    // storage blocked: the circuit still works, it just shows as "Circuit #id"
  }
}
