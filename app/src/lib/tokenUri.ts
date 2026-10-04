export type CircuitMetadata = {
  name: string
  description: string
  image: string
  attributes: { trait_type: string; value: string | number }[]
}

function b64decodeUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Decode the on-chain `data:application/json;base64,...` tokenURI. */
export function decodeTokenUri(uri: string): CircuitMetadata | undefined {
  const prefix = 'data:application/json;base64,'
  if (!uri.startsWith(prefix)) return undefined
  try {
    const meta = JSON.parse(b64decodeUtf8(uri.slice(prefix.length))) as CircuitMetadata
    // Only ever render the contract's own inline SVG.
    if (typeof meta.image !== 'string' || !meta.image.startsWith('data:image/svg+xml;base64,')) return undefined
    return meta
  } catch {
    return undefined
  }
}
