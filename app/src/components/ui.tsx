import { useState, type ReactNode } from 'react'
import { shortAddr } from '../lib/format.ts'

export function Stat(props: { label: string; value: ReactNode; unit?: ReactNode; accent?: boolean; hint?: string; children?: ReactNode }) {
  return (
    <div className={`stat ${props.accent ? 'accent' : ''}`} title={props.hint}>
      <div className="stat-label">{props.label}</div>
      <div className="stat-value mono">{props.value}</div>
      {props.unit && <div className="stat-unit">{props.unit}</div>}
      {props.children}
    </div>
  )
}

/** An address with an explorer link (when the chain has one) and a copy button. */
export function Addr({ a, href, label }: { a: string; href?: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="addr">
      {href ? (
        <a className="mono" href={href} target="_blank" rel="noreferrer">
          {label ?? shortAddr(a)}
        </a>
      ) : (
        <span className="mono">{label ?? shortAddr(a)}</span>
      )}
      <button
        className="icon-btn tiny"
        title="Copy address"
        onClick={() =>
          navigator.clipboard?.writeText(a).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  )
}

/** A row of labelled bits (pins). Clickable when `onToggle` is given. */
export function Pins(props: { labels: string[]; bits: ArrayLike<number>; onToggle?: (i: number) => void; kind?: 'in' | 'out'; compare?: ArrayLike<number> }) {
  return (
    <div className={`pins ${props.kind ?? 'in'}`}>
      {props.labels.map((l, i) => {
        const on = !!props.bits[i]
        const off = props.compare !== undefined && props.compare[i] !== props.bits[i]
        const content = (
          <>
            <span className="pin-led" />
            <span className="pin-label">{l}</span>
            <span className="pin-val mono">{on ? 1 : 0}</span>
          </>
        )
        return props.onToggle ? (
          <button key={i} className={`pin ${on ? 'on' : ''}`} onClick={() => props.onToggle!(i)} aria-pressed={on}>
            {content}
          </button>
        ) : (
          <span key={i} className={`pin ${on ? 'on' : ''} ${off ? 'bad' : ''}`}>
            {content}
          </span>
        )
      })}
    </div>
  )
}

export function Seg<T extends string>(props: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={`seg ${props.small ? 'small' : ''}`} role="tablist">
      {props.options.map(([v, l]) => (
        <button key={v} className={props.value === v ? 'on' : ''} onClick={() => props.onChange(v)} role="tab" aria-selected={props.value === v}>
          {l}
        </button>
      ))}
    </div>
  )
}

export function Row({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className={`row ${strong ? 'strong' : ''}`}>
      <dt>{k}</dt>
      <dd className="mono">{v}</dd>
    </div>
  )
}
