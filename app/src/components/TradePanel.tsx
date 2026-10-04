import { useEffect, useState } from 'react'
import { useBalance, useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { cerebrLensAbi, cerebrProcessorAbi } from '../abi/index.ts'
import { useCerebr, useUserState } from '../hooks/useCerebr.ts'
import { useTx } from '../hooks/useTx.ts'
import { useDebounced } from '../hooks/useDebounced.ts'
import { fmt, minusBps, parseAmount, plusBps } from '../lib/format.ts'

type Mode = 'buy' | 'sell'
type BuyBy = 'okb' | 'cbr'
const SLIPPAGES = [10, 50, 100, 300] // bps

export function TradePanel({ onPreview }: { onPreview: (delta: bigint | undefined) => void }) {
  const { lens, chainId, state } = useCerebr()
  const { address, user } = useUserState()
  const { data: okbBal } = useBalance({ address, chainId })
  const { send, busy } = useTx()

  const [mode, setMode] = useState<Mode>('buy')
  const [buyBy, setBuyBy] = useState<BuyBy>('okb')
  const [input, setInput] = useState('')
  const [slip, setSlip] = useState(50)
  const [customSlip, setCustomSlip] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const amount = useDebounced(parseAmount(input), 250)
  const enabled = !!lens && amount !== undefined && amount > 0n

  const exactOkb = useReadContract({
    address: lens, abi: cerebrLensAbi, functionName: 'quoteBuyExactOKB', args: [amount ?? 0n], chainId,
    query: { enabled: enabled && mode === 'buy' && buyBy === 'okb' },
  })
  const exactCbr = useReadContract({
    address: lens, abi: cerebrLensAbi, functionName: 'quoteBuy', args: [amount ?? 0n], chainId,
    query: { enabled: enabled && mode === 'buy' && buyBy === 'cbr', retry: false },
  })
  const sellQ = useReadContract({
    address: lens, abi: cerebrLensAbi, functionName: 'quoteSell', args: [amount ?? 0n], chainId,
    query: { enabled: enabled && mode === 'sell' && (user?.cbrBalance ?? 0n) >= (amount ?? 0n), retry: false },
  })

  // What will happen if submitted.
  let cbrOut: bigint | undefined
  let okbCost: bigint | undefined
  let maxCost: bigint | undefined
  let net: bigint | undefined
  let fee: bigint | undefined
  let minRefund: bigint | undefined
  let problem: string | undefined
  if (mode === 'buy' && buyBy === 'okb' && exactOkb.data) {
    ;[cbrOut, okbCost] = exactOkb.data
    if (cbrOut === 0n) problem = 'Budget too small for any CBR'
  } else if (mode === 'buy' && buyBy === 'cbr') {
    cbrOut = amount
    okbCost = exactCbr.data
    if (exactCbr.error) problem = 'Exceeds the 10M CBR max supply'
  } else if (mode === 'sell' && amount) {
    if ((user?.cbrBalance ?? 0n) < amount) problem = 'Not enough CBR'
    else if (sellQ.data) [, fee, net] = sellQ.data
  }
  if (mode === 'buy' && okbCost !== undefined) {
    maxCost = plusBps(okbCost, slip)
    if (okbBal && maxCost > okbBal.value) problem = 'Not enough OKB (incl. slippage)'
    if (state?.launchActive && user && cbrOut !== undefined) {
      const cap = user.launchWalletRemaining < user.launchBlockRemaining ? user.launchWalletRemaining : user.launchBlockRemaining
      if (cbrOut > cap) problem = `Fair-launch cap: max ${fmt(cap, 6)} CBR this block`
    }
  }
  if (mode === 'sell' && net !== undefined) minRefund = minusBps(net, slip)
  if (state?.paused && mode === 'buy') problem = 'Buys are paused'

  useEffect(() => {
    onPreview(mode === 'buy' ? cbrOut : amount !== undefined && !problem ? -amount : undefined)
  }, [mode, cbrOut, amount, problem, onPreview])

  const submit = async () => {
    if (!state) return
    if (mode === 'buy' && cbrOut && maxCost !== undefined) {
      const r = await send(`Buy ${fmt(cbrOut, 6)} CBR`, {
        address: state.processor, abi: cerebrProcessorAbi, functionName: 'buyTransistors',
        args: [cbrOut, maxCost], value: maxCost, // unused OKB is refunded by the contract
      })
      if (r) setInput('')
    } else if (mode === 'sell' && amount && minRefund !== undefined) {
      const r = await send(`Sell ${fmt(amount, 6)} CBR`, {
        address: state.processor, abi: cerebrProcessorAbi, functionName: 'sellTransistors', args: [amount, minRefund],
      })
      if (r) setInput('')
    }
  }

  const ready = mode === 'buy' ? cbrOut !== undefined && cbrOut > 0n && maxCost !== undefined : minRefund !== undefined
  const unit = mode === 'sell' ? 'CBR' : buyBy === 'okb' ? 'OKB' : 'CBR'
  const setMax = () => {
    if (mode === 'sell' && user) setInput(fmtInput(user.cbrBalance))
    if (mode === 'buy' && buyBy === 'okb' && okbBal) setInput(fmtInput(okbBal.value > 10n ** 16n ? minusBps(okbBal.value - 10n ** 16n, slip) : 0n))
  }

  return (
    <div className="card trade">
      <div className="card-head">
        <div className="tabs">
          <button className={mode === 'buy' ? 'on' : ''} onClick={() => { setMode('buy'); setInput('') }}>Buy</button>
          <button className={mode === 'sell' ? 'on' : ''} onClick={() => { setMode('sell'); setInput('') }}>Sell</button>
        </div>
        <button className="icon-btn" onClick={() => setShowSettings((s) => !s)} title="Slippage">
          ⚙ <span className="small mono">{slip / 100}%</span>
        </button>
      </div>

      {showSettings && (
        <div className="settings">
          <span className="small muted">Slippage tolerance</span>
          <div className="chips">
            {SLIPPAGES.map((s) => (
              <button key={s} className={slip === s && !customSlip ? 'chip on' : 'chip'} onClick={() => { setSlip(s); setCustomSlip('') }}>
                {s / 100}%
              </button>
            ))}
            <input
              className="chip-input mono"
              placeholder="custom %"
              value={customSlip}
              onChange={(e) => {
                setCustomSlip(e.target.value)
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v >= 0 && v <= 50) setSlip(Math.round(v * 100))
              }}
            />
          </div>
        </div>
      )}

      {mode === 'buy' && (
        <div className="seg small">
          <button className={buyBy === 'okb' ? 'on' : ''} onClick={() => { setBuyBy('okb'); setInput('') }}>Spend exact OKB</button>
          <button className={buyBy === 'cbr' ? 'on' : ''} onClick={() => { setBuyBy('cbr'); setInput('') }}>Get exact CBR</button>
        </div>
      )}

      <div className="field">
        <input inputMode="decimal" placeholder="0.0" value={input} onChange={(e) => setInput(e.target.value.replace(',', '.'))} className="mono" />
        <span className="unit">{unit}</span>
        {(mode === 'sell' || buyBy === 'okb') && address && <button className="max" onClick={setMax}>MAX</button>}
      </div>
      <div className="small muted balance-line">
        Balance: <span className="mono">{fmt(okbBal?.value, 5)} OKB</span> · <span className="mono">{fmt(user?.cbrBalance, 6)} CBR</span>
      </div>

      <dl className="quote">
        {mode === 'buy' ? (
          <>
            <Row k="You receive" v={cbrOut !== undefined ? `${fmt(cbrOut, 6)} CBR` : '—'} strong />
            <Row k="Quoted cost" v={okbCost !== undefined ? `${fmt(okbCost, 6)} OKB` : '—'} />
            <Row k={`Max spend (+${slip / 100}%)`} v={maxCost !== undefined ? `${fmt(maxCost, 6)} OKB` : '—'} />
            <Row k="Avg price" v={cbrOut && okbCost ? `${fmt((okbCost * 10n ** 18n) / cbrOut, 4)} OKB` : '—'} />
          </>
        ) : (
          <>
            <Row k="You receive" v={net !== undefined ? `${fmt(net, 6)} OKB` : '—'} strong />
            <Row k="Protocol fee (1%)" v={fee !== undefined ? `${fmt(fee, 4)} OKB` : '—'} />
            <Row k={`Min refund (−${slip / 100}%)`} v={minRefund !== undefined ? `${fmt(minRefund, 6)} OKB` : '—'} />
          </>
        )}
      </dl>

      {problem && <div className="error small">{problem}</div>}
      <button className={`btn big ${mode === 'buy' ? 'primary' : 'danger'}`} disabled={!address || !ready || !!problem || !!busy} onClick={submit}>
        {!address ? 'Connect wallet' : busy ? busy + '…' : mode === 'buy' ? 'Buy Transistors' : 'Sell Transistors'}
      </button>
      {mode === 'sell' && <p className="tiny muted">Sells can never be paused or rate-limited.</p>}
    </div>
  )
}

/** Exact decimal string (no rounding up), so MAX never exceeds the balance. */
const fmtInput = (wei: bigint) => formatUnits(wei, 18)

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`row ${strong ? 'strong' : ''}`}>
      <dt>{k}</dt>
      <dd className="mono">{v}</dd>
    </div>
  )
}
