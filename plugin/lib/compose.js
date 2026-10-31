// 召回装配：在预算内决定给谁、给多细（设计稿 §7.3、§7.4，分配方式为两阶段）
//
// 预算是**上限**，不是每轮固定注入：没命中就一个字都不注入（turnSection 返回空字符串，这一段不加）。
//
// 两阶段（避免"一个高分人物吃光预算"）：
//   ① 保底：按分数从高到低，给每个人都先放一行简版，装不下就跳过继续试下一个；
//   ② 加厚：用剩下的预算，按同样顺序把简版升级成完整档案，装不下就停在简版。
//
// 连带人物吃**剩余**预算，不挤占主人物（§7.4）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 字符数（按码点算，不是字节）。注入预算用这个口径。 */
export function charCount(text) {
  return [...String(text ?? '')].length
}

/**
 * 两阶段装配。
 * @param {Array<{key:string, briefText:string, fullText?:string}>} candidates 已按分数从高到低排好
 * @param {{budget?:number, residentChars?:number}} options
 *   residentChars：常驻摘要等固定开销，先从预算里扣掉
 * @returns {{blocks: Array<{key:string, level:'brief'|'full', text:string, chars:number}>,
 *            used: number, dropped: string[]}}
 */
export function allocateRecalls(candidates, { budget = 3000, residentChars = 0 } = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  let remaining = Math.max(0, budget - Math.max(0, residentChars))

  const blocks = []
  const dropped = []
  const kept = []

  // ① 保底：先人人有份
  for (const item of list) {
    const text = String(item.briefText ?? '')
    const chars = charCount(text)
    if (chars > remaining) {
      dropped.push(item.key)
      continue
    }
    const block = { key: item.key, level: 'brief', text, chars }
    blocks.push(block)
    kept.push({ item, block })
    remaining -= chars
  }

  // ② 加厚：用剩余预算把排前面的升级成完整档案
  for (const { item, block } of kept) {
    const full = item.fullText
    if (typeof full !== 'string' || !full) continue
    const extra = charCount(full) - block.chars
    if (extra <= 0 || extra > remaining) continue
    block.level = 'full'
    block.text = full
    block.chars += extra
    remaining -= extra
  }

  const used = blocks.reduce((sum, block) => sum + block.chars, 0)
  return { blocks, used, dropped }
}
