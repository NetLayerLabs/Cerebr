import { useCerebr } from '../hooks/useCerebr.ts'
import { compact, fmt } from '../lib/format.ts'
import { TIERS } from '../lib/tiers.ts'

export function Stats() {
  const { state, blockNumber } = useCerebr()
  if (!state) return <section className="stats skeleton-row" />
  const pct = Number((state.totalSupply * 10_000n) / state.maxSupply) / 100
  const collat =
    state.reserveRequired > 0n ? Number(((state.balance - state.protocolFees) * 10_000n) / state.reserveRequired) / 100 : undefined
  const launchLeft =
    state.launchActive && blockNumber !== undefined ? Number(state.launchEndBlock - blockNumber) : undefined

  return (
    <>
      {(state.paused || state.launchActive) && (
        <div className="banners">
          {state.paused && (
            <div className="banner warn">
              Processor paused: buys, tape-outs and fusion are halted. Sells and reveals always stay open.
            </div>
          )}
          {state.launchActive && (
            <div className="banner info">
              Fair-launch guard active{launchLeft !== undefined ? ` for ${launchLeft} more blocks` : ''}: max{' '}
              {compact(state.walletCapPerBlock)} CBR per wallet per block, {compact(state.blockCap)} CBR per block overall.
            </div>
          )}
        </div>
      )}
      <section className="stats">
        <Stat label="Spot price" value={fmt(state.currentPrice, 4)} unit="OKB / CBR" />
        <Stat label="Circulating supply" value={compact(state.totalSupply)} unit={`of ${compact(state.maxSupply)} CBR`}>
          <div className="bar">
            <div style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </Stat>
        <Stat label="OKB reserve" value={fmt(state.balance, 4)} unit={collat ? `${collat.toFixed(2)}% of curve backing` : 'OKB'} />
        <Stat
          label="Surplus reserve"
          value={fmt(state.surplusReserve, 4)}
          unit="OKB locked forever"
          accent
          hint="OKB backing of burned CBR. Nobody can withdraw it, not even the owner: it over-collateralises the curve."
        />
        <Stat label="CBR burned" value={compact(state.totalCbrBurned)} unit="by tape-outs + fusion" accent />
        <Stat label="Circuits" value={state.totalCircuits.toString()} unit="taped out + fused">
          <div className="tier-mini">
            {TIERS.map((t, i) => (
              <span key={t.id} title={`${t.name}: ${state.mintedByTier[i]}`} style={{ color: t.color }}>
                {t.name[0]}
                <b>{state.mintedByTier[i].toString()}</b>
              </span>
            ))}
          </div>
        </Stat>
      </section>
    </>
  )
}

function Stat(props: {
  label: string
  value: string
  unit?: string
  accent?: boolean
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className={`stat ${props.accent ? 'accent' : ''}`} title={props.hint}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value mono">{props.value}</div>
      {props.unit && <div className="stat-unit">{props.unit}</div>}
      {props.children}
    </div>
  )
}
