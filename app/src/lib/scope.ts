// CerebrScope: Cerebr's no-admin, no-funds lens contract (onchain SVG die shots + metadata of TapeOut
// circuits) and its label registry (what a circuit computes: name, description, pin names), writable
// only by the circuit's owner. The gallery prefers its image and falls back to the client-side
// renderer (lib/dieShot.ts) on any error. Pure module (no React, no import.meta.env).
import { parseAbi, type Abi, type Address, type PublicClient } from 'viem'
import { decodeTokenUri } from './tokenUri.ts'
import type { TxParams } from './cerebr.ts'

export const scopeAbi = parseAbi([
  'struct Label { string name; string description; string[] inputs; string[] outputs; }',
  'function tokenURI(address circuits, uint256 id) view returns (string)',
  'function svgOf(address circuits, uint256 id) view returns (string)',
  'function labelOf(address circuits, uint256 id) view returns (Label)',
  'function setLabel(address circuits, uint256 id, Label label)',
  'function clearLabel(address circuits, uint256 id)',
  'event LabelSet(address indexed circuits, uint256 indexed id, address indexed by)',
  'error NotCPU(address circuits)',
  'error NotCircuitOwner()',
  'error LabelTooLong()',
  'error TooManyPinLabels()',
  // ownerOf() of a missing circuit, bubbled up from the CPU
  'error ERC721NonexistentToken(uint256 tokenId)',
])

/** CerebrScope limits, in UTF-8 bytes (MAX_LABEL_NAME, MAX_DESCRIPTION, MAX_PIN_LABEL). */
export const MAX_LABEL_NAME = 64
export const MAX_DESCRIPTION = 512
export const MAX_PIN_LABEL = 32

/** A label as CerebrScope stores it. All empty = no label. */
export type OnchainLabel = { name: string; description: string; inputs: readonly string[]; outputs: readonly string[] }

export const hasLabel = (l: OnchainLabel | undefined): l is OnchainLabel => !!l && l.name.trim().length > 0

const enc = new TextEncoder()
export const byteLength = (s: string) => enc.encode(s).length

/** Cuts `s` to at most `max` UTF-8 bytes without splitting a character. */
export function clipBytes(s: string, max: number): string {
  if (byteLength(s) <= max) return s
  let out = ''
  let n = 0
  for (const ch of s) {
    const b = byteLength(ch)
    if (n + b > max) break
    out += ch
    n += b
  }
  return out
}

/**
 * A label that setLabel() accepts for a circuit with nIn inputs and nOut outputs: name <= 64 bytes,
 * description <= 512 bytes, at most nIn / nOut pin names of <= 32 bytes each (_checkPins).
 */
export function fitLabel(l: { name: string; description?: string; inputs?: readonly string[]; outputs?: readonly string[] }, nIn: number, nOut: number): OnchainLabel {
  const pins = (p: readonly string[] | undefined, n: number) => (p ?? []).slice(0, n).map((x) => clipBytes(x.trim(), MAX_PIN_LABEL))
  return {
    name: clipBytes(l.name.trim(), MAX_LABEL_NAME),
    description: clipBytes((l.description ?? '').trim(), MAX_DESCRIPTION),
    inputs: pins(l.inputs, nIn),
    outputs: pins(l.outputs, nOut),
  }
}

/** CerebrScope.setLabel(circuits, id, label). Only the circuit NFT's owner may send it. */
export function setLabelTx(scope: Address, circuits: Address, id: bigint, label: OnchainLabel): TxParams {
  const { name, description, inputs, outputs } = label
  return { address: scope, abi: scopeAbi as Abi, functionName: 'setLabel', args: [circuits, id, { name, description, inputs, outputs }] }
}

/** labelOf() for many circuits in one multicall. A failed read leaves that id out. */
export async function readLabels(pc: PublicClient, scope: Address, circuits: Address, ids: bigint[], multicallAddress?: Address): Promise<Map<bigint, OnchainLabel>> {
  const out = new Map<bigint, OnchainLabel>()
  if (ids.length === 0) return out
  const res = await pc.multicall({
    allowFailure: true,
    multicallAddress,
    contracts: ids.map((id) => ({ address: scope, abi: scopeAbi, functionName: 'labelOf', args: [circuits, id] }) as const),
  })
  res.forEach((r, i) => {
    if (r.status === 'success') out.set(ids[i], r.result as OnchainLabel)
  })
  return out
}

/** data: URI of the circuit's onchain image, or undefined if the scope cannot render it. */
export async function scopeImage(pc: PublicClient, scope: Address, circuits: Address, id: bigint): Promise<string | undefined> {
  try {
    const uri = await pc.readContract({ address: scope, abi: scopeAbi, functionName: 'tokenURI', args: [circuits, id] })
    const meta = decodeTokenUri(uri)
    if (meta?.image) return meta.image
  } catch {
    // fall through to svgOf()
  }
  try {
    const svg = await pc.readContract({ address: scope, abi: scopeAbi, functionName: 'svgOf', args: [circuits, id] })
    if (svg.startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  } catch {
    // not available
  }
  return undefined
}
