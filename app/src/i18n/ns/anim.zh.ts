import type { en } from './anim.en.ts'

/** Animation namespace, 简体中文. Must define exactly the keys of anim.en.ts (a missing or extra key is a type error). */
export const zh: Record<keyof typeof en, string> = {
  'anim.toggle': '动画',
  'anim.toggleTitle': '显示信号在逻辑门之间的传播',
  'anim.aria': '本次推理的门级动画',
  'anim.head': '门级追踪',
  'anim.layer': '第 {n} / {total} 层',
  'anim.size': '{g} 个元件 · {d} 层逻辑',
  'anim.replay': '重播',
  'anim.waiting': '等待链上 eval 结果…',
  'anim.waitingStep': '按下时钟即可追踪一次链上 step。当前显示的是本地模拟器在当前状态下的结果。',
  'anim.synced': '链上结果 {bits} 与模拟器逐门一致。',
  'anim.differs': '链上结果 {bits} 与模拟器不一致。',
  'anim.one': '信号 1',
  'anim.zero': '信号 0',
  'anim.state': '输入状态 {bits}',
  'anim.reduced': '已开启减少动态效果：直接显示最终状态。',
  'anim.error': '这个电路无法在本地追踪。',
}
