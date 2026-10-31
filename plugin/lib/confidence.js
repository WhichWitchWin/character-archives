// 人物冷存档 · 信度体系（设计稿 §5.1 状态码、§5.5 关闭信度时的保留规则）
//
// 信度位永远是一个字符串，语法固定：
//   "0"～"9" 固定码 | "X" 无信度 | "N" 不标信度 | "r<号码>[+|-]" 他述且来源是字典第 N 号
//
// 注意别把两套码搞混（§5.1）：
//   值位置：字符串＝原文、数字＝字典下标（靠 JSON 类型区分）；
//   信度位：本文件这一套。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const SOURCE = Object.freeze({
  USER: 'user',         // 用户（主角）
  SELF: 'self',         // 自述
  OTHER: 'other',       // 他述
  MVU: 'mvu',           // 状态机抄入
  NONE: 'none',         // 无信度（关闭期间统一写这个）
  UNMARKED: 'unmarked', // 不标信度（开启期间也可用）
})

export const TRUTH = Object.freeze({
  TRUE: 'true',
  UNKNOWN: 'unknown',
  FALSE: 'false',
})

/** 四项排序的默认优先级，玩家可在设置页拖动改变（§5.5）。 */
export const DEFAULT_ORDER = Object.freeze(['turn', 'salience', 'truth', 'source'])

const FIXED = Object.freeze({
  0: [SOURCE.USER, TRUTH.TRUE],
  1: [SOURCE.USER, TRUTH.UNKNOWN],
  2: [SOURCE.USER, TRUTH.FALSE],
  3: [SOURCE.SELF, TRUTH.TRUE],
  4: [SOURCE.SELF, TRUTH.UNKNOWN],
  5: [SOURCE.SELF, TRUTH.FALSE],
  6: [SOURCE.OTHER, TRUTH.TRUE],
  7: [SOURCE.OTHER, TRUTH.UNKNOWN],
  8: [SOURCE.OTHER, TRUTH.FALSE],
})

const FIXED_CODE = new Map(
  Object.entries(FIXED).map(([code, [source, truth]]) => [`${source}:${truth}`, code]),
)

const VIA_PATTERN = /^r(\d+)([+-])?$/

const SOURCE_RANK = { user: 0, self: 1, other: 2, mvu: 3, none: 4, unmarked: 5 }
const TRUTH_RANK = { true: 0, unknown: 1, false: 2 }

/**
 * 解析信度位。
 * @returns {{source: string, truth: string|null, via: number|null} | null} 无法解析时返回 null
 */
export function parseConfidence(code) {
  if (typeof code !== 'string') return null
  if (code === '9') return { source: SOURCE.MVU, truth: null, via: null }
  if (code === 'X') return { source: SOURCE.NONE, truth: null, via: null }
  if (code === 'N') return { source: SOURCE.UNMARKED, truth: null, via: null }

  const match = VIA_PATTERN.exec(code)
  if (match) {
    const truth = match[2] === '+' ? TRUTH.TRUE : match[2] === '-' ? TRUTH.FALSE : TRUTH.UNKNOWN
    return { source: SOURCE.OTHER, truth, via: Number(match[1]) }
  }

  const fixed = FIXED[code]
  if (fixed) return { source: fixed[0], truth: fixed[1], via: null }

  return null
}

/** 把 {source, truth, via} 拼回信度位；拼不出来返回 null。 */
export function formatConfidence({ source, truth = null, via = null } = {}) {
  if (source === SOURCE.MVU) return '9'
  if (source === SOURCE.NONE) return 'X'
  if (source === SOURCE.UNMARKED) return 'N'

  if (source === SOURCE.OTHER && via !== null) {
    if (!Number.isInteger(via) || via < 0) return null
    // 只有「未定」才允许省略后缀；拼错的真值一律返回 null，不许悄悄写成未定。
    let suffix = ''
    if (truth === TRUTH.TRUE) suffix = '+'
    else if (truth === TRUTH.FALSE) suffix = '-'
    else if (truth !== TRUTH.UNKNOWN && truth !== null) return null
    return `r${via}${suffix}`
  }

  return FIXED_CODE.get(`${source}:${truth}`) ?? null
}

const ORDER_KEYS = new Set(['turn', 'salience', 'truth', 'source'])

/**
 * 比较两条同栏目条目，负数表示 a 该排前面（也就是该被保留）。
 * salienceOf(entry) 给出「来源关键度」：用户＝999999，在册人物按非空条目数，路人最低。
 * order 来自设置页的拖动，脏数据（空的、含未知键）一律回落默认顺序 ——
 * 静默判平会让稳定排序保留最旧的那条，等于关信度时把用户新写的值丢掉。
 */
export function compareEntries(a, b, { order = DEFAULT_ORDER, salienceOf = () => 0 } = {}) {
  const keys = Array.isArray(order) && order.length > 0 && order.every((key) => ORDER_KEYS.has(key))
    ? order
    : DEFAULT_ORDER
  for (const key of keys) {
    if (key === 'turn') {
      const diff = b[3] - a[3]
      if (diff) return diff
    } else if (key === 'salience') {
      const diff = salienceOf(b) - salienceOf(a)
      if (diff) return diff
    } else if (key === 'truth') {
      const diff = truthRank(a) - truthRank(b)
      if (diff) return diff
    } else if (key === 'source') {
      const diff = sourceRank(a) - sourceRank(b)
      if (diff) return diff
    }
  }
  return 0
}

/**
 * 关闭信度时的保留规则（§5.5），针对**同一个栏目**的多条值：
 *   1. "N"（不标信度）原样保留，不参与排序、不被丢弃；
 *   2. 有 MVU 值（"9"）就只留轮次最新那条，其余非 N 值全丢；
 *   3. 没有 MVU 才排序，只留排第一的那条，其余丢弃。
 *
 * 唯一值条目（默认只有「姓名」）不排序、直接去码，由调用方按条目定义处理 —— 条目定义到 M4 才有。
 * 信度位坏掉的条目按丢弃处理，不猜它的语义。
 */
export function selectKept(entries, { order = DEFAULT_ORDER, salienceOf = () => 0 } = {}) {
  const kept = []
  const dropped = []
  const rest = []
  const mvu = []

  for (const entry of entries) {
    const parsed = parseConfidence(entry[2])
    if (!parsed) {
      dropped.push(entry)
    } else if (parsed.source === SOURCE.UNMARKED) {
      kept.push(entry)
    } else if (parsed.source === SOURCE.MVU) {
      mvu.push(entry)
    } else {
      rest.push(entry)
    }
  }

  if (mvu.length) {
    const newest = mvu.reduce((best, entry) => (entry[3] > best[3] ? entry : best))
    kept.push(newest)
    for (const entry of mvu) if (entry !== newest) dropped.push(entry)
    dropped.push(...rest)
  } else if (rest.length) {
    const sorted = [...rest].sort((a, b) => compareEntries(a, b, { order, salienceOf }))
    kept.push(sorted[0])
    dropped.push(...sorted.slice(1))
  }

  return { kept, dropped }
}

function truthRank(entry) {
  const parsed = parseConfidence(entry[2])
  return parsed && parsed.truth ? TRUTH_RANK[parsed.truth] : 3
}

function sourceRank(entry) {
  const parsed = parseConfidence(entry[2])
  return parsed ? SOURCE_RANK[parsed.source] ?? 6 : 6
}
