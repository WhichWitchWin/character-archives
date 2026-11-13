// 分叉继承（ADR 0110）：把父局的整局数据剪到分叉点，返回子局该有的那一份。
//
// 为什么需要：酒馆的分叉＝**开一局新游戏**（新 gameId），而插件自己的文件按 gameId 存，
// 官方文档也明说「自己写的文件不会随存档、分叉带走」——所以分叉后新局是空白。
// 订阅宿主的 `onTimelineChanged`（`kind:'fork'`，带 `fromGameId`）就能把父局搬过来。
//
// 这里只做**纯变换**（不碰 fs、不碰 ctx）：搬文件在 `lib/store.js`，订阅在 `index.mjs`。
// 剪枝复用回退那套 `pruneFutureFlags`——分叉点之后的 flags 记录都是「还没发生的未来」，
// 带过去会让候选表凭空多出人、离场判定算错。

import { pruneFutureFlags } from './rollback.js'

/** 整局数据的结构版本。跟 `index.mjs` 的 `DATA_VERSION` 同值，这里不 import（避免循环依赖）。 */
const STATE_VERSION = 1

/** 带轮次的 flags：分叉点是第 0 轮时，这些记录全部属于「还没发生」。 */
const TURN_SCOPED_FLAGS = ['seen', 'left', 'draft', 'fuzzyLeft', 'lastHits', 'playerBack']

/** 深拷贝：整局数据都可 JSON 化，clone 一下断开引用，改子局不会串到父局。 */
function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

/**
 * 冷却只留「分叉点之前就立下的」。
 *
 * 记录是 `{lastTurn, until}`：`lastTurn` 是立下这条冷却的那一轮。`lastTurn > 分叉点`
 * 说明它是分叉**之后**才发生的事，带过去会让子局的召回被「未来的冷却」压住好几轮——
 * 只少条目、不报错，很难查（`lib/cooldown.js` 记过同类问题）。
 * `until > 分叉点` 不算未来：那条召回确实发生在分叉之前，冷却自然延续是合理的。
 */
function pruneFutureCooldowns(cooldowns, cut) {
  const next = {}
  for (const [key, record] of Object.entries(cooldowns ?? {})) {
    if (!record || typeof record !== 'object') continue
    const at = Number.isInteger(record.lastTurn) ? record.lastTurn : 0
    if (cut == null || at <= cut) next[key] = record
  }
  return next
}

/**
 * 父局 → 子局的整局数据。
 *
 * @param {object} parent 父局的整局数据（`store.readGame(fromGameId)`）
 * @param {{forkTurn?:number|null}} [options] 分叉点轮次（0＝在开场白前分叉）；拿不到传 `null`＝不剪
 * @returns {object} 子局该有的整局数据（新对象，不与父局共享引用）
 */
export function inheritGameState(parent, { forkTurn = null } = {}) {
  // 数组／标量都当「没数据」：数组上挂属性在 JSON 里会整片丢掉，不能让它漏出去
  const source = parent && typeof parent === 'object' && !Array.isArray(parent) ? parent : {}
  const cut = Number.isInteger(forkTurn) && forkTurn >= 0 ? forkTurn : null
  const child = clone(source) ?? {}
  child.v = source.v === STATE_VERSION ? source.v : STATE_VERSION

  const meta = { ...(child.meta ?? {}) }
  if (cut != null) meta.updatedTurn = cut === 0 ? null : cut
  child.meta = meta

  const flags = clone(source.flags) ?? {}
  if (cut === 0) {
    // 一轮都没结算过：带轮次的记录全是未来
    for (const key of TURN_SCOPED_FLAGS) delete flags[key]
    child.flags = flags
    child.cooldowns = {}
  } else if (cut != null) {
    const pruned = pruneFutureFlags({ flags, turn: cut })
    // pruneFutureFlags 没管 lastHits（它是「上一轮命中」，同样带轮次），这里补一刀
    if (pruned.lastHits && typeof pruned.lastHits === 'object') {
      const kept = {}
      for (const [name, at] of Object.entries(pruned.lastHits)) {
        if (typeof at !== 'number' || at <= cut) kept[name] = at
      }
      pruned.lastHits = kept
    }
    child.flags = pruned
    child.cooldowns = pruneFutureCooldowns(child.cooldowns, cut)
  }

  // 快照索引**总是**归一成数组（半坏形状别漏到面板的 summary 里）；知道分叉点就截断
  const index = Array.isArray(child.snapshots?.index) ? child.snapshots.index : []
  child.snapshots = {
    ...(child.snapshots ?? {}),
    index: cut == null ? index : index.filter((item) => Number(item?.turn) <= cut),
  }

  // 预设归「全局 + 按卡」存：`saveGameState` 一直故意不写进整局数据（会撑体积、且是第二真相源）。
  // 分叉这条路也不能从父局把它们抄回来，否则玩家后来改预设时子局会「复活」旧栏目定义。
  delete child.entries
  delete child.mvuChecklist
  if (child.settings && typeof child.settings === 'object') {
    const settings = { ...child.settings }
    delete settings.checkedCodes
    child.settings = settings
  }

  // 调试日志是「这一局的现场记录」：新局从头记，别把父局的历史混进来
  child.debugLog = []
  return child
}
