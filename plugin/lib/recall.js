// 召回打分（设计稿 §7.10 召回加权算法）
//
//   召回分 =（匹配 + 一致性 + 先验 + 时效）÷ 4
//
// 四个信号都用**固定刻度**归一化，不按本轮候选做 min-max ——
// 候选只有一两个时，min-max 会把最高分永远抬成 1.0，变成「只要命中就满分」，阈值就没意义了。
//
// 注意：设计稿里「匹配」也含关联线索（每条 0.5），「一致性」也是同一批线索的对上条数，
// 所以同一线索会在这两项各加一次。这是设计稿的写法，本模块照实现，不在算法层偷偷减权。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 分档阈值（§7.10） */
export const TIER = Object.freeze({
  full: 0.8,      // ≥ 0.80 全量召回
  brief: 0.5,     // 0.50～0.80 简版 + 相关条目
  candidate: 0.3, // 0.30～0.50 最简提示或进候选
})

/** 同名候选分差小于这个值，视为分不清（§7.10） */
export const SAME_NAME_GAP = 0.1

export const MATCH = Object.freeze({
  name: 1.0,       // 姓名命中
  alias: 0.9,      // 别名命中
  singleName: 0.6, // 单字名命中
  clue: 0.5,       // 第一条关联线索
  cap: 1.0,        // 匹配总分封顶
})

/** 一致性：对上的关联项条数 → 分数（§7.10） */
export const CONSISTENCY = Object.freeze({ one: 0.4, two: 0.7, three: 1.0 })

/**
 * 关联线索的递减累加：0.5、0.75、0.875… 封顶 1.0。
 * 「多条按递减累加」照设计稿；再多的线索也不会比"姓名命中"更重。
 */
export function clueScore(count) {
  let total = 0
  let step = MATCH.clue
  for (let index = 0; index < Math.max(0, count); index += 1) {
    total += step
    step /= 2
  }
  return Math.min(MATCH.cap, total)
}

/**
 * 匹配分：取最强的那一项当底，再叠加线索分，封顶 1.0。
 * @param {{name?:boolean, alias?:boolean, singleName?:boolean, clues?:number}} signals
 */
export function matchScore({ name = false, alias = false, singleName = false, clues = 0 } = {}) {
  const base = name ? MATCH.name : alias ? MATCH.alias : singleName ? MATCH.singleName : 0
  return Math.min(MATCH.cap, base + clueScore(clues))
}

/**
 * 一致性：这一轮提到的其它东西，和该人物档案里登记的关联项对上了几条。
 * 「没点名但明显相关」靠它抓。
 */
export function consistencyScore(hits) {
  if (hits >= 3) return CONSISTENCY.three
  if (hits === 2) return CONSISTENCY.two
  if (hits === 1) return CONSISTENCY.one
  return 0
}

/**
 * 先验：关键度在全册中的分位，0～1。
 * 比我先的人越多，分位越高；并列的分数相同。全册只有一个人时给 1。
 */
export function priorScore(salience, all) {
  const list = Array.isArray(all) ? all : []
  if (list.length <= 1) return 1
  const below = list.filter((value) => value < salience).length
  return Math.min(1, below / (list.length - 1))
}

/** 时效：exp(-0.01 × 距上次更新的轮数)。轮次不会倒着算是调用方的事。 */
export function recencyScore(turn, lastTurn) {
  const gap = Math.max(0, (turn ?? 0) - (lastTurn ?? 0))
  return Math.exp(-0.01 * gap)
}

/** 总分 = 四项等权平均。 */
export function totalScore({ match = 0, consistency = 0, prior = 0, recency = 0 } = {}) {
  return (match + consistency + prior + recency) / 4
}

/**
 * 分档。
 * @param {number} score
 * @param {{weakOnly?: boolean}} options
 *   weakOnly：只靠单字名命中（没有别的信号）时，最多只到「候选」，不真召回 —— ADR 里的单字名规则。
 * @returns {'full'|'brief'|'candidate'|'none'}
 */
export function tierOf(score, { weakOnly = false } = {}) {
  const tier = score >= TIER.full ? 'full'
    : score >= TIER.brief ? 'brief'
      : score >= TIER.candidate ? 'candidate'
        : 'none'
  if (weakOnly && (tier === 'full' || tier === 'brief')) return 'candidate'
  return tier
}

/** 同名消歧：两个候选分差小于 0.10 → 分不清。 */
export function sameNameAmbiguous(scoreA, scoreB) {
  // 用一点容差：0.9 - 0.8 在浮点里是 0.09999999999999998，正好卡在边界上
  return Math.abs(scoreA - scoreB) < SAME_NAME_GAP - 1e-9
}
