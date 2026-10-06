import { useMemo, useState } from 'react'
import { useConnection, useGasPrice } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { tapeoutGas } from '@cerebr/sdk/tapeout'
import { useBalances, useCircuits, useCpu, useNet } from '../hooks/useCpu.ts'
import { useInFlight, useTx } from '../hooks/useTx.ts'
import { useToasts } from '../hooks/useToasts.tsx'
import { href } from '../hooks/useRoute.ts'
import { claimTx, dropErrorKey, neuronArg, neuronFormula, neuronNand, pickGenesisNeuron, useGenesisDrop } from '../lib/drop.ts'
import { compileDesign } from '../lib/cerebr.ts'
import { fmt } from '../lib/format.ts'
import { Row } from './ui.tsx'
import { useI18n } from '../i18n/index.tsx'
import '../views/drop.css'

/** Fallback when the live estimate is not available yet (first claim measured on a fork: ~102k). */
const CLAIM_GAS = 110_000n
/** Any EOA that has not claimed: lets us estimate claim() gas before a wallet is connected. */
const PROBE = '0x000000000000000000000000000000000000dEaD'

/**
 * Genesis Drop card, rendered right after the hero in ProcessorView. Reads drop
 * `contracts.genesisDropId` on `contracts.drops` live (remaining, claims left, claimed count, per
 * claim, hasClaimed for the connected wallet), claims it (simulated first, known reverts decoded),
 * and then points to Circuit Studio with a 16-NAND neuron preselected (#studio/neuron:...), one that
 * is not taped out yet when possible (pickGenesisNeuron), so claimers do not all copy one circuit.
 * Renders nothing off X Layer, when the drop does not exist, is not Cerebr's, or has ended (unless
 * the connected wallet claimed it, which keeps the next step visible).
 */
export function GenesisDropCard() {
  const { contracts, chainId, pc, cfg, explorerTx } = useNet()
  const { address } = useConnection()
  const { cpu } = useCpu()
  const { balances } = useBalances()
  const { data, isLoading, refetch } = useGenesisDrop(address)
  const { send, busy: sending } = useTx()
  // The pre-simulation below awaits before send() sets `busy`: lock the button for the whole click.
  const { inFlight, guard } = useInFlight()
  const busy = !!sending || inFlight
  const { index } = useCircuits()
  const { push } = useToasts()
  const { data: gasPrice } = useGasPrice({ chainId })
  const { t, rich } = useI18n()
  const [claimHash, setClaimHash] = useState<string>()

  // The suggested first neuron: one of GENESIS_NEURONS that is not on the CPU yet, picked per address.
  const neuron = useMemo(
    () =>
      pickGenesisNeuron(address, (spec) =>
        index ? compileDesign({ kind: 'neuron', ...spec }, { mode: 'direct', cpu: cfg?.circuits, index }).existing !== undefined : false,
      ),
    [address, index, cfg?.circuits],
  )

  const drop = data?.drop
  const ours = !!drop && !!cpu && drop.transistors.toLowerCase() === cpu.transistors.toLowerCase()
  const claimed = !!data?.claimed

  // claim() gas, estimated live (from the wallet when connected, else from a fresh EOA).
  const { data: claimGas } = useQuery({
    queryKey: ['cerebr', 'drop', 'gas', contracts?.drops, contracts?.genesisDropId.toString(), address],
    enabled: !!pc && !!contracts && !!drop?.live && !claimed,
    staleTime: 60_000,
    retry: false,
    queryFn: () => pc!.estimateContractGas({ ...claimTx(contracts!.drops, contracts!.genesisDropId), account: address ?? PROBE }),
  })

  if (!contracts) return null
  if (isLoading || (drop && !cpu)) {
    return (
      <section className="card drop-card" aria-busy>
        <div className="card-head">
          <h2>{t('drop.head', { id: contracts.genesisDropId })}</h2>
        </div>
        <p className="muted small drop-loading">{t('drop.loading')}</p>
      </section>
    )
  }
  if (!drop || !ours || (!drop.live && !claimed)) return null

  const kind = drop.tokenId === 1 ? 'LATCH' : 'NAND'
  const n = drop.perClaim
  const total = drop.claimedCount + drop.sharesLeft
  const pct = total > 0n ? Number((drop.claimedCount * 10_000n) / total) / 100 : 0
  const gas = (claimGas ?? CLAIM_GAS) * (gasPrice ?? 0n)

  // The suggested first neuron: its NAND count and the Studio tape-out quote (live fee, gas estimate).
  const nand = neuronNand(neuron)
  const tapeGas = tapeoutGas({ nand, latch: 0, refs: [] }) * (gasPrice ?? 0n)
  const have = balances?.nand
  const missing = have !== undefined && have < BigInt(nand) ? BigInt(nand) - have : 0n
  // Studio mints what is missing (one mint call: price x n + protocol fee) before the tape-out.
  const tapeTotal = cpu!.tapeoutFee + (missing > 0n ? missing * cpu!.mintPrice + cpu!.protocolFee : 0n)

  async function claim() {
    if (!pc || !contracts || !drop) return
    if (!address) {
      push({ kind: 'error', title: t('drop.connect'), body: t('drop.connectBody') })
      return
    }
    const tx = claimTx(contracts.drops, contracts.genesisDropId)
    const label = t('drop.claimTx', { n, kind, id: drop.id })
    // Pre-flight with the drop's own revert strings (useTx simulates again before the wallet opens).
    try {
      await pc.simulateContract({ ...tx, account: address })
    } catch (e) {
      const k = dropErrorKey(e)
      if (k) {
        push({ kind: 'error', title: label, body: t(k) })
        void refetch()
        return
      }
    }
    const r = await send(label, tx)
    if (r) setClaimHash(r.transactionHash)
  }

  return (
    <section className={`card drop-card ${claimed ? 'is-claimed' : ''}`}>
      <div className="card-head">
        <h2>{t('drop.head', { id: drop.id })}</h2>
        <span className={`pill drop-pill ${claimed ? 'claimed' : drop.live ? 'on' : ''}`}>
          {claimed ? t('drop.pill.claimed') : drop.live ? t('drop.pill.live') : t('drop.pill.ended')}
        </span>
      </div>
      <div className="drop-grid">
        <div className="drop-main">
          <h3 className="drop-title">{rich(claimed ? 'drop.titleClaimed' : 'drop.title', { n, kind, em: (c) => <span className="grad">{c}</span> })}</h3>
          <p className="muted drop-lede">{t('drop.lede', { n, kind })}</p>

          {!claimed ? (
            <>
              <dl className="quote drop-quote">
                <Row k={t('drop.youPay')} v={t('drop.youPayV')} strong />
                <Row k={t('drop.gas')} v={gasPrice ? `~${fmt(gas, 3)} OKB` : '-'} />
                <Row k={t('drop.then')} v={t('drop.thenV', { fee: fmt(cpu!.tapeoutFee, 6) })} />
              </dl>
              <button className="btn primary big drop-cta" disabled={busy || !drop.live} onClick={() => void guard(claim)}>
                {busy ? t('drop.claiming') : t('drop.claimBtn', { n, kind })}
              </button>
              <p className="tiny muted drop-rule">
                {!address && <span className="drop-hint">{t('drop.connectBody')} </span>}
                {t('drop.rule', { n, kind })}
              </p>
            </>
          ) : (
            <div className="drop-done">
              <p className="drop-ok small">
                {claimHash ? t('drop.done', { n, kind }) : t('drop.already', { n, kind })}
                {claimHash && explorerTx(claimHash) && (
                  <>
                    {' '}
                    <a href={explorerTx(claimHash)} target="_blank" rel="noreferrer">
                      {t('drop.txLink')}
                    </a>
                  </>
                )}
              </p>
              <div className="drop-next">
                <div className="drop-next-k tiny mono">{t('drop.next')}</div>
                <p className="small drop-next-body">{t('drop.nextBody', { nand })}</p>
                <dl className="quote drop-quote">
                  <Row k={t('drop.design')} v={<span className="drop-eq">{neuronFormula(neuron)}</span>} />
                  <Row k={t('drop.burns')} v={t('drop.burnsV', { nand })} />
                  <Row k={t('drop.tapeFee')} v={`${fmt(cpu!.tapeoutFee, 6)} OKB`} />
                  <Row k={t('drop.gas')} v={gasPrice ? `~${fmt(tapeGas, 3)} OKB` : '-'} />
                  {missing > 0n && <Row k={t('drop.mintMissing', { n: missing.toString() })} v={`${fmt(tapeTotal - cpu!.tapeoutFee, 6)} OKB`} />}
                  <Row k={t('drop.total')} v={t('drop.totalV', { fee: fmt(tapeTotal, 6) })} strong />
                </dl>
                <a className="btn primary big drop-cta" href={href('studio', neuronArg(neuron))}>
                  {t('drop.nextCta')} <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="drop-side">
          <div className="drop-stats">
            <DropStat label={t('drop.remaining')} value={drop.remaining.toString()} unit={t('drop.remainingU', { kind })} accent />
            <DropStat label={t('drop.claimsLeft')} value={drop.sharesLeft.toString()} unit={t('drop.claimsLeftU', { total: total.toString() })} />
            <DropStat label={t('drop.claimedCount')} value={drop.claimedCount.toString()} unit={t('drop.claimedU', { amt: (drop.claimedCount * n).toString(), kind })} />
            <DropStat label={t('drop.perClaim')} value={n.toString()} unit={t('drop.perClaimU', { kind })} />
          </div>
          <div className="drop-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('drop.meter', { pct })}>
            <div style={{ width: `${Math.min(100, Math.max(pct, drop.claimedCount > 0n ? 1 : 0))}%` }} />
          </div>
          <div className="drop-meter-k tiny mono muted">{t('drop.meter', { pct })}</div>
          <dl className="quote drop-quote">
            <Row k={t('drop.wallet')} v={!address ? t('drop.walletNone') : claimed ? t('drop.walletClaimed') : t('drop.walletOpen')} />
            <Row k={t('drop.holding')} v={balances ? `${balances.nand} NAND · ${balances.latch} LATCH` : address ? '…' : '-'} />
          </dl>
        </div>
      </div>
    </section>
  )
}

function DropStat({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  return (
    <div className={`drop-stat ${accent ? 'accent' : ''}`}>
      <div className="drop-stat-k">{label}</div>
      <div className="drop-stat-v">{value}</div>
      <div className="drop-stat-u">{unit}</div>
    </div>
  )
}
