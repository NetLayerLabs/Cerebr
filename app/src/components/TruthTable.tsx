import { useMemo } from 'react'
import { bitsOf, runSequence, truthTable, type Program } from '@cerebr/sdk'
import { useT } from '../i18n/index.tsx'

/** Exhaustive truth table from the local simulator, checked row by row against the reference model. */
export function TruthTable(props: { program: Program; inputs: string[]; outputs: string[]; reference?: (x: number[]) => number[] }) {
  const { program, inputs, outputs, reference } = props
  const t = useT()
  const rows = useMemo(() => {
    const t = truthTable(program)
    return t.map((out, k) => {
      const x = bitsOf(k, program.nIn)
      const want = reference?.(x)
      return { k, x, out, ok: !want || want.every((v, i) => v === out[i]) }
    })
  }, [program, reference])
  const bad = rows.filter((r) => !r.ok).length
  const fires = rows.filter((r) => r.out.some(Boolean)).length
  return (
    <div className="tt-wrap">
      <div className="tt-sum small">
        <span className="muted">
          {t('tt.patterns', { n: rows.length, k: fires })}
        </span>
        {reference && (
          <span className={bad ? 'error' : 'ok'}>{bad ? t('tt.differ', { n: bad }) : t('tt.matches')}</span>
        )}
      </div>
      <div className="tt-scroll">
        <table className="tt mono">
          <thead>
            <tr>
              {inputs.map((l, i) => (
                <th key={`i${i}`}>{l}</th>
              ))}
              <th className="tt-sep" />
              {outputs.map((l, i) => (
                <th key={`o${i}`} className="out">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className={r.ok ? '' : 'bad'}>
                {r.x.map((b, i) => (
                  <td key={`i${i}`} className={b ? 'one' : ''}>
                    {b}
                  </td>
                ))}
                <td className="tt-sep" />
                {r.out.map((b, i) => (
                  <td key={`o${i}`} className={`out ${b ? 'one' : ''}`}>
                    {b}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Step trace of a sequential circuit (state carried between steps, starting from zero). */
export function SequenceTrace(props: { program: Program; inputs: string[]; outputs: string[]; state?: string[]; sequence: number[][]; referenceStep?: (s: number[], x: number[]) => { state: number[]; outputs: number[] } }) {
  const { program, sequence, referenceStep } = props
  const t = useT()
  const rows = useMemo(() => {
    let state = Array(program.nState).fill(0) as number[]
    let refState = state
    return sequence.map((x, t) => {
      const r = runSequence(program, [x], state)
      const want = referenceStep?.(refState, x)
      const row = { t, x, state, out: r.outputs[0], ok: !want || want.outputs.every((v, i) => v === r.outputs[0][i]) }
      state = r.state
      if (want) refState = want.state
      return row
    })
  }, [program, sequence, referenceStep])
  const labels = props.state ?? Array.from({ length: program.nState }, (_, i) => `s${i}`)
  return (
    <div className="tt-wrap">
      <div className="tt-sum small">
        <span className="muted">{t('tt.steps', { n: rows.length })}</span>
        {referenceStep && <span className={rows.every((r) => r.ok) ? 'ok' : 'error'}>{rows.every((r) => r.ok) ? t('tt.seqMatch') : t('tt.seqDiffer')}</span>}
      </div>
      <div className="tt-scroll">
        <table className="tt mono">
          <thead>
            <tr>
              <th>t</th>
              {props.inputs.map((l) => (
                <th key={l}>{l}</th>
              ))}
              <th className="tt-sep" />
              {labels.map((l) => (
                <th key={l} className="st">
                  {l}
                </th>
              ))}
              <th className="tt-sep" />
              {props.outputs.map((l) => (
                <th key={l} className="out">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t} className={r.ok ? '' : 'bad'}>
                <td className="muted">{r.t}</td>
                {r.x.map((b, i) => (
                  <td key={i} className={b ? 'one' : ''}>
                    {b}
                  </td>
                ))}
                <td className="tt-sep" />
                {r.state.map((b, i) => (
                  <td key={i} className={`st ${b ? 'one' : ''}`}>
                    {b}
                  </td>
                ))}
                <td className="tt-sep" />
                {r.out.map((b, i) => (
                  <td key={i} className={`out ${b ? 'one' : ''}`}>
                    {b}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
