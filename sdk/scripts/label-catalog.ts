// Writes CerebrScope onchain labels (name, description, input / output pin names) for the catalog
// circuits recorded in launch/out/<chainId>.json, so wallets, explorers and the dApp show real names.
//
//   node scripts/label-catalog.ts --rpc http://127.0.0.1:8545 --as 0xOwner --dry-run   # fork rehearsal
//   node --env-file=.env scripts/label-catalog.ts --network xlayer --dry-run           # mainnet plan
//   node --env-file=.env scripts/label-catalog.ts --network xlayer --yes               # mainnet send
//
// Idempotent: circuits whose onchain label already matches are skipped. Mainnet needs all of
// --network xlayer, PRIVATE_KEY and --yes. The key is never printed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getCircuit } from '../src/neuro/index.ts';
import { xLayer } from '../src/tapeout/index.ts';
import { LAUNCH_DIR } from './lib/config.ts';

const scopeAbi = parseAbi([
  'struct Label { string name; string description; string[] inputs; string[] outputs; }',
  'function setLabel(address circuits, uint256 id, Label label)',
  'function labelOf(address circuits, uint256 id) view returns (Label)',
  'function MAX_LABEL_NAME() view returns (uint256)',
  'function MAX_DESCRIPTION() view returns (uint256)',
  'function MAX_PIN_LABEL() view returns (uint256)',
]);
const circuitsAbi = parseAbi(['function ownerOf(uint256 id) view returns (address)']);

const { values: args } = parseArgs({
  options: {
    network: { type: 'string', default: 'fork' },
    rpc: { type: 'string' },
    as: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

const mainnet = args.network === 'xlayer';
const rpc = args.rpc ?? (mainnet ? (process.env.XLAYER_RPC ?? 'https://rpc.xlayer.tech') : (process.env.FORK_RPC ?? 'http://127.0.0.1:8545'));
if (mainnet && /127\.0\.0\.1|localhost/.test(rpc)) throw new Error('--network xlayer needs a public RPC');
const out = JSON.parse(readFileSync(resolve(LAUNCH_DIR, 'out/196.json'), 'utf8'));
const circuits = out.processor.circuits as Address;
const scope = out.scope as Address;
if (!scope) throw new Error('launch/out/196.json has no CerebrScope address');

const pc = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc, { batch: true }) });
const chainId = await pc.getChainId();
if (mainnet && chainId !== 196) throw new Error(`expected chain 196, got ${chainId}`);
if (!mainnet) {
  const client = (await pc.request({ method: 'web3_clientVersion' as never })) as string;
  if (!/anvil/i.test(client)) throw new Error(`fork mode needs a local anvil, got ${client}`);
}

let account: Address;
let sign: ((req: { to: Address; data: Hex }) => Promise<Hex>) | undefined;
if (mainnet && process.env.PRIVATE_KEY) {
  let acct;
  try {
    acct = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
  } catch {
    throw new Error('PRIVATE_KEY is not a valid secp256k1 private key (value not shown)');
  }
  account = acct.address;
  const wc = createWalletClient({ account: acct, chain: { ...xLayer, rpcUrls: { default: { http: [rpc] } } }, transport: http(rpc) });
  sign = (req) => wc.sendTransaction({ ...req, chain: null });
} else if (args.as) {
  account = args.as as Address;
  if (!mainnet) {
    await pc.request({ method: 'anvil_impersonateAccount' as never, params: [account] as never });
    sign = (req) => pc.request({ method: 'eth_sendTransaction' as never, params: [{ from: account, ...req }] as never }) as Promise<Hex>;
  }
} else {
  throw new Error(mainnet ? 'mainnet needs PRIVATE_KEY (or --as for a dry run)' : 'fork mode needs --as <owner>');
}

const [maxName, maxDesc, maxPin] = await Promise.all([
  pc.readContract({ address: scope, abi: scopeAbi, functionName: 'MAX_LABEL_NAME' }),
  pc.readContract({ address: scope, abi: scopeAbi, functionName: 'MAX_DESCRIPTION' }),
  pc.readContract({ address: scope, abi: scopeAbi, functionName: 'MAX_PIN_LABEL' }),
]);
const enc = new TextEncoder();
/** House style (no em dashes, "onchain"), then clipped to `max` UTF-8 bytes on a character boundary. */
const clip = (s: string, max: bigint) => {
  let t = s.replace(/—/g, '-').replace(/\bon-chain\b/gi, (m) => (m[0] === 'O' ? 'Onchain' : 'onchain'));
  while (enc.encode(t).length > Number(max)) t = t.slice(0, -1);
  return t;
};

console.log(`CerebrScope ${scope} · circuits ${circuits} · chain ${chainId} · ${mainnet ? 'MAINNET' : 'fork'} · owner ${account}`);
const plan: { id: bigint; key: string; label: { name: string; description: string; inputs: string[]; outputs: string[] } }[] = [];
for (const c of out.circuits as { key: string; circuitId: string }[]) {
  const id = BigInt(c.circuitId);
  const nc = getCircuit(c.key);
  const label = {
    name: clip(nc.name, maxName),
    description: clip(nc.description, maxDesc),
    inputs: nc.inputs.map((p) => clip(p, maxPin)),
    outputs: nc.outputs.map((p) => clip(p, maxPin)),
  };
  const [owner, cur] = await Promise.all([
    pc.readContract({ address: circuits, abi: circuitsAbi, functionName: 'ownerOf', args: [id] }),
    pc.readContract({ address: scope, abi: scopeAbi, functionName: 'labelOf', args: [circuits, id] }),
  ]);
  if (owner.toLowerCase() !== account.toLowerCase()) {
    console.log(`  #${id} ${c.key}: owned by ${owner}, skipped`);
    continue;
  }
  if (JSON.stringify(cur) === JSON.stringify(label)) {
    console.log(`  #${id} ${c.key}: already labelled "${label.name}"`);
    continue;
  }
  plan.push({ id, key: c.key, label });
  console.log(`  #${id} ${c.key}: set "${label.name}" (${label.inputs.length} in, ${label.outputs.length} out pin names)`);
}

if (plan.length === 0) {
  console.log('\nNothing to do: every catalog circuit is labelled.');
  process.exit(0);
}
if (args['dry-run'] || !sign) {
  console.log(`\nDry run: ${plan.length} setLabel transaction(s) planned; nothing was sent.`);
  process.exit(0);
}
if (mainnet && !args.yes) {
  console.log('\nAdd --yes to send these transactions.');
  process.exit(2);
}

let gas = 0n;
for (const p of plan) {
  // Simulate first so a revert (wrong owner, too long) stops before anything is sent.
  await pc.simulateContract({ account, address: scope, abi: scopeAbi, functionName: 'setLabel', args: [circuits, p.id, p.label] });
  const hash = await sign({ to: scope, data: encodeFunctionData({ abi: scopeAbi, functionName: 'setLabel', args: [circuits, p.id, p.label] }) });
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`#${p.id} setLabel reverted (${hash})`);
  gas += r.gasUsed * r.effectiveGasPrice;
  const back = await pc.readContract({ address: scope, abi: scopeAbi, functionName: 'labelOf', args: [circuits, p.id] });
  const ok = back.name === p.label.name && back.description === p.label.description;
  console.log(`  #${p.id} ${ok ? 'OK' : 'MISMATCH'} tx ${hash}`);
  if (!ok) process.exitCode = 1;
}
console.log(`\nDone: ${plan.length} label(s) written, gas ${Number(gas) / 1e18} OKB.`);
