import { useMemo, useState } from 'react'
import { cerebrProcessorAbi } from '../abi/index.ts'
import { useCerebr, useUserState } from '../hooks/useCerebr.ts'
import { useTx } from '../hooks/useTx.ts'
import { compact } from '../lib/format.ts'
import { TIERS, tierName } from '../lib/tiers.ts'

export function FusionPanel() {
  const { state } = useCerebr()
  const { address, user } = useUserState()
  const { send, busy } = useTx()
  const [picked, setPicked] = useState<bigint[]>([])

  const fusable = useMemo(() => (user?.circuits ?? []).filter((c) => c.revealed && c.tier < 3 && c.fusedInto === 0n), [user])
  const sel = picked.map((id) => fusable.find((c) => c.id === id)).filter((c) => !!c)
  const tier = sel[0]?.tier
  const cost = tier !== undefined && state ? state.tapeOutCosts[tier] : undefined
  const enough = cost !== undefined && (user?.cbrBalance ?? 0n) >= cost

  const toggle = (id: bigint, t: number) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id)
      const first = fusable.find((c) => c.id === p[0])
      if (first && first.tier !== t) return [id] // different tier: restart selection
      return [...p, id].slice(-2)
    })
  }

  const fuse = async () => {
    if (!state || sel.length !== 2) return
    const r = await send(`Fuse #${sel[0].id} + #${sel[1].id}`, {
      address: state.processor, abi: cerebrProcessorAbi, functionName: 'fuseCircuits', args: [sel[0].id, sel[1].id],
    })
    if (r) setPicked([])
  }

  return (
    <div className="card fusion">
      <div className="card-head">
        <h2>Fusion</h2>
        <span className="small muted">2 × same tier + CBR → next tier</span>
      </div>
      <p className="small muted">
        Parents are not burned: they move into the child's brain wallet (ERC-6551), so anything they hold stays
        recoverable by the child's owner.
      </p>
      {!address ? (
        <div className="empty small">Connect a wallet to fuse.</div>
      ) : fusable.length < 2 ? (
        <div className="empty small">You need two revealed, never-fused Circuits of the same tier (below Singularity). Each Circuit can be a fusion parent only once.</div>
      ) : (
        <div className="picker">
          {fusable.map((c) => {
            const on = picked.includes(c.id)
            const dim = tier !== undefined && c.tier !== tier && !on
            return (
              <button
                key={c.id.toString()}
                className={`pick ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}
                style={{ '--tc': TIERS[c.tier].color } as React.CSSProperties}
                onClick={() => toggle(c.id, c.tier)}
              >
                <span className="mono">#{c.id.toString()}</span>
                <span className="tiny">{tierName(c.tier)}</span>
                <span className="tiny muted">{c.traits.rarity}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="fusion-eq">
        <Slot c={sel[0]} />
        <span className="op">+</span>
        <Slot c={sel[1]} />
        <span className="op">+</span>
        <div className="slot mono small">{cost !== undefined ? `${compact(cost)} CBR` : 'CBR'}</div>
        <span className="op">→</span>
        <div className="slot child" style={{ '--tc': tier !== undefined ? TIERS[tier + 1].color : '#8b98a9' } as React.CSSProperties}>
          {tier !== undefined ? tierName(tier + 1) : '?'}
        </div>
      </div>
      <button
        className="btn big primary"
        disabled={sel.length !== 2 || !enough || !!busy || !!state?.paused}
        onClick={fuse}
      >
        {sel.length === 2 && !enough ? 'Need more CBR' : 'Fuse circuits'}
      </button>
    </div>
  )
}

function Slot({ c }: { c?: { id: bigint; tier: number } }) {
  return (
    <div className="slot" style={c ? ({ '--tc': TIERS[c.tier].color } as React.CSSProperties) : undefined}>
      {c ? <span className="mono">#{c.id.toString()}</span> : <span className="muted">pick</span>}
    </div>
  )
}
