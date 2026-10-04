import { useReadContract } from 'wagmi'
import { cerebrLensAbi, cerebrProcessorAbi } from '../abi/index.ts'
import { useCerebr, useUserState } from '../hooks/useCerebr.ts'
import { useTx } from '../hooks/useTx.ts'
import { compact, fmt } from '../lib/format.ts'
import { TIERS } from '../lib/tiers.ts'

const RARITY = ['C', 'R', 'E', 'L'] as const

export function TapeOutPanel() {
  const { state } = useCerebr()
  const { address, user } = useUserState()
  const { send, busy } = useTx()
  if (!state) return <div className="card skeleton" style={{ minHeight: 260 }} />

  const tapeOut = (tier: number) =>
    send(`Tape out ${TIERS[tier].name} Circuit`, {
      address: state.processor,
      abi: cerebrProcessorAbi,
      ...(tier === 0
        ? { functionName: 'tapeOutCircuit', args: [] } // canonical Basic entry point
        : { functionName: 'tapeOutCircuitTier', args: [tier] }),
    })

  return (
    <div className="card">
      <div className="card-head">
        <h2>Tape out a Circuit</h2>
        <span className="small muted">burns CBR forever · traits sealed until reveal</span>
      </div>
      <div className="tiers">
        {TIERS.map((t) => {
          const cost = t.id < 3 ? state.tapeOutCosts[t.id as 0 | 1 | 2] : undefined
          const enough = cost !== undefined && (user?.cbrBalance ?? 0n) >= cost
          return (
            <div key={t.id} className="tier" style={{ '--tc': t.color } as React.CSSProperties}>
              <div className="tier-top">
                <span className="tier-name">{t.name}</span>
                <span className="tier-count mono small">{state.mintedByTier[t.id].toString()} minted</span>
              </div>
              <div className="tier-cost mono">{cost !== undefined ? `${compact(cost)} CBR` : 'Fusion only'}</div>
              {cost !== undefined ? <OkbEquivalent amount={cost} /> : <div className="tiny muted">Quantum + Quantum + 100k CBR</div>}
              <div className="odds" title="Rarity odds: Common / Rare / Epic / Legendary">
                {t.odds.map((o, i) => (
                  <span key={i} style={{ flexGrow: o || 0.001 }} className={`odd r${i}`}>
                    {o >= 8 ? `${RARITY[i]} ${o}%` : ''}
                  </span>
                ))}
              </div>
              <div className="tiny muted spec">
                {t.cores} cores · {t.clock} GHz · {t.node} nm
              </div>
              {cost !== undefined && (
                <button
                  className="btn tier-btn"
                  disabled={!address || !enough || !!busy || state.paused}
                  onClick={() => tapeOut(t.id)}
                  title={!enough ? 'Not enough CBR' : undefined}
                >
                  {enough || !address ? 'Tape out' : 'Need more CBR'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OkbEquivalent({ amount }: { amount: bigint }) {
  const { lens, chainId } = useCerebr()
  const { data } = useReadContract({
    address: lens, abi: cerebrLensAbi, functionName: 'quoteBuy', args: [amount], chainId,
    query: { enabled: !!lens, retry: false },
  })
  return <div className="tiny muted">≈ {data !== undefined ? `${fmt(data, 3)} OKB` : '—'} to buy now</div>
}
