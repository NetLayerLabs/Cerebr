// Optional permissionless reveal keeper. The contracts already auto-reveal on-chain (every tape-out
// and fusion settles up to 2 queued Circuits, every buy 1; AUDIT 2-6), so this is a backup for quiet
// periods and pauses: it reveals every sealed Circuit as soon as it is ready, so no owner can hold a
// reveal back until the 256-block blockhash window expires and re-roll. reveal() is callable by anyone.
//
//   RPC_URL=https://testrpc.xlayer.tech KEEPER_PRIVATE_KEY=0x... node scripts/keeper.ts
//   RPC_URL=http://127.0.0.1:8545 node scripts/keeper.ts        (anvil: unlocked account #9, no key)
//
// Env: RPC_URL (required), CIRCUIT (default: from the generated deployments for the chain),
//      KEEPER_PRIVATE_KEY (required off anvil; use a dedicated low-balance hot wallet),
//      POLL_MS (default 2000), ONCE=1 (single pass, then exit).
import { createPublicClient, createWalletClient, http, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { cerebrCircuitAbi } from '../src/abi/index.ts'
import { getDeployment } from '../src/config/deployments.ts'

const RPC = process.env.RPC_URL
if (!RPC) throw new Error('RPC_URL is required')
const POLL_MS = Number(process.env.POLL_MS ?? 2000)
const ANVIL_ACCOUNT_9: Address = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720'

const pub = createPublicClient({ transport: http(RPC) })
const chainId = await pub.getChainId()
const circuit = (process.env.CIRCUIT ?? getDeployment(chainId)?.circuit) as Address | undefined
if (!circuit || /^0x0+$/.test(circuit)) throw new Error(`no Circuit address for chain ${chainId}; set CIRCUIT`)

const key = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined
if (!key && chainId !== 31337) throw new Error('KEEPER_PRIVATE_KEY is required outside anvil')
const account = key ? privateKeyToAccount(key) : ANVIL_ACCOUNT_9
const wallet = createWalletClient({ transport: http(RPC), account })

let nextUnchecked = 1n // ids below this are known to be revealed
const pending = new Set<bigint>()

async function pass() {
  const [total, block] = await Promise.all([
    pub.readContract({ address: circuit!, abi: cerebrCircuitAbi, functionName: 'totalMinted' }),
    pub.getBlockNumber(),
  ])
  for (; nextUnchecked <= total; nextUnchecked++) pending.add(nextUnchecked)
  for (const id of [...pending].sort((a, b) => (a < b ? -1 : 1))) {
    const [, revealed, commitBlock] = await pub.readContract({
      address: circuit!,
      abi: cerebrCircuitAbi,
      functionName: 'circuitInfo',
      args: [id],
    })
    if (revealed) {
      pending.delete(id)
      continue
    }
    if (block < BigInt(commitBlock) + 2n) continue // hash of commitBlock + 1 not available yet
    try {
      const { request, result } = await pub.simulateContract({
        address: circuit!,
        abi: cerebrCircuitAbi,
        functionName: 'reveal',
        args: [id],
        account,
      })
      const hash = await wallet.writeContract({ ...request, chain: null })
      const r = await pub.waitForTransactionReceipt({ hash })
      console.log(`${result ? 'revealed' : 're-committed'} #${id} (tx ${hash}, gas ${r.gasUsed})`)
      if (result) pending.delete(id)
    } catch (e) {
      // Someone else revealed first, or a transient RPC error: re-check next pass.
      console.warn(`reveal #${id} skipped: ${(e as Error).message.split('\n')[0]}`)
    }
  }
}

console.log(`keeper: chain ${chainId}, circuit ${circuit}, sender ${typeof account === 'string' ? account : account.address}`)
do {
  await pass()
  if (process.env.ONCE) break
  await new Promise((r) => setTimeout(r, POLL_MS))
} while (true)
