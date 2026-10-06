// Where the landing page reads from. Only addresses live here: every number on the page (supply,
// price, fees, gate counts, ...) is read from X Layer at runtime (useCpuStats.ts).

import { formatEther, isAddress, type Address } from 'viem'
import { cpuConfigFor } from '../config/cpu.ts'

const env = import.meta.env as Record<string, string | undefined>

function addr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? v : undefined
}

const cfg = cpuConfigFor(196)

export interface Issuance {
  /** The mainnet CPU (circuits address), from VITE_CPU_196 (same variable as the dApp), else the launch record. */
  cpu: Address | undefined
  /** Its transistors contract when known (lets readCpu answer in one round trip; verified onchain). */
  transistors: Address | undefined
  /** CerebrScope (circuit labels). */
  scope: Address | undefined
}

const cpu = addr(env.VITE_CPU_196) ?? addr(env.VITE_CEREBR_CPU) ?? cfg?.circuits
const sameCpu = !!cpu && cpu.toLowerCase() === cfg?.circuits.toLowerCase()

export const ISSUANCE: Issuance = {
  cpu,
  transistors: sameCpu ? cfg?.transistors : undefined,
  scope: cfg?.scope,
}

export const RPC_196 = env.VITE_RPC_196 || 'https://rpc.xlayer.tech'
export const EXPLORER = 'https://www.oklink.com/xlayer'

/** Wei to a short OKB string without trailing zeros. */
export function okb(wei: bigint): string {
  return formatEther(wei)
}

/** 0x1234…abcd */
export function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}
