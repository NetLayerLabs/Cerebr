/**
 * Circuit DATA translations (Simplified Chinese), pure data so Node scripts can import it
 * (scripts/i18n-check.ts verifies every SDK catalog id has an entry). Used by ../circuits.ts.
 */
export type CatalogText = { name: string; description: string; story: string }

export const CATALOG_ZH: Record<string, CatalogText> = {
  'and-neuron': {
    name: 'AND 神经元',
    description: '两个兴奋性突触（w=+1,+1），阈值 2：仅当两个输入同时出现脉冲时发放。',
    story: '一个巧合检测器：只有两个证人同时作证，它才会相信。',
  },
  'or-neuron': {
    name: 'OR 神经元',
    description: '两个兴奋性突触（w=+1,+1），阈值 1：任一输入出现脉冲即发放。',
    story: '最宽容的神经元：一个信号就足以唤醒它。',
  },
  'nand-neuron': {
    name: '抑制性神经元（NAND）',
    description: '两个抑制性突触（w=-1,-1），阈值 -1：仅当两个输入同时出现脉冲时保持沉默。',
    story: '由处理器铸造的那个门直接构成：一个 NAND，就是一个神经元。',
  },
  'majority-3': {
    name: '三输入多数表决',
    description: '三个兴奋性突触，阈值 2：三个输入的多数表决（6 个 NAND，即全加器的进位）。',
    story: '三个投票者，一个决定。能够否决单根故障导线的最小委员会。',
  },
  'majority-5': {
    name: '五输入多数表决',
    description: '五个兴奋性突触，阈值 3：五个输入的多数表决。',
    story: '芯片上的五人议会；从结构上就不可能出现平票。',
  },
  'threshold-neuron': {
    name: 'Go/No-Go 神经元',
    description: '三个兴奋性（+1）和两个抑制性（-1）突触，阈值 2：y = [e0+e1+e2 − i0 − i1 ≥ 2]。',
    story: '兴奋为之辩护，抑制提出反对；当理由足够充分时，神经元便会发放。',
  },
  'line-cell': {
    name: '线段单元',
    description: '三个兴奋性突触，阈值 3：当一笔线段上的三个像素全部点亮时发放。',
    story: '一个三像素长的感受野：线条检测器的第一级。',
  },
  'any-of-3': {
    name: '三选一神经元',
    description: '三个兴奋性突触，阈值 1：汇聚三个特征检测器。',
    story: '池化神经元：它不在乎是哪个检测器发放，只在乎有一个发放了。',
  },
  'xor-net': {
    name: 'XOR 问题',
    description: '两层网络：隐藏层为 OR 神经元和 NAND 神经元，输出层为 AND 神经元。y = x0 XOR x1。',
    story: 'Minsky 和 Papert 证明单个感知机无法学会 XOR。两层就可以：这里用 NAND 门实现，运行在链上。',
  },
  'xor-net-ref': {
    name: 'XOR 问题（REF 组合）',
    description: '同一个两层 XOR 网络，通过 REF 由已流片的 OR、NAND 和 AND 神经元电路连接而成。',
    story: 'Minsky 和 Papert 证明单个感知机无法学会 XOR。两层就可以：这里用 NAND 门实现，运行在链上。',
  },
  'line-detector': {
    name: '线条检测器',
    description:
      '3×3 二值化网络：8 个线段单元（3 行、3 列、2 条对角线；笔画上 w=+1，θ=3）由“任一”神经元（θ=1）汇聚。输出为多热编码 [水平, 垂直, 对角]；全为零表示没有线条。',
    story: '一个微型视觉皮层：简单细胞对方向敏感，复杂细胞将其汇聚。512 张图像，每个答案都在链上。',
  },
  'line-detector-ref': {
    name: '线条检测器（REF 组合）',
    description: '通过 REF 组合的线条检测器：一个已流片的线段单元（复用 8 次），由三选一神经元（2 次）和 OR 神经元（1 次）汇聚。',
    story: '一个微型视觉皮层：简单细胞对方向敏感，复杂细胞将其汇聚。512 张图像，每个答案都在链上。',
  },
  'adder-2bit': {
    name: '2 位加法器',
    description: '两个 2 位数相加 a + b（低位在前）：半加器 + 全加器，输出 3 位和。',
    story: '神经元源自算术：阈值神经元就是一次加权求和加一次比较。',
  },
  'spiking-neuron': {
    name: '积分发放神经元',
    description: '时序神经元，2 位膜电位保存在两个 LATCH 中：累积输入脉冲，在第三个脉冲时发放并复位；`inhibit` 将其清零。用 step() 运行。',
    story: '这个神经元有记忆。它的电位在两次调用之间保存在锁存器中：链上状态的心跳。',
  },
}

/** Word-like pin names (identifier-like pins such as x0, r1c2, e0, s1 stay as they are). */
export const PINS_ZH: Record<string, string> = {
  horizontal: '水平',
  vertical: '垂直',
  diagonal: '对角',
  spike: '脉冲',
  inhibit: '抑制',
  fire: '发放',
  veto: '否决',
}

/** Names / stories the app or SDK generates for non-catalog designs. */
export const GENERIC_ZH: Record<string, string> = {
  'Threshold Neuron': '阈值神经元',
  'Neural Network': '神经网络',
  'Neural Network (REF-composed)': '神经网络（REF 组合）',
  'A binarized neuron with integer synapses, compiled to NAND gates.': '一个具有整数突触的二值化神经元，编译为 NAND 门。',
  // Circuits #15 and #16 on X Layer, as labelled onchain in CerebrScope (not catalog entries).
  'Vote-with-veto neuron': '带否决的投票神经元',
  'y = [ +x0 +x1 +x2 -x3 >= 2 ]: three excitatory votes and one inhibitory veto. Taped out through the Cerebr app Circuit Studio.':
    'y = [ +x0 +x1 +x2 -x3 >= 2 ]：三个兴奋性投票和一个抑制性否决。通过 Cerebr 应用的电路工作室流片。',
  'Neural Arena Bot': '神经竞技场机器人',
  'Unbeatable tic-tac-toe policy as a 7-layer threshold network (362 neurons, 590 NAND): win > block > safe threat > centre > corners > edges. Input 2i = bot on cell i, 2i+1 = human on cell i; output = one-hot move. Called onchain by NeuralArena 0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD.':
    '不可战胜的井字棋策略，实现为 7 层阈值网络（362 个神经元，590 个 NAND）：取胜 > 阻挡 > 安全威胁 > 中心 > 角 > 边。输入 2i = 格 i 上的机器人棋子，2i+1 = 格 i 上的人类棋子；输出 = 独热编码的落子。由 NeuralArena 0xD984b3D13603AB51af02ddFFaa1FD86bE8c162BD 在链上调用。',
  // The Cerebr processor's own story (launch/config.json, written onchain at createCPU).
  'Cerebr is an on-chain neural processor. Its transistors are synapses: every NAND minted here is wired into a neuron. Its circuits are neurons and networks, compiled from threshold units into NAND netlists and taped out on X Layer; REF links taped-out neurons into deeper networks, so the brain grows by reuse. eval() is inference: anyone can run any Cerebr circuit on-chain, for free, forever.':
    'Cerebr 是一颗链上神经网络处理器。它的晶体管就是突触：这里铸造的每个 NAND 都会被接入一个神经元。它的电路是神经元和网络，由阈值单元编译为 NAND 网表并在 X Layer 上流片；REF 将已流片的神经元连接成更深的网络，让大脑通过复用不断成长。eval() 就是推理：任何人都可以在链上免费、永久地运行任意 Cerebr 电路。',
}
