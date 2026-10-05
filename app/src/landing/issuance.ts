// Launch values for the Cerebr processor, as shown on the landing page. One source of truth:
// launch/config.json (the same file sdk/scripts/launch.ts passes to createCPU). Its supply cap and
// unit price are only shown once `issuance.confirmed` is true; until then the page shows
// "set at launch" placeholders. Once the CPU exists, the live strip reads the real values on-chain.

import { formatEther, isAddress, parseEther, type Address } from 'viem'
import { cpuConfigFor } from '../config/cpu.ts'
import launchConfigRaw from '../../../launch/config.json?raw'

const env = import.meta.env as Record<string, string | undefined>

interface LaunchConfigFile {
  cpu?: { name?: string; symbol?: string }
  issuance?: { transistorSupply?: string; mintPriceOkb?: string; confirmed?: boolean }
}

function parseConfig(raw: string): LaunchConfigFile {
  try {
    return JSON.parse(raw) as LaunchConfigFile
  } catch {
    return {}
  }
}

const config = parseConfig(launchConfigRaw)
const confirmed = config.issuance?.confirmed === true

function supplyOf(v: string | undefined): bigint | undefined {
  return confirmed && v && /^\d+$/.test(v) ? BigInt(v) : undefined
}

function priceOf(v: string | undefined): bigint | undefined {
  return confirmed && v && /^\d+(\.\d{1,18})?$/.test(v) ? parseEther(v) : undefined
}

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? v : undefined
}

export interface Issuance {
  name: string
  symbol: string
  /** Transistor supply cap (NAND + LATCH share it); undefined until confirmed. */
  supplyCap: bigint | undefined
  /** Price per transistor in wei; undefined until confirmed. */
  mintPrice: bigint | undefined
  /** The mainnet CPU (circuits address), from VITE_CPU_196 (same variable as the dApp), else the launch record. */
  cpu: Address | undefined
}

export const ISSUANCE: Issuance = {
  name: config.cpu?.name ?? 'Cerebr',
  symbol: config.cpu?.symbol ?? '',
  supplyCap: supplyOf(config.issuance?.transistorSupply),
  mintPrice: priceOf(config.issuance?.mintPriceOkb),
  cpu: addr(env.VITE_CPU_196) ?? addr(env.VITE_CEREBR_CPU) ?? cpuConfigFor(196)?.circuits,
}

/** TapeOut protocol fees observed on X Layer on 2026-10-04 (TAPEOUT.md). TapeOut's owner can change them. */
export const FEES = {
  deploy: '0.0066',
  mintCall: '0.00066',
  tapeout: '0.0013',
  open: '0.08',
  execute: '0.0013',
} as const

export const RPC_196 = env.VITE_RPC_196 || 'https://rpc.xlayer.tech'
export const EXPLORER = 'https://www.oklink.com/xlayer'

/** Wei to a short OKB string without trailing zeros. */
export function okb(wei: bigint): string {
  return formatEther(wei)
}
