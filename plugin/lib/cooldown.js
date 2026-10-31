// 人物冷存档 · 召回冷却（设计稿 §7.5、§3.6）
//
// 三个层次别混（§7.5）：
//   1. 是否允许召回 —— 由冷却决定，是闸门；
//   2. 是否真的召回 —— 由姓名／别名／线索命中决定；
//   3. 召回什么 —— 全量，或简版＋相关条目。
//
// 粒度：**全量召回冷却整个人物**；简版／连带召回只冷却**给过的具体条目**。
// 0 轮 = 无冷却（不记）。
//
// 清理规则：冷却一结束（当前轮 ≥ 截止轮）就**立刻删掉那条记录** —— 它的使命已经结束，
// 留着只会让整局数据越积越多。这样回退也安全：
//   - 未到期的记录还在 → 冷却仍生效；
//   - 已到期的早删了 → 回退到更早轮次时，本来也该允许召回。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx，数据进数据出。

export const DEFAULT_COOLDOWN_TURNS = 10

/** 冷却表的初始形状：键是 personKey / entryKey。 */
export function createCooldowns() {
  return {}
}

/** 人物级键（全量召回用）。 */
export function personKey(personId) {
  return `p:${personId}`
}

/** 条目级键（简版／连带召回用）。 */
export function entryKey(personId, code) {
  return `e:${personId}:${code}`
}

/**
 * 记一次召回。
 * @param {number} turns 冷却轮数；<= 0 表示无冷却，不记录
 */
export function rememberRecall(cooldowns, key, turn, turns = DEFAULT_COOLDOWN_TURNS) {
  const next = { ...(cooldowns ?? {}) }
  if (!(turns > 0)) return next
  next[key] = { lastTurn: turn, until: turn + turns }
  return next
}

/** 这个键在当前轮还在冷却里吗。没记过 = 不在冷却。 */
export function isCoolingDown(cooldowns, key, turn) {
  const record = cooldowns?.[key]
  if (!record) return false
  return turn < record.until
}

/** 删掉已经到期的记录（当前轮 ≥ 截止轮）。 */
export function pruneExpired(cooldowns, turn) {
  const next = {}
  for (const [key, record] of Object.entries(cooldowns ?? {})) {
    if (record.until > turn) next[key] = record
  }
  return next
}
