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

export type Naming = 'queued' | 'pending' | 'done' | 'failed' | 'skipped'
export type TapeoutProgress = { step: number; of: number; done?: bigint }
/** One CerebrScope.setLabel after the tape-outs: each new dependency, then the design itself (last). */
export type NameJob = { id: bigint; label: OnchainLabel; state: Naming; dep: boolean }

/**
 * The tape-out flow shared by the Studio and the Trainer: mint the missing NAND / LATCH (one call per
 * kind), tape out missing REF dependencies, tape out the design, then name each new circuit onchain
 * (CerebrScope.setLabel: the dependencies, then the design). Every write goes through useTx (simulate,
 * send, wait, toasts). The step list is frozen when a run starts, so the refetch after the tape-out
 * (which now finds the design and its dependencies onchain) does not re-plan the panel.
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
  const [jobs, setJobs] = useState<NameJob[] | undefined>()
  const [frozen, setFrozen] = useState<{ steps: string[]; names: number } | undefined>()
  const scope = cfg?.scope
  const nameBytes = byteLength(name.trim())
  const nameError = nameBytes > MAX_LABEL_NAME ? t('st.nameTooLong', { n: nameBytes, max: MAX_LABEL_NAME }) : undefined
  const have = balances ?? { nand: 0n, latch: 0n }
  const plan = planDesign(c, have, cpu)
  const mainName = name.trim() || (label?.name ?? c.label.name)
  const planned = [
    ...plan.mints.map((m) => t('st.stepMint', { n: m.amount, label: m.label })),
    ...plan.tapeouts.map((x) => (x.dep ? t('st.stepTapeDep', { name: ct.name(x.label) }) : t('st.stepTape', { name: ct.name(mainName) }))),
    ...(scope ? [...plan.tapeouts.filter((x) => x.dep).map((x) => t('st.stepNameDep', { name: ct.name(x.label) })), t('st.stepName')] : []),
  ]
  const steps = frozen?.steps ?? planned
  /** Index of the first naming step in `steps` (one per tape-out, last). */
  const namesFrom = steps.length - (frozen?.names ?? (scope ? plan.tapeouts.length : 0))

  // Every exit refetches balances and the circuit index (awaited), so a retry plans from chain
  // state: no second mint for transistors already bought, no second tapeout of a landed dependency.
  async function stop() {
    await qc.invalidateQueries()
    setProgress(undefined)
    setFrozen(undefined)
  }

  /**
   * CerebrScope.setLabel for each circuit just taped out, in order, from job `from`. A rejection keeps
   * the circuits and stops the queue at that job: it can be retried, or skipped to go on with the next.
   */
  async function nameFrom(list: NameJob[], from: number) {
    if (!scope) return
    let cur = list
    const set = (i: number, state: Naming) => {
      cur = cur.map((j, k) => (k === i ? { ...j, state } : j))
      setJobs(cur)
    }
    for (let i = from; i < cur.length; i++) {
      if (cur[i].state === 'done' || cur[i].state === 'skipped') continue
      set(i, 'pending')
      const r = await send(t('st.nameTx', { id: cur[i].id }), setLabelTx(scope, cpu.circuits, cur[i].id, cur[i].label))
      set(i, r ? 'done' : 'failed')
      if (!r) return
    }
  }

  async function run() {
    if (!index || !balances || nameError) return
    const idx = new Map(index)
    let step = 0
    setFrozen({ steps: planned, names: scope ? plan.tapeouts.length : 0 })
    setJobs(undefined)
    setProgress({ step, of: planned.length })
    for (const m of plan.mints) {
      const r = await send(t('st.stepMint', { n: m.amount, label: m.label }), mintTx(cpu.transistors, m.id === NAND_ID ? NAND_ID : LATCH_ID, m.amount, cpu.mintPrice, cpu.protocolFee), { refresh: false })
      if (!r) return stop()
      setProgress({ step: ++step, of: planned.length })
    }
    // Dependencies first; each one's id goes into the index so the next compile REFs it.
    const named: NameJob[] = []
    for (const d of c.deps.filter((x) => x.circuitId === undefined)) {
      const r = await send(t('st.stepTape', { name: ct.name(d.label.name) }), tapeoutTx(cpu.circuits, d.hex, d.netlist.nIn, d.netlist.nOut, cpu.tapeoutFee), { refresh: false })
      if (!r) return stop()
      const depId = tapedOutId(r, cpu.circuits)
      addToIndex(idx, d.netlist, d.hex, depId)
      named.push({ id: depId, label: fitLabel(d.label, d.netlist.nIn, d.netlist.nOut), state: 'queued', dep: true })
      setProgress({ step: ++step, of: planned.length })
    }
    const final = compileDesign(design, { mode, cpu: cpu.circuits, index: idx })
    if (!final.hex) {
      push({ kind: 'error', title: t('st.depMissing') })
      return stop()
    }
    const r = await send(t('st.stepTape', { name: ct.name(mainName) }), tapeoutTx(cpu.circuits, final.hex, final.netlist.nIn, final.netlist.nOut, cpu.tapeoutFee), { refresh: false })
    if (!r) return stop()
    const id = tapedOutId(r, cpu.circuits)
    setProgress({ step: ++step, of: planned.length, done: id })
    await qc.invalidateQueries()
    const base = label ?? labelFor(design, final.label)
    const list = scope ? [...named, { id, label: fitLabel({ ...base, name: name.trim() || base.name }, final.netlist.nIn, final.netlist.nOut), state: 'queued' as Naming, dep: false }] : []
    setJobs(list)
    await nameFrom(list, 0)
  }

  const failed = jobs?.findIndex((j) => j.state === 'failed') ?? -1

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
    jobs,
    namesFrom,
    /** Skip the rejected naming and go on with the next circuit, if any. */
    skipNaming: () => {
      if (!jobs || failed < 0) return
      const list = jobs.map((j, k) => (k === failed ? { ...j, state: 'skipped' as Naming } : j))
      setJobs(list)
      void nameFrom(list, failed + 1)
    },
    retryNaming: () => jobs && failed >= 0 && nameFrom(jobs, failed),
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
