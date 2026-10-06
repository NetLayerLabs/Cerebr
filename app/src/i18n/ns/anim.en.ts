/**
 * Animation namespace (components/GateAnimation.tsx and its toggle in views/PlaygroundView.tsx),
 * English (the source). Owned by the Market + Animation feature: every key starts with 'anim.'.
 * anim.zh.ts must define exactly these keys.
 */
export const en = {
  'anim.toggle': 'Animate',
  'anim.toggleTitle': 'Show the signal flowing through the gates',
  'anim.aria': 'Gate-level animation of this inference',
  'anim.head': 'Gate trace',
  'anim.layer': 'layer {n} / {total}',
  'anim.size': '{g} elements · {d} logic layers',
  'anim.replay': 'Replay',
  'anim.waiting': 'Waiting for the onchain eval…',
  'anim.waitingStep': 'Clock it to trace a step onchain. Showing the simulator for the current state.',
  'anim.synced': 'Onchain result {bits} matches the simulator, gate by gate.',
  'anim.differs': 'Onchain result {bits} differs from the simulator.',
  'anim.one': 'signal 1',
  'anim.zero': 'signal 0',
  'anim.state': 'state in {bits}',
  'anim.reduced': 'Reduced motion is on: showing the final state.',
  'anim.error': 'This circuit cannot be traced locally.',
}
