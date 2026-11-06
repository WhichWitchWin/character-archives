// 指针表：每个角色一份的「他对某条命题的态度」（ADR 0081 / 0083）
//
// 结构（固定 4 元素）：
//   [人物id, 命题id, [[状态, 来源], ...], 建立轮]
//   - 状态：0 真 / 1 假 / 2 未定
//   - 来源：'' 自己 / 'p7' 某人 / '?' 未知来源
//
// 「自己」那组永远排第 0 位（如果有），只有本人能改（ADR 0083 规则⑨）。
// 别人组默认最多 3 组，超了丢最早的——一条指针上挂十个来源没有额外价值，
// 只会让快照无限膨胀。上限可由设置（cognition.maxOtherSources）传进来，不传就是 3。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const POINTER_FIELDS = 4
export const POINTER_PERSON = 0
export const POINTER_CLAIM = 1
export const POINTER_STATES = 2
export const POINTER_FROM = 3

/**
 * 约定状态（内部码，模型看到的是文字）。ADR 0087。
 *
 * 存在**来源组**里，组的形状是 `[态度, 来源, 游戏时间?, 约定状态?]`——
 * 因为"他什么时候听说的、他认为约定完成没有"都属于**这一次认知**，
 * 不属于整条指针（一个人可能听张三说办成了、听李四说黄了）。
 */
export const CONVENTION = Object.freeze({
  PENDING: 0,   // 没完成
  DONE: 1,      // 完成了
  EXPIRED: 2,   // 过期了
  FAILED: 3,    // 失败了
})

const CONVENTION_VALUES = new Set([CONVENTION.PENDING, CONVENTION.DONE, CONVENTION.EXPIRED, CONVENTION.FAILED])

export const TRUTH = Object.freeze({
  TRUE: 0,
  FALSE: 1,
  UNKNOWN: 2,
})

export const SELF = ''
export const UNKNOWN_SOURCE = '?'
export const MAX_OTHER_SOURCES = 3

const STATES = [TRUTH.TRUE, TRUTH.FALSE, TRUTH.UNKNOWN]

export function createPointers() {
  return []
}

/**
 * 建一条空指针；同一人同一命题已经有就返回已有的（ADR 0083：一人一命题一条指针）。
 * @returns {any[] | null}
 */
export function addPointer(pointers, { personId, claimId, turn } = {}) {
  if (!Array.isArray(pointers)) return null
  if (typeof personId !== 'string' || !personId) return null
  if (!Number.isInteger(claimId) || claimId <= 0) return null

  const existing = pointerOf(pointers, personId, claimId)
  if (existing) return existing

  const pointer = [personId, claimId, [], Number.isInteger(turn) ? turn : 0]
  pointers.push(pointer)
  return pointer
}

export function pointerOf(pointers, personId, claimId) {
  if (!Array.isArray(pointers)) return null
  return (
    pointers.find(
      (pointer) =>
        Array.isArray(pointer) && pointer[POINTER_PERSON] === personId && pointer[POINTER_CLAIM] === claimId,
    ) ?? null
  )
}

export function pointersOf(pointers, personId) {
  if (!Array.isArray(pointers)) return []
  return pointers.filter((pointer) => Array.isArray(pointer) && pointer[POINTER_PERSON] === personId)
}

export function pointersTo(pointers, claimId) {
  if (!Array.isArray(pointers)) return []
  return pointers.filter((pointer) => Array.isArray(pointer) && pointer[POINTER_CLAIM] === claimId)
}

/**
 * 写一组「态度 + 来源（+ 听到时的游戏时间 + 约定状态）」。
 * - 来源＝自己：找现有的自己那组改；没有就插到最前；**时间每次刷新**（"我现在这么认为"）
 * - 来源＝别人：找同来源那组改；没有就追加，超过上限丢最早的（按加入顺序）
 * @param {{state:number, source?:string, gt?:string, convention?:number, maxOtherSources?:number}} input
 *   maxOtherSources：「别人」组最多几组（设置 cognition.maxOtherSources）。
 *   不传／传不合法时就按默认 3 —— 老调用方的行为一个字都不变。
 * @returns {Array<number|string> | null} 写入的那组；参数不合法返回 null
 */
export function setEntry(pointer, { state, source = SELF, gt = '', convention = undefined, maxOtherSources = MAX_OTHER_SOURCES } = {}) {
  if (!Array.isArray(pointer)) return null
  if (!STATES.includes(state)) return null
  if (typeof source !== 'string') return null
  const at = typeof gt === 'string' && gt.trim() ? gt.trim() : ''
  const hasConvention = CONVENTION_VALUES.has(convention)
  // 只认正整数：小数／0／负数／字符串一律回落到默认，免得 trimOthers 拿脏值算名额
  const limit = Number.isInteger(maxOtherSources) && maxOtherSources >= 1 ? maxOtherSources : MAX_OTHER_SOURCES

  const groupOf = (value) => {
    const group = [state, value]
    // 第 3 格：游戏时间；没有 gt 但有约定状态时用空串占位（第 4 格才对得上）
    if (at || hasConvention) group.push(at)
    if (hasConvention) group.push(convention)
    return group
  }

  if (!Array.isArray(pointer[POINTER_STATES])) pointer[POINTER_STATES] = []
  const states = pointer[POINTER_STATES]

  if (source === SELF) {
    const index = states.findIndex((entry) => Array.isArray(entry) && entry[1] === SELF)
    const next = groupOf(SELF)
    if (index >= 0) states[index] = next
    else states.unshift(next)
    return next
  }

  const index = states.findIndex((entry) => Array.isArray(entry) && entry[1] === source)
  const next = groupOf(source)
  if (index >= 0) {
    states[index] = next
    return next
  }

  states.push(next)
  trimOthers(states, limit)
  return next
}

/**
 * 更新「最后变动轮」（指针第 4 格）。冷却要拿它算轮次差（ADR 0086）。
 * @returns {boolean} 写进去了吗
 */
export function touchPointer(pointer, turn) {
  if (!Array.isArray(pointer) || !Number.isInteger(turn) || turn < 0) return false
  pointer[POINTER_FROM] = turn
  return true
}

/** 读一组来源里的约定状态；没有返回 null。 */
export function conventionOf(entry) {
  if (!Array.isArray(entry)) return null
  const value = entry[3]
  return CONVENTION_VALUES.has(value) ? value : null
}

/** 别人组超出名额就丢最早的那一组（自组不算名额，ADR 0083 规则⑨）。 */
function trimOthers(states, limit = MAX_OTHER_SOURCES) {
  const others = states.filter((entry) => Array.isArray(entry) && entry[1] !== SELF)
  if (others.length <= limit) return
  const index = states.indexOf(others[0])
  if (index >= 0) states.splice(index, 1)
}

export function hasSelf(pointer) {
  return selfEntry(pointer) !== null
}

export function selfEntry(pointer) {
  if (!Array.isArray(pointer)) return null
  const states = pointer[POINTER_STATES]
  if (!Array.isArray(states)) return null
  return states.find((entry) => Array.isArray(entry) && entry[1] === SELF) ?? null
}

/**
 * 一条指针里**要显示出来**的几组来源（设置 cognition.conflictDisplay）。
 *
 * 为什么放在这一层：自动召回（recallEngine）、查档案与手动召回（recallQuery）都要挑同一批组——
 * 三处各写一遍挑法，迟早出现「提示词显示一种、工具返回显示另一种」。
 *
 * 只挑**渲染用的组**，快照里 `pointer[2]` 一个元素都不删：玩家改回「都显示」还是全的。
 *
 * @param {any[]} pointer
 * @param {'all'|'self'|'latest'} [conflictDisplay] 认不出的值按 all 处理
 * @returns {any[]} 新数组（不会返回指针里那个原数组本身）
 */
export function visibleGroups(pointer, conflictDisplay = 'all') {
  const states = Array.isArray(pointer?.[POINTER_STATES]) ? pointer[POINTER_STATES] : []
  if (conflictDisplay === 'latest') return states.length ? [states[states.length - 1]] : []
  if (conflictDisplay === 'self') {
    const self = states.filter((entry) => Array.isArray(entry) && entry[1] === SELF)
    // 没有「他自己那组」时退回全部：宁可多显示一种说法，也别渲染出一行空白
    return self.length ? self : [...states]
  }
  return [...states]
}

export function dropPointer(pointers, personId, claimId) {
  if (!Array.isArray(pointers)) return false
  const index = pointers.findIndex(
    (pointer) =>
      Array.isArray(pointer) && pointer[POINTER_PERSON] === personId && pointer[POINTER_CLAIM] === claimId,
  )
  if (index < 0) return false
  pointers.splice(index, 1)
  return true
}
