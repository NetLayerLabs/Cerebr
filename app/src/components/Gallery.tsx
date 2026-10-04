import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { encodeFunctionData, zeroHash, type Address } from 'viem'
import { cerebrAccountAbi, cerebrCircuitAbi, cerebrLensAbi, erc6551RegistryAbi } from '../abi/index.ts'
import { useCerebr, useUserState } from '../hooks/useCerebr.ts'
import { useTx } from '../hooks/useTx.ts'
import { decodeTokenUri } from '../lib/tokenUri.ts'
import { fmt, shortAddr } from '../lib/format.ts'
import { RARITY_COLORS, TIERS, tierName } from '../lib/tiers.ts'

export function Gallery() {
  const { address, user, isLoading } = useUserState()
  const { state, blockNumber } = useCerebr()
  const { send, busy } = useTx()
  const circuits = user?.circuits ?? []
  const ready = circuits.filter((c) => !c.revealed && blockNumber !== undefined && blockNumber >= c.revealReadyBlock)

  return (
    <section className="gallery-wrap">
      <div className="section-head">
        <h2>Your Circuits</h2>
        <span className="small muted">
          {address ? `${circuits.length} owned directly · art and metadata fully on-chain` : 'connect a wallet to see your Circuits'}
        </span>
        {ready.length > 1 && state && (
          <button
            className="btn ghost small"
            disabled={!!busy}
            onClick={async () => {
              for (const c of ready) {
                await send(`Reveal #${c.id}`, { address: state.circuit, abi: cerebrCircuitAbi, functionName: 'reveal', args: [c.id] })
              }
            }}
          >
            Reveal all ready ({ready.length})
          </button>
        )}
      </div>
      {address && isLoading && <div className="gallery"><div className="circuit skeleton" /><div className="circuit skeleton" /></div>}
      {address && !isLoading && circuits.length === 0 && (
        <div className="empty">No Circuits yet. Buy CBR and tape out your first brain.</div>
      )}
      <div className="gallery">
        {circuits.map((c) => (
          <CircuitCard key={c.id.toString()} c={c} />
        ))}
      </div>
    </section>
  )
}

type CircuitView = NonNullable<ReturnType<typeof useUserState>['user']>['circuits'][number]

function CircuitCard({ c }: { c: CircuitView }) {
  const { state, chainId, lens, blockNumber, explorerAddr } = useCerebr()
  const { address } = useUserState()
  const { send, busy } = useTx()
  const [copied, setCopied] = useState(false)

  const uri = useReadContract({
    address: state?.circuit, abi: cerebrCircuitAbi, functionName: 'tokenURI', args: [c.id], chainId,
    query: { enabled: !!state, staleTime: 60_000 },
  })
  // Circuits held inside this Circuit's brain wallet (e.g. fused parents).
  const nested = useReadContract({
    address: lens, abi: cerebrLensAbi, functionName: 'userState', args: [c.tba], chainId, scopeKey: 'static',
    query: { enabled: !!lens && c.tier > 0, staleTime: 30_000 },
  })
  const meta = uri.data ? decodeTokenUri(uri.data) : undefined
  const tier = TIERS[c.tier]
  const readyIn = blockNumber !== undefined ? Number(c.revealReadyBlock - blockNumber) : undefined
  const children = nested.data?.circuits ?? []

  const reveal = () =>
    state && send(`Reveal Circuit #${c.id}`, { address: state.circuit, abi: cerebrCircuitAbi, functionName: 'reveal', args: [c.id] })
  const activate = () =>
    state &&
    send(`Activate brain wallet #${c.id}`, {
      address: state.erc6551Registry, abi: erc6551RegistryAbi, functionName: 'createAccount',
      args: [state.accountImplementation, zeroHash, BigInt(chainId), state.circuit, c.id],
    })
  // Nested recovery: the child's brain wallet transfers a held parent back to the owner.
  const pullOut = (childId: bigint) =>
    state && address &&
    send(`Withdraw #${childId} from brain wallet #${c.id}`, {
      address: c.tba, abi: cerebrAccountAbi, functionName: 'execute',
      args: [
        state.circuit, 0n,
        encodeFunctionData({ abi: cerebrCircuitAbi, functionName: 'transferFrom', args: [c.tba, address as Address, childId] }),
        0,
      ],
    })

  return (
    <article className={`circuit ${c.revealed ? '' : 'sealed'}`} style={{ '--tc': tier.color } as React.CSSProperties}>
      <div className="art">
        {meta ? <img src={meta.image} alt={meta.name} loading="lazy" /> : <div className="art-ph" />}
        {!c.revealed && <div className="seal-glow" />}
      </div>
      <div className="circuit-body">
        <div className="circuit-title">
          <span className="mono">#{c.id.toString()}</span>
          <span className="badge" style={{ color: tier.color, borderColor: tier.color }}>{tier.name}</span>
          {c.revealed && (
            <span className="badge" style={{ color: RARITY_COLORS[c.traits.rarity], borderColor: RARITY_COLORS[c.traits.rarity] }}>
              {c.traits.rarity}
            </span>
          )}
          {c.fusedInto !== 0n && (
            <span className="badge muted" title="Already used as a fusion parent; cannot be fused again">
              fused → #{c.fusedInto.toString()}
            </span>
          )}
        </div>

        {c.revealed ? (
          <div className="traits small">
            <span>{c.traits.architecture}</span>
            <span className="mono">{c.traits.cores.toString()} cores</span>
            <span className="mono">{(Number(c.traits.clockTenthsGHz) / 10).toFixed(1)} GHz</span>
            <span className="mono">{c.traits.nodeNm.toString()} nm</span>
          </div>
        ) : (
          <div className="sealed-row">
            <span className="small muted">
              Sealed wafer{readyIn !== undefined && readyIn > 0 ? ` · ready in ${readyIn} block${readyIn > 1 ? 's' : ''}` : ''}
            </span>
            <button className="btn primary small" disabled={!!busy || readyIn === undefined || readyIn > 0} onClick={reveal}>
              Reveal
            </button>
          </div>
        )}

        <div className="tba">
          <div className="tba-head small">
            <span className="muted">Brain wallet</span>
            <a className="mono" href={explorerAddr(c.tba)} target="_blank" rel="noreferrer">{shortAddr(c.tba)}</a>
            <button
              className="icon-btn tiny"
              onClick={() => {
                navigator.clipboard?.writeText(c.tba).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                })
              }}
              title="Copy address"
            >
              {copied ? '✓' : '⧉'}
            </button>
            <span className={`pill ${c.tbaDeployed ? 'on' : ''}`}>{c.tbaDeployed ? 'active' : 'counterfactual'}</span>
          </div>
          <div className="tba-row small">
            <span className="mono">{fmt(c.tbaBalance, 4)} OKB</span>
            {!c.tbaDeployed && (
              <button className="btn ghost small" disabled={!!busy} onClick={activate}>
                Activate brain wallet
              </button>
            )}
          </div>
          {children.length > 0 && (
            <div className="nested small">
              <span className="muted">Holds</span>
              {children.map((p) => (
                <span key={p.id.toString()} className="nested-chip" style={{ '--tc': TIERS[p.tier].color } as React.CSSProperties}>
                  #{p.id.toString()} {tierName(p.tier)}
                  {c.tbaDeployed && (
                    <button className="link tiny" disabled={!!busy} onClick={() => pullOut(p.id)} title="Transfer back to your wallet">
                      withdraw
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
