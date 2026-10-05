// Guards against a launch re-run spending after the launch is complete. Idempotence normally comes
// from the state file; these checks also hold when that file is missing, stale or edited:
//  - a mainnet state marked `done` refuses to send unless --continue-after-done;
//  - createCPU is refused when this deployer already has a processor (an out file for the network,
//    or a CPU on the factory whose creator is the deployer) unless --allow-second-cpu.

import { existsSync, readFileSync } from 'node:fs';
import { getAddress, type Address, type PublicClient } from 'viem';
import { XLAYER, circuitsAbi, factoryAbi, transistorsAbi } from '../../src/tapeout/index.ts';
import { outPath } from './state.ts';

/** Error text when a mainnet run would send after the recorded launch completed, else undefined. */
export function doneGuard(o: { mainnet: boolean; sends: boolean; done?: string; statePath: string; continueAfterDone: boolean }): string | undefined {
  if (!o.mainnet || !o.sends || !o.done || o.continueAfterDone) return undefined;
  return (
    `the launch recorded in ${o.statePath} completed at ${o.done}; refusing to send more transactions.\n` +
    'Use --dry-run or --verify-only to inspect it. To deliberately extend a finished launch (e.g. tape out a newly added circuit), ' +
    're-run with --continue-after-done after checking the dry-run plan.'
  );
}

export interface ExistingCpu {
  circuits: Address;
  transistors: Address;
  /** Where it was found. */
  source: string;
}

/** The processor recorded in the (non-fork) launch output for this chain, if that file exists. */
export function recordedLaunch(chainId: number): ExistingCpu | undefined {
  const path = outPath('xlayer', chainId);
  if (!existsSync(path)) return undefined;
  let p: { circuits?: string; transistors?: string } = {};
  try {
    p = JSON.parse(readFileSync(path, 'utf8')).processor ?? {};
  } catch {
    // unreadable: still a launch record
  }
  return { circuits: (p.circuits ?? '(unreadable)') as Address, transistors: (p.transistors ?? '(unreadable)') as Address, source: path };
}

/**
 * Every CPU on the TapeOut factory whose transistors.creator() is `creator`. Iterates
 * factory.cpus(i) with multicall: X Layer's public RPC caps eth_getLogs at 100 blocks, so scanning
 * CPUCreated by creator topic from TapeOut's first block (~1.5M blocks) is not practical.
 */
export async function findCpusCreatedBy(pc: PublicClient, creator: Address, batch = 100): Promise<ExistingCpu[]> {
  const count = await pc.readContract({ address: XLAYER.factory, abi: factoryAbi, functionName: 'cpuCount' });
  const out: ExistingCpu[] = [];
  const me = getAddress(creator);
  for (let end = Number(count); end > 0; end -= batch) {
    const ids = Array.from({ length: Math.min(batch, end) }, (_, j) => BigInt(end - 1 - j));
    const call = { allowFailure: false, multicallAddress: XLAYER.multicall3 } as const;
    const circuits = (await pc.multicall({ ...call, contracts: ids.map((i) => ({ address: XLAYER.factory, abi: factoryAbi, functionName: 'cpus', args: [i] }) as const) })) as Address[];
    const transistors = (await pc.multicall({ ...call, contracts: circuits.map((c) => ({ address: c, abi: circuitsAbi, functionName: 'transistors' }) as const) })) as Address[];
    const creators = await pc.multicall({
      allowFailure: true,
      multicallAddress: XLAYER.multicall3,
      contracts: transistors.map((t) => ({ address: t, abi: transistorsAbi, functionName: 'creator' }) as const),
    });
    creators.forEach((r, j) => {
      if (r.status === 'success' && getAddress(r.result as Address) === me) {
        out.push({ circuits: getAddress(circuits[j]), transistors: getAddress(transistors[j]), source: `TapeOut factory cpus(${ids[j]}), creator ${me}` });
      }
    });
  }
  return out;
}

/**
 * Error text when planning createCPU would create a second processor for this deployer, else
 * undefined. Checks the network's launch output (mainnet) and the factory itself (both modes).
 */
export async function secondCpuGuard(o: { pc: PublicClient; mainnet: boolean; chainId: number; deployer: Address; statePath: string }): Promise<string | undefined> {
  const found: ExistingCpu[] = [];
  if (o.mainnet) {
    const rec = recordedLaunch(o.chainId);
    if (rec) found.push(rec);
  }
  found.push(...(await findCpusCreatedBy(o.pc, o.deployer)));
  if (found.length === 0) return undefined;
  const list = found.map((f) => `  processor (circuits) ${f.circuits}, transistors ${f.transistors}  [${f.source}]`).join('\n');
  return (
    `${o.statePath} has no processor, but ${o.deployer} already has one:\n${list}\n` +
    'Refusing to createCPU a second processor. If the state file was lost, restore it (mainnet: launch/state.196.json is committed) ' +
    'and re-run; pass --allow-second-cpu only if you really want another processor.'
  );
}
