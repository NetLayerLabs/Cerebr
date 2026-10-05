// CerebrScope: Cerebr's no-admin, no-funds lens contract (on-chain SVG die shots + metadata of TapeOut
// circuits). Optional: when a scope address is configured, the gallery prefers its image and falls
// back to the client-side renderer (lib/dieShot.ts) on any error.
import { parseAbi, type Address, type PublicClient } from 'viem'
import { decodeTokenUri } from './tokenUri.ts'

export const scopeAbi = parseAbi([
  'function tokenURI(address circuits, uint256 id) view returns (string)',
  'function svgOf(address circuits, uint256 id) view returns (string)',
])

/** data: URI of the circuit's on-chain image, or undefined if the scope cannot render it. */
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
