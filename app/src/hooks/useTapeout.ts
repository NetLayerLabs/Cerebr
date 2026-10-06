import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getCircuit, type OutputMode } from '@cerebr/sdk'
import { LATCH_ID, NAND_ID } from '@cerebr/sdk/tapeout'
import { useBalances, useCircuits, useNet, type CpuState } from './useCpu.ts'
import { useTx } from './useTx.ts'
import { useToasts } from './useToasts.tsx'
import { addToIndex, compileDesign, labelOfCatalog, labelOfNeuron, mintTx, planDesign, tapedOutId, tapeoutTx, type CircuitLabel, type Compiled, type Design } from '../lib/cerebr.ts'
import { MAX_LABEL_NAME, byteLength, fitLabel, setLabelTx, type OnchainLabel } from '../lib/scope.ts'
import { useI18n } from '../i18n/index.tsx'
import { useCircuitText } from '../i18n/circuits.ts'

export type Naming = 'pending' | 'done' | 'failed' | 'skipped'
export type TapeoutProgress = { step: number; of: number; done?: bigint }

/**
 * The tape-out flow shared by the Studio and the Trainer: mint the missing NAND / LATCH (one call per
 * kind), tape out missing REF dependencies, tape out the design, then name it onchain
 * (CerebrScope.setLabel). Every write goes through useTx (simulate, send, wait, toasts).
 *
 * `label` overrides the onchain label written after the tape-out (and the default name); without it
 * the label comes from the design (catalog entry, neuron equation, or the compiled network label).
 */
export function useTapeout({ c, cpu, design, mode, label }: { c: Compiled; cpu: CpuState; design: Design; mode: OutputMode; label?: CircuitLabel }) {
  const { cfg } = useNet()
  const { index } = useCircuits()
  const { balances } = useBalances()
  const { send, busy } = useTx()
  const { push } = useToasts()
  const qc = useQueryClient()
  const { t } = useI18n()
  const ct = useCircuitText()
  const [progress, setProgress] = useState<TapeoutProgress | undefined>()
  // The name written onchain (CerebrScope.setLabel) right after the tape-out. Editable before it.
  const [name, setName] = useState(label?.name ?? c.label.name)
  const [naming, setNaming] = useState<{ state: Naming; label: OnchainLabel } | undefined>()
  const scope = cfg?.scope
  const nameBytes = byteLength(name.trim())
  const nameError = nameBytes > MAX_LABEL_NAME ? t('st.nameTooLong', { n: nameBytes, max: MAX_LABEL_NAME }) : undefined
  const have = balances ?? { nand: 0n, latch: 0n }
  const plan = planDesign(c, have, cpu)
  const steps = [
    ...plan.mints.map((m) => t('st.stepMint', { n: m.amount, label: m.label })),
    ...plan.tapeouts.map((x) => t(x.dep ? 'st.stepTapeDep' : 'st.stepTape', { name: ct.name(x.label) })),
    ...(scope ? [t('st.stepName')] : []),
  ]

  // Every exit refetches balances and the circuit index (awaited), so a retry plans from chain
  // state: no second mint for transistors already bought, no second tapeout of a landed dependency.
  async function stop() {
    await qc.invalidateQueries()
    setProgress(undefined)
  }

  /** CerebrScope.setLabel for the circuit just taped out. A rejection keeps the circuit: it can be retried or skipped. */
  async function nameIt(id: bigint, l: OnchainLabel) {
    if (!scope) return
    setNaming({ state: 'pending', label: l })
    const r = await send(t('st.nameTx', { id }), setLabelTx(scope, cpu.circuits, id, l))
    setNaming({ state: r ? 'done' : 'failed', label: l })
    if (r) setProgress((p) => (p ? { ...p, step: p.of } : p))
  }

  async function run() {
    if (!index || !balances || nameError) return
    const idx = new Map(index)
    let step = 0
    setProgress({ step, of: steps.length })
    for (const m of plan.mints) {
      const r = await send(t('st.stepMint', { n: m.amount, label: m.label }), mintTx(cpu.transistors, m.id === NAND_ID ? NAND_ID : LATCH_ID, m.amount, cpu.mintPrice, cpu.protocolFee), { refresh: false })
      if (!r) return stop()
      setProgress({ step: ++step, of: steps.length })
    }
    // Dependencies first; each one's id goes into the index so the next compile REFs it.
    for (const d of c.deps.filter((x) => x.circuitId === undefined)) {
      const r = await send(t('st.stepTape', { name: ct.name(d.label.name) }), tapeoutTx(cpu.circuits, d.hex, d.netlist.nIn, d.netlist.nOut, cpu.tapeoutFee), { refresh: false })
      if (!r) return stop()
      addToIndex(idx, d.netlist, d.hex, tapedOutId(r, cpu.circuits))
      setProgress({ step: ++step, of: steps.length })
    }
    const final = compileDesign(design, { mode, cpu: cpu.circuits, index: idx })
    if (!final.hex) {
      push({ kind: 'error', title: t('st.depMissing') })
      return stop()
    }
    const r = await send(t('st.stepTape', { name: ct.name(final.label.name) }), tapeoutTx(cpu.circuits, final.hex, final.netlist.nIn, final.netlist.nOut, cpu.tapeoutFee), { refresh: false })
    if (!r) return stop()
    const id = tapedOutId(r, cpu.circuits)
    setProgress({ step: ++step, of: steps.length, done: id })
    await qc.invalidateQueries()
    const base = label ?? labelFor(design, final.label)
    await nameIt(id, fitLabel({ ...base, name: name.trim() || base.name }, final.netlist.nIn, final.netlist.nOut))
  }

  return {
    plan,
    steps,
    have,
    scope,
    progress,
    name,
    setName,
    nameBytes,
    nameError,
    naming,
    skipNaming: () => setNaming((n) => (n ? { ...n, state: 'skipped' } : n)),
    retryNaming: () => progress?.done !== undefined && naming && nameIt(progress.done, naming.label),
    run,
    busy,
    /** Can the flow start now (wallet balances + circuit index loaded, nothing blocking, not already running)? */
    ready: !busy && !plan.blocked && !nameError && !!index && !!balances && !(progress && !progress.done),
    /** A run is in flight (between the first transaction and the tape-out). */
    running: !!progress && progress.done === undefined,
  }
}

function labelFor(design: Design, compiled: CircuitLabel): CircuitLabel {
  if (design.kind === 'catalog') return labelOfCatalog(getCircuit(design.id))
  if (design.kind === 'neuron') return labelOfNeuron({ weights: design.weights, theta: design.theta })
  return compiled
}
